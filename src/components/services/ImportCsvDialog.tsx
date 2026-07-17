import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, AlertCircle, CheckCircle2 } from 'lucide-react';

const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Resident { id: string; name: string; }
interface Service  { id: string; name: string; }

export interface ImportAssignment {
  userId: string;
  serviceId: string;
  dayOfWeek: string;
  weekDate: string;
  userName: string;
  serviceName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (assignments: ImportAssignment[]) => Promise<void>;
  residents: Resident[];
  services: Service[];
}

/**
 * Parses new CSV format:
 * Header: Service Name, "10 May (2025-05-04)", "17 May (2025-05-11)", ...
 * Row:    Service Name, "Resident Name (Mon)", ...
 */
function parseCsv(text: string, residents: Resident[], services: Service[]) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { assignments: [] as ImportAssignment[], errors: ['File is empty or has no data rows.'] };

  const splitRow = (row: string) => {
    const cells: string[] = [];
    let cur = '', inQ = false;
    for (const ch of row) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cells.push(cur.trim());
    return cells.map(c => c.replace(/^"|"$/g, '').trim());
  };

  const headers = splitRow(lines[0]);
  const errors: string[] = [];
  const assignments: ImportAssignment[] = [];

  // Map column index → weekDate (extracted from header like "10 May (2025-05-04)")
  const colToWeekDate: Record<number, string> = {};
  headers.forEach((h, i) => {
    if (i === 0) return; // Service name column
    const match = h.match(/\((\d{4}-\d{2}-\d{2})\)/);
    if (match) colToWeekDate[i] = match[1];
    else errors.push(`Column ${i + 1} "${h}": could not parse week date — expected format "10 May (2025-05-04)"`);
  });

  const serviceMap: Record<string, Service> = {};
  services.forEach(s => { serviceMap[s.name.toLowerCase().trim()] = s; });

  const nameMap: Record<string, Resident> = {};
  residents.forEach(r => { nameMap[r.name.toLowerCase().trim()] = r; });

  for (let row = 1; row < lines.length; row++) {
    const cols = splitRow(lines[row]);
    const svcName = cols[0]?.trim();
    if (!svcName) continue;

    const svc = serviceMap[svcName.toLowerCase()];
    if (!svc) {
      errors.push(`Row ${row + 1}: Service "${svcName}" not found`);
      continue;
    }

    Object.entries(colToWeekDate).forEach(([colIdx, weekDate]) => {
      const cell = cols[parseInt(colIdx)]?.trim();
      if (!cell) return;

      // Parse "Resident Name (Mon)" or "Resident Name (Monday)"
      const cellMatch = cell.match(/^(.+?)\s+\((\w+)\)\s*$/);
      if (!cellMatch) {
        errors.push(`Row ${row + 1}, col ${parseInt(colIdx) + 1}: Expected "Name (Day)", got "${cell}"`);
        return;
      }

      const residentName = cellMatch[1].trim();
      const dayRaw = cellMatch[2];
      const fullDay = FULL_DAYS.find(d => d.toLowerCase().startsWith(dayRaw.toLowerCase().slice(0, 3)));

      if (!fullDay) {
        errors.push(`Row ${row + 1}: Unknown day "${dayRaw}"`);
        return;
      }

      const resident = nameMap[residentName.toLowerCase()];
      if (!resident) {
        errors.push(`Row ${row + 1}: Resident "${residentName}" not found`);
        return;
      }

      assignments.push({
        userId: resident.id,
        serviceId: svc.id,
        dayOfWeek: fullDay,
        weekDate,
        userName: resident.name,
        serviceName: svc.name,
      });
    });
  }

  return { assignments, errors };
}

export default function ImportCsvDialog({ open, onClose, onConfirm, residents, services }: Props) {
  const [parsed, setParsed] = useState<ReturnType<typeof parseCsv> | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setParsed(parseCsv((ev.target?.result as string) || '', residents, services));
    reader.readAsText(file);
  };

  const reset = () => { setParsed(null); if (inputRef.current) inputRef.current.value = ''; };

  const handleConfirm = async () => {
    if (!parsed?.assignments.length) return;
    setSaving(true);
    try {
      await onConfirm(parsed.assignments);
      reset(); onClose();
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Assignments from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV exported from this page. Format: services as rows, week dates as columns, cells as "Name (Day)".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">Click to upload CSV</p>
            <p className="text-xs text-muted-foreground mt-1">Must match the exported format</p>
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </div>

          {parsed && (
            <div className="space-y-3">
              {parsed.errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-medium mb-1">{parsed.errors.length} issue(s):</p>
                    <ul className="text-xs space-y-0.5 max-h-24 overflow-y-auto">
                      {parsed.errors.map((e, i) => <li key={i}>• {e}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {parsed.assignments.length > 0 ? (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="bg-muted/50 px-3 py-2 text-sm font-medium flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    {parsed.assignments.length} assignment(s) ready to import
                  </div>
                  <div className="max-h-44 overflow-y-auto divide-y divide-border">
                    {parsed.assignments.map((a, i) => (
                      <div key={i} className="px-3 py-1.5 text-xs flex justify-between items-center gap-2">
                        <span className="font-medium truncate">{a.serviceName}</span>
                        <span className="text-muted-foreground text-right shrink-0">
                          {a.userName.split(' ')[0]} · {a.dayOfWeek.slice(0, 3)} · wk {a.weekDate}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-2">No valid assignments found in file.</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button disabled={!parsed?.assignments.length || saving} onClick={handleConfirm}>
            {saving ? 'Importing…' : `Import ${parsed?.assignments.length || 0} Assignment(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
