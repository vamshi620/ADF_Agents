/**
 * Tool: run_adf_pipeline
 *
 * Triggers an ADF pipeline run (manual / on-demand) and polls until
 * it reaches a terminal state: Succeeded | Failed | Cancelled | TimedOut.
 *
 * Returns per-activity details (rows read/written, errors) and a
 * direct portal monitoring URL.
 */
import { getAzureConfig } from '../config.js';

export type AuthMethod = 'service-principal' | 'azure-cli';

export interface RunAdfPipelineOptions {
  pipelineName:        string;
  authMethod:          AuthMethod;
  parameters?:         Record<string, string | number | boolean>;
  pollIntervalSeconds?: number;
  timeoutMinutes?:     number;
  subscriptionId?:     string;
  resourceGroup?:      string;
  factoryName?:        string;
  tenantId?:           string;
  clientId?:           string;
  clientSecret?:       string;
}

export interface ActivityRunInfo {
  activityName:  string;
  activityType:  string;
  status:        string;
  durationMs?:   number;
  rowsRead?:     number;
  rowsWritten?:  number;
  error?:        string;
}

export interface RunAdfPipelineResult {
  success:        boolean;
  runId?:         string;
  pipelineName:   string;
  status:         'Succeeded' | 'Failed' | 'Cancelled' | 'TimedOut' | 'Unknown';
  startTime?:     string;
  endTime?:       string;
  durationMs?:    number;
  activityRuns:   ActivityRunInfo[];
  portalRunUrl?:  string;
  error?:         string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token helpers (same pattern as adf-deploy.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function getCliToken(): Promise<string> {
  const { execSync } = await import('child_process');
  const raw = execSync(
    'az account get-access-token --resource https://management.azure.com --query accessToken -o tsv',
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
  if (!raw || raw.length < 20) throw new Error('Azure CLI empty token. Run `az login` first.');
  return raw;
}

async function getSpToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const fetch = (await import('node-fetch')).default;
  const resp  = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: clientId,
      client_secret: clientSecret, resource: 'https://management.azure.com/',
    }).toString(),
  });
  if (!resp.ok) throw new Error(`SP token error: ${resp.status} ${await resp.text()}`);
  return ((await resp.json()) as { access_token: string }).access_token;
}

async function getBearerToken(
  method: AuthMethod, tenantId?: string, clientId?: string, clientSecret?: string,
): Promise<string> {
  if (method === 'azure-cli') return getCliToken();
  if (!tenantId || !clientId || !clientSecret)
    throw new Error('Service-principal auth requires tenantId, clientId, clientSecret.');
  return getSpToken(tenantId, clientId, clientSecret);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export async function runAdfPipeline(opts: RunAdfPipelineOptions): Promise<RunAdfPipelineResult> {
  const az = getAzureConfig();
  const {
    pipelineName,
    authMethod,
    parameters          = {},
    pollIntervalSeconds = 10,
    timeoutMinutes      = 60,
    subscriptionId      = az.subscriptionId,
    resourceGroup       = az.resourceGroup,
    factoryName         = az.factoryName,
    tenantId            = az.tenantId,
    clientId            = az.clientId,
    clientSecret        = az.clientSecret,
  } = opts;

  // Validate config
  for (const [key, val] of Object.entries({ subscriptionId, resourceGroup, factoryName })) {
    if (!val || val.startsWith('<')) {
      return { success: false, pipelineName, status: 'Unknown', activityRuns: [],
        error: `${key} is not configured — update your .env file.` };
    }
  }

  // Acquire token
  let token: string;
  try {
    token = await getBearerToken(authMethod, tenantId, clientId, clientSecret);
  } catch (err: any) {
    return { success: false, pipelineName, status: 'Unknown', activityRuns: [],
      error: `Auth failed: ${err.message}` };
  }

  const fetch   = (await import('node-fetch')).default;
  const baseUrl =
    `https://management.azure.com/subscriptions/${subscriptionId}` +
    `/resourceGroups/${resourceGroup}/providers/Microsoft.DataFactory` +
    `/factories/${factoryName}`;

  // ── 1. Trigger run ──────────────────────────────────────────────────────────
  const triggerResp = await fetch(
    `${baseUrl}/pipelines/${pipelineName}/createRun?api-version=2018-06-01`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ parameters }),
    },
  );
  if (!triggerResp.ok) {
    return { success: false, pipelineName, status: 'Unknown', activityRuns: [],
      error: `Trigger failed: HTTP ${triggerResp.status} — ${await triggerResp.text()}` };
  }

  const { runId } = (await triggerResp.json()) as { runId: string };
  const startTime = new Date().toISOString();
  const deadline  = Date.now() + timeoutMinutes * 60_000;
  const terminal  = new Set(['Succeeded', 'Failed', 'Cancelled']);
  let lastStatus  = 'Queued';
  let runEndTime: string | undefined;

  // ── 2. Poll for completion ─────────────────────────────────────────────────
  while (Date.now() < deadline) {
    await sleep(pollIntervalSeconds * 1000);
    try {
      const sr = await fetch(`${baseUrl}/pipelineRuns/${runId}?api-version=2018-06-01`,
        { headers: { Authorization: `Bearer ${token}` } });
      if (sr.ok) {
        const j = (await sr.json()) as { status: string; runEnd?: string };
        lastStatus = j.status;
        runEndTime = j.runEnd;
        if (terminal.has(lastStatus)) break;
      }
    } catch { /* transient — keep polling */ }
  }

  if (!terminal.has(lastStatus)) lastStatus = 'TimedOut';

  // ── 3. Fetch activity runs ─────────────────────────────────────────────────
  const activityRuns: ActivityRunInfo[] = [];
  try {
    const ar = await fetch(
      `${baseUrl}/pipelineRuns/${runId}/queryActivityRuns?api-version=2018-06-01`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          lastUpdatedAfter:  startTime,
          lastUpdatedBefore: new Date().toISOString(),
          filters: [], orderBy: [{ orderBy: 'ActivityRunStart', order: 'ASC' }],
        }),
      },
    );
    if (ar.ok) {
      const j = (await ar.json()) as { value: any[] };
      for (const a of j.value ?? []) {
        activityRuns.push({
          activityName: a.activityName,
          activityType: a.activityType,
          status:       a.status,
          durationMs:   a.durationInMs,
          rowsRead:     a.output?.rowsRead,
          rowsWritten:  a.output?.rowsCopied,
          error:        a.error?.message,
        });
      }
    }
  } catch { /* best-effort */ }

  // ── 4. Build result ────────────────────────────────────────────────────────
  const endTs    = runEndTime ? new Date(runEndTime).getTime() : Date.now();
  const durationMs = endTs - new Date(startTime).getTime();

  const portalRunUrl =
    `https://adf.azure.com/en/monitoring/pipelineruns/${runId}` +
    `?factory=%2Fsubscriptions%2F${subscriptionId}` +
    `%2FresourceGroups%2F${resourceGroup}` +
    `%2Fproviders%2FMicrosoft.DataFactory%2Ffactories%2F${factoryName}`;

  return {
    success:      lastStatus === 'Succeeded',
    runId,
    pipelineName,
    status:       lastStatus as RunAdfPipelineResult['status'],
    startTime,
    endTime:      runEndTime,
    durationMs,
    activityRuns,
    portalRunUrl,
    error: lastStatus !== 'Succeeded'
      ? lastStatus === 'TimedOut'
        ? `Pipeline did not finish within ${timeoutMinutes} min.`
        : `Pipeline ended with status: ${lastStatus}`
      : undefined,
  };
}
