import JSZip from 'jszip';

/**
 * A spreadsheet a teacher can hand to a class, written by hand.
 *
 * A comma-separated file cannot carry any of what makes a marking sheet readable in a room —
 * a heading that stands out, a wrong answer that is visibly wrong, columns wide enough to
 * read, a header that stays put while you scroll. So this writes a real workbook.
 *
 * By hand, because it is a few hundred lines of known XML and the alternative is shipping a
 * spreadsheet library for one screen. `jszip` is already here for other reasons and is the
 * only part that is genuinely hard.
 *
 * The shapes below are the minimum a workbook needs to be valid: content types, the package
 * relationships, the workbook and its sheets, and a style table the cells point into by
 * index. Anything omitted here is omitted because Excel and LibreOffice both default it.
 */

/** The visual roles a cell can take. Index into the style table written below, in order. */
export type CellStyle =
  | 'default'
  | 'title'
  | 'subtitle'
  | 'header'
  | 'label'
  | 'value'
  | 'correct'
  | 'incorrect'
  | 'blank';

const STYLE_INDEX: Record<CellStyle, number> = {
  default: 0,
  title: 1,
  subtitle: 2,
  header: 3,
  label: 4,
  value: 5,
  correct: 6,
  incorrect: 7,
  blank: 8
};

export type Cell = { value: string | number | null; style?: CellStyle };

export type Sheet = {
  name: string;
  /** Column widths in characters. Missing entries fall back to the writer's default. */
  columnWidths?: number[];
  /** Rows above which the sheet stays put while the rest scrolls. */
  frozenRows?: number;
  rows: Cell[][];
};

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

/**
 * A sheet name Excel will accept.
 *
 * It refuses the five characters below, refuses an empty name, and truncates at 31. A file
 * that will not open is a worse outcome than a shortened tab, and the name is a convenience
 * either way — the person's name is in the sheet as well.
 */
export function toSheetName(value: string, fallback: string): string {
  const cleaned = value.replace(/[\\/?*[\]:]/gu, ' ').trim();

  return (cleaned.length > 0 ? cleaned : fallback).slice(0, 31);
}

/** `A`, `B` … `AA`. Columns are addressed by letter in the cell references. */
function columnLetter(index: number): string {
  let remaining = index + 1;
  let letters = '';

  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }

  return letters;
}

function cellXml(cell: Cell, rowNumber: number, columnIndex: number): string {
  const reference = `${columnLetter(columnIndex)}${rowNumber}`;
  const style = STYLE_INDEX[cell.style ?? 'default'];

  if (cell.value === null || cell.value === '') return `<c r="${reference}" s="${style}"/>`;

  if (typeof cell.value === 'number') {
    return `<c r="${reference}" s="${style}"><v>${cell.value}</v></c>`;
  }

  // Inline, so the workbook needs no shared-string table. Text is short here and repeated
  // strings are a handful of letters; a table would trade clarity for nothing.
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const columns = (sheet.columnWidths ?? [])
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join('');

  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row.map((cell, columnIndex) => cellXml(cell, rowIndex + 1, columnIndex)).join('');

      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');

  const frozen =
    sheet.frozenRows && sheet.frozenRows > 0
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.frozenRows}" topLeftCell="A${sheet.frozenRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${frozen}${columns ? `<cols>${columns}</cols>` : ''}<sheetData>${rows}</sheetData></worksheet>`;
}

/**
 * The style table, in the order {@link STYLE_INDEX} names.
 *
 * Restrained on purpose: one accent for headings, green and red only where they carry
 * meaning, and a hairline everywhere so the table reads as a table. A sheet handed to a
 * fifteen-year-old should look like a marking sheet, not a dashboard.
 */
function stylesXml(): string {
  const fonts = [
    '<font><sz val="11"/><name val="Calibri"/></font>',
    '<font><b/><sz val="16"/><name val="Calibri"/></font>',
    '<font><sz val="11"/><color rgb="FF6B7280"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF047857"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FFB91C1C"/><name val="Calibri"/></font>'
  ].join('');

  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1D4ED8"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill>'
  ].join('');

  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>'
  ].join('');

  // font / fill / border, in the order STYLE_INDEX names.
  const cellXfs = [
    '<xf fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>',
    '<xf fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    '<xf fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    '<xf fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>',
    '<xf fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>',
    '<xf fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
    '<xf fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
    '<xf fontId="6" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
    '<xf fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  ].join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="7">${fonts}</fonts><fills count="6">${fills}</fills><borders count="2">${borders}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9">${cellXfs}</cellXfs></styleSheet>`;
}

/** Writes the sheets into a real `.xlsx`, which is a zip of XML parts. */
export async function buildXlsx(sheets: Sheet[]): Promise<Buffer> {
  const zip = new JSZip();

  const overrides = sheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('');

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );

  const sheetEntries = sheets
    .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('');

  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets></workbook>`
  );

  const sheetRels = sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )
    .join('');

  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );

  zip.file('xl/styles.xml', stylesXml());

  for (const [index, sheet] of sheets.entries()) {
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet));
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
