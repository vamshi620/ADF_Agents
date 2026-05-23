#!/usr/bin/env node
/**
 * ADF Copilot Agents – MCP Server
 *
 * Exposes 10 tools to GitHub Copilot agents via the Model Context Protocol:
 *   1.  get_db_schema         – fetch SQL Server schema (tables, columns, PKs, FKs, indexes)
 *   2.  run_sql               – execute inline SQL with dry-run safety (NO stored procs)
 *   3.  read_file             – read any file in the workspace/
 *   4.  write_file            – create or update files in workspace/
 *   5.  list_files            – list workspace directory contents
 *   6.  generate_adf_pipeline – build ADF ARM template JSON from inline SQL activities
 *   7.  deploy_to_adf         – deploy Linked Service + Datasets + Pipeline to Azure ADF
 *   8.  run_adf_pipeline      – trigger pipeline run, poll to completion, return activity details
 *   9.  generate_word_doc     – produce styled .docx documents
 *   10. save_csv              – write a CSV file to workspace/csv/
 *
 * Design principles:
 *   ✅ ALL SQL is inline — sqlReaderQuery / Script activities only
 *   ❌ NO stored procedure references anywhere in generated pipelines
 *   ✅ Supports both Service Principal and Azure CLI authentication
 *   ✅ Trigger type is always Manual (on-demand)
 */

import { McpServer }            from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z }                    from 'zod';

import { getDbSchema }        from './tools/db-schema.js';
import { runSql }             from './tools/run-sql.js';
import { readFile, writeFile, listFiles } from './tools/file-system.js';
import { generateAdfPipeline }from './tools/adf-pipeline.js';
import { deployToAdf }        from './tools/adf-deploy.js';
import { runAdfPipeline }     from './tools/adf-runner.js';
import { generateWordDoc }    from './tools/generate-docx.js';
import { saveCsv }            from './tools/save-csv.js';

// ── Create the MCP server ──────────────────────────────────────────────────
const server = new McpServer({
  name:    'adf-copilot-mcp-server',
  version: '1.0.0',
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool 1: get_db_schema
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'get_db_schema',
  'Connects to the configured SQL Server database and returns a complete schema description ' +
  'including all tables, columns, data types, nullability, primary keys, foreign keys, ' +
  'indexes, and approximate row counts. Optionally filter to specific tables.',
  {
    tables: z
      .array(z.string())
      .optional()
      .describe('Optional list of table names to filter. Leave empty to fetch all tables.'),
  },
  async ({ tables }) => {
    try {
      const result = await getDbSchema(tables);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `ERROR: ${String(err)}` }], isError: true };
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 2: run_sql
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'run_sql',
  'Executes an inline SQL script against the configured SQL Server database. ' +
  'IMPORTANT: Use only raw SELECT / INSERT / UPDATE / DELETE / DDL statements. ' +
  'NEVER pass EXEC or stored procedure calls. ' +
  'Supports GO batch separators. Use dryRun=true to validate without committing. ' +
  'Always runs inside a transaction — rolled back automatically on error or dry-run.',
  {
    sqlScript: z
      .string()
      .describe('Inline T-SQL script. Use GO on its own line to separate batches. NO stored procedure calls.'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, runs in a transaction that is always rolled back. Safe preview mode.'),
    database: z
      .string()
      .optional()
      .describe('Override the target database. Defaults to DB_DATABASE in .env.'),
  },
  async ({ sqlScript, dryRun, database }) => {
    try {
      const result = await runSql({ sqlScript, dryRun, database });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `ERROR: ${String(err)}` }], isError: true };
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 3: read_file
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'read_file',
  'Reads a file from the project workspace. Use to read ADF_MEMORY.md for pipeline state, ' +
  'SQL scripts from workspace/sql/, or ARM templates from workspace/adf/.',
  {
    filePath: z
      .string()
      .describe('File path relative to the project root. E.g. "ADF_MEMORY.md", "workspace/adf/ClaimExtract.json".'),
  },
  async ({ filePath }) => {
    try {
      const result = readFile({ filePath });
      return {
        content: [{
          type: 'text' as const,
          text: result.exists ? result.content : `[File not found: ${filePath}]`,
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `ERROR: ${String(err)}` }], isError: true };
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 4: write_file
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'write_file',
  'Creates or overwrites a file in the project workspace. ' +
  'Use to create ADF_MEMORY.md, save generated SQL scripts, or write ARM templates.',
  {
    filePath: z
      .string()
      .describe('File path relative to the project root. E.g. "ADF_MEMORY.md", "workspace/sql/001_Extract.sql".'),
    content:  z.string().describe('Full text content to write.'),
    append:   z.boolean().optional().default(false).describe('If true, appends instead of overwriting.'),
  },
  async ({ filePath, content, append }) => {
    try {
      const result = writeFile({ filePath, content, append });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `ERROR: ${String(err)}` }], isError: true };
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 5: list_files
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'list_files',
  'Lists files in a project workspace directory.',
  {
    directory: z.string().optional().default('.').describe('Directory relative to project root.'),
    pattern:   z.string().optional().describe('File extension filter, e.g. ".sql" or ".json".'),
    recursive: z.boolean().optional().default(false).describe('Include subdirectories recursively.'),
  },
  async ({ directory, pattern, recursive }) => {
    try {
      const result = listFiles({ directory, pattern, recursive });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `ERROR: ${String(err)}` }], isError: true };
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 6: generate_adf_pipeline
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'generate_adf_pipeline',
  'Generates an Azure Data Factory ARM template JSON containing a Linked Service, ' +
  'source/sink Datasets, and a Pipeline with inline SQL activities. ' +
  'IMPORTANT: NO stored procedure references — every activity uses sqlReaderQuery (inline SQL). ' +
  'Supports Lookup (returns rows), Copy (source→sink table), and Script (fire-and-forget DML) activities. ' +
  'Writes the template to workspace/adf/<pipelineName>.json and returns the full ARM JSON. ' +
  'Trigger type is always Manual (on-demand).',
  {
    pipelineName:        z.string().describe('Short pipeline name — no spaces (e.g. "ClaimExtract").'),
    pipelineDescription: z.string().describe('Human-readable description shown in ADF Studio.'),
    activities: z.array(
      z.object({
        name:  z.string().describe('Unique activity name within the pipeline.'),
        type:  z.enum(['Lookup', 'Copy', 'Script']).describe(
          'Lookup = returns rows. Copy = moves data to a sink table. Script = executes DML with no output.',
        ),
        sqlQuery: z.string().describe(
          'Inline T-SQL query — NO stored procedure calls. ' +
          'SELECT for Lookup/Copy source; INSERT/UPDATE/DELETE for Script.',
        ),
        destinationTable: z.string().optional().describe(
          'Required for Copy. Target table as "schema.table" (e.g. "dbo.StagingClaims"). Auto-created if absent.',
        ),
        dependsOn:   z.array(z.string()).optional().describe('Activity names that must succeed first.'),
        description: z.string().optional().describe('Optional description shown in ADF Studio.'),
      }),
    ).describe('Ordered list of SQL activities to include in the pipeline.'),
    sqlServerName:     z.string().optional().describe('SQL Server hostname. Defaults to DB_SERVER from .env.'),
    databaseName:      z.string().optional().describe('Database name. Defaults to DB_DATABASE from .env.'),
    linkedServiceName: z.string().optional().describe('ADF Linked Service name. Defaults to LS_SqlServer_<pipelineName>.'),
  },
  async ({ pipelineName, pipelineDescription, activities, sqlServerName, databaseName, linkedServiceName }) => {
    try {
      const result = generateAdfPipeline({ pipelineName, pipelineDescription, activities, sqlServerName, databaseName, linkedServiceName });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `ERROR: ${String(err)}` }], isError: true };
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 7: deploy_to_adf
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'deploy_to_adf',
  'Deploys an ADF ARM template (Linked Service, Datasets, and Pipeline) to Azure Data Factory ' +
  'via the Azure Management REST API. ' +
  'Reads Azure config from .env (AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, AZURE_ADF_FACTORY_NAME). ' +
  'Auth methods: ' +
  '  "azure-cli" — uses token from `az login` (recommended for first-time users). ' +
  '  "service-principal" — uses AZURE_CLIENT_ID + AZURE_CLIENT_SECRET from .env (for automation). ' +
  'Returns a portal URL to view the deployed pipeline in ADF Studio.',
  {
    armTemplatePath: z.string().describe(
      'Path to the ARM template JSON. Relative to project root (e.g. "workspace/adf/ClaimExtract.json") or absolute.',
    ),
    authMethod: z.enum(['service-principal', 'azure-cli']).describe(
      '"azure-cli": uses `az login` token. "service-principal": uses AZURE_CLIENT_ID/SECRET from .env.',
    ),
    subscriptionId: z.string().optional().describe('Override AZURE_SUBSCRIPTION_ID from .env.'),
    resourceGroup:  z.string().optional().describe('Override AZURE_RESOURCE_GROUP from .env.'),
    factoryName:    z.string().optional().describe('Override AZURE_ADF_FACTORY_NAME from .env.'),
    tenantId:       z.string().optional().describe('Override AZURE_TENANT_ID (service-principal only).'),
    clientId:       z.string().optional().describe('Override AZURE_CLIENT_ID (service-principal only).'),
    clientSecret:   z.string().optional().describe('Override AZURE_CLIENT_SECRET (service-principal only).'),
  },
  async ({ armTemplatePath, authMethod, subscriptionId, resourceGroup, factoryName, tenantId, clientId, clientSecret }) => {
    try {
      const result = await deployToAdf({ armTemplatePath, authMethod, subscriptionId, resourceGroup, factoryName, tenantId, clientId, clientSecret });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `ERROR: ${String(err)}` }], isError: true };
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 8: run_adf_pipeline
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'run_adf_pipeline',
  'Triggers an Azure Data Factory pipeline run (manual/on-demand) and polls until it finishes. ' +
  'Returns the final status (Succeeded | Failed | Cancelled | TimedOut), ' +
  'per-activity run details (rows read/written, duration, errors), ' +
  'and a direct link to the ADF monitoring portal for this specific run.',
  {
    pipelineName: z.string().describe('Name of the ADF pipeline to trigger (must already be deployed).'),
    authMethod:   z.enum(['service-principal', 'azure-cli']).describe(
      '"azure-cli": uses `az login` token. "service-principal": uses AZURE_CLIENT_ID/SECRET from .env.',
    ),
    parameters:          z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Optional pipeline run parameters.'),
    pollIntervalSeconds: z.number().optional().describe('Seconds between status polls. Default: 10.'),
    timeoutMinutes:      z.number().optional().describe('Max wait time in minutes before TimedOut. Default: 60.'),
    subscriptionId:      z.string().optional().describe('Override AZURE_SUBSCRIPTION_ID from .env.'),
    resourceGroup:       z.string().optional().describe('Override AZURE_RESOURCE_GROUP from .env.'),
    factoryName:         z.string().optional().describe('Override AZURE_ADF_FACTORY_NAME from .env.'),
    tenantId:            z.string().optional().describe('Override AZURE_TENANT_ID.'),
    clientId:            z.string().optional().describe('Override AZURE_CLIENT_ID.'),
    clientSecret:        z.string().optional().describe('Override AZURE_CLIENT_SECRET.'),
  },
  async ({ pipelineName, authMethod, parameters, pollIntervalSeconds, timeoutMinutes,
           subscriptionId, resourceGroup, factoryName, tenantId, clientId, clientSecret }) => {
    try {
      const result = await runAdfPipeline({
        pipelineName, authMethod, parameters, pollIntervalSeconds, timeoutMinutes,
        subscriptionId, resourceGroup, factoryName, tenantId, clientId, clientSecret,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `ERROR: ${String(err)}` }], isError: true };
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 9: generate_word_doc
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'generate_word_doc',
  'Generates a professionally styled Word (.docx) document. Use for requirements, code reviews, and test reports.',
  {
    filename: z.string().describe('Output filename. Extension .docx added automatically.'),
    title: z.string().describe('Main document title.'),
    subtitle: z.string().optional().describe('Optional subtitle.'),
    author: z.string().optional().describe('Author name.'),
    sections: z.array(
      z.object({
        heading: z.string().describe('Section heading.'),
        content: z.string().describe('Markdown-like content. Use "- " for bullets, "1. " for numbers.'),
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe('Heading level (1-3). Default 2.'),
        table: z.object({
          headers: z.array(z.string()),
          rows: z.array(z.array(z.string()))
        }).optional().describe('Optional table to append to the section.')
      })
    ).describe('Document sections.'),
  },
  async ({ filename, title, subtitle, author, sections }) => {
    try {
      const result = await generateWordDoc({ filename, title, subtitle, author, sections });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `ERROR: ${String(err)}` }], isError: true };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 10: save_csv
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'save_csv',
  'Writes a CSV file to workspace/csv/',
  {
    filename: z.string().describe('Output filename. Extension .csv added automatically.'),
    headers: z.array(z.string()).describe('Array of column header strings.'),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe('Array of data rows.'),
  },
  async ({ filename, headers, rows }) => {
    try {
      const result = saveCsv({ filename, headers, rows });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `ERROR: ${String(err)}` }], isError: true };
    }
  }
);

// ── Start server over stdio ────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('ADF MCP Server failed to start:', err);
  process.exit(1);
});
