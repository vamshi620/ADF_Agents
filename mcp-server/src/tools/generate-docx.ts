/**
 * Tool: generate_word_doc
 *
 * Generates a professionally styled Word (.docx) document with a branded
 * cover page, headers, footers, styled headings, tables, and bullet/numbered lists.
 * Saves to workspace/docs/<filename>.docx.
 */
import * as fs from 'fs';
import { join } from 'path';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, ShadingType, PageBreak, Header, Footer,
  convertInchesToTwip, LevelFormat, SimpleField,
} from 'docx';
import { WORKSPACE_ROOT } from '../config.js';

export interface DocTable {
  headers: string[];
  rows:    string[][];
}

export interface DocSection {
  heading:  string;
  content:  string;
  level?:   1 | 2 | 3;
  table?:   DocTable;
}

export interface GenerateDocxOptions {
  filename:   string;
  title:      string;
  subtitle?:  string;
  author?:    string;
  sections:   DocSection[];
}

export interface GenerateDocxResult {
  filePath:  string;
  sizeBytes: number;
}

// ── Brand palette ──────────────────────────────────────────────────────────
const C = {
  primary:      '1F4E79',
  primaryLight: 'D6E4F0',
  accent:       '2E86C1',
  gray:         '5D6D7E',
  lightGray:    'F2F3F4',
  white:        'FFFFFF',
  black:        '000000',
};

function bold(text: string, color = C.black): TextRun {
  return new TextRun({ text, bold: true, color, font: 'Calibri' });
}

function body(text: string): TextRun {
  return new TextRun({ text, font: 'Calibri', size: 22, color: C.gray });
}

function buildTable(t: DocTable): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: t.headers.map(h =>
      new TableCell({
        children: [new Paragraph({ children: [bold(h, C.white)], alignment: AlignmentType.CENTER })],
        shading: { type: ShadingType.SOLID, color: C.primary, fill: C.primary },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
      }),
    ),
  });

  const dataRows = t.rows.map((row, i) =>
    new TableRow({
      children: row.map(cell =>
        new TableCell({
          children: [new Paragraph({ children: [body(cell ?? '')] })],
          shading: i % 2 !== 0
            ? { type: ShadingType.SOLID, color: C.lightGray, fill: C.lightGray }
            : undefined,
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
        }),
      ),
    }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows:  [headerRow, ...dataRows],
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 4, color: C.primary },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: C.primary },
      left:   { style: BorderStyle.SINGLE, size: 4, color: C.primary },
      right:  { style: BorderStyle.SINGLE, size: 4, color: C.primary },
    },
  });
}

function parseContent(content: string): Paragraph[] {
  return content.split('\n').map(line => {
    const t = line.trim();
    if (!t) return new Paragraph({ children: [] });
    if (t.startsWith('- ') || t.startsWith('• '))
      return new Paragraph({ children: [body(t.slice(2))], bullet: { level: 0 } });
    const m = t.match(/^(\d+)\.\s+(.*)/);
    if (m) return new Paragraph({ children: [body(m[2])], numbering: { reference: 'numbered-list', level: 0 } });
    return new Paragraph({ children: [body(t)] });
  });
}

export async function generateWordDoc(options: GenerateDocxOptions): Promise<GenerateDocxResult> {
  const { filename, title, subtitle, author, sections } = options;
  const docsDir = join(WORKSPACE_ROOT, 'workspace', 'docs');
  fs.mkdirSync(docsDir, { recursive: true });

  const children: (Paragraph | Table)[] = [];

  // Cover
  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 56, font: 'Calibri', color: C.primary })],
      alignment: AlignmentType.CENTER,
      spacing:   { before: convertInchesToTwip(1.5), after: 200 },
    }),
  );
  if (subtitle) {
    children.push(new Paragraph({
      children:  [new TextRun({ text: subtitle, size: 28, font: 'Calibri', color: C.accent, italics: true })],
      alignment: AlignmentType.CENTER,
      spacing:   { after: 200 },
    }));
  }
  const meta = [author ? `Author: ${author}` : '', `Generated: ${new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}`].filter(Boolean).join('   |   ');
  children.push(
    new Paragraph({ children: [body(meta)], alignment: AlignmentType.CENTER, spacing: { after: 400 } }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // Sections
  for (const s of sections) {
    const lvl = s.level ?? 2;
    children.push(new Paragraph({
      text:    s.heading,
      heading: lvl === 1 ? HeadingLevel.HEADING_1 : lvl === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
      spacing: { before: 300, after: 120 },
    }));
    children.push(...parseContent(s.content));
    if (s.table) {
      children.push(new Paragraph({ children: [] }), buildTable(s.table), new Paragraph({ children: [] }));
    }
    children.push(new Paragraph({ children: [] }));
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'numbered-list',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT }],
      }],
    },
    styles: {
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { bold: true, size: 36, color: C.primary, font: 'Calibri' }, paragraph: { spacing: { before: 300, after: 120 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', run: { bold: true, size: 28, color: C.accent,   font: 'Calibri' }, paragraph: { spacing: { before: 240, after: 80  } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', run: { bold: true, size: 24, color: C.gray,    font: 'Calibri' }, paragraph: { spacing: { before: 200, after: 60  } } },
      ],
    },
    sections: [{
      properties: {
        page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.25), right: convertInchesToTwip(1.25) } },
      },
      headers: {
        default: new Header({ children: [new Paragraph({
          children: [
            new TextRun({ text: title, font: 'Calibri', size: 18, color: C.primary, bold: true }),
            new TextRun({ text: '  |  ADF Copilot Agents', font: 'Calibri', size: 18, color: C.gray }),
          ],
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.primary } },
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          children: [new TextRun({ text: 'Page ', font: 'Calibri', size: 18, color: C.gray }), new SimpleField('PAGE')],
          alignment: AlignmentType.RIGHT,
          border:    { top: { style: BorderStyle.SINGLE, size: 6, color: C.primaryLight } },
        })] }),
      },
      children,
    }],
  });

  const safeFilename = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  const filePath     = join(docsDir, safeFilename);
  const buffer       = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
  return { filePath, sizeBytes: buffer.byteLength };
}
