import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, FileText, CheckCircle2, Download, Search, ChevronLeft, ChevronRight, Loader2, AlertCircle, Clock, Users, BarChart3, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { useDebouncedCallback } from 'use-debounce';
import { getJigyasaTracker, processJigyasaRegistration, processJigyasaAttendance } from 'zite-endpoints-sdk';
import type { GetJigyasaTrackerOutputType } from 'zite-endpoints-sdk';
import { parseRegistrationCsv, parseAttendanceCsv, extractDateFromFilename } from '@/lib/jigyasaCsvParser';
import { exportToCsv } from '@/utils/exportCsv';
import { format } from 'date-fns';

type RegRecord = GetJigyasaTrackerOutputType['registrations'][0];
type SessionRecord = GetJigyasaTrackerOutputType['sessionRecords'][0];
type ProcessedFile = GetJigyasaTrackerOutputType['processedFiles'][0];
type Stats = GetJigyasaTrackerOutputType['stats'];

const PAGE_SIZE = 50;

interface Props {
  centreFilter?: string;
  affiliateFilter?: string;
  canUpload?: boolean;
}

export default function JigyasaTrackerTab({ centreFilter, affiliateFilter, canUpload = true }: Props) {
  const [activeTab, setActiveTab] = useState<'summary' | 'sessions' | 'files'>('summary');
  const [loading, setLoading] = useState(true);
  const [registrations, setRegistrations] = useState<RegRecord[]>([]);
  const [sessionRecords, setSessionRecords] = useState<SessionRecord[]>([]);
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const [centre, setCentre] = useState(centreFilter || '');
  const [affiliate, setAffiliate] = useState(affiliateFilter || '');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const [uploadingReg, setUploadingReg] = useState(false);
  const [uploadingAtt, setUploadingAtt] = useState(false);
  const regInputRef = useRef<HTMLInputElement>(null);
  const attInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getJigyasaTracker({
        tab: activeTab,
        centre: centre || undefined,
        affiliate: affiliate || undefined,
        search: search || undefined,
        offset,
        limit: activeTab === 'sessions' ? 2000 : PAGE_SIZE,
      });
      setRegistrations(res.registrations);
      setSessionRecords(res.sessionRecords);
      setProcessedFiles(res.processedFiles);
      setStats(res.stats);
      setHasMore(res.hasMore);
      setTotalCount(res.totalCount);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load tracker');
    }
    setLoading(false);
  }, [activeTab, centre, affiliate, search, offset]);

  useEffect(() => { load(); }, [load]);

  const debouncedSearch = useDebouncedCallback((v: string) => { setSearch(v); setOffset(0); }, 400);

  const handleRegUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingReg(true);
    try {
      const text = await file.text();
      const rows = parseRegistrationCsv(text);
      if (rows.length === 0) { toast.error('No valid rows found in CSV'); return; }
      const res = await processJigyasaRegistration({ fileName: file.name, rows });
      toast.success(`Processed ${res.created} registrations from ${file.name}`);
      load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to process registration CSV');
    } finally {
      setUploadingReg(false);
      if (regInputRef.current) regInputRef.current.value = '';
    }
  };

  const handleAttUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const sessionDate = extractDateFromFilename(file.name);
    if (!sessionDate) {
      toast.error('Filename must contain a date in YYYY-MM-DD format (e.g. Attendance_2026-06-17.csv)');
      if (attInputRef.current) attInputRef.current.value = '';
      return;
    }
    setUploadingAtt(true);
    try {
      const text = await file.text();
      const rows = parseAttendanceCsv(text);
      if (rows.length === 0) { toast.error('No valid rows found in CSV'); return; }
      const res = await processJigyasaAttendance({ fileName: file.name, sessionDate, rows } as any);
      toast.success(`Processed ${res.attendeesProcessed} attendees for ${sessionDate}. ${res.newRegistrations} new registrations created.`);
      load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to process attendance CSV');
    } finally {
      setUploadingAtt(false);
      if (attInputRef.current) attInputRef.current.value = '';
    }
  };

  // Build pivot data from session records
  const pivotData = useMemo(() => buildPivot(sessionRecords), [sessionRecords]);

  const handleExport = () => {
    if (activeTab === 'summary' && registrations.length > 0) {
      const headers = ['Name', 'Email', 'Phone', 'State', 'Centre', 'Affiliate', 'Age', 'Gender', 'City', 'Occupation', 'Attendance Mode', 'Total Sessions', 'Total Duration'];
      const rows = registrations.map(r => [r.name, r.email, r.phone, r.state, r.centreName, r.affiliateName, r.age, r.gender, r.city, r.occupation, r.attendanceMode, r.totalSessions, r.totalDuration]);
      exportToCsv('jigyasa-summary', headers, rows);
    } else if (activeTab === 'sessions' && pivotData) {
      const headers = ['Name', 'Email', 'Centre', 'Affiliate', ...pivotData.dates.map(d => format(new Date(d + 'T00:00:00'), 'MMM d'))];
      const rows = pivotData.people.map(p => [p.name, p.email, p.centreName, p.affiliateName, ...pivotData.dates.map(d => p.dateMap[d] ?? 0)]);
      exportToCsv('jigyasa-sessions', headers, rows);
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Section */}
      {canUpload && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UploadCard
            title="Registration CSV"
            description="Latest TagMango registration export (Sales → Transactions)"
            icon={<FileText className="w-6 h-6 text-muted-foreground" />}
            loading={uploadingReg}
            inputRef={regInputRef}
            onChange={handleRegUpload}
            accept=".csv"
          />
          <UploadCard
            title="Attendance CSV"
            description="Filename must contain date: Attendance_YYYY-MM-DD.csv"
            icon={<Clock className="w-6 h-6 text-muted-foreground" />}
            loading={uploadingAtt}
            inputRef={attInputRef}
            onChange={handleAttUpload}
            accept=".csv"
          />
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <JStatCard value={stats?.totalRegistered || 0} label="Registered" icon={<Users className="w-4 h-4" />} loading={loading && !stats} />
        <JStatCard value={stats?.attendedAtLeastOne || 0} label="Attended ≥ 1" icon={<CheckCircle2 className="w-4 h-4" />} loading={loading && !stats} />
        <JStatCard value={stats?.totalSessionDates || 0} label="Sessions Tracked" icon={<Calendar className="w-4 h-4" />} loading={loading && !stats} />
        <JStatCard
          value={stats && stats.totalRegistered > 0 ? `${((stats.attendedAtLeastOne / stats.totalRegistered) * 100).toFixed(1)}%` : '0%'}
          label="Attendance Rate"
          icon={<BarChart3 className="w-4 h-4" />}
          loading={loading && !stats}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="min-w-[140px]">
              <label className="text-xs text-muted-foreground mb-1 block">Centre</label>
              <Select value={centre || 'all'} onValueChange={v => { setCentre(v === 'all' ? '' : v); setOffset(0); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Centres</SelectItem>
                  {(stats?.centres || []).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[140px]">
              <label className="text-xs text-muted-foreground mb-1 block">Affiliate</label>
              <Select value={affiliate || 'all'} onValueChange={v => { setAffiliate(v === 'all' ? '' : v); setOffset(0); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Affiliates</SelectItem>
                  {(stats?.affiliates || []).map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-muted-foreground mb-1 block">Search</label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input placeholder="Name or email…" className="pl-8 h-9" onChange={e => debouncedSearch(e.target.value)} />
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport} className="h-9 gap-1">
              <Download className="w-3.5 h-3.5" /> Export
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={v => { setActiveTab(v as any); setOffset(0); }}>
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="sessions">Session Details</TabsTrigger>
          <TabsTrigger value="files">Processed Files</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <SummaryTable records={registrations} loading={loading} />
          {totalCount > 0 && (
            <PaginationBar offset={offset} setOffset={setOffset} hasMore={hasMore} totalCount={totalCount} />
          )}
        </TabsContent>
        <TabsContent value="sessions" className="mt-4">
          <SessionPivotTable data={pivotData} loading={loading} />
        </TabsContent>
        <TabsContent value="files" className="mt-4">
          <FilesTable records={processedFiles} loading={loading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ──── Pivot Builder ──── */

interface PivotPerson {
  email: string;
  name: string;
  centreName: string;
  affiliateName: string;
  dateMap: Record<string, number>; // date → minutes
}

interface PivotData {
  dates: string[];       // sorted YYYY-MM-DD
  people: PivotPerson[];
}

function durationDisplayToMinutes(display: string): number {
  if (!display) return 0;
  const parts = display.split(':');
  if (parts.length !== 3) return 0;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) + (parseInt(parts[2], 10) > 0 ? 1 : 0);
}

function buildPivot(records: SessionRecord[]): PivotData {
  const dateSet = new Set<string>();
  const personMap = new Map<string, PivotPerson>();

  for (const r of records) {
    if (!r.email) continue;
    const key = r.email.toLowerCase();
    dateSet.add(r.sessionDate);

    let person = personMap.get(key);
    if (!person) {
      person = { email: r.email, name: r.name, centreName: r.centreName, affiliateName: r.affiliateName, dateMap: {} };
      personMap.set(key, person);
    }
    const mins = durationDisplayToMinutes(r.durationDisplay);
    person.dateMap[r.sessionDate] = (person.dateMap[r.sessionDate] || 0) + mins;
  }

  const dates = [...dateSet].filter(Boolean).sort();
  const people = [...personMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  return { dates, people };
}

/* ──── Sub-components ──── */

function UploadCard({ title, description, icon, loading, inputRef, onChange, accept }: {
  title: string; description: string; icon: React.ReactNode; loading: boolean;
  inputRef: React.RefObject<HTMLInputElement>; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; accept: string;
}) {
  return (
    <Card className="border-2 border-dashed hover:border-primary/40 transition-colors cursor-pointer" onClick={() => !loading && inputRef.current?.click()}>
      <CardContent className="pt-6 pb-6 text-center space-y-2">
        {loading ? <Loader2 className="w-6 h-6 mx-auto animate-spin text-primary" /> : icon}
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onChange} />
        <Button variant="outline" size="sm" disabled={loading} className="mt-2">
          {loading ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Processing…</> : <><Upload className="w-3 h-3 mr-1" /> Upload</>}
        </Button>
      </CardContent>
    </Card>
  );
}

function JStatCard({ value, label, icon, loading }: { value: number | string; label: string; icon: React.ReactNode; loading: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 text-center">
        {loading ? <Skeleton className="h-8 w-16 mx-auto" /> : (
          <p className="text-2xl font-bold text-primary">{value}</p>
        )}
        <div className="flex items-center justify-center gap-1 mt-1">
          {icon}
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PaginationBar({ offset, setOffset, hasMore, totalCount }: {
  offset: number; setOffset: (v: number) => void; hasMore: boolean; totalCount: number;
}) {
  return (
    <div className="flex items-center justify-between mt-4">
      <p className="text-xs text-muted-foreground">
        Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, totalCount)} of {totalCount}
      </p>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          <ChevronLeft className="w-4 h-4" /> Prev
        </Button>
        <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => setOffset(offset + PAGE_SIZE)}>
          Next <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function SummaryTable({ records, loading }: { records: RegRecord[]; loading: boolean }) {
  if (loading) return <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  if (records.length === 0) return <EmptyState message="No registrations found" />;

  return (
    <Card>
      <CardContent className="p-0">
        {/* Mobile */}
        <div className="block md:hidden divide-y">
          {records.map(r => (
            <div key={r.id} className="p-3 space-y-1">
              <div className="flex justify-between items-start">
                <p className="font-medium text-sm">{r.name}</p>
                <Badge variant="outline" className="text-xs">{r.totalSessions} sessions</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{r.email}</p>
              <div className="flex gap-2 text-xs text-muted-foreground">
                {r.centreName && <span>{r.centreName}</span>}
                {r.affiliateName && <><span>·</span><span>{r.affiliateName}</span></>}
              </div>
              <p className="text-xs font-mono text-muted-foreground">{r.totalDuration}</p>
            </div>
          ))}
        </div>
        {/* Desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b">
              <th className="text-left p-3 font-medium text-muted-foreground">Name</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Phone</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Centre</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Affiliate</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Sessions</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Total Duration</th>
            </tr></thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3 text-muted-foreground">{r.email}</td>
                  <td className="p-3 text-muted-foreground">{r.phone}</td>
                  <td className="p-3">{r.centreName}</td>
                  <td className="p-3">{r.affiliateName}</td>
                  <td className="p-3 text-right font-medium">{r.totalSessions}</td>
                  <td className="p-3 text-right font-mono text-xs">{r.totalDuration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionPivotTable({ data, loading }: { data: PivotData; loading: boolean }) {
  if (loading) return <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  if (data.people.length === 0) return <EmptyState message="No session records found" />;

  return (
    <Card>
      <CardContent className="p-0">
        {/* Mobile card view */}
        <div className="block md:hidden divide-y">
          {data.people.map(p => (
            <div key={p.email} className="p-3 space-y-2">
              <div>
                <p className="font-medium text-sm">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.email}</p>
                {p.centreName && <p className="text-xs text-muted-foreground">{p.centreName}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.dates.map(d => {
                  const mins = p.dateMap[d] ?? 0;
                  return (
                    <div key={d} className={`text-center rounded px-2 py-1 text-xs ${mins > 0 ? 'bg-primary/10 text-primary font-medium' : 'bg-muted text-muted-foreground'}`}>
                      <div className="text-[10px] leading-tight">{format(new Date(d + 'T00:00:00'), 'MMM d')}</div>
                      <div className="font-mono">{mins}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {/* Desktop pivot table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2.5 font-medium text-muted-foreground sticky left-0 bg-card z-10 min-w-[150px]">Name</th>
                <th className="text-left p-2.5 font-medium text-muted-foreground min-w-[120px]">Centre</th>
                {data.dates.map(d => (
                  <th key={d} className="text-center p-2.5 font-medium text-muted-foreground whitespace-nowrap min-w-[60px]">
                    <div className="text-[10px] leading-tight">{format(new Date(d + 'T00:00:00'), 'MMM d')}</div>
                    <div className="text-[9px] text-muted-foreground/60 font-normal">(min)</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.people.map(p => (
                <tr key={p.email} className="border-b hover:bg-muted/30">
                  <td className="p-2.5 font-medium sticky left-0 bg-card z-10">
                    <div>{p.name}</div>
                    <div className="text-[11px] text-muted-foreground font-normal">{p.email}</div>
                  </td>
                  <td className="p-2.5 text-muted-foreground text-xs">{p.centreName}</td>
                  {data.dates.map(d => {
                    const mins = p.dateMap[d] ?? 0;
                    return (
                      <td key={d} className={`p-2.5 text-center font-mono text-xs ${mins > 0 ? 'text-primary font-semibold' : 'text-muted-foreground/40'}`}>
                        {mins}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t">
          <p className="text-xs text-muted-foreground">{data.people.length} participants · {data.dates.length} sessions · Values in minutes</p>
        </div>
      </CardContent>
    </Card>
  );
}

function FilesTable({ records, loading }: { records: ProcessedFile[]; loading: boolean }) {
  if (loading) return <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  if (records.length === 0) return <EmptyState message="No files processed yet" />;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="block md:hidden divide-y">
          {records.map(r => (
            <div key={r.id} className="p-3 space-y-1">
              <p className="font-medium text-sm truncate">{r.fileName}</p>
              <div className="flex gap-2 text-xs">
                <Badge variant={r.fileType === 'Registration' ? 'default' : 'secondary'}>{r.fileType}</Badge>
                <span className="text-muted-foreground">{r.recordsProcessed} records</span>
                {r.processedAt && <span className="text-muted-foreground">{format(new Date(r.processedAt), 'MMM d, h:mm a')}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b">
              <th className="text-left p-3 font-medium text-muted-foreground">File Name</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Type</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Session Date</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Records</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Processed At</th>
            </tr></thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{r.fileName}</td>
                  <td className="p-3"><Badge variant={r.fileType === 'Registration' ? 'default' : 'secondary'}>{r.fileType}</Badge></td>
                  <td className="p-3">{r.sessionDate ? format(new Date(r.sessionDate + 'T00:00:00'), 'MMM d, yyyy') : '—'}</td>
                  <td className="p-3 text-right">{r.recordsProcessed}</td>
                  <td className="p-3 text-muted-foreground">{r.processedAt ? format(new Date(r.processedAt), 'MMM d, yyyy h:mm a') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <AlertCircle className="w-10 h-10 mx-auto mb-2 text-muted-foreground/40" />
        <p className="text-muted-foreground text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}
