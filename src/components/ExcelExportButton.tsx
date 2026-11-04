'use client';

import { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { ExcelSheet } from '@/utils/exportExcel';

export function ExcelExportButton({ filename, getSheets, disabled }: {
  filename: string;
  getSheets: () => ExcelSheet[];
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const sheets = getSheets();
      const { exportExcel } = await import('@/utils/exportExcel');
      await exportExcel(filename, sheets);
    } catch {
      toast.error('Could not export Excel. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="outline" className="h-8" disabled={disabled || busy} onClick={download}>
      {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <FileSpreadsheet className="w-3 h-3 mr-1" />}
      {busy ? 'Exporting…' : 'Export Excel'}
    </Button>
  );
}
