/**
 * Tool: run_sql
 * Executes a SQL script against SQL Server with optional dry-run safety.
 * Supports GO batch separators. Always wraps in a transaction.
 */
import { connectToDb } from '../db.js';

export interface RunSqlOptions {
  sqlScript:     string;
  dryRun?:       boolean;
  transactional?: boolean;
  database?:     string;
}

export interface RunSqlResult {
  success:      boolean;
  rowsAffected: number;
  recordsets:   Record<string, unknown>[][];
  messages:     string[];
  error?:       string;
  dryRun:       boolean;
}

export async function runSql(options: RunSqlOptions): Promise<RunSqlResult> {
  const { sqlScript, dryRun = false, database } = options;
  const pool     = await connectToDb(database);
  const messages: string[] = [];
  const recordsets: Record<string, unknown>[][] = [];
  let totalRowsAffected = 0;

  pool.on('infoMessage', (info: any) => messages.push(`[INFO] ${info.message}`));

  // Split on standalone GO lines
  const batches = sqlScript
    .split(/^\s*GO\s*$/im)
    .map(b => b.trim())
    .filter(b => b.length > 0);

  if (batches.length === 0) {
    return { success: false, rowsAffected: 0, recordsets: [], messages: [], error: 'No SQL batches found.', dryRun };
  }

  const transaction = pool.transaction();
  try {
    await transaction.begin();
    for (const batch of batches) {
      const req    = transaction.request();
      const result = await req.query(batch);
      totalRowsAffected += result.rowsAffected.reduce((a: number, b: number) => a + b, 0);
      const rsets = Array.isArray(result.recordsets)
        ? result.recordsets
        : Object.values(result.recordsets as Record<string, unknown[]>);
      for (const rs of rsets) recordsets.push(rs as Record<string, unknown>[]);
    }

    if (dryRun) {
      await transaction.rollback();
      messages.push('[DRY RUN] Transaction rolled back — no changes persisted.');
      return { success: true, rowsAffected: totalRowsAffected, recordsets, messages, dryRun: true };
    }

    await transaction.commit();
    messages.push('[SUCCESS] Transaction committed.');
    return { success: true, rowsAffected: totalRowsAffected, recordsets, messages, dryRun: false };

  } catch (err: unknown) {
    try { await transaction.rollback(); } catch { /* ignore */ }
    const errorMessage = err instanceof Error ? err.message : String(err);
    messages.push(`[ERROR] ${errorMessage}`);
    return { success: false, rowsAffected: 0, recordsets, messages, error: errorMessage, dryRun };
  } finally {
    await pool.close();
  }
}
