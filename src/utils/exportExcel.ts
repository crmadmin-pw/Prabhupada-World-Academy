import type { Cell, Sheet } from 'write-excel-file/universal';

export type ExcelValue = string | number | boolean | null | undefined;
export interface ExcelSheet {
  name: string;
  headers: string[];
  rows: ExcelValue[][];
}

// Explicit string cells keep names and other user input from becoming formulas.
function cell(value: ExcelValue): Cell {
  if (value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return null;
  if (typeof value === 'number') return { type: Number, value };
  if (typeof value === 'boolean') return { type: Boolean, value };
  return { type: String, value, format: '@' };
}

export async function createExcelBlob(sheets: ExcelSheet[]): Promise<Blob> {
  const { default: writeExcelFile } = await import('write-excel-file/universal');
  const workbook: Sheet<Blob>[] = sheets.map(sheet => ({
    sheet: sheet.name,
    stickyRowsCount: 1,
    columns: sheet.headers.map((header, index) => ({
      width: Math.min(45, Math.max(12, header.length + 2,
        ...sheet.rows.slice(0, 200).map(row => String(row[index] ?? '').length + 2))),
    })),
    data: [
      sheet.headers.map(value => ({ type: String, value, fontWeight: 'bold', backgroundColor: '#FFF0E3', wrap: true })),
      ...sheet.rows.map(row => sheet.headers.map((_, index) => cell(row[index]))),
    ],
  }));
  return writeExcelFile(workbook).toBlob();
}

export async function exportExcel(filename: string, sheets: ExcelSheet[]): Promise<void> {
  const blob = await createExcelBlob(sheets);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Allow mobile browsers time to start consuming the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
