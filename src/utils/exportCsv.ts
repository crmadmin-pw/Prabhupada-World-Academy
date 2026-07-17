/**
 * Generates a CSV file and triggers a browser download.
 * 
 * Overload 1: exportToCsv(rows, filename) — 2D array (headers included in rows)
 * Overload 2: exportToCsv(filename, headers, rows) — separate headers + rows
 */
export function exportToCsv(
  filenameOrRows: string | any[][],
  headersOrFilename?: string[] | string,
  rows?: (string | number | null | undefined)[][]
): void {
  let filename: string;
  let allLines: any[][];

  if (Array.isArray(filenameOrRows)) {
    // Overload 1: exportToCsv(rows, filename)
    allLines = filenameOrRows;
    filename = (headersOrFilename as string) || 'export.csv';
  } else {
    // Overload 2: exportToCsv(filename, headers, rows)
    filename = filenameOrRows;
    const headers = headersOrFilename as string[];
    allLines = [headers, ...(rows || [])];
  }

  const escape = (cell: any): string => {
    const str = cell == null ? '' : String(cell);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvContent = allLines.map(row =>
    (Array.isArray(row) ? row : [row]).map(escape).join(',')
  ).join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  if (!document.body) return;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
