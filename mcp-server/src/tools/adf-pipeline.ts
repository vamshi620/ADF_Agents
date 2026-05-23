/**
 * Tool: generate_adf_pipeline
 *
 * Builds a complete Azure Data Factory ARM template JSON containing:
 *   - SQL Server Linked Service  (Windows Auth / SQL Auth via .env)
 *   - Source dataset(s)         (inline SQL — NO stored procedure references)
 *   - Sink dataset(s)           (for Copy activities)
 *   - Pipeline                  (Lookup | Copy | Script activities)
 *
 * Writes the template to workspace/adf/<pipelineName>.json.
 * Trigger type is always Manual / on-demand.
 */
import * as fs   from 'fs';
import * as path from 'path';
import { WORKSPACE_ROOT } from '../config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface AdfSqlActivity {
  /** Unique activity name (no spaces allowed by ADF) */
  name:             string;
  /** Lookup → returns rows; Copy → source→sink; Script → fire-and-forget DML */
  type:             'Lookup' | 'Copy' | 'Script';
  /** Inline T-SQL. NEVER a EXEC / stored-procedure call. */
  sqlQuery:         string;
  /** For Copy: destination table as "schema.table" (e.g. "dbo.StagingClaims") */
  destinationTable?: string;
  /** Activity names that must succeed before this one starts */
  dependsOn?:       string[];
  /** Description shown in ADF Studio */
  description?:     string;
}

export interface GenerateAdfPipelineOptions {
  pipelineName:        string;
  pipelineDescription: string;
  activities:          AdfSqlActivity[];
  sqlServerName?:      string;
  databaseName?:       string;
  linkedServiceName?:  string;
}

export interface GenerateAdfPipelineResult {
  success:          boolean;
  pipelineName:     string;
  filePath:         string;
  linkedServiceName:string;
  datasetsCreated:  string[];
  activitiesCreated:string[];
  armTemplate:      object;
  error?:           string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ARM resource builders
// ─────────────────────────────────────────────────────────────────────────────

function armName(factoryParam: string, resourceName: string): string {
  return `[concat(parameters('${factoryParam}'), '/${resourceName}')]`;
}

function factoryRef(resourceSegment: string): string {
  return `[concat(variables('factoryId'), '/${resourceSegment}')]`;
}

function buildLinkedService(lsName: string, sqlServer: string, database: string): object {
  const trustedConn = process.env.DB_TRUSTED_CONNECTION === 'true';
  const connStr = trustedConn
    ? `Data Source=${sqlServer};Initial Catalog=${database};Integrated Security=True;`
    : `Data Source=${sqlServer};Initial Catalog=${database};User ID=${process.env.DB_USER ?? ''};Password=${process.env.DB_PASSWORD ?? ''};`;

  return {
    name:       armName('factoryName', lsName),
    type:       'Microsoft.DataFactory/factories/linkedservices',
    apiVersion: '2018-06-01',
    properties: {
      type:        'SqlServer',
      description: `SQL Server linked service — ${database} on ${sqlServer}`,
      typeProperties: { connectionString: connStr },
    },
    dependsOn: [],
  };
}

function buildSourceDataset(dsName: string, lsName: string): object {
  return {
    name:       armName('factoryName', dsName),
    type:       'Microsoft.DataFactory/factories/datasets',
    apiVersion: '2018-06-01',
    properties: {
      type:        'SqlServerTable',
      description: `Generic source dataset — inline SQL injected per activity`,
      linkedServiceName: { referenceName: lsName, type: 'LinkedServiceReference' },
      typeProperties: {},
      schema: [],
    },
    dependsOn: [factoryRef(`linkedServices/${lsName}`)],
  };
}

function buildSinkDataset(dsName: string, destinationTable: string, lsName: string): object {
  const [schema, table] = destinationTable.includes('.')
    ? destinationTable.split('.', 2)
    : ['dbo', destinationTable];

  return {
    name:       armName('factoryName', dsName),
    type:       'Microsoft.DataFactory/factories/datasets',
    apiVersion: '2018-06-01',
    properties: {
      type:        'SqlServerTable',
      description: `Sink dataset → [${schema}].[${table}]`,
      linkedServiceName: { referenceName: lsName, type: 'LinkedServiceReference' },
      typeProperties: { schema, table },
    },
    dependsOn: [factoryRef(`linkedServices/${lsName}`)],
  };
}

function buildActivityJson(
  act:              AdfSqlActivity,
  sourceDataset:    string,
  lsName:           string,
  sinkDataset?:     string,
): object {
  const deps = (act.dependsOn ?? []).map(d => ({
    activity:             d,
    dependencyConditions: ['Succeeded'],
  }));

  const policy = {
    timeout:                '0.12:00:00',
    retry:                  0,
    retryIntervalInSeconds: 30,
    secureOutput:           false,
    secureInput:            false,
  };

  if (act.type === 'Lookup') {
    return {
      name:        act.name,
      description: act.description ?? '',
      type:        'Lookup',
      dependsOn:   deps,
      policy,
      userProperties: [],
      typeProperties: {
        source: {
          type:           'SqlServerSource',
          sqlReaderQuery: act.sqlQuery,      // ← inline SQL, no SP
          queryTimeout:   '02:00:00',
          partitionOption:'None',
        },
        dataset:       { referenceName: sourceDataset, type: 'DatasetReference' },
        firstRowOnly:  false,
      },
    };
  }

  if (act.type === 'Script') {
    return {
      name:        act.name,
      description: act.description ?? '',
      type:        'Script',
      dependsOn:   deps,
      policy,
      userProperties: [],
      linkedServiceName: { referenceName: lsName, type: 'LinkedServiceReference' },
      typeProperties: {
        scripts: [{ type: 'NonQuery', text: act.sqlQuery }],  // ← inline SQL, no SP
        logSettings: { logDestination: 'ActivityOutput' },
      },
    };
  }

  // Copy
  if (!sinkDataset) throw new Error(`Copy activity "${act.name}" requires destinationTable.`);
  return {
    name:        act.name,
    description: act.description ?? '',
    type:        'Copy',
    dependsOn:   deps,
    policy,
    userProperties: [],
    typeProperties: {
      source: {
        type:           'SqlServerSource',
        sqlReaderQuery: act.sqlQuery,        // ← inline SQL, no SP
        queryTimeout:   '02:00:00',
        partitionOption:'None',
      },
      sink: {
        type:                  'SqlServerSink',
        writeBehavior:         'insert',
        sqlWriterUseTableLock: false,
        tableOption:           'autoCreate',
        disableMetricsCollection: false,
      },
      enableStaging: false,
      translator: {
        type:                'TabularTranslator',
        typeConversion:      true,
        typeConversionSettings: {
          allowDataTruncation: true,
          treatBooleanAsNumber:false,
        },
      },
    },
    inputs:  [{ referenceName: sourceDataset, type: 'DatasetReference' }],
    outputs: [{ referenceName: sinkDataset,   type: 'DatasetReference' }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function generateAdfPipeline(opts: GenerateAdfPipelineOptions): GenerateAdfPipelineResult {
  const {
    pipelineName,
    pipelineDescription,
    activities,
    sqlServerName     = process.env.DB_SERVER   ?? 'localhost',
    databaseName      = process.env.DB_DATABASE ?? 'YourDatabase',
    linkedServiceName = `LS_SqlServer_${pipelineName}`,
  } = opts;

  const factoryName = process.env.AZURE_ADF_FACTORY_NAME ?? '<your-adf-factory-name>';
  const datasetsCreated:   string[] = [];
  const activitiesCreated: string[] = [];
  const armResources:      object[] = [];

  // 1. Linked Service
  armResources.push(buildLinkedService(linkedServiceName, sqlServerName, databaseName));

  // 2. Shared source dataset
  const srcDs = `DS_${pipelineName}_Source`;
  armResources.push(buildSourceDataset(srcDs, linkedServiceName));
  datasetsCreated.push(srcDs);

  // 3. Sink datasets (per unique destination table)
  const sinkMap = new Map<string, string>();
  for (const act of activities) {
    if (act.type === 'Copy' && act.destinationTable && !sinkMap.has(act.destinationTable)) {
      const safeName = act.destinationTable.replace(/[^a-zA-Z0-9_]/g, '_');
      const sinkDs   = `DS_${pipelineName}_Sink_${safeName}`;
      armResources.push(buildSinkDataset(sinkDs, act.destinationTable, linkedServiceName));
      datasetsCreated.push(sinkDs);
      sinkMap.set(act.destinationTable, sinkDs);
    }
  }

  // 4. Activities
  const adfActivities: object[] = [];
  for (const act of activities) {
    adfActivities.push(buildActivityJson(act, srcDs, linkedServiceName, act.destinationTable ? sinkMap.get(act.destinationTable) : undefined));
    activitiesCreated.push(act.name);
  }

  // 5. Pipeline resource
  const pipelineResource = {
    name:       armName('factoryName', pipelineName),
    type:       'Microsoft.DataFactory/factories/pipelines',
    apiVersion: '2018-06-01',
    properties: {
      description: pipelineDescription,
      activities:  adfActivities,
      policy:      { elapsedTimeMetric: {} },
      parameters:  {},
      variables:   {},
      annotations: [`ADF-Copilot-Agent`, `SQL-Only`, `No-StoredProcs`],
    },
    dependsOn: [
      factoryRef(`linkedServices/${linkedServiceName}`),
      factoryRef(`datasets/${srcDs}`),
      ...Array.from(sinkMap.values()).map(ds => factoryRef(`datasets/${ds}`)),
    ],
  };
  armResources.push(pipelineResource);

  // 6. Full ARM template
  const armTemplate = {
    $schema:        'http://schema.management.azure.com/schemas/2015-01-01/deploymentTemplate.json#',
    contentVersion: '1.0.0.0',
    parameters: {
      factoryName: {
        type: 'string',
        metadata: { description: 'Name of the Azure Data Factory instance.' },
        defaultValue: factoryName,
      },
    },
    variables: {
      factoryId: `[concat('Microsoft.DataFactory/factories/', parameters('factoryName'))]`,
    },
    resources: armResources,
  };

  // 7. Write to workspace/adf/
  const adfDir    = path.join(WORKSPACE_ROOT, 'workspace', 'adf');
  fs.mkdirSync(adfDir, { recursive: true });
  const outputPath = path.join(adfDir, `${pipelineName}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(armTemplate, null, 2), 'utf-8');

  return { success: true, pipelineName, filePath: outputPath, linkedServiceName, datasetsCreated, activitiesCreated, armTemplate };
}
