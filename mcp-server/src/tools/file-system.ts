/**
 * Tool: read_file / write_file / list_files
 * File-system helpers scoped to the project workspace folder.
 */
import * as fs   from 'fs';
import * as path from 'path';
import { WORKSPACE_ROOT } from '../config.js';

function resolve(filePath: string): string {
  // Prevent directory traversal outside workspace
  const abs = path.resolve(WORKSPACE_ROOT, filePath);
  if (!abs.startsWith(WORKSPACE_ROOT)) {
    throw new Error(`Path "${filePath}" is outside the project workspace.`);
  }
  return abs;
}

// ── read_file ────────────────────────────────────────────────────────────────
export function readFile({ filePath }: { filePath: string }): { exists: boolean; content: string } {
  const abs = resolve(filePath);
  if (!fs.existsSync(abs)) return { exists: false, content: '' };
  return { exists: true, content: fs.readFileSync(abs, 'utf-8') };
}

// ── write_file ───────────────────────────────────────────────────────────────
export function writeFile({
  filePath,
  content,
  append = false,
}: {
  filePath: string;
  content:  string;
  append?:  boolean;
}): { filePath: string; bytesWritten: number } {
  const abs = resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (append) {
    fs.appendFileSync(abs, content, 'utf-8');
  } else {
    fs.writeFileSync(abs, content, 'utf-8');
  }
  return { filePath: abs, bytesWritten: Buffer.byteLength(content, 'utf-8') };
}

// ── list_files ───────────────────────────────────────────────────────────────
export function listFiles({
  directory  = '.',
  pattern,
  recursive  = false,
}: {
  directory?: string;
  pattern?:   string;
  recursive?: boolean;
}): { files: string[]; directory: string } {
  const abs = resolve(directory);
  if (!fs.existsSync(abs)) return { files: [], directory: abs };

  function collect(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const results: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (recursive) results.push(...collect(full));
      } else {
        const rel = path.relative(WORKSPACE_ROOT, full);
        if (!pattern || rel.endsWith(pattern)) results.push(rel);
      }
    }
    return results;
  }

  return { files: collect(abs), directory: abs };
}
