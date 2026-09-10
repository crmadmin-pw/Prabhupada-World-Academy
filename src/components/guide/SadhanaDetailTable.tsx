import TableScrollArea from '@/components/mobile/TableScrollArea';
import { useState, useMemo, memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { ArrowUpDown, ArrowUp, ArrowDown, CheckCircle, Flame } from 'lucide-react';
import { scoreColor } from '@/lib/scoring';
import { computeCell, colorTypeToClass } from '@/utils/cellRenderer';

// SAD-009: Duration fields stored as raw minutes — convert to HH:MM for display
export const DURATION_MINUTE_KEYS = new Set([
  'study_minutes', 'sleep_minutes', 'preaching_minutes', 'preaching_raw', 'nr_preaching',
]);

// P3-002 FIX: Fields that should show YES / — instead of numeric score
export const TOGGLE_DISPLAY_KEYS = new Set([
  'fillingSameDay', 'on_time',
  'cleanliness', 'daily_service', 'report_sending',
  'ma_na_gv', 'quotes_tulasi', 'japa_visible', 'sleep_quality',
  'bath',
]);

const FILL_DAY_KEYS_SET = new Set(['report_sending']);
const SVC_KEYS_SET       = new Set(['daily_service', 'svc']);

/** Swap the positions of SVC and Fill Day in the field def array */
export function reorderFieldDefs(defs: FieldDef[]): FieldDef[] {
  return defs;
}

export function minutesToHHMM(mins: number): string {
  const rounded = Math.round(mins);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface FieldDef {
  key: string;
  shortLabel: string;
  maxPoints: number | null;
  isScoring: boolean;
  forResident: boolean;
  forNR: boolean;
}

export interface UserRow {
  userId: string;
  fullName: string;
  ashrayLevel: string;
  isResident: boolean;
  residencyName?: string;
  submitted: boolean;
  fieldScores: Record<string, number | string | null>;
  totalScore: number | null;
  scorePercent: number | null;
  flagSick: boolean;
  flagOs: boolean;
  phone?: string;
  currentStreak?: number;
  submittedAt?: string | null;
  rank?: number;
  isTempResident?: boolean;
  fieldRawValues?: Record<string, number | string | null>;
  nrFieldColors?: Record<string, string | null>;
  nrFieldNA?: Record<string, boolean>;
  /** Fields that are tracked but NOT counted in score (leaderboard only) — shown with neutral bg */
  nrFieldLeaderboard?: Record<string, boolean>;
  /** Set when this row acts as a group-header divider (for export interleaving) */
  _groupHeader?: string;
  _groupStats?: { count: number; submitted: number; avgScore: number | null };
}

// ── Ashray grouping ────────────────────────────────────────────────────────────

/** Seniority order for NR ashray-level grouping — most senior first */
export const ASHRAY_SENIORITY = [
  'Harinam Diksha', 'Caranashraya', 'Upasaka', 'Sadhaka', 'Sevak', 'Shraddhavan', 'Jigyasa',
];

export interface AshrayGroup {
  level: string;
  users: UserRow[];            // sorted by canonicalSort within the group
  submittedCount: number;
  avgScore: number | null;
  ranks: Map<string, number>;  // userId → per-group rank
}

export function buildAshrayGroups(users: UserRow[]): AshrayGroup[] {
  const map = new Map<string, UserRow[]>();
  for (const u of users) {
    const key = u.ashrayLevel || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(u);
  }
  const presentLevels = [...map.keys()];
  const ordered = [
    ...ASHRAY_SENIORITY.filter(l => presentLevels.includes(l)),
    ...presentLevels.filter(k => k !== '' && !ASHRAY_SENIORITY.includes(k)).sort(),
    ...(presentLevels.includes('') ? [''] : []),
  ];
  return ordered.map(level => {
    const groupUsers = [...(map.get(level) || [])].sort(canonicalSort);
    const submitted = groupUsers.filter(u => u.submitted && !u.isTempResident);
    const ranks = new Map<string, number>();
    submitted.forEach((u, i) => ranks.set(u.userId, i + 1));
    const pcts = submitted.map(u => u.scorePercent).filter((v): v is number => v !== null);
    const avgScore = pcts.length > 0 ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
    return { level: level || 'Unknown Level', users: groupUsers, submittedCount: submitted.length, avgScore, ranks };
  });
}

// ── Sort ───────────────────────────────────────────────────────────────────────

/** Ashray seniority rank — lower number = more senior = ranks higher */
const ASHRAY_RANK: Record<string, number> = {
  'Harinam Diksha': 1, 'Caranashraya': 2, 'Upasaka': 3,
  'Sadhaka': 4, 'Sevak': 5, 'Shraddhavan': 6, 'Jigyasa': 7,
};

/** Canonical sort: Score (desc) → Ashray seniority → Submission time (earliest first) */
export function canonicalSort(a: UserRow, b: UserRow): number {
  if (!a.submitted && !b.submitted) return 0;
  if (!a.submitted) return 1;
  if (!b.submitted) return -1;
  const sa = a.scorePercent ?? -1, sb = b.scorePercent ?? -1;
  if (sb !== sa) return sb - sa;
  // Same score: more senior ashray level ranks higher
  const ar = ASHRAY_RANK[a.ashrayLevel || ''] ?? 99;
  const br = ASHRAY_RANK[b.ashrayLevel || ''] ?? 99;
  if (ar !== br) return ar - br;
  // Same score + same ashray: longer streak ranks higher
  const aStreak = a.currentStreak ?? 0;
  const bStreak = b.currentStreak ?? 0;
  if (bStreak !== aStreak) return bStreak - aStreak;
  // Same streak: earliest submission time ranks higher
  const at = a.submittedAt ? new Date(a.submittedAt).getTime() : Infinity;
  const bt = b.submittedAt ? new Date(b.submittedAt).getTime() : Infinity;
  return at - bt;
}

// Raw unit labels shown in column header when "Show Filled Entries" is on
const RAW_UNITS: Record<string, string> = {
  rounds: 'count', sp_reading: 'HH:MM',
  ma_na_gv: 'raw', quotes_tulasi: 'raw', japa_visible: 'raw',
  sb: 'raw', cleanliness: 'raw', report_sending: 'raw', daily_service: 'raw', sleep_quality: 'raw',
  chanting: 'count', reading: 'HH:MM', hearing: 'HH:MM',
  wakeUptime: 'time', sleepTime: 'time',
  fillingSameDay: 'raw', seva: 'raw', bhaktiVriksha: 'raw',
};

interface Props {
  users: UserRow[];
  fieldDefs: FieldDef[];
  reportDate: string;
  senderName?: string;
  onUserClick?: (userId: string) => void;
  showFolkColumn?: boolean;
  showRealValues?: boolean;
  /** When true, groups NR users by ashray level with per-group ranking */
  groupByAshray?: boolean;
}

function getRankBgTextClass(scorePercent: number | null, isResident: boolean): string {
  if (scorePercent == null) return 'bg-card text-muted-foreground';
  const greenPct = isResident ? 95 : 75;
  const amberPct = isResident ? 85 : 50;
  if (scorePercent >= greenPct) return 'bg-green-100 text-green-700';
  if (scorePercent >= amberPct) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-600';
}

const SortIcon = memo(function SortIcon({ col, sortKey, sortDir }: { col: string; sortKey: string; sortDir: 'asc' | 'desc' }) {
  if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40 shrink-0 no-print-col" />;
  return sortDir === 'asc'
    ? <ArrowUp className="w-3 h-3 ml-1 shrink-0 no-print-col" />
    : <ArrowDown className="w-3 h-3 ml-1 shrink-0 no-print-col" />;
});

function StatusEmoji({ user }: { user: UserRow }) {
  if (user.flagSick && user.flagOs) return <span className="shrink-0 text-sm mr-1" title="Sick & Out of Station">🤒✈️</span>;
  if (user.flagSick) return <span className="shrink-0 text-sm mr-1" title="Sick">🤒</span>;
  if (user.flagOs) return <span className="shrink-0 text-sm mr-1" title="Out of Station">✈️</span>;
  if (user.isTempResident) return <span className="shrink-0 text-sm mr-1" title="Scholar — temporarily visiting FOLK">🎓</span>;
  return null;
}

// Shared th base style
const TH = 'p-2 text-xs font-bold whitespace-nowrap bg-muted border-b border-border';
const TH_CORNER = `${TH} sticky left-0 z-[30]`;
const TH_TOP = `${TH} z-[20]`;

export default function SadhanaDetailTable({
  users, fieldDefs, reportDate, senderName, onUserClick,
  showFolkColumn = true, showRealValues = false, groupByAshray = false,
}: Props) {
  const [sortKey, setSortKey] = useState('scorePercent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const orderedFieldDefs = useMemo(() => reorderFieldDefs(fieldDefs), [fieldDefs]);

  const handleSort = (key: string) => {
    if (groupByAshray) return; // grouped mode: no user-driven sort
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = useMemo(() => {
    if (groupByAshray) return users; // not used in grouped mode
    return [...users].sort((a, b) => {
      let av: any, bv: any;
      if (sortKey === 'rank')              { av = a.rank ?? 9999; bv = b.rank ?? 9999; }
      else if (sortKey === 'fullName')      { av = a.fullName;       bv = b.fullName; }
      else if (sortKey === 'ashrayLevel')   { av = a.ashrayLevel || ''; bv = b.ashrayLevel || ''; }
      else if (sortKey === 'residencyName') { av = a.residencyName || '—'; bv = b.residencyName || '—'; }
      else if (sortKey === 'scorePercent')  { return canonicalSort(a, b); }
      else if (sortKey === 'currentStreak') { av = a.currentStreak ?? 0; bv = b.currentStreak ?? 0; }
      else { av = typeof a.fieldScores[sortKey] === 'number' ? a.fieldScores[sortKey] : -1; bv = typeof b.fieldScores[sortKey] === 'number' ? b.fieldScores[sortKey] : -1; }
      let cmp: number;
      if (typeof av === 'string') cmp = sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      else cmp = sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
      if (cmp !== 0) return cmp;
      const aFlag = (a.flagSick || a.flagOs) ? 1 : 0;
      const bFlag = (b.flagSick || b.flagOs) ? 1 : 0;
      if (aFlag !== bFlag) return aFlag - bFlag;
      const aStreak2 = a.currentStreak ?? 0;
      const bStreak2 = b.currentStreak ?? 0;
      if (bStreak2 !== aStreak2) return bStreak2 - aStreak2;
      const aTime = a.submittedAt ? new Date(a.submittedAt).getTime() : Infinity;
      const bTime = b.submittedAt ? new Date(b.submittedAt).getTime() : Infinity;
      return aTime - bTime;
    });
  }, [users, sortKey, sortDir, groupByAshray]);

  const groups = useMemo(() => {
    if (!groupByAshray) return [];
    return buildAshrayGroups(users);
  }, [users, groupByAshray]);

  const extraCols = showFolkColumn ? 6 : 4;
  const totalColSpan = 2 + extraCols + orderedFieldDefs.length;

  // ── Single user row renderer ──────────────────────────────────────────────
  const renderUserRow = (user: UserRow, rankVal: number | null) => {
    const stickyBg = 'bg-card';
    // Show center name for everyone (residencyName is already stripped of "FOLK " prefix by usersForTable).
    const folkLabel = user.residencyName || '—';

    return (
      <tr
        key={user.userId}
        className={`border-b border-border/50 last:border-0 bg-card ${!user.submitted ? 'opacity-60' : ''} ${onUserClick ? 'cursor-pointer hover:brightness-95' : ''}`}
        onClick={() => onUserClick?.(user.userId)}
      >
        {/* Rank */}
        <td className={`w-[36px] text-center text-xs font-bold sticky left-0 z-10 ${user.submitted && rankVal != null ? getRankBgTextClass(user.scorePercent, user.isResident) : `${stickyBg} text-muted-foreground`}`}>
          <div className="px-2 py-2">{user.submitted && rankVal != null ? rankVal : ''}</div>
        </td>
        {/* Name — bold to match export image */}
        <td className={`w-[180px] min-w-[180px] sticky z-10 ${stickyBg}`} style={{ left: 36 }}>
          <div className="px-2 py-2">
            <div className="flex items-center gap-0.5 font-bold text-xs">
              <StatusEmoji user={user} />
              <span className="truncate max-w-[110px]">{user.fullName}</span>

            </div>
            {!user.submitted && <Badge variant="destructive" className="text-xs mt-0.5">Missing</Badge>}
          </div>
        </td>

        {/* Level */}
        <td className="px-2 py-2 text-center text-xs no-print-col">
          {user.ashrayLevel
            ? <span className="text-foreground font-medium truncate block max-w-[86px] mx-auto" title={user.ashrayLevel}>{user.ashrayLevel}</span>
            : <span className="text-muted-foreground/40">—</span>}
        </td>
        {/* Residency status */}
        {showFolkColumn && (
          <td className="px-2 py-2 text-center text-xs no-print-col">
            {user.isResident
              ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700 border border-green-300 leading-tight">Resident</span>
              : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground border border-border leading-tight">Non-Resident</span>}
          </td>
        )}
        {/* FOLK */}
        {showFolkColumn && (
          <td className="px-2 py-2 text-center text-xs no-print-col border-r border-border/50">
            <span className="text-primary font-medium truncate block max-w-[68px] mx-auto" title={user.residencyName || folkLabel}>{folkLabel}</span>
          </td>
        )}
        {/* Streak */}
        <td className="px-2 py-2 text-center text-xs no-print-col">
          {(user.currentStreak ?? 0) > 0 ? (
            <span className="flex items-center justify-center gap-0.5 text-orange-600 font-bold">
              <Flame className="w-3 h-3" />
              <span>{user.currentStreak}</span>
            </span>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </td>

        {/* Field cells — rendered via shared SSOT computeCell() */}
        {orderedFieldDefs.map((d) => {
          const { displayText, colorType } = computeCell(user, d, showRealValues);
          const cellClass = colorTypeToClass(colorType);
          return (
            <td key={d.key} className={`px-2 py-2 text-xs ${cellClass}`}>
              {displayText}
            </td>
          );
        })}

        {/* Total % */}
        <td className={`px-3 py-2 text-center text-sm font-bold whitespace-nowrap sticky right-0 z-10 border-l border-border/50 ${stickyBg} ${scoreColor(user.scorePercent, user.isResident)}`}>
          {user.scorePercent != null ? `${user.scorePercent}%` : ''}
        </td>
      </tr>
    );
  };

  // ── Group header row renderer ─────────────────────────────────────────────
  const renderGroupHeader = (group: AshrayGroup) => (
    <tr key={`gh-${group.level}`} className="border-t-2 border-primary/20">
      <td colSpan={totalColSpan} className="bg-primary/10 px-4 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-primary">✨ {group.level}</span>
          <span className="text-muted-foreground text-xs">
            {group.users.length} member{group.users.length !== 1 ? 's' : ''}
          </span>
          <span className="text-muted-foreground/40 text-xs">·</span>
          <span className="text-muted-foreground text-xs">{group.submittedCount} submitted</span>
          {group.avgScore !== null && (
            <>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <span className={`text-xs font-semibold ${scoreColor(group.avgScore, false)}`}>
                Avg: {group.avgScore}%
              </span>
            </>
          )}
        </div>
      </td>
    </tr>
  );

  return (
    <TableScrollArea className="overflow-x-auto overflow-y-auto max-h-[72vh] border rounded-lg shadow-sm">
      <table className="w-full text-sm border-collapse">

        <thead className="sticky top-0 z-20">
          {/* COLUMN HEADER ROW */}
          <tr className="border-b border-border">
            {/* Rank */}
            <th
              className={`${TH_CORNER} w-[36px] min-w-[36px] text-center ${!groupByAshray ? 'cursor-pointer select-none' : ''}`}
              onClick={() => handleSort('rank')}
            >
              <span className="flex items-center justify-center">
                #
                {!groupByAshray && <SortIcon col="rank" sortKey={sortKey} sortDir={sortDir} />}
              </span>
            </th>
            {/* Name */}
            <th
              className={`${TH_CORNER} w-[180px] min-w-[180px] text-left ${!groupByAshray ? 'cursor-pointer select-none' : ''}`}
              style={{ left: 36 }}
              onClick={() => handleSort('fullName')}
            >
              <span className="flex items-center">
                Name
                {!groupByAshray && <SortIcon col="fullName" sortKey={sortKey} sortDir={sortDir} />}
              </span>
            </th>
            {/* Level */}
            <th
              className={`${TH_TOP} w-[90px] min-w-[90px] text-center no-print-col ${!groupByAshray ? 'cursor-pointer select-none' : ''}`}
              onClick={() => handleSort('ashrayLevel')}
            >
              <span className="flex items-center justify-center">
                Level
                {!groupByAshray && <SortIcon col="ashrayLevel" sortKey={sortKey} sortDir={sortDir} />}
              </span>
            </th>
            {/* Residency status */}
            {showFolkColumn && (
              <th className={`${TH_TOP} w-[120px] min-w-[120px] text-center no-print-col`}>
                Residency
              </th>
            )}
            {/* FOLK */}
            {showFolkColumn && (
              <th
                className={`${TH_TOP} w-[72px] min-w-[72px] text-center no-print-col border-r border-border ${!groupByAshray ? 'cursor-pointer select-none' : ''}`}
                onClick={() => handleSort('residencyName')}
              >
                <span className="flex items-center justify-center">
                  FOLK
                  {!groupByAshray && <SortIcon col="residencyName" sortKey={sortKey} sortDir={sortDir} />}
                </span>
              </th>
            )}
            {/* Streak */}
            <th
              className={`${TH_TOP} w-[52px] min-w-[52px] text-center no-print-col ${!groupByAshray ? 'cursor-pointer select-none' : ''}`}
              onClick={() => handleSort('currentStreak')}
            >
              <span className="flex items-center justify-center">
                🔥
                {!groupByAshray && <SortIcon col="currentStreak" sortKey={sortKey} sortDir={sortDir} />}
              </span>
            </th>

            {/* Field columns */}
            {orderedFieldDefs.map((d) => (
              <th
                key={d.key}
                className={`${TH_TOP} min-w-[72px] text-center ${!groupByAshray ? 'cursor-pointer select-none' : ''}`}
                onClick={() => handleSort(d.key)}
              >
                <div className="flex flex-col items-center gap-0.5">
                  <span className="flex items-center whitespace-nowrap text-xs font-bold">
                    {d.shortLabel}
                    {!groupByAshray && <SortIcon col={d.key} sortKey={sortKey} sortDir={sortDir} />}
                  </span>
                  {!showRealValues && d.maxPoints != null && d.forResident && (
                    <span className="text-muted-foreground font-normal text-[10px]">/{d.maxPoints} pts</span>
                  )}
                  {showRealValues && d.forResident && RAW_UNITS[d.key] && (
                    <span className="text-muted-foreground font-normal text-[10px]">{RAW_UNITS[d.key]}</span>
                  )}
                  {!showRealValues && d.maxPoints != null && d.forNR && !d.forResident && (
                    <span className="text-muted-foreground font-normal text-[10px]">/{d.maxPoints} pts</span>
                  )}
                  {showRealValues && d.forNR && !d.forResident && RAW_UNITS[d.key] && (
                    <span className="text-muted-foreground font-normal text-[10px]">{RAW_UNITS[d.key]}</span>
                  )}
                </div>
              </th>
            ))}

            {/* Total % */}
            <th
              className={`${TH} sticky right-0 z-[30] min-w-[72px] text-center border-l border-border ${!groupByAshray ? 'cursor-pointer select-none' : ''}`}
              onClick={() => handleSort('scorePercent')}
            >
              <span className="flex items-center justify-center whitespace-nowrap">
                Total %
                {!groupByAshray && <SortIcon col="scorePercent" sortKey={sortKey} sortDir={sortDir} />}
              </span>
            </th>
          </tr>

          {/* Grouped-mode subtitle bar */}
          {groupByAshray && (
            <tr>
              <td colSpan={totalColSpan} className="bg-muted/60 px-4 py-1 text-[10px] text-muted-foreground border-b border-border">
                Grouped by Ashray Level · sorted by score within each group · per-group ranking · columns show raw values
              </td>
            </tr>
          )}
        </thead>

        <tbody>
          {groupByAshray ? (
            // ── Grouped mode ──────────────────────────────────────────────────
            groups.length === 0 ? (
              <tr>
                <td colSpan={totalColSpan} className="text-center py-8 text-muted-foreground text-sm">
                  No users found
                </td>
              </tr>
            ) : (
              groups.flatMap(group => [
                renderGroupHeader(group),
                ...group.users.map(u => renderUserRow(u, group.ranks.get(u.userId) ?? null)),
              ])
            )
          ) : (
            // ── Flat mode (existing behaviour) ────────────────────────────────
            sorted.length === 0 ? (
              <tr>
                <td colSpan={2 + extraCols + fieldDefs.length} className="text-center py-8 text-muted-foreground text-sm">
                  No users found
                </td>
              </tr>
            ) : (
              sorted.map(u => renderUserRow(u, u.submitted && u.rank != null ? u.rank : null))
            )
          )}
        </tbody>
      </table>
    </TableScrollArea>
  );
}
