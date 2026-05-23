/**
 * Tool: save_csv
 *
 * Writes a CSV file to workspace/csv/
 */
import * as fs from 'fs';
import * as path from 'path';
import { WORKSPACE_ROOT } from '../config.js';

export interface SaveCsvOptions {
  filename: string;
  headers: string[];
  rows: (string | number | boolean | null | undefined)[][];
}

export interface SaveCsvResult {
  filePath: string;
  rows: number;
  sizeBytes: number;
}

function escapeCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCsv(cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map(escapeCell).join(',');
}

export function saveCsv(options: SaveCsvOptions): SaveCsvResult {
  const { filename, headers, rows } = options;
  const safeFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  const csvDir = path.resolve(WORKSPACE_ROOT, 'workspace', 'csv');
  
  fs.mkdirSync(csvDir, { recursive: true });
  const filePath = path.join(csvDir, safeFilename);

  const lines: string[] = [rowToCsv(headers), ...rows.map(rowToCsv)];
  const csvContent = lines.join('\r\n') + '\r\n';
  fs.writeFileSync(filePath, csvContent, 'utf-8');

  const stat = fs.statSync(filePath);
  return { filePath, rows: rows.length, sizeBytes: stat.size };
}
