/**
 * db.ts — SQL Server connection helper
 * Supports both SQL auth and Windows auth (trusted connection / msnodesqlv8).
 */
import { getDbConfig } from './config.js';

// We lazily import mssql to support both SQL auth and Windows auth drivers
let _sql: any = null;

export function getSqlModule(): any {
  if (!_sql) {
    _sql = require('mssql');
  }
  return _sql;
}

/**
 * Opens (and returns) a new connection pool for the given database.
 * Always close the pool when done to avoid connection leaks.
 */
export async function connectToDb(databaseOverride?: string): Promise<any> {
  const cfg = getDbConfig();
  const sql = getSqlModule();

  // If Windows auth is requested, use msnodesqlv8 driver
  if (cfg.options.trustedConnection) {
    const driver = process.env.DB_ODBC_DRIVER ?? 'ODBC Driver 17 for SQL Server';
    const port   = cfg.port ? `,${cfg.port}` : '';
    const connStr =
      `Driver={${driver}};` +
      `Server=${cfg.server}${port};` +
      `Database=${databaseOverride ?? cfg.database};` +
      `Trusted_Connection=yes;`;

    const pool = new sql.ConnectionPool({
      connectionString: connStr,
      driver: 'msnodesqlv8',
      options: { trustServerCertificate: cfg.options.trustServerCertificate },
    });

    await pool.connect();
    return pool;
  }

  // Standard SQL auth
  const pool = new sql.ConnectionPool({
    server:   cfg.server,
    port:     cfg.port,
    database: databaseOverride ?? cfg.database,
    user:     cfg.user,
    password: cfg.password,
    options: {
      encrypt:                cfg.options.encrypt,
      trustServerCertificate: cfg.options.trustServerCertificate,
    },
  });

  await pool.connect();
  return pool;
}
