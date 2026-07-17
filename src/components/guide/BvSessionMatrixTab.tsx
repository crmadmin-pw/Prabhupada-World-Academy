/**
 * BvSessionMatrixTab — BV session attendance + quiz matrix
 * Columns: Name | Level | FOLK | Group | date columns (Attend | Quiz) | Att% | Quiz%
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Users, Calendar, CheckSquare, Brain, FileDown, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getBvSessionMatrix } from 'zite-endpoints-sdk';
import type { GetBvSessionMatrixOutputType } from 'zite-endpoints-sdk';
import { format, startOfISOWeek, endOfISOWeek, getISOWeek, getISOWeekYear, startOfMonth, endOfMonth } from 'date-fns';
import { useDebouncedCallback } from 'use-debounce';
import { ASHRAY_LEVELS } from '@/types/enums';
import { EmptyState } from '@/shared';
import { exportToCsv } from '@/utils/exportCsv';

type ReportType = 'weekly' | 'monthly';
type MemberRow = GetBvSessionMatrixOutputType['members'][0];

function getDefaultWeek(): string {
  const today = new Date();
  return `${getISOWeekYear(today)}-W${String(getISOWeek(today)).padStart(2, '0')}`;
}

function parseWeekInput(weekStr: string): { start: string; end: string } {
  const [yearStr, wStr] = weekStr.split('-W');
  const year = parseInt(yearStr); const week = parseInt(wStr);
  const jan4 = new Date(year, 0, 4);
  const ws = startOfISOWeek(jan4);
  const weekStart = new Date(ws); weekStart.setDate(ws.getDate() + (week - 1) * 7);
  return { start: format(weekStart, 'yyyy-MM-dd'), end: format(endOfISOWeek(weekStart), 'yyyy-MM-dd') };
}

function parseMonthInput(monthStr: string): { start: string; end: string } {
  const [y, m] = monthStr.split('-');
  const date = new Date(parseInt(y), parseInt(m) - 1, 1);
  return { start: format(startOfMonth(date), 'yyyy-MM-dd'), end: format(endOfMonth(date), 'yyyy-MM-dd') };
}

function getWeekOptions() {
  const opts: { value: string; label: string }[] = [];
  const now = new Date(); const cws = startOfISOWeek(now);
  for (let i = 0; i < 52; i++) {
    const ws = new Date(cws); ws.setDate(cws.getDate() - i * 7);
    const we = endOfISOWeek(ws);
    opts.push({ value: `${getISOWeekYear(ws)}-W${String(getISOWeek(ws)).padStart(2, '0')}`, label: `Week ${getISOWeek(ws)}: ${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}` });
  }
  return opts;
}

function getMonthOptions() {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let y = now.getFullYear(); y >= now.getFullYear() - 1; y--) {
    const max = y === now.getFullYear() ? now.getMonth() + 1 : 12;
    for (let m = max; m >= 1; m--)
      opts.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: format(new Date(y, m - 1, 1), 'MMMM yyyy') });
  }
  return opts;
}

const WEEK_OPTIONS = getWeekOptions();
const MONTH_OPTIONS = getMonthOptions();

interface Props { guideId: string; bvslMode?: boolean; residencyIds?: string[]; }

export default function BvSessionMatrixTab({ guideId, bvslMode, residencyIds }: Props) {
  const [loading, setLoading] = useState(false);
  const [reportType, setReportType] = useState<ReportType>('weekly');
  const [selectedWeek, setSelectedWeek] = useState(getDefaultWeek());
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [groupId, setGroupId] = useState('all');
  const [ashrayFilter, setAshrayFilter] = useState('all');
  const [residencyFilter, setResidencyFilter] = useState('all');
  const [folkFilter, setFolkFilter] = useState('all');
  const [viewFilter, setViewFilter] = useState<'both' | 'attendance' | 'quiz'>('both');
  const [data, setData] = useState<GetBvSessionMatrixOutputType | null>(null);

  const { start, end } = useMemo(() => {
    if (reportType === 'weekly') return parseWeekInput(selectedWeek);
    return parseMonthInput(selectedMonth);
  }, [reportType, selectedWeek, selectedMonth]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getBvSessionMatrix({
        guideId, startDate: start, endDate: end,
        groupId: groupId !== 'all' ? groupId : undefined,
        bvslMode,
        residencyIds: residencyIds && residencyIds.length > 0 ? residencyIds : undefined,
      });
      setData(result);
    } catch { toast.error('Failed to load BV report'); }
    finally { setLoading(false); }
  }, [guideId, start, end, groupId, bvslMode, residencyIds]);

  const debouncedFetch = useDebouncedCallback(fetchData, 300);
  useEffect(() => { debouncedFetch(); }, [guideId, start, end, groupId, bvslMode, residencyIds]);

  const groups: { id: string; name: string }[] = (data as any)?.groups ?? [];

  // Available FOLK residencies for filter
  const availableResidencies = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, string>();
    for (const m of data.members) {
      const rn = (m as any).residencyName;
      if (rn) map.set(rn, rn);
    }
    return Array.from(map.keys()).sort();
  }, [data]);

  // Client-side filtering
  const filteredMembers = useMemo(() => {
    if (!data) return [];
    return data.members.filter(m => {
      if (ashrayFilter !== 'all' && m.ashrayLevel !== ashrayFilter) return false;
      if (residencyFilter === 'resident' && !m.isResident) return false;
      if (residencyFilter === 'non_resident' && m.isResident) return false;
      if (folkFilter !== 'all') {
        const rn = (m as any).residencyName || null;
        if (folkFilter === 'NR') { if (m.isResident) return false; }
        else { if (rn !== folkFilter) return false; }
      }
      return true;
    }).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [data, ashrayFilter, residencyFilter, folkFilter]);

  // Summary stats
  const stats = useMemo(() => {
    if (!data || filteredMembers.length === 0) return { sessionDates: 0, attendancePct: 0, avgQuiz: null as number | null };
    const sessionDates = data.sessionDates.length;
    let possible = 0; let attended = 0;
    const quizList: number[] = [];
    for (const m of filteredMembers) {
      const att = (data.attendance as Record<string, Record<string, boolean>>)[m.userId] || {};
      const qs = (data.quizScores as Record<string, Record<string, number>>)[m.userId] || {};
      for (const d of data.sessionDates) {
        if (att[d] !== undefined) { possible++; if (att[d]) attended++; }
      }
      for (const score of Object.values(qs)) { if (score != null) quizList.push(score as number); }
    }
    return {
      sessionDates,
      attendancePct: possible > 0 ? Math.round(attended / possible * 100) : 0,
      avgQuiz: quizList.length > 0 ? Math.round(quizList.reduce((a, b) => a + b, 0) / quizList.length) : null,
    };
  }, [data, filteredMembers]);

  const displayDates = data?.allDates ?? [];
  const sessionDateSet = new Set<string>(data?.sessionDates ?? []);

  const dateLabel = reportType === 'weekly' && start && end
    ? `${format(new Date(start + 'T00:00:00'), 'MMM d')} – ${format(new Date(end + 'T00:00:00'), 'MMM d, yyyy')}`
    : reportType === 'monthly' ? format(new Date(selectedMonth + '-01'), 'MMMM yyyy') : '';

  const handleExportImage = () => {
    const table = document.querySelector('#bv-matrix-table') as HTMLTableElement | null;
    if (!table) return toast.error('Table not found');
    const rows = Array.from(table.querySelectorAll('tr'));
    const padding = 16;
    const cellPad = 6;
    const fontSize = 11;
    const lineH = fontSize * 1.6;
    // Measure column widths
    const colWidths: number[] = [];
    rows.forEach(row => {
      Array.from(row.cells).forEach((cell, ci) => {
        const span = cell.colSpan || 1;
        if (span === 1) {
          const w = Math.max(colWidths[ci] || 0, cell.textContent!.trim().length * (fontSize * 0.6) + cellPad * 2);
          colWidths[ci] = Math.max(w, 36);
        }
      });
    });
    // Fill gaps
    const totalCols = Math.max(...rows.map(r => Array.from(r.cells).reduce((s, c) => s + (c.colSpan || 1), 0)));
    for (let i = 0; i < totalCols; i++) { if (!colWidths[i]) colWidths[i] = 40; }
    const totalWidth = colWidths.reduce((a, b) => a + b, 0) + padding * 2;
    const totalHeight = rows.length * lineH + padding * 2 + 30;
    const canvas = document.createElement('canvas');
    canvas.width = totalWidth; canvas.height = totalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, totalWidth, totalHeight);
    ctx.font = `bold ${fontSize + 2}px sans-serif`;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(`BV Report — ${dateLabel}`, padding, padding + fontSize);
    ctx.font = `${fontSize}px sans-serif`;
    let y = padding + 28;
    rows.forEach((row, ri) => {
      if (ri % 2 === 1) { ctx.fillStyle = '#f8f8f8'; ctx.fillRect(padding, y, totalWidth - padding * 2, lineH); }
      ctx.fillStyle = ri < 2 ? '#e8f0fe' : 'transparent';
      if (ri < 2) ctx.fillRect(padding, y, totalWidth - padding * 2, lineH);
      let x = padding;
      let ci = 0;
      Array.from(row.cells).forEach(cell => {
        const span = cell.colSpan || 1;
        const colW = colWidths.slice(ci, ci + span).reduce((a, b) => a + b, 0);
        ctx.fillStyle = ri < 2 ? '#1a56db' : '#1a1a1a';
        ctx.font = ri < 2 ? `bold ${fontSize}px sans-serif` : `${fontSize}px sans-serif`;
        const text = cell.textContent?.trim() || '';
        ctx.fillText(text.slice(0, Math.floor(colW / (fontSize * 0.55))), x + cellPad, y + lineH * 0.7);
        ctx.strokeStyle = '#e2e8f0';
        ctx.strokeRect(x, y, colW, lineH);
        x += colW; ci += span;
      });
      y += lineH;
    });
    const link = document.createElement('a');
    link.download = `bv-report-${start}-${end}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleExportCsv = () => {
    if (!data) return;
    const dateHeaders = displayDates.flatMap(d => [`${format(new Date(d + 'T00:00:00'), 'MMM d')} Att`, `${format(new Date(d + 'T00:00:00'), 'MMM d')} Quiz`]);
    const headers = ['Name', 'Level', 'FOLK', 'Group', ...dateHeaders, 'Att%', 'Quiz%'];
    const rows = filteredMembers.map(m => {
      const att = (data.attendance as Record<string, Record<string, boolean>>)[m.userId] || {};
      const qs = (data.quizScores as Record<string, Record<string, number>>)[m.userId] || {};
      let attT = 0; let attP = 0; const ql: number[] = [];
      const dateCells = displayDates.flatMap(d => {
        const hasS = sessionDateSet.has(d);
        const a = att[d]; const q = qs[d];
        if (hasS && a !== undefined) { attP++; if (a) attT++; }
        if (q != null) ql.push(q);
        return [hasS ? (a ? '✓' : '✗') : '—', q != null ? `${q}%` : '—'];
      });
      return [
        m.fullName, m.ashrayLevel || '', m.isResident ? ((m as any).residencyName || 'Resident') : 'NR', m.groupName,
        ...dateCells,
        attP > 0 ? `${Math.round(attT / attP * 100)}%` : '—',
        ql.length > 0 ? `${Math.round(ql.reduce((a, b) => a + b, 0) / ql.length)}%` : '—',
      ];
    });
    exportToCsv(`bv-report-${start}-${end}.csv`, headers, rows);
  };

  const handleWhatsAppReminder = () => {
    if (!data || filteredMembers.length === 0) return;
    const absent = filteredMembers.filter(m => {
      const att = (data.attendance as Record<string, Record<string, boolean>>)[m.userId] || {};
      let possible = 0; let present = 0;
      for (const d of data.sessionDates) { if (att[d] !== undefined) { possible++; if (att[d]) present++; } }
      return possible > 0 && (present / possible) < 0.5;
    });
    if (absent.length === 0) { toast.success('All members have good attendance! 🎉'); return; }
    const names = absent.slice(0, 20).map(m => `• ${m.fullName}`).join('\n');
    const msg = `🙏 Hare Krishna!\n\nBV Report (${dateLabel}):\nThe following members have low attendance:\n${names}${absent.length > 20 ? `\n...and ${absent.length - 20} more` : ''}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">BV Report</CardTitle>
              {dateLabel && <span className="text-xs text-muted-foreground">{dateLabel}</span>}
              <button onClick={fetchData} disabled={loading} title="Refresh"
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40 text-xs font-medium">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              {reportType === 'monthly' && (
                <Button size="sm" variant="outline" className="h-8" onClick={handleExportCsv} disabled={!data || loading}>
                  <FileDown className="w-3 h-3 mr-1" />Export CSV
                </Button>
              )}
              {reportType === 'weekly' && (
                <Button size="sm" variant="outline" className="h-8" onClick={handleExportImage} disabled={!data || loading}>
                  <FileDown className="w-3 h-3 mr-1" />Export Image
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-8 border-green-600 text-green-700 hover:bg-green-600 hover:text-white" onClick={handleWhatsAppReminder} disabled={!data || loading}>
                <MessageCircle className="w-3 h-3 mr-1" />WhatsApp Group Reminder
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
            <div className="flex items-center gap-1.5">
              <Label className="text-sm font-medium whitespace-nowrap">Type:</Label>
              <Select value={reportType} onValueChange={(v: ReportType) => setReportType(v)}>
                <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {reportType === 'weekly' && (
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium whitespace-nowrap">Week:</Label>
                <Select value={selectedWeek} onValueChange={setSelectedWeek}>
                  <SelectTrigger className="h-8 w-[230px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60">{WEEK_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {reportType === 'monthly' && (
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium whitespace-nowrap">Month:</Label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60">{MONTH_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {groups.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium whitespace-nowrap">Group:</Label>
                <Select value={groupId} onValueChange={setGroupId}>
                  <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Groups</SelectItem>
                    {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Label className="text-sm font-medium whitespace-nowrap">Level:</Label>
              <Select value={ashrayFilter} onValueChange={setAshrayFilter}>
                <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  {ASHRAY_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-sm font-medium whitespace-nowrap">View:</Label>
              <Select value={viewFilter} onValueChange={(v: 'both' | 'attendance' | 'quiz') => setViewFilter(v)}>
                <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both</SelectItem>
                  <SelectItem value="attendance">Attendance Only</SelectItem>
                  <SelectItem value="quiz">Quiz Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-sm font-medium whitespace-nowrap">FOLK:</Label>
              <Select value={folkFilter} onValueChange={setFolkFilter}>
                <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="NR">NR</SelectItem>
                  {availableResidencies.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading skeleton */}
      {!data && loading && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          <Card><CardContent className="p-4"><Skeleton className="h-64" /></CardContent></Card>
        </div>
      )}

      {data && (
        <div className={`space-y-3 transition-opacity ${loading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
          {/* Summary cards */}
          <div className="flex flex-wrap gap-3">
            <SummaryCard icon={Users} label="Total Members" value={filteredMembers.length} />
            <SummaryCard icon={Calendar} label="Session Dates" value={stats.sessionDates} color="text-primary" />
            <SummaryCard icon={CheckSquare} label="Attendance %"  value={`${stats.attendancePct}%`}
              color={stats.attendancePct >= 75 ? 'text-green-600' : stats.attendancePct >= 50 ? 'text-amber-600' : 'text-red-600'} />
            <SummaryCard icon={Brain} label="Avg Quiz"
              value={stats.avgQuiz != null ? `${stats.avgQuiz}%` : '—'}
              color={stats.avgQuiz == null ? '' : stats.avgQuiz >= 80 ? 'text-green-600' : stats.avgQuiz >= 60 ? 'text-amber-600' : 'text-red-600'} />
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground items-center">
            <span className="font-medium">Legend:</span>
            <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">✓ Attended</span>
            <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">✗ Absent</span>
            <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">— No session</span>
            <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">Quiz ≥80%</span>
            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">Quiz 60-79%</span>
            <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">Quiz &lt;60%</span>
          </div>

          {filteredMembers.length === 0 ? (
            <Card><CardContent className="py-4"><EmptyState title="No members found for the selected filters." /></CardContent></Card>
          ) : displayDates.length === 0 ? (
            <Card><CardContent className="py-4"><EmptyState title="No dates in the selected period." /></CardContent></Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table id="bv-matrix-table" className="text-xs border-collapse" style={{ minWidth: 400 }}>
                    <thead>
                      {/* Row 1: date group headers */}
                      <tr className="bg-muted/50 border-b">
                        <th className="p-2 text-left font-semibold sticky left-0 bg-muted/50 z-20 border-r min-w-[130px]">Name</th>
                        <th className="p-2 text-center font-medium min-w-[80px]">Level</th>
                        <th className="p-2 text-center font-medium min-w-[72px]">FOLK</th>
                        <th className="p-2 text-left font-medium border-r min-w-[80px]">Group</th>
                        {displayDates.map(d => (
                          <th key={d} colSpan={viewFilter === 'both' ? 2 : 1}
                            className={`p-1 text-center font-medium border-r whitespace-nowrap ${sessionDateSet.has(d) ? 'bg-primary/10 text-primary' : ''}`}
                            style={{ minWidth: viewFilter === 'both' ? 80 : 40 }}>
                            {format(new Date(d + 'T00:00:00'), 'MMM d')}
                            {sessionDateSet.has(d) && <span className="ml-1 text-[9px] text-primary opacity-70">●</span>}
                          </th>
                        ))}
                        {viewFilter !== 'quiz' && <th className="p-2 text-center font-semibold border-l-2 border-border min-w-[60px]" rowSpan={2}>Att%</th>}
                        {viewFilter !== 'attendance' && <th className="p-2 text-center font-semibold min-w-[60px]" rowSpan={2}>Quiz%</th>}
                      </tr>
                      {/* Row 2: sub-column headers */}
                      <tr className="bg-muted/30 border-b">
                        <th className="sticky left-0 bg-muted/30 z-20 border-r" />
                        <th />
                        <th />
                        <th className="border-r" />
                        {displayDates.flatMap(d => [
                          ...(viewFilter !== 'quiz' ? [<th key={`${d}-ha`} className={`p-1 text-center font-medium border-r text-[10px] ${sessionDateSet.has(d) ? 'bg-primary/5' : 'text-muted-foreground'}`} style={{ minWidth: 38 }}>Att</th>] : []),
                          ...(viewFilter !== 'attendance' ? [<th key={`${d}-hq`} className={`p-1 text-center font-medium border-r text-[10px] ${sessionDateSet.has(d) ? 'bg-primary/5' : 'text-muted-foreground'}`} style={{ minWidth: 42 }}>Quiz</th>] : []),
                        ])}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMembers.map((m, idx) => (
                        <MatrixRow
                          key={m.userId}
                          member={m}
                          dates={displayDates}
                          sessionDates={sessionDateSet}
                          attendance={(data.attendance as Record<string, Record<string, boolean>>)[m.userId] || {}}
                          quizScores={(data.quizScores as Record<string, Record<string, number>>)[m.userId] || {}}
                          isEven={idx % 2 === 0}
                          viewFilter={viewFilter}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function MatrixRow({ member, dates, sessionDates, attendance, quizScores, isEven, viewFilter }: {
  member: MemberRow;
  dates: string[];
  sessionDates: Set<string>;
  attendance: Record<string, boolean>;
  quizScores: Record<string, number>;
  isEven: boolean;
  viewFilter: 'both' | 'attendance' | 'quiz';
}) {
  const rowBg = isEven ? '' : 'bg-muted/20';

  let attTotal = 0; let attPossible = 0;
  const quizList: number[] = [];
  for (const d of dates) {
    if (sessionDates.has(d) && attendance[d] !== undefined) {
      attPossible++;
      if (attendance[d]) attTotal++;
    }
    const q = quizScores[d];
    if (q != null) quizList.push(q);
  }
  const attPct = attPossible > 0 ? Math.round(attTotal / attPossible * 100) : null;
  const avgQuiz = quizList.length > 0 ? Math.round(quizList.reduce((a, b) => a + b, 0) / quizList.length) : null;

  const folkLabel = member.isResident ? ((member as any).residencyName || 'Resident') : 'NR';

  return (
    <tr className={`border-b hover:bg-muted/30 ${rowBg}`}>
      <td className={`p-2 font-medium sticky left-0 z-10 border-r ${isEven ? 'bg-background' : 'bg-muted/20'}`} style={{ minWidth: 130 }}>
        <div className="truncate max-w-[120px]">{member.fullName}</div>
      </td>
      <td className="p-2 text-center text-[11px]">
        {member.ashrayLevel ? <span className="font-medium truncate block max-w-[75px] mx-auto">{member.ashrayLevel}</span> : <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="p-2 text-center text-[11px]">
        {member.isResident
          ? <span className="text-primary font-medium truncate block max-w-[68px] mx-auto">{folkLabel}</span>
          : <span className="text-muted-foreground font-medium">NR</span>}
      </td>
      <td className={`p-2 text-muted-foreground border-r ${isEven ? 'bg-background' : 'bg-muted/20'}`} style={{ minWidth: 80 }}>
        <div className="truncate max-w-[70px] text-[11px]">{member.groupName}</div>
      </td>
      {dates.flatMap(d => {
        const hasSession = sessionDates.has(d);
        const attVal = attendance[d];
        const quizVal = quizScores[d];
        const cells: React.ReactElement[] = [];
        if (viewFilter !== 'quiz') {
          cells.push(
            <td key={`${d}-a`} className="border-r p-1 text-center" style={{ minWidth: 38 }}>
              {!hasSession ? (
                <span className="text-muted-foreground">—</span>
              ) : attVal === true ? (
                <span className="inline-block px-1 rounded bg-green-50 text-green-700 font-bold">✓</span>
              ) : attVal === false ? (
                <span className="inline-block px-1 rounded bg-red-50 text-red-600 font-bold">✗</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
          );
        }
        if (viewFilter !== 'attendance') {
          cells.push(
            <td key={`${d}-q`} className="border-r p-1 text-center" style={{ minWidth: 42 }}>
              {quizVal != null ? (
                <span className={`inline-block px-1 rounded font-medium text-[10px] ${quizVal >= 80 ? 'bg-green-50 text-green-700' : quizVal >= 60 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                  {quizVal}%
                </span>
              ) : <span className="text-muted-foreground">—</span>}
            </td>
          );
        }
        return cells;
      })}
      {viewFilter !== 'quiz' && (
        <td className="p-1 text-center border-l-2 border-border">
          {attPct != null ? (
            <Badge variant="outline" className={`text-[10px] px-1 ${attPct >= 75 ? 'text-green-600 border-green-300' : attPct >= 50 ? 'text-amber-600 border-amber-300' : 'text-red-600 border-red-300'}`}>
              {attPct}%
            </Badge>
          ) : <span className="text-muted-foreground">—</span>}
        </td>
      )}
      {viewFilter !== 'attendance' && (
        <td className="p-1 text-center">
          {avgQuiz != null ? (
            <Badge variant="outline" className={`text-[10px] px-1 ${avgQuiz >= 80 ? 'text-green-600 border-green-300' : avgQuiz >= 60 ? 'text-amber-600 border-amber-300' : 'text-red-600 border-red-300'}`}>
              {avgQuiz}%
            </Badge>
          ) : <span className="text-muted-foreground">—</span>}
        </td>
      )}
    </tr>
  );
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string | number; color?: string }) {
  return (
    <Card className="flex-1 min-w-[100px]">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2"><Icon className={`w-4 h-4 ${color || 'text-muted-foreground'}`} /><span className="text-xs text-muted-foreground">{label}</span></div>
        <div className={`text-2xl font-bold mt-1 ${color || ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
