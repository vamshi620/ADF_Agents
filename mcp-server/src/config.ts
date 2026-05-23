import { config as loadEnv } from 'dotenv';
import { resolve, dirname }   from 'path';
import { fileURLToPath }      from 'url';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

export const WORKSPACE_ROOT = resolve(__dirname, '../../');

// Load .env from the project root
loadEnv({ path: resolve(WORKSPACE_ROOT, '.env') });

// ─────────────────────────────────────────────────────────────────────────────
// SQL Server connection config
// ─────────────────────────────────────────────────────────────────────────────
export interface DbConfig {
  server:   string;
  port?:    number;
  database: string;
  user:     string;
  password: string;
  options: {
    encrypt:                boolean;
    trustServerCertificate: boolean;
    trustedConnection?:     boolean;
  };
}

export function getDbConfig(): DbConfig {
  const server   = process.env.DB_SERVER;
  const database = process.env.DB_DATABASE;

  if (!server || !database) {
    throw new Error(
      'Missing required env vars: DB_SERVER and DB_DATABASE must be set in .env',
    );
  }

  const portVal = process.env.DB_PORT;

  return {
    server,
    port:     portVal ? parseInt(portVal, 10) : undefined,
    database,
    user:     process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
    options: {
      encrypt:                process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
      trustedConnection:      process.env.DB_TRUSTED_CONNECTION === 'true',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output / workspace directory
// ─────────────────────────────────────────────────────────────────────────────
export function getOutputDir(): string {
  return resolve(WORKSPACE_ROOT, 'workspace');
}

// ─────────────────────────────────────────────────────────────────────────────
// Azure / ADF config
// ─────────────────────────────────────────────────────────────────────────────
export interface AzureConfig {
  subscriptionId: string;
  resourceGroup:  string;
  factoryName:    string;
  tenantId:       string;
  clientId:       string;
  clientSecret:   string;
  region:         string;
}

export function getAzureConfig(): AzureConfig {
  return {
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID ?? '<your-subscription-id>',
    resourceGroup:  process.env.AZURE_RESOURCE_GROUP  ?? '<your-resource-group>',
    factoryName:    process.env.AZURE_ADF_FACTORY_NAME ?? '<your-adf-factory-name>',
    tenantId:       process.env.AZURE_TENANT_ID        ?? '<your-tenant-id>',
    clientId:       process.env.AZURE_CLIENT_ID        ?? '<your-client-id>',
    clientSecret:   process.env.AZURE_CLIENT_SECRET    ?? '<your-client-secret>',
    region:         process.env.AZURE_REGION           ?? 'eastus',
  };
}
