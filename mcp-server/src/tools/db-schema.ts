/**
 * Tool: get_db_schema
 * Fetches full SQL Server schema: tables, columns, PKs, FKs, indexes, row counts.
 */
import { connectToDb } from '../db.js';
import { getDbConfig } from '../config.js';

export interface ColumnInfo {
  columnName:       string;
  dataType:         string;
  maxLength:        string | null;
  isNullable:       boolean;
  defaultValue:     string | null;
  isPrimaryKey:     boolean;
  isForeignKey:     boolean;
  referencedTable:  string | null;
  referencedColumn: string | null;
}

export interface IndexInfo {
  indexName:    string;
  columns:      string[];
  isUnique:     boolean;
  isPrimaryKey: boolean;
}

export interface TableSchema {
  tableName: string;
  schema:    string;
  columns:   ColumnInfo[];
  indexes:   IndexInfo[];
  rowCount:  number | null;
}

export interface DbSchemaResult {
  databaseName: string;
  tables:       TableSchema[];
  fetchedAt:    string;
}

export async function getDbSchema(tableFilter?: string[]): Promise<DbSchemaResult> {
  const config = getDbConfig();
  const pool   = await connectToDb();

  try {
    const filterClause = (col: string) =>
      tableFilter && tableFilter.length > 0
        ? `AND ${col} IN (${tableFilter.map(n => `'${n.replace(/'/g, "''")}'`).join(',')})`
        : '';

    const columnQuery = `
      SELECT
        t.TABLE_SCHEMA AS [schema],
        t.TABLE_NAME   AS tableName,
        c.COLUMN_NAME  AS columnName,
        c.DATA_TYPE    AS dataType,
        CASE
          WHEN c.CHARACTER_MAXIMUM_LENGTH = -1 THEN 'MAX'
          WHEN c.CHARACTER_MAXIMUM_LENGTH IS NOT NULL THEN CAST(c.CHARACTER_MAXIMUM_LENGTH AS VARCHAR)
          WHEN c.NUMERIC_PRECISION IS NOT NULL
            THEN CAST(c.NUMERIC_PRECISION AS VARCHAR) + ',' + CAST(c.NUMERIC_SCALE AS VARCHAR)
          ELSE NULL
        END AS maxLength,
        c.IS_NULLABLE   AS isNullable,
        c.COLUMN_DEFAULT AS defaultValue,
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS isPrimaryKey,
        CASE WHEN fk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS isForeignKey,
        fk.REFERENCED_TABLE  AS referencedTable,
        fk.REFERENCED_COLUMN AS referencedColumn
      FROM INFORMATION_SCHEMA.TABLES t
      JOIN INFORMATION_SCHEMA.COLUMNS c
        ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
      LEFT JOIN (
        SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
          ON ku.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND ku.TABLE_SCHEMA = tc.TABLE_SCHEMA
        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ) pk ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA AND pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
      LEFT JOIN (
        SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME,
               kcu2.TABLE_NAME AS REFERENCED_TABLE, kcu2.COLUMN_NAME AS REFERENCED_COLUMN
        FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON ku.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2 ON kcu2.CONSTRAINT_NAME = rc.UNIQUE_CONSTRAINT_NAME
      ) fk ON fk.TABLE_SCHEMA = c.TABLE_SCHEMA AND fk.TABLE_NAME = c.TABLE_NAME AND fk.COLUMN_NAME = c.COLUMN_NAME
      WHERE t.TABLE_TYPE = 'BASE TABLE'
      ${filterClause('t.TABLE_NAME')}
      ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME, c.ORDINAL_POSITION
    `;

    const indexQuery = `
      SELECT SCHEMA_NAME(t.schema_id) AS [schema], t.name AS tableName,
             i.name AS indexName, i.is_unique AS isUnique, i.is_primary_key AS isPrimaryKey,
             STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
      FROM sys.indexes i
      JOIN sys.tables t ON t.object_id = i.object_id
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = i.object_id AND c.column_id = ic.column_id
      WHERE i.name IS NOT NULL AND t.is_ms_shipped = 0
      ${filterClause('t.name')}
      GROUP BY SCHEMA_NAME(t.schema_id), t.name, i.name, i.is_unique, i.is_primary_key
      ORDER BY [schema], tableName, indexName
    `;

    const rowCountQuery = `
      SELECT SCHEMA_NAME(t.schema_id) AS [schema], t.name AS tableName, p.rows AS [rowCount]
      FROM sys.tables t
      JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
      ${tableFilter && tableFilter.length > 0
        ? `WHERE t.name IN (${tableFilter.map(n => `'${n.replace(/'/g, "''")}'`).join(',')})`
        : ''}
    `;

    const [colResult, idxResult, rcResult] = await Promise.all([
      pool.request().query(columnQuery),
      pool.request().query(indexQuery),
      pool.request().query(rowCountQuery),
    ]);

    const tableMap = new Map<string, TableSchema>();

    for (const row of colResult.recordset) {
      const key = `${row.schema}.${row.tableName}`;
      if (!tableMap.has(key)) {
        tableMap.set(key, { tableName: row.tableName, schema: row.schema, columns: [], indexes: [], rowCount: null });
      }
      tableMap.get(key)!.columns.push({
        columnName:       row.columnName,
        dataType:         row.maxLength ? `${row.dataType}(${row.maxLength})` : row.dataType,
        maxLength:        row.maxLength,
        isNullable:       row.isNullable === 'YES',
        defaultValue:     row.defaultValue,
        isPrimaryKey:     row.isPrimaryKey === 1,
        isForeignKey:     row.isForeignKey === 1,
        referencedTable:  row.referencedTable ?? null,
        referencedColumn: row.referencedColumn ?? null,
      });
    }

    for (const row of idxResult.recordset) {
      const key = `${row.schema}.${row.tableName}`;
      if (tableMap.has(key)) {
        tableMap.get(key)!.indexes.push({
          indexName:    row.indexName,
          columns:      row.columns.split(', '),
          isUnique:     row.isUnique,
          isPrimaryKey: row.isPrimaryKey,
        });
      }
    }

    for (const row of rcResult.recordset) {
      const key = `${row.schema}.${row.tableName}`;
      if (tableMap.has(key)) tableMap.get(key)!.rowCount = row.rowCount;
    }

    return { databaseName: config.database, tables: Array.from(tableMap.values()), fetchedAt: new Date().toISOString() };
  } finally {
    await pool.close();
  }
}
