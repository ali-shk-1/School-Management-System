'use client';

/**
 * "Print Sheet" + "Excel" button pair. Each page passes getSpec(), which
 * builds a SheetSpec from exactly the rows currently on screen (filters
 * applied). Print output is A4; Excel is a .xlsx download.
 */
import { printSheet, downloadSheetExcel, type SheetSpec } from '@/lib/sheet-export';
import { showToast } from '@/lib/toast';

export default function SheetButtons({
  getSpec,
  disabled,
}: {
  getSpec: () => SheetSpec | null;
  disabled?: boolean;
}) {
  function onPrint() {
    const spec = getSpec();
    if (!spec || spec.rows.length === 0) return showToast('Nothing to print on this page.', 'error');
    if (!printSheet(spec)) showToast('Please allow pop-ups to print.', 'error');
  }
  async function onExcel() {
    const spec = getSpec();
    if (!spec || spec.rows.length === 0) return showToast('Nothing to export on this page.', 'error');
    try {
      await downloadSheetExcel(spec);
    } catch {
      showToast('Failed to generate Excel file.', 'error');
    }
  }
  return (
    <>
      <button className="btn btn-outline btn-sm" title="Print this page's data (A4)" onClick={onPrint} disabled={disabled}>
        🖨 Print Sheet
      </button>
      <button className="btn btn-outline btn-sm" title="Download this page's data as an Excel sheet" onClick={onExcel} disabled={disabled}>
        ⬇ Excel
      </button>
    </>
  );
}
