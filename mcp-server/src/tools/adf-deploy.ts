/**
 * Tool: deploy_to_adf
 *
 * Deploys an ADF ARM template to Azure via the Management REST API.
 * Deploys resources in correct dependency order:
 *   1. Linked Services
 *   2. Datasets
 *   3. Pipelines
 *
 * Auth options:
 *   - "azure-cli"        → uses `az account get-access-token` (user must be logged in)
 *   - "service-principal"→ uses client-credentials grant with AZURE_CLIENT_ID / SECRET
 */
import * as fs   from 'fs';
import * as path from 'path';
import { WORKSPACE_ROOT, getAzureConfig } from '../config.js';

export type AuthMethod = 'service-principal' | 'azure-cli';

export interface DeployToAdfOptions {
  armTemplatePath: string;
  authMethod:      AuthMethod;
  subscriptionId?: string;
  resourceGroup?:  string;
  factoryName?:    string;
  tenantId?:       string;
  clientId?:       string;
  clientSecret?:   string;
}

export interface DeployToAdfResult {
  success:           boolean;
  deploymentName:    string;
  resourcesDeployed: string[];
  portalUrl?:        string;
  error?:            string;
  details?:          string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getCliToken(): Promise<string> {
  const { execSync } = await import('child_process');
  const raw = execSync(
    'az account get-access-token --resource https://management.azure.com --query accessToken -o tsv',
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
  if (!raw || raw.length < 20) throw new Error('Azure CLI returned an empty token. Run `az login` first.');
  return raw;
}

async function getSpToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const fetch = (await import('node-fetch')).default;
  const resp  = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: clientId,
        client_secret: clientSecret, resource: 'https://management.azure.com/',
      }).toString(),
    },
  );
  if (!resp.ok) throw new Error(`SP token error: ${resp.status} ${await resp.text()}`);
  const json = (await resp.json()) as { access_token: string };
  return json.access_token;
}

async function getBearerToken(
  method: AuthMethod,
  tenantId?: string, clientId?: string, clientSecret?: string,
): Promise<string> {
  if (method === 'azure-cli') return getCliToken();
  if (!tenantId || !clientId || !clientSecret)
    throw new Error('Service-principal auth requires tenantId, clientId, and clientSecret.');
  return getSpToken(tenantId, clientId, clientSecret);
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy single ARM resource via ADF REST API
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_TO_SEGMENT: Record<string, string> = {
  'Microsoft.DataFactory/factories/linkedservices': 'linkedservices',
  'Microsoft.DataFactory/factories/datasets':       'datasets',
  'Microsoft.DataFactory/factories/pipelines':      'pipelines',
};

async function putResource(
  resourceType: string, resourceName: string, properties: object,
  subId: string, rg: string, factory: string, token: string,
): Promise<void> {
  const segment = TYPE_TO_SEGMENT[resourceType];
  if (!segment) throw new Error(`Unknown ADF resource type: ${resourceType}`);

  const fetch = (await import('node-fetch')).default;
  const url   =
    `https://management.azure.com/subscriptions/${subId}` +
    `/resourceGroups/${rg}/providers/Microsoft.DataFactory` +
    `/factories/${factory}/${segment}/${resourceName}?api-version=2018-06-01`;

  const resp = await fetch(url, {
    method:  'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ properties }),
  });

  if (!resp.ok) throw new Error(`PUT ${resourceType}/${resourceName} → HTTP ${resp.status}: ${await resp.text()}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract clean resource name from ARM concat expression
// e.g. "[concat(parameters('factoryName'), '/MyLinkedService')]" → "MyLinkedService"
// ─────────────────────────────────────────────────────────────────────────────

function extractResourceName(armNameExpr: string): string {
  const m = armNameExpr.match(/\/([^/'"\]]+)['"]?\]?$/);
  return m ? m[1] : armNameExpr;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export async function deployToAdf(opts: DeployToAdfOptions): Promise<DeployToAdfResult> {
  const az = getAzureConfig();
  const {
    armTemplatePath,
    authMethod,
    subscriptionId = az.subscriptionId,
    resourceGroup  = az.resourceGroup,
    factoryName    = az.factoryName,
    tenantId       = az.tenantId,
    clientId       = az.clientId,
    clientSecret   = az.clientSecret,
  } = opts;

  // Validate required config
  for (const [key, val] of Object.entries({ subscriptionId, resourceGroup, factoryName })) {
    if (!val || val.startsWith('<')) {
      return { success: false, deploymentName: '', resourcesDeployed: [],
        error: `${key} is not configured — update your .env file.` };
    }
  }

  // Load ARM template
  const absPath = path.isAbsolute(armTemplatePath)
    ? armTemplatePath
    : path.join(WORKSPACE_ROOT, armTemplatePath);
  if (!fs.existsSync(absPath))
    return { success: false, deploymentName: '', resourcesDeployed: [], error: `ARM template not found: ${absPath}` };

  const template  = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
  const resources = (template.resources ?? []) as any[];

  // Acquire token
  let token: string;
  try {
    token = await getBearerToken(authMethod, tenantId, clientId, clientSecret);
  } catch (err: any) {
    return { success: false, deploymentName: '', resourcesDeployed: [], error: `Auth failed: ${err.message}` };
  }

  const deploymentName    = `adf-agent-deploy-${Date.now()}`;
  const resourcesDeployed: string[] = [];

  // Deploy in dependency order
  const order = [
    'Microsoft.DataFactory/factories/linkedservices',
    'Microsoft.DataFactory/factories/datasets',
    'Microsoft.DataFactory/factories/pipelines',
  ];

  for (const targetType of order) {
    for (const resource of resources.filter((r: any) => r.type === targetType)) {
      const resourceName = extractResourceName(resource.name ?? '');
      try {
        await putResource(resource.type, resourceName, resource.properties,
          subscriptionId, resourceGroup, factoryName, token);
        resourcesDeployed.push(`${resource.type}/${resourceName}`);
      } catch (err: any) {
        return { success: false, deploymentName, resourcesDeployed,
          error: err.message, details: `Failed at: ${resource.type}/${resourceName}` };
      }
    }
  }

  const portalUrl =
    `https://adf.azure.com/en/monitoring/pipelineruns` +
    `?factory=%2Fsubscriptions%2F${subscriptionId}` +
    `%2FresourceGroups%2F${resourceGroup}` +
    `%2Fproviders%2FMicrosoft.DataFactory%2Ffactories%2F${factoryName}`;

  return { success: true, deploymentName, resourcesDeployed, portalUrl };
}
