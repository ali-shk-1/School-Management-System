/**
 * Generic "Print sheet" + "Download Excel" helpers used by every Fees tab.
 * Each tab builds a SheetSpec from exactly the rows it has on screen and
 * hands it to printSheet() / downloadSheetExcel().
 */
import { formatMoney } from '@/lib/api-client';

export type SheetCell = string | number | null | undefined;

export interface SheetColumn {
  header: string;
  /** Numeric money column: right-aligned, "Rs. 1,000" in print, number in Excel. */
  money?: boolean;
  width?: number;
}

export interface SheetSpec {
  /** Heading shown above the table / used as the worksheet name. */
  title: string;
  /** Optional second line (filters, date, student …). */
  subtitle?: string;
  columns: SheetColumn[];
  rows: SheetCell[][];
  /** Optional totals row; same length as columns, use '' for blanks. */
  totals?: SheetCell[];
  /** File name without extension. */
  fileName: string;
  /**
   * Optional condensed layout used ONLY for the A4 print (very wide sheets,
   * e.g. 12-month grids). Excel always gets the full columns/rows above.
   */
  print?: { columns: SheetColumn[]; rows: SheetCell[][]; totals?: SheetCell[] };
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}

function printCell(col: SheetColumn, v: SheetCell): string {
  if (v == null || v === '') return '';
  return col.money && typeof v === 'number' ? formatMoney(v) : String(v);
}

/** Opens a print window. Returns false if the pop-up was blocked. */
export function printSheet(full: SheetSpec): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  const spec = full.print ? { ...full, ...full.print } : full;
  const landscape = spec.columns.length > 8;
  const fontPx = spec.columns.length > 24 ? 6.5 : spec.columns.length > 16 ? 8 : 10;
  const head = spec.columns
    .map((c) => `<th class="${c.money ? 'num' : ''}">${esc(c.header)}</th>`)
    .join('');
  const body = spec.rows
    .map(
      (r) =>
        `<tr>${spec.columns
          .map((c, i) => `<td class="${c.money ? 'num' : ''}">${esc(printCell(c, r[i]))}</td>`)
          .join('')}</tr>`
    )
    .join('');
  const foot = spec.totals
    ? `<tfoot><tr>${spec.columns
        .map((c, i) => `<td class="${c.money ? 'num' : ''}">${esc(printCell(c, spec.totals![i]))}</td>`)
        .join('')}</tr></tfoot>`
    : '';
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>${esc(spec.title)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 14mm 10mm; }
  body { font-family: Arial, sans-serif; color: #1a1a2e; padding: 0; }
  h1 { font-size: 14px; margin: 0 0 4px; }
  .sub { font-size: 11px; color: #555; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: ${fontPx}px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: ${fontPx < 10 ? 3 : 5}px ${fontPx < 10 ? 3 : 6}px; text-align: left; }
  th { background: #f0f0f0; color: #333; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: 700; background: #f7f7f7; }
</style></head><body>
  <h1>${esc(spec.title)}</h1>
  ${spec.subtitle ? `<div class="sub">${esc(spec.subtitle)}</div>` : ''}
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>
  <script>window.onload = function () { window.print(); };<\/script>
</body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

/** Builds and downloads an .xlsx via ExcelJS (dynamically imported). */
export async function downloadSheetExcel(spec: SheetSpec): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(spec.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet');
  ws.columns = spec.columns.map((c, i) => ({
    header: c.header,
    key: `c${i}`,
    width: c.width ?? (c.money ? 14 : 18),
  }));
  ws.getRow(1).font = { bold: true };
  const moneyIdx = spec.columns.map((c, i) => (c.money ? i + 1 : 0)).filter(Boolean);
  spec.rows.forEach((r) => ws.addRow(spec.columns.map((_, i) => r[i] ?? '')));
  if (spec.totals) {
    ws.addRow([]);
    ws.addRow(spec.totals.map((v) => v ?? '')).font = { bold: true };
  }
  moneyIdx.forEach((ci) => {
    ws.getColumn(ci).numFmt = '#,##0';
  });
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${spec.fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
