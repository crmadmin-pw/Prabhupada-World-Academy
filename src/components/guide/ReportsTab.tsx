// Fix 4: Frontend filtering for residency/level/folk-residency (no re-fetch on filter change)
// Fix 8: Debounce API call — only re-fetch when date/reportType changes
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FileDown, Image, Users, Headphones, BookOpen, Music2, TrendingUp, Search, Package, MessageCircle, Moon, Clock, RefreshCw, Zap, GraduationCap } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { getGuideDetailedReport, GetGuideDetailedReportOutputType, recalculateScoresForDate } from 'zite-endpoints-sdk';
import { useDebouncedCallback } from 'use-debounce';
import { format, subDays, startOfMonth, endOfMonth, startOfISOWeek, endOfISOWeek, getISOWeek, getISOWeekYear } from 'date-fns';
import { ASHRAY_LEVELS } from '@/types/enums';
import { scoreColor } from '@/lib/scoring';
import { fmt } from '@/lib/fmt';
import { EmptyState } from '@/shared';
import SadhanaDetailTable, { FieldDef, TOGGLE_DISPLAY_KEYS, DURATION_MINUTE_KEYS, minutesToHHMM, canonicalSort, UserRow, reorderFieldDefs, buildAshrayGroups } from '@/components/guide/SadhanaDetailTable';
import { exportToCsv } from '@/utils/exportCsv';
import { exportReportAsImage } from '@/utils/exportReportImage';
import ScoringCriteriaPanel from '@/components/guide/ScoringCriteriaPanel';

interface ReportsTabProps { guideId: string; senderName?: string; bvslMode?: boolean; mentorMode?: boolean; }
type ReportType = 'daily' | 'weekly' | 'monthly';
type ResidencyFilter = 'all' | 'resident' | 'non_resident' | 'scholar';

// ── "All" view: 6 common fields shared between residents and non-residents ──────
// These use remapped keys (common_*). Scoring scales differ per group (R rounds max=4,
// NR max=8) so we show raw values only — maxPoints: null means neutral cell styling.
const COMMON_FIELD_DEFS: FieldDef[] = [
  { key: 'common_rounds',    shortLabel: 'Rounds', maxPoints: null, isScoring: false, forResident: true, forNR: true },
  { key: 'common_reading',   shortLabel: 'Read',   maxPoints: null, isScoring: false, forResident: true, forNR: true },
  { key: 'common_hearing',   shortLabel: 'Hear',   maxPoints: null, isScoring: false, forResident: true, forNR: true },
  { key: 'common_seva',      shortLabel: 'Seva',   maxPoints: null, isScoring: false, forResident: true, forNR: true },
  { key: 'common_preaching', shortLabel: 'Preach', maxPoints: null, isScoring: false, forResident: true, forNR: true },
  { key: 'common_books',     shortLabel: 'Books',  maxPoints: null, isScoring: false, forResident: true, forNR: true },
];

type ReportUser = GetGuideDetailedReportOutputType['users'][0];

function getDefaultWeek(): string {
  const today = new Date();
  return `${getISOWeekYear(today)}-W${String(getISOWeek(today)).padStart(2, '0')}`;
}

function parseWeekInput(weekStr: string): { start: string; end: string } {
  const [yearStr, wStr] = weekStr.split('-W');
  const year = parseInt(yearStr);
  const week = parseInt(wStr);
  const jan4 = new Date(year, 0, 4);
  const startW1 = startOfISOWeek(jan4);
  const weekStart = new Date(startW1);
  weekStart.setDate(startW1.getDate() + (week - 1) * 7);
  return { start: format(weekStart, 'yyyy-MM-dd'), end: format(endOfISOWeek(weekStart), 'yyyy-MM-dd') };
}

function parseMonthInput(monthStr: string): { start: string; end: string } {
  const [yearStr, mStr] = monthStr.split('-');
  const date = new Date(parseInt(yearStr), parseInt(mStr) - 1, 1);
  return { start: format(startOfMonth(date), 'yyyy-MM-dd'), end: format(endOfMonth(date), 'yyyy-MM-dd') };
}

function getReportTitle(reportType: ReportType, selectedDate: string, startDate?: string, endDate?: string): string {
  if (reportType === 'daily') {
    return `SADHANA REPORT FOR ${format(new Date(selectedDate + 'T00:00:00'), 'EEEE, MMMM d, yyyy').toUpperCase()}`;
  }
  if (startDate && endDate) {
    return `SADHANA REPORT — ${format(new Date(startDate + 'T00:00:00'), 'MMM d, yyyy').toUpperCase()} – ${format(new Date(endDate + 'T00:00:00'), 'MMM d, yyyy').toUpperCase()}`;
  }
  return 'SADHANA REPORT';
}

// Phase 7 FIX: 1 pt = 15 min (lower bound of 15–24 min range), 2 pts = 30 min
function sbPtsToMinutes(pts: number): number {
  if (pts <= 0) return 0;
  if (pts >= 2) return 30;
  if (pts < 1) return Math.round(pts * 15);
  return 15;
}

/** Parse HH:MM string to minutes from midnight */
function parseTimeToMins(timeStr: string): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

/** Convert minutes from midnight to HH:MM display */
function minsToTimeDisplay(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getWeekOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  const currentWeekStart = startOfISOWeek(now);
  for (let i = 0; i < 78; i++) {
    const ws = new Date(currentWeekStart);
    ws.setDate(currentWeekStart.getDate() - i * 7);
    const we = endOfISOWeek(ws);
    const wn = getISOWeek(ws);
    const wy = getISOWeekYear(ws);
    options.push({
      value: `${wy}-W${String(wn).padStart(2, '0')}`,
      label: `Week ${wn}: ${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}`,
    });
  }
  return options;
}

function getMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  for (let y = curYear; y >= curYear - 2; y--) {
    const maxM = y === curYear ? curMonth : 12;
    for (let m = maxM; m >= 1; m--) {
      const date = new Date(y, m - 1, 1);
      options.push({
        value: `${y}-${String(m).padStart(2, '0')}`,
        label: format(date, 'MMMM yyyy'),
      });
    }
  }
  return options;
}

const WEEK_OPTIONS = getWeekOptions();
const MONTH_OPTIONS = getMonthOptions();

function computeSummary(users: ReportUser[], isScholarView = false) {
  const submitted = users.filter(u => u.submitted);
  // In scholar view, compute averages from scholars themselves.
  // In all other views, exclude scholars so they don't distort residency aggregate stats.
  const submittedNonScholar = isScholarView
    ? submitted
    : submitted.filter(u => !(u as any).isTempResident);
  const avg = (arr: number[], zeroIfEmpty = false) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : (zeroIfEmpty ? 0 : null);
  // OS/SICK FIX: chanting & reading are scored even when sick/OS — include all submitted users.
  // Only SB/hearing is skipped during sick/OS, so hearVals still excludes them.
  const nonSickOs = submittedNonScholar.filter(u => !u.flagSick && !u.flagOs);
  // Include 0 values — compulsory fields should show 0 average not "—"
  const chantVals = submittedNonScholar.map(u => u.chantingRaw ?? 0);
  const readVals  = submittedNonScholar.map(u => u.readingRaw ?? 0);
  const hearVals  = nonSickOs.map(u => u.hearingRaw).filter((v): v is number => v !== null);
  const pctVals = submittedNonScholar.map(u => u.scorePercent).filter((v): v is number => v !== null);
  // SB avg for residents (points, then converted to minutes) — exclude sick/OS
  const sbVals = nonSickOs.filter(u => u.isResident).map(u => {
    const v = u.fieldScores['sb'];
    return typeof v === 'number' ? v : null;
  }).filter((v): v is number => v !== null);
  // Sleep duration avg — sleep_minutes is now a raw number (minutes) — exclude sick/OS
  const sleepMinsArr = nonSickOs.map(u => {
    const v = u.fieldScores['sleep_minutes'];
    return typeof v === 'number' && v > 0 ? v : null;
  }).filter((v): v is number => v !== null);
  return {
    totalUsers: users.length,
    submitted: submitted.length,
    missing: users.length - submitted.length,
    chantingAvg: avg(chantVals, true),
    readingAvg: avg(readVals, true),
    hearingAvg: avg(hearVals),
    sbAvg: avg(sbVals),
    sleepTimeAvg: sleepMinsArr.length > 0 ? Math.round(sleepMinsArr.reduce((a, b) => a + b, 0) / sleepMinsArr.length) : null,
    scorePercentAvg: pctVals.length > 0 ? Math.round(pctVals.reduce((a, b) => a + b, 0) / pctVals.length) : null,
  };
}

export default function ReportsTab({ guideId, senderName, bvslMode, mentorMode }: ReportsTabProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [reportType, setReportType] = useState<ReportType>('daily');
  const [selectedDate, setSelectedDate] = useState(format(subDays(new Date(), 1), 'yyyy-MM-dd'));
  const [selectedWeek, setSelectedWeek] = useState(getDefaultWeek());
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [residencyFilter, setResidencyFilter] = useState<ResidencyFilter>(() => {
    return (sessionStorage.getItem('guide_report_residencyFilter') as ResidencyFilter) || 'resident';
  });
  const [ashrayLevelFilter, setAshrayLevelFilter] = useState<string>('all');
  const [folkResidencyId, setFolkResidencyId] = useState<string>('all');
  const [rawReportData, setRawReportData] = useState<GetGuideDetailedReportOutputType | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [showScholars, setShowScholars] = useState(false);
  const [showMissing, setShowMissing] = useState(true);
  const [showRealValues, setShowRealValues] = useState(false);
  const [guideFilter, setGuideFilter] = useState<string>('all');
  const reportRef = useRef<HTMLDivElement>(null);
  // Race-condition guard: only the latest request's result/error is applied
  const fetchSeqRef = useRef(0);

  const { start: computedStart, end: computedEnd } = useMemo(() => {
    if (reportType === 'weekly' && selectedWeek) return parseWeekInput(selectedWeek);
    if (reportType === 'monthly' && selectedMonth) return parseMonthInput(selectedMonth);
    return { start: undefined as string | undefined, end: undefined as string | undefined };
  }, [reportType, selectedWeek, selectedMonth]);

  const fetchReport = useCallback(async (params: {
    guideId: string; date: string; reportType: ReportType;
    computedStart?: string; computedEnd?: string; bvslMode?: boolean; mentorMode?: boolean;
  }) => {
    // Assign a unique sequence number to this request
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    try {
      const result = await getGuideDetailedReport({
        guideId: params.guideId,
        date: params.date,
        reportType: params.reportType,
        startDate: params.computedStart,
        endDate: params.computedEnd,
        bvslMode: params.bvslMode,
        mentorMode: params.mentorMode,
      });
      // Only apply if this is still the latest request
      if (seq === fetchSeqRef.current) {
        setRawReportData(result);
      }
    } catch (err) {
      // Only show error toast if this is still the latest request (ignore stale failures)
      if (seq === fetchSeqRef.current) {
        toast.error('Failed to load report');
      }
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const debouncedFetch = useDebouncedCallback(fetchReport, 400);

  useEffect(() => {
    debouncedFetch({ guideId, date: selectedDate, reportType, computedStart, computedEnd, bvslMode, mentorMode });
  }, [guideId, reportType, selectedDate, computedStart, computedEnd, bvslMode, mentorMode]);

  const residencies = rawReportData?.availableResidencies ?? [];
  const availableGuides: { guideId: string; guideName: string }[] = (rawReportData as any)?.availableGuides ?? [];
  const currentGuideId: string | null = (rawReportData as any)?.currentGuideId ?? null;

  // Persist residencyFilter in sessionStorage so it survives navigation back from user detail
  useEffect(() => {
    sessionStorage.setItem('guide_report_residencyFilter', residencyFilter);
  }, [residencyFilter]);

  const scholarCount = useMemo(() => {
    if (!rawReportData) return 0;
    return rawReportData.users.filter(u => !!(u as any).isTempResident).length;
  }, [rawReportData]);

  // NI-04: Auto-select when guide covers exactly 1 residency; reset to 'all' when multiple
  useEffect(() => {
    if (residencies.length === 1) {
      setFolkResidencyId(residencies[0].residencyId);
    } else if (residencies.length > 1) {
      setFolkResidencyId('all');
    }
  }, [residencies.length]);

  // Fix 4: Client-side filtering — instant, no API call needed
  const clientFilteredUsers = useMemo(() => {
    if (!rawReportData) return [];
    return rawReportData.users.filter(u => {
      const isScholar = !!(u as any).isTempResident;
      // Scholar-only view: show only scholars
      if (residencyFilter === 'scholar') {
        if (!isScholar) return false;
      } else if (residencyFilter === 'resident') {
        // Official residents + scholars (if showScholars checked)
        if (!u.isResident) return false;
        if (isScholar && !showScholars) return false;
      } else if (residencyFilter === 'non_resident') {
        // Non-residents only — scholars have isResident=true so naturally excluded
        if (u.isResident) return false;
      } else {
        // 'all': everyone except scholars (unless showScholars checked)
        if (isScholar && !showScholars) return false;
      }
      if (ashrayLevelFilter !== 'all' && u.ashrayLevel !== ashrayLevelFilter) return false;
      // FOLK Residency filter: only applies to residents
      if (folkResidencyId !== 'all') {
        if (u.isResident && u.residencyId !== folkResidencyId) return false;
      }
      if (!showMissing && !u.submitted) return false;
      // Guide filter — only apply when a specific guide is selected
      if (guideFilter && guideFilter !== '' && guideFilter !== 'all') {
        const userGuideId = (u as any).guideId;
        if (userGuideId !== guideFilter) return false;
      }
      if (searchQuery && !u.fullName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [rawReportData, residencyFilter, ashrayLevelFilter, folkResidencyId, searchQuery, showScholars, showMissing, guideFilter]);

  // Compute canonical ranks from the canonical sort order
  const usersForTable = useMemo(() => {
    // Look up residencyName for ALL users (residents and NR alike).
    // NR users may have a residencyId from their pending/former residency field,
    // which allows showing the center name in the FOLK column instead of a blank.
    const withResidency = clientFilteredUsers.map(u => ({
      ...u,
      residencyName: residencies.find(r => r.residencyId === (u as any).residencyId)?.residencyName?.replace(/^FOLK\s+/i, '') || undefined,
    })) as UserRow[];

    // ── "All" view: remap field scores to unified common_* keys ──────────────
    // Residents and NR use different field keys and scoring scales for the same
    // concept (rounds, reading, hearing, seva, preaching, books). We inject the
    // raw values under common_* keys so a single column covers both groups.
    const remapped = residencyFilter === 'all'
      ? withResidency.map(u => {
          const fs = u.fieldScores;
          const commonScores: Record<string, number | string | null> = {
            common_rounds:    (u as any).chantingRaw ?? null,
            common_reading:   (u as any).readingRaw ?? null,
            common_hearing:   (u as any).hearingRaw ?? null,
            common_seva:      u.isResident ? (fs['daily_service'] ?? null) : (fs['seva'] ?? null),
            common_preaching: u.isResident ? (fs['preaching_raw'] ?? null) : (fs['nr_preaching'] ?? null),
            common_books:     u.isResident ? (fs['distribution_raw'] ?? null) : (fs['nr_books'] ?? null),
          };
          return { ...u, fieldScores: { ...fs, ...commonScores } };
        })
      : withResidency;

    // Only rank submitted non-scholar users — scholars are monitored separately, not ranked
    const submittedSorted = remapped.filter(u => u.submitted && !u.isTempResident).sort(canonicalSort);
    const rankedMap = new Map<string, number>();
    // RANK-FIX: Use DB record id (guaranteed unique) not userId — duplicate custom userIds
    // (e.g. two residents sharing "USER-031") would cause one rank to overwrite the other.
    submittedSorted.forEach((u, idx) => rankedMap.set((u as any).id || u.userId, idx + 1));
    return remapped.map(u => ({ ...u, rank: rankedMap.get((u as any).id || u.userId) }));
  }, [clientFilteredUsers, residencies, residencyFilter]);

  const summary = useMemo(() => {
    if (!rawReportData) return null;
    return computeSummary(clientFilteredUsers, residencyFilter === 'scholar');
  }, [clientFilteredUsers, rawReportData, residencyFilter]);

  const visibleFieldDefs: FieldDef[] = residencyFilter === 'all'
    // "All" view: use the 6 common fields with remapped keys (raw values, no scoring scale mismatch)
    ? COMMON_FIELD_DEFS
    : (rawReportData?.fieldDefs ?? []).filter(d => {
        // Scholars use resident scoring template
        if (residencyFilter === 'resident' || residencyFilter === 'scholar') return d.forResident;
        if (residencyFilter === 'non_resident') return d.forNR;
        return true;
      });

  // Hide FOLK column when it carries no meaningful info:
  // - Only 1 residency exists → every resident is from the same folk
  // - A specific folk is selected (folkResidencyId !== 'all') → all shown residents are from that one folk
  // - Non-resident filter → everyone shows "NR", column is pointless
  // "All" filter: always show — residents show FOLK name, NRs show "NR", key for distinguishing members
  const showFolkColumn =
    residencyFilter === 'all' ||
    (residencyFilter !== 'non_resident' &&
      folkResidencyId === 'all' &&
      (residencies.length > 1 || (residencyFilter === 'scholar' && residencies.length > 1)));

  const reportTitle = getReportTitle(reportType, selectedDate, computedStart, computedEnd);

  const totalPreachingMins = useMemo(() => {
    const submitted = clientFilteredUsers.filter(u => u.submitted);
    if (submitted.length === 0) return 0;
    const vals = submitted.map(u => {
      // Check both resident (preaching_raw) and NR (nr_preaching) field keys
      const v = u.fieldScores['preaching_raw'] ?? u.fieldScores['nr_preaching'];
      if (typeof v === 'string' && v.includes(':')) {
        const [h, m] = v.split(':').map(Number);
        return h * 60 + (m || 0);
      }
      return typeof v === 'number' ? v : 0;
    });
    return vals.reduce((a, b) => a + b, 0);
  }, [clientFilteredUsers]);

  // Keep avgPreachingMins for image export (it passes to exportReportAsImage which labels it)
  const avgPreachingMins = totalPreachingMins;

  const totalBooksDistributed = useMemo(() => {
    const submitted = clientFilteredUsers.filter(u => u.submitted);
    if (submitted.length === 0) return 0;
    const vals = submitted.map(u => {
      // Check both resident (distribution_raw/books_distributed) and NR (nr_books) field keys
      const v = u.fieldScores['distribution_raw'] ?? u.fieldScores['books_distributed'] ?? u.fieldScores['nr_books'];
      return typeof v === 'number' ? v : (typeof v === 'string' && v !== '' ? Number(v) : 0);
    });
    return vals.reduce((a, b) => a + b, 0);
  }, [clientFilteredUsers]);

  // Keep avgBooksDistributed for image export
  const avgBooksDistributed = totalBooksDistributed;

  const getFieldHeader = (d: FieldDef) => {
    if (d.key === 'sp_reading') return `${d.shortLabel} (/3 pts)`;
    if (d.key === 'sb') return `${d.shortLabel} (min)`;
    if (d.key === 'reading') return `${d.shortLabel} (HH:MM)`;
    if (d.key === 'hearing') return `${d.shortLabel} (HH:MM)`;
    return d.shortLabel;
  };

  const buildUserCsvRow = (u: UserRow, rankDisplay: number | string) => [
    rankDisplay,
    u.fullName,
    u.ashrayLevel || '',
    u.isResident
      ? (residencies.find((r: any) => r.residencyId === (u as any).residencyId)?.residencyName?.replace(/^FOLK\s+/i, '') || 'Resident')
      : 'NR',
    String(u.currentStreak ?? 0),
    ...visibleFieldDefs.map(d => {
      const applicable = u.isResident ? d.forResident : d.forNR;
      if (!applicable) return 'NA';
      if (!u.submitted) return '';
      const val = u.fieldScores[d.key];
      if (val === null || val === undefined) return '';
      if (TOGGLE_DISPLAY_KEYS.has(d.key)) return Number(val) > 0 ? 'Yes' : 'No';
      if (DURATION_MINUTE_KEYS.has(d.key)) {
        const mins = Number(val);
        if (isNaN(mins) || mins < 0) return '';
        return minutesToHHMM(mins);
      }
      return String(val);
    }),
    u.scorePercent != null ? `${u.scorePercent}%` : '',
  ];

  /** Build a descriptive kebab-case filename for exports */
  const buildExportFilename = (ext: 'png' | 'csv'): string => {
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Date segment
    let datePart: string;
    if (reportType === 'daily') {
      datePart = selectedDate;
    } else if (reportType === 'weekly' && computedStart && computedEnd) {
      datePart = `${computedStart}-to-${computedEnd}`;
    } else if (reportType === 'monthly' && selectedMonth) {
      datePart = selectedMonth;
    } else {
      datePart = selectedDate;
    }

    // Residency segment
    const residencyPart = residencyFilter === 'non_resident' ? 'non-residents'
      : residencyFilter === 'resident' ? 'residents'
      : residencyFilter === 'scholar' ? 'scholars'
      : 'all';

    // FOLK segment
    const folkPart = folkResidencyId !== 'all'
      ? `folk-${slug(residencies.find(r => r.residencyId === folkResidencyId)?.residencyName?.replace(/^FOLK\s+/i, '') || folkResidencyId)}`
      : '';

    // Guide segment
    const guidePart = guideFilter && guideFilter !== 'all'
      ? `guide-${slug(availableGuides.find(g => g.guideId === guideFilter)?.guideName || guideFilter)}`
      : '';

    // Ashray segment
    const ashrayPart = ashrayLevelFilter !== 'all' ? `level-${slug(ashrayLevelFilter)}` : '';

    const parts = ['sadhana-report', datePart, residencyPart, folkPart, guidePart, ashrayPart].filter(Boolean);
    return `${parts.join('-')}.${ext}`;
  };

  const handleExportCsv = () => {
    if (!rawReportData) return;
    const headers = ['Rank', 'Name', 'Ashray Level', 'FOLK', 'Streak', ...visibleFieldDefs.map(getFieldHeader), 'Total %'];
    const emptyCols = headers.map(() => '');

    if (residencyFilter === 'non_resident') {
      // Grouped CSV — one separator row per ashray level group
      const groups = buildAshrayGroups(usersForTable);
      const rows: any[][] = [];
      for (const group of groups) {
        const avgLabel = group.avgScore !== null ? `Avg: ${group.avgScore}%` : '';
        rows.push([
          `=== ${group.level} (${group.users.length} members · ${group.submittedCount} submitted${avgLabel ? ' · ' + avgLabel : ''}) ===`,
          ...emptyCols.slice(1),
        ]);
        for (const u of group.users) {
          rows.push(buildUserCsvRow(u, group.ranks.get(u.userId) ?? ''));
        }
      }
      exportToCsv(buildExportFilename('csv'), headers, rows);
    } else {
      // Flat CSV — canonical sort (same as on-screen ranking)
      const sortedForCsv = [...usersForTable].sort(canonicalSort);
      const rows = sortedForCsv.map(u => buildUserCsvRow(u, u.submitted && u.rank != null ? u.rank : ''));
      exportToCsv(buildExportFilename('csv'), headers, rows);
    }
  };

  const handleWhatsAppGroupReminder = () => {
    if (!rawReportData) return;
    const missing = clientFilteredUsers.filter(u => !u.submitted && !(u as any).isTempResident);
    if (missing.length === 0) { toast.success('Everyone has submitted! 🎉'); return; }
    let dateStr = '';
    if (reportType === 'daily') {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      const fullDate = format(new Date(selectedDate + 'T00:00:00'), 'EEEE, d MMM yyyy');
      if (selectedDate === todayStr) dateStr = `Today, ${fullDate}`;
      else if (selectedDate === yesterdayStr) dateStr = `Yesterday, ${fullDate}`;
      else dateStr = fullDate;
    } else if (reportType === 'weekly' && computedStart) {
      dateStr = `${format(new Date(computedStart + 'T00:00:00'), 'd MMM')} – ${format(new Date((computedEnd ?? computedStart) + 'T00:00:00'), 'd MMM yyyy')}`;
    } else if (reportType === 'monthly') {
      dateStr = format(new Date(selectedMonth + '-01'), 'MMMM yyyy');
    }
    const names = missing.map(u => `• ${u.fullName}`).join('\n');
    const msg = `🙏 Hare Krishna!\n\nKindly submit your Sadhana form for *${dateStr}*.\n${window.location.origin}\n\nStill pending (${missing.length}):\n${names}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleSyncScores = async () => {
    const start = computedStart ?? selectedDate;
    const end = computedEnd ?? selectedDate;
    setSyncing(true);
    try {
      const result = await recalculateScoresForDate({ startDate: start, endDate: end });
      if (result.fixed > 0) {
        toast.success(`✅ Synced ${result.fixed} entr${result.fixed === 1 ? 'y' : 'ies'} — refreshing report…`);
        // Refresh the report to show updated scores
        await fetchReport({ guideId, date: selectedDate, reportType, computedStart, computedEnd, bvslMode, mentorMode });
      } else {
        toast.info('All scores are already up-to-date.');
      }
    } catch {
      toast.error('Failed to sync scores. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  const handleExportImage = () => {
    if (!rawReportData) return;
    const folkResName = residencyFilter === 'non_resident'
      ? 'Non-Residents'
      : folkResidencyId === 'all'
        ? (residencies.length === 1 ? residencies[0].residencyName : 'All Residencies')
        : (residencies.find(r => r.residencyId === folkResidencyId)?.residencyName || 'All Residencies');
    const ashrayLabel = ashrayLevelFilter === 'all' ? 'All Ashray Levels' : ashrayLevelFilter;
    let dateLabel = '';
    if (reportType === 'daily') {
      dateLabel = format(new Date(selectedDate + 'T00:00:00'), 'MMM d, yyyy');
    } else if (reportType === 'weekly' && computedStart && computedEnd) {
      dateLabel = `${format(new Date(computedStart + 'T00:00:00'), 'MMM d')} – ${format(new Date(computedEnd + 'T00:00:00'), 'MMM d, yyyy')}`;
    } else if (reportType === 'monthly' && selectedMonth) {
      const [y, m] = selectedMonth.split('-');
      dateLabel = format(new Date(parseInt(y), parseInt(m) - 1, 1), 'MMMM yyyy');
    }
    // Build export user list — grouped for NR, flat for others
    let exportUsers: UserRow[];
    if (residencyFilter === 'non_resident') {
      const groups = buildAshrayGroups(usersForTable);
      exportUsers = [];
      for (const group of groups) {
        // Insert a virtual group-header row before each group's users
        exportUsers.push({
          userId: `__gh_${group.level}`,
          fullName: group.level,
          ashrayLevel: group.level,
          isResident: false,
          submitted: false,
          fieldScores: {},
          totalScore: null,
          scorePercent: null,
          flagSick: false,
          flagOs: false,
          _groupHeader: group.level,
          _groupStats: { count: group.users.length, submitted: group.submittedCount, avgScore: group.avgScore },
        } as UserRow);
        // Inject per-group ranks into user rows for the image
        for (const u of group.users) {
          const grp = group.ranks.get(u.userId);
          exportUsers.push({ ...u, rank: grp });
        }
      }
    } else {
      exportUsers = [...usersForTable].sort(canonicalSort);
    }

    setTimeout(() => {
      exportReportAsImage(
        summary ?? { totalUsers: usersForTable.length },
        exportUsers,
        reorderFieldDefs(visibleFieldDefs),
        buildExportFilename('png'),
        avgPreachingMins,
        avgBooksDistributed,
        folkResName,
        ashrayLabel,
        dateLabel,
        (residencyFilter !== 'non_resident') ? (summary?.sleepTimeAvg ?? null) : null,
        residencyFilter,
        showFolkColumn,
        reportType,
      );
    }, 50);
  };



  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .no-print-col { display: none !important; }
          @page { size: A4 landscape; margin: 0mm; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; }
          div[class*="min-h-screen"] { min-height: 0 !important; }
          .print-content { padding: 6mm; zoom: 0.82; }
          .print-title-block { display: block !important; }
          .print-table-sticky { position: static !important; }
        }
        .print-title-block { display: none; }
      `}</style>
      <div className="space-y-4">

        {/* Filters Card */}
        <Card className="no-print">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base">Sadhana Report</CardTitle>
                <button
                  onClick={() => fetchReport({ guideId, date: selectedDate, reportType, computedStart, computedEnd, bvslMode, mentorMode })}
                  disabled={loading}
                  title="Refresh report data"
                  className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40 text-xs font-medium"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>

              </div>
              <div className="flex gap-2 items-center flex-wrap">
                {loading && <span className="text-xs text-muted-foreground animate-pulse">Loading…</span>}
                <Button size="sm" variant="outline" className="h-8" onClick={handleExportCsv} disabled={!rawReportData || loading}>
                  <FileDown className="w-3 h-3 mr-1" />Export CSV
                </Button>
                <Button size="sm" variant="outline" className="h-8" onClick={handleExportImage} disabled={!rawReportData || loading}>
                  <Image className="w-3 h-3 mr-1" />Export Image
                </Button>
                <Button size="sm" variant="outline" className="h-8 border-amber-500 text-amber-700 hover:bg-amber-500 hover:text-white disabled:opacity-50" onClick={handleSyncScores} disabled={!rawReportData || loading || syncing} title="Re-sync scores from submittedAt timestamps (use after manually editing submittedAt in the database)">
                  <Zap className={`w-3 h-3 mr-1 ${syncing ? 'animate-pulse' : ''}`} />{syncing ? 'Syncing…' : 'Sync Scores'}
                </Button>
                <Button size="sm" variant="outline" className="h-8 border-green-600 text-green-700 hover:bg-green-600 hover:text-white active:bg-green-700 active:text-white focus-visible:ring-green-500" onClick={handleWhatsAppGroupReminder} disabled={!rawReportData || loading}>
                  <MessageCircle className="w-3 h-3 mr-1" />WhatsApp Group Reminder
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative no-print mb-2">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by name..." className="pl-8 h-9" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
              {/* Report Type */}
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium whitespace-nowrap">Type:</Label>
                <Select value={reportType} onValueChange={(v: ReportType) => setReportType(v)}>
                  <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {reportType === 'daily' && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Label className="text-sm font-medium whitespace-nowrap">Date:</Label>
                  <Button
                    size="sm"
                    variant={selectedDate === format(subDays(new Date(), 1), 'yyyy-MM-dd') ? 'default' : 'outline'}
                    className="h-8 text-xs px-3"
                    onClick={() => setSelectedDate(format(subDays(new Date(), 1), 'yyyy-MM-dd'))}
                  >Yesterday</Button>
                  <Button
                    size="sm"
                    variant={selectedDate === format(new Date(), 'yyyy-MM-dd') ? 'default' : 'outline'}
                    className="h-8 text-xs px-3"
                    onClick={() => setSelectedDate(format(new Date(), 'yyyy-MM-dd'))}
                  >Today</Button>
                  <Input type="date" className="h-8 w-[140px]" value={selectedDate}
                    onChange={e => setSelectedDate(e.target.value)} max={format(new Date(), 'yyyy-MM-dd')} />
                </div>
              )}

              {reportType === 'weekly' && (
                <div className="flex items-center gap-1.5">
                  <Label className="text-sm font-medium whitespace-nowrap">Week:</Label>
                  <Select value={selectedWeek} onValueChange={setSelectedWeek}>
                    <SelectTrigger className="h-8 w-[230px]"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      {WEEK_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {reportType === 'monthly' && (
                <div className="flex items-center gap-1.5">
                  <Label className="text-sm font-medium whitespace-nowrap">Month:</Label>
                  <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                    <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      {MONTH_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Residency filter */}
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium whitespace-nowrap">Residency:</Label>
                <Select value={residencyFilter} onValueChange={(v: ResidencyFilter) => { setResidencyFilter(v); if (v === 'non_resident') setShowScholars(false); }}>
                  <SelectTrigger className="h-8 w-[140px]">
                    {residencyFilter === 'all' ? 'All' : residencyFilter === 'resident' ? 'Residents' : residencyFilter === 'non_resident' ? 'Non-Residents' : residencyFilter === 'scholar' ? 'Scholars' : residencyFilter}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="resident">Residents</SelectItem>
                    <SelectItem value="non_resident">Non-Residents</SelectItem>
                    {scholarCount > 0 && (
                      <SelectItem value="scholar">Scholars</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* NI-04: FOLK Residency filter */}
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium whitespace-nowrap">FOLK:</Label>
                <Select value={folkResidencyId} onValueChange={setFolkResidencyId}>
                  <SelectTrigger className="h-8 w-[150px]">
                    {folkResidencyId === 'all' ? 'All' : residencies.find(r => r.residencyId === folkResidencyId)?.residencyName.replace(/^FOLK\s+/i, '') || folkResidencyId}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {residencies.map(r => (
                      <SelectItem key={r.residencyId} value={r.residencyId}>
                        {r.residencyName.replace(/^FOLK\s+/i, '')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Guide filter — shown whenever guide data is available */}
              {!bvslMode && !mentorMode && availableGuides.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Label className="text-sm font-medium whitespace-nowrap">Guide:</Label>
                  <Select value={guideFilter || 'all'} onValueChange={v => setGuideFilter(v === 'all' ? 'all' : v)}>
                    <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Guides</SelectItem>
                      {availableGuides.map(g => (
                        <SelectItem key={g.guideId} value={g.guideId}>
                          {g.guideName}{g.guideId === currentGuideId ? ' (you)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Ashray filter */}
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium whitespace-nowrap">Ashray:</Label>
                <Select value={ashrayLevelFilter} onValueChange={setAshrayLevelFilter}>
                  <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Levels</SelectItem>
                    {ASHRAY_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Show Missing toggle */}
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id="show-missing"
                  checked={showMissing}
                  onCheckedChange={(v) => setShowMissing(!!v)}
                  className="w-4 h-4"
                />
                <Label htmlFor="show-missing" className="text-sm font-medium whitespace-nowrap cursor-pointer">
                  Show Missing
                </Label>
              </div>

              {/* Show Scholars toggle — only when scholars exist and we're not in scholar-only or NR view */}
              {scholarCount > 0 && residencyFilter !== 'scholar' && residencyFilter !== 'non_resident' && (
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id="show-scholars"
                    checked={showScholars}
                    onCheckedChange={(v) => setShowScholars(!!v)}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="show-scholars" className="text-sm font-medium whitespace-nowrap cursor-pointer flex items-center gap-1">
                    <GraduationCap className="w-3.5 h-3.5 text-indigo-600" />
                    Show Scholars ({scholarCount})
                  </Label>
                </div>
              )}

              {/* Show Real Values — displays actual user inputs instead of scored points */}
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id="show-real-values"
                  checked={showRealValues}
                  onCheckedChange={(v) => setShowRealValues(!!v)}
                  className="w-4 h-4"
                />
                <Label htmlFor="show-real-values" className="text-sm font-medium whitespace-nowrap cursor-pointer">
                  Show Real Values
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scoring Criteria Reference */}
        <ScoringCriteriaPanel />

        {/* Report Content */}
        {!rawReportData && loading && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
              {[...Array(7)].map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
            <Card><CardContent className="p-4"><Skeleton className="h-64" /></CardContent></Card>
          </div>
        )}
        {rawReportData && (
          <div ref={reportRef} className={`space-y-3 transition-opacity print-content ${loading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>

            {/* Print-only title */}
            <div className="print-title-block" style={{ borderBottom: '2px solid #222', paddingBottom: 6, marginBottom: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: 0.5 }}>SADHANA REPORT</div>
              <div style={{ fontSize: 11, fontWeight: 600, marginTop: 2 }}>{reportTitle}</div>
              <div style={{ fontSize: 9, marginTop: 2, color: '#555' }}>
                {residencyFilter === 'all' ? 'All Members' : residencyFilter === 'resident' ? 'Residents Only' : residencyFilter === 'non_resident' ? 'Non-Residents Only' : 'Scholars'}
                {ashrayLevelFilter !== 'all' ? ` · Level: ${ashrayLevelFilter}` : ''}
                {' · '}Generated: {new Date().toLocaleString()}
              </div>
            </div>

            {/* Summary Cards */}
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Report Summary</span>
              <span className="text-xs text-muted-foreground">
                {summary?.submitted ?? 0} of {summary?.totalUsers ?? 0} submitted · averages are across submitted entries only
                {residencyFilter !== 'scholar' && scholarCount > 0 && !showScholars && (
                  <span className="ml-1 text-indigo-600">· {scholarCount} scholar{scholarCount > 1 ? 's' : ''} excluded</span>
                )}
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              {/* 1 — Total Members */}
              <Card className="flex-1 min-w-[110px]">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2"><Users className="w-4 h-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">Total</span></div>
                  <div className="text-2xl font-bold mt-1">{summary?.totalUsers ?? 0}</div>
                </CardContent>
              </Card>
              {/* 2 — Total Books */}
              <Card className="flex-1 min-w-[110px]">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2"><Package className="w-4 h-4 text-primary" /><span className="text-xs text-muted-foreground">Total Books</span></div>
                  <div className="text-2xl font-bold mt-1 text-primary">{totalBooksDistributed}</div>
                </CardContent>
              </Card>
              {/* 3 — Total Preaching */}
              <Card className="flex-1 min-w-[110px]">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /><span className="text-xs text-muted-foreground">Total Preaching</span></div>
                  <div className="text-2xl font-bold mt-1 text-primary">{minutesToHHMM(totalPreachingMins)}</div>
                </CardContent>
              </Card>
              {/* 4 — Avg Rounds */}
              <Card className="flex-1 min-w-[110px]">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2"><Music2 className="w-4 h-4 text-primary" /><span className="text-xs text-muted-foreground">Avg Rounds</span></div>
                  <div className="text-2xl font-bold mt-1 text-primary">{summary?.chantingAvg != null ? fmt.numDisplay(summary.chantingAvg) : 0}</div>
                </CardContent>
              </Card>
              {/* 5 — Avg Reading */}
              <Card className="flex-1 min-w-[110px]">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-primary" /><span className="text-xs text-muted-foreground">Avg Reading</span></div>
                  <div className="text-2xl font-bold mt-1 text-primary">
                    {summary?.readingAvg != null
                      ? minutesToHHMM(Math.round(summary.readingAvg))
                      : '00:00'}
                  </div>
                </CardContent>
              </Card>
              {/* 6 — Avg SB/Hearing */}
              <Card className="flex-1 min-w-[110px]">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2"><Headphones className="w-4 h-4 text-primary" /><span className="text-xs text-muted-foreground">Avg Hearing</span></div>
                  <div className="text-2xl font-bold mt-1 text-primary">
                    {(() => {
                      if (summary?.hearingAvg != null) return minutesToHHMM(Math.round(summary.hearingAvg));
                      if (summary?.sbAvg != null) return minutesToHHMM(sbPtsToMinutes(summary.sbAvg));
                      return '00:00';
                    })()}
                  </div>
                </CardContent>
              </Card>
              {/* 7 — Avg Sleep Time — residents only */}
              {(residencyFilter === 'resident' || residencyFilter === 'scholar' || residencyFilter === 'all') && summary?.sleepTimeAvg != null && (
                <Card className="flex-1 min-w-[110px]">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2"><Moon className="w-4 h-4 text-indigo-500" /><span className="text-xs text-muted-foreground">Avg Sleep (hrs)</span></div>
                    <div className="text-2xl font-bold mt-1 text-indigo-600">{minsToTimeDisplay(summary.sleepTimeAvg)}</div>
                  </CardContent>
                </Card>
              )}
              {/* 8 — Avg Total % */}
              <Card className="flex-1 min-w-[110px]">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-green-600" /><span className="text-xs text-muted-foreground">Avg Total %</span></div>
                  <div className={`text-2xl font-bold mt-1 ${scoreColor(summary?.scorePercentAvg, residencyFilter === 'resident' || residencyFilter === 'scholar')}`}>
                    {summary?.scorePercentAvg != null ? `${summary.scorePercentAvg}%` : '0%'}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Table */}
            {loading ? (
              <Card><CardContent className="p-4 space-y-2">
                <Skeleton className="h-8 w-full" />
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </CardContent></Card>
            ) : usersForTable.length > 0 ? (
              <SadhanaDetailTable
                users={usersForTable}
                fieldDefs={visibleFieldDefs}
                reportDate={selectedDate}
                senderName={senderName}
                onUserClick={(userId) => navigate(`/guide/users/${userId}`)}
                showFolkColumn={showFolkColumn}
                showRealValues={showRealValues}
                groupByAshray={residencyFilter === 'non_resident' || residencyFilter === 'all'}
              />
            ) : (
              <Card>
                <CardContent className="py-2">
                  <EmptyState
                    title={searchQuery ? `No users found matching "${searchQuery}"` : 'No users found for the selected filters.'}
                  />
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}
