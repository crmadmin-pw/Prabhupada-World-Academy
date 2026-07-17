import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Download, Upload, Save, FileSpreadsheet, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { exportServiceAllocation, importServiceAllocation, getResidenciesForGuide } from 'zite-endpoints-sdk';
import { exportToCsv } from '@/utils/exportCsv';
import { getCurrentServiceWeekStart } from '@/lib/serviceWeek';
import AllocationExportGrid, { CellEdit } from '@/components/services/AllocationExportGrid';
import ImportCsvDialog, { ImportAssignment } from '@/components/services/ImportCsvDialog';

const SERVICE_TYPES = [
  { value: 'Weekly', label: 'Regular Weekly' },
  { value: 'Saturday Maha Cleaning', label: 'Saturday Maha Cleaning' },
  { value: 'Sunday Love Feast', label: 'Sunday Love Feast' },
  { value: 'Occasional', label: 'Occasional' },
  { value: 'Festivals', label: 'Festivals' },
];

type AllocData = {
  services: { id: string; name: string }[];
  weekDates: string[];
  grid: Record<string, Record<string, { userId: string; userName: string; dayOfWeek: string }[]>>;
  residents: { id: string; name: string }[];
  currentWeekDate: string;
};

function fmtDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function shiftWeek(dateStr: string, delta: number) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta * 7);
  return d.toISOString().split('T')[0];
}

export default function ServiceManagementPage() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();

  const [serviceType, setServiceType] = useState('Weekly');
  const [residencyId, setResidencyId] = useState('');
  // weekDate = the "current" center week — range shows 2 before + this + 3 after
  const [weekDate, setWeekDate] = useState(getCurrentServiceWeekStart());
  const [residencies, setResidencies] = useState<{ id: string; residencyId: string; residencyName: string }[]>([]);
  const [data, setData] = useState<AllocData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // edits: serviceId → weekDate → { userId, dayOfWeek } | null (null = pending clear)
  const [edits, setEdits] = useState<Record<string, Record<string, CellEdit>>>({});

  useEffect(() => {
    if (authLoading || !user) return;
    getResidenciesForGuide({}).then((res: any) => {
      const list = Array.isArray(res) ? res : [];
      setResidencies(list);
      if (list.length > 0) setResidencyId(list[0].residencyId);
    }).catch(() => {});
  }, [authLoading, user]);

  const load = () => {
    if (!residencyId || !weekDate) return;
    setLoading(true);
    exportServiceAllocation({ serviceType, residencyId, weekDate })
      .then((d: any) => { setData(d); setEdits({}); })
      .catch(() => toast.error('Failed to load allocation data'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [serviceType, residencyId, weekDate]);

  const handleEdit = (serviceId: string, wDate: string, userId: string, dayOfWeek: string) => {
    setEdits(prev => ({
      ...prev,
      [serviceId]: { ...(prev[serviceId] || {}), [wDate]: { userId, dayOfWeek } },
    }));
  };

  const handleClear = (serviceId: string, wDate: string) => {
    setEdits(prev => ({
      ...prev,
      [serviceId]: { ...(prev[serviceId] || {}), [wDate]: null },
    }));
  };

  const handleSave = async () => {
    if (!data) return;

    // Collect all weekDates that have pending edits
    const weekDateSet = new Set<string>();
    Object.values(edits).forEach(weekMap => Object.keys(weekMap).forEach(wd => weekDateSet.add(wd)));
    if (weekDateSet.size === 0) { toast.info('No pending changes to save.'); return; }

    setSaving(true);
    let totalCreated = 0;
    try {
      for (const wDate of weekDateSet) {
        const assignments: { userId: string; serviceId: string; dayOfWeek: string }[] = [];
        const clearServiceIds: string[] = [];

        Object.entries(edits).forEach(([serviceId, weekMap]) => {
          if (!(wDate in weekMap)) return;
          const edit = weekMap[wDate];
          if (edit && edit.userId) {
            assignments.push({ serviceId, userId: edit.userId, dayOfWeek: edit.dayOfWeek });
          } else {
            clearServiceIds.push(serviceId);
          }
        });

        if (assignments.length > 0 || clearServiceIds.length > 0) {
          const res = await importServiceAllocation({
            weekDate: wDate, serviceType, residencyId, assignments, clearServiceIds,
          }) as any;
          totalCreated += res.created;
        }
      }
      toast.success(`Saved ${totalCreated} assignment(s) across ${weekDateSet.size} week(s)`);
      load();
    } catch {
      toast.error('Failed to save assignments. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    if (!data) return;
    // New format: services as rows, weeks as columns
    const headers = [
      'Service Name',
      ...data.weekDates.map(wd => `${fmtDate(wd)} (${wd})`),
    ];
    const rows = data.services.map(svc => [
      svc.name,
      ...data.weekDates.map(wd => {
        const cell = data.grid[svc.id]?.[wd];
        if (!cell || cell.length === 0) return '';
        return cell.map(a => `${a.userName} (${a.dayOfWeek.slice(0, 3)})`).join('; ');
      }),
    ]);
    exportToCsv(`service-allocation-${serviceType.replace(/\s+/g, '-')}-${weekDate}.csv`, headers, rows);
    toast.success('CSV exported — fill in cells as "Name (Day)" and import back.');
  };

  const handleImportConfirm = async (assignments: ImportAssignment[]) => {
    // Group by weekDate, call importServiceAllocation once per week
    const byWeek = new Map<string, ImportAssignment[]>();
    assignments.forEach(a => {
      if (!byWeek.has(a.weekDate)) byWeek.set(a.weekDate, []);
      byWeek.get(a.weekDate)!.push(a);
    });

    let total = 0;
    for (const [wDate, wAssignments] of byWeek) {
      const res = await importServiceAllocation({
        weekDate: wDate, serviceType, residencyId,
        assignments: wAssignments.map(({ userId, serviceId, dayOfWeek }) => ({ userId, serviceId, dayOfWeek })),
      }) as any;
      total += res.created;
    }
    toast.success(`Imported ${total} assignment(s)`);
    load();
  };

  // Range label: "26 Apr — 31 May"
  const rangeLabel = useMemo(() => {
    if (!data?.weekDates?.length) return fmtDate(weekDate);
    const first = data.weekDates[0];
    const last = data.weekDates[data.weekDates.length - 1];
    const f = new Date(first + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const l = new Date(last + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${f} — ${l}`;
  }, [data?.weekDates, weekDate]);

  const pendingCount = Object.values(edits).reduce(
    (sum, weekMap) => sum + Object.keys(weekMap).length, 0
  );

  if (authLoading) return null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1600px] mx-auto px-4 py-5 space-y-4">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold flex items-center gap-2 flex-wrap">
              <FileSpreadsheet className="w-5 h-5 text-primary shrink-0" />
              Service Allocation Manager
              {pendingCount > 0 && (
                <Badge variant="secondary">{pendingCount} unsaved change{pendingCount !== 1 ? 's' : ''}</Badge>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              Services as rows · Weeks as columns · Click any cell to assign a resident
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setShowImport(true)} disabled={!data || loading}>
              <Upload className="w-3.5 h-3.5 mr-1.5" />Import CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!data || loading}>
              <Download className="w-3.5 h-3.5 mr-1.5" />Export CSV
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !data || loading || pendingCount === 0}>
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </div>

        {/* ── Filters ────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-3 items-center p-3 rounded-lg bg-card border border-border">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground font-medium">Service Type</span>
            <Select value={serviceType} onValueChange={v => { if (v) { setServiceType(v as string); setEdits({}); } }}>
              <SelectTrigger className="w-[200px] h-8 text-sm">
                <SelectValue>
                  {(val) => SERVICE_TYPES.find(st => st.value === val)?.label || val}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SERVICE_TYPES.map(st => <SelectItem key={st.value} value={st.value}>{st.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {residencies.length > 1 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground font-medium">Residency</span>
              <Select value={residencyId} onValueChange={v => { if (v) { setResidencyId(v as string); setEdits({}); } }}>
                <SelectTrigger className="w-[180px] h-8 text-sm">
                  <SelectValue>
                    {(val) => residencies.find(r => r.residencyId === val)?.residencyName || val}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {residencies.map(r => <SelectItem key={r.residencyId} value={r.residencyId}>{r.residencyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Week range navigator — shifts the center week */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground font-medium">Week Range</span>
            <div className="flex items-center gap-1 h-8 rounded-md border border-input bg-background px-2">
              <button onClick={() => setWeekDate(shiftWeek(weekDate, -1))} className="p-0.5 hover:bg-muted rounded transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-medium px-1 whitespace-nowrap flex items-center gap-1">
                <CalendarDays className="w-3 h-3 text-muted-foreground" />
                {rangeLabel}
              </span>
              <button onClick={() => setWeekDate(shiftWeek(weekDate, 1))} className="p-0.5 hover:bg-muted rounded transition-colors">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-muted/60 border border-border" />
              Past = read-only
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-primary/10 border-2 border-primary/40" />
              This week
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-card border border-border" />
              Future = editable
            </span>
          </div>
        </div>

        {/* ── Grid ───────────────────────────────────────────────────── */}
        {loading ? (
          <div className="space-y-2 rounded-lg border border-border p-4">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        ) : data ? (
          <AllocationExportGrid
            services={data.services}
            weekDates={data.weekDates}
            currentWeekDate={data.currentWeekDate}
            grid={data.grid}
            residents={data.residents}
            edits={edits}
            onChange={handleEdit}
            onClear={handleClear}
          />
        ) : (
          <div className="rounded-lg border border-border bg-card p-12 text-center text-muted-foreground text-sm">
            Select a residency to load allocation data.
          </div>
        )}

        {/* ── Hint ───────────────────────────────────────────────────── */}
        {data && !loading && (
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-4 py-3 border border-border space-y-1">
            <p className="font-medium text-foreground">How to use:</p>
            <ol className="list-decimal list-inside space-y-0.5 pl-1">
              <li>Click any cell in the <strong>current or future</strong> week columns to assign a resident</li>
              <li>Pick the resident and day from the popover, then click <em>Apply</em></li>
              <li>Click <strong>Save Changes</strong> to commit all edits at once</li>
              <li>Or <strong>Export CSV</strong>, fill in cells as "Name (Day)", and <strong>Import CSV</strong> to bulk-assign</li>
            </ol>
          </div>
        )}
      </div>

      <ImportCsvDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onConfirm={handleImportConfirm}
        residents={data?.residents || []}
        services={data?.services || []}
      />
    </div>
  );
}
