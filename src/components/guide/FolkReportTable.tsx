import {
  minutesToHHMM,
  DURATION_MINUTE_KEYS,
  type FieldDef,
} from '@/components/guide/SadhanaDetailTable';
import { scoreColor } from '@/lib/scoring';

export interface FolkRow {
  residencyId: string;
  folkName: string;
  total: number;
  submitted: number;
  displayAvgs: Record<string, number | null>;
  scoredAvgs: Record<string, number | null>;
  avgScore: number | null;
  weightedScore?: number | null;
}

interface Props {
  folkRows: FolkRow[];
  fieldDefs: FieldDef[];
}

function formatDisplay(key: string, val: number | null): string {
  if (val === null || val === undefined) {
    // Japa/Sleep: not filled → NF
    if (key === 'japa_finish_time' || key === 'sleep_minutes') return 'NF';
    // Study/Preaching: null means 0 minutes (valid — user just didn't do it)
    if (key === 'study_minutes' || key === 'preaching_raw') return '00:00';
    // Books: null means 0
    if (key === 'distribution_raw') return '0';
    return '';
  }
  // sp_reading is now scored points (0–3), NOT minutes — do not convert to HH:MM
  if (key === 'japa_finish_time') {
    const display = minutesToHHMM(Math.round(val));
    return !display || display === '00:00' ? 'NF' : display;
  }
  if (key === 'sleep_minutes') {
    if (val === 0) return 'NF';
    return minutesToHHMM(Math.round(val));
  }
  if (key === 'preaching_raw') return minutesToHHMM(Math.round(val));
  if (key === 'reading' || key === 'hearing') return minutesToHHMM(Math.round(val));
  if (key !== 'sp_reading' && DURATION_MINUTE_KEYS.has(key)) return minutesToHHMM(Math.round(val));
  if (key === 'distribution_raw') return String(Math.round(val));
  return String(Math.round(val * 10) / 10);
}

function cellColorClass(scored: number | null, maxPts: number | null): string {
  if (scored === null || maxPts === null || maxPts === 0) return 'text-foreground';
  const pct = scored / maxPts;
  if (pct >= 0.99) return 'bg-green-100 text-green-700 font-semibold';
  if (pct >= 0.01) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-600';
}

// Folk residency table always uses resident thresholds (≥95% green, ≥85% amber, <85% red)
// — same as scoreColor(pct, true). Do NOT use custom thresholds here.
function avgScoreColor(pct: number | null): string {
  return scoreColor(pct, true);
}

function weightedScoreColor(pct: number | null): string {
  if (pct === null) return 'text-muted-foreground';
  // Weighted score factors in submission rate, so same resident thresholds apply
  return scoreColor(pct, true) + ' font-bold';
}

export default function FolkReportTable({ folkRows, fieldDefs }: Props) {
  const residentFields = fieldDefs.filter(d => d.forResident);

  if (folkRows.length === 0) {
    return (
      <div className="border rounded-lg py-10 text-center text-muted-foreground text-sm bg-card">
        No FOLK residency data available for this date.
      </div>
    );
  }

  const RANK_W = 32;
  const NAME_W = 140;

  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto border rounded-lg shadow-sm">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted border-b border-border">
              <th
                className="px-2 py-2.5 text-center font-bold text-muted-foreground text-xs border-r border-border sticky z-20 bg-muted"
                style={{ left: 0, minWidth: RANK_W, width: RANK_W }}
              >
                #
              </th>
              <th
                className="px-3 py-2.5 text-left font-bold text-xs whitespace-nowrap border-r border-border sticky z-20 bg-muted"
                style={{ left: RANK_W, minWidth: NAME_W, width: NAME_W }}
              >
                FOLK Residency
              </th>
              <th className="px-3 py-2.5 text-center font-bold text-xs whitespace-nowrap">Members</th>
              <th className="px-3 py-2.5 text-center font-bold text-xs whitespace-nowrap border-r border-border">Submitted</th>
              {residentFields.map(d => (
                <th key={d.key} className="px-2 py-2.5 text-center font-bold text-xs whitespace-nowrap min-w-[64px]">
                  <div className="flex flex-col items-center gap-0.5">
                    <span>{d.shortLabel}</span>
                    {d.key === 'preaching_raw' || d.key === 'distribution_raw' ? (
                      <span className="font-normal text-[10px] text-muted-foreground">total</span>
                    ) : d.maxPoints != null ? (
                      <span className="font-normal text-[10px] text-muted-foreground">/{d.maxPoints}</span>
                    ) : null}
                  </div>
                </th>
              ))}
              {/* Avg % — regular (non-sticky) */}
              <th className="px-3 py-2.5 text-center font-bold text-xs whitespace-nowrap border-l border-border min-w-[60px]">
                Avg %
              </th>
              {/* Weighted Score — sticky right */}
              <th className="px-3 py-2.5 text-center font-bold text-xs whitespace-nowrap border-l border-border sticky right-0 z-20 bg-muted min-w-[72px]">
                W.Score
              </th>
            </tr>
          </thead>
          <tbody>
            {folkRows.map((row, idx) => (
              <tr
                key={row.residencyId}
                className="border-b border-border/50 last:border-0 hover:brightness-[0.98] bg-card"
              >
                <td
                  className="px-2 py-2.5 text-center font-bold text-muted-foreground text-xs border-r border-border sticky z-10 bg-card"
                  style={{ left: 0, minWidth: RANK_W, width: RANK_W }}
                >
                  {idx + 1}
                </td>
                <td
                  className="px-3 py-2.5 font-semibold text-xs border-r border-border sticky z-10 bg-card"
                  style={{ left: RANK_W, minWidth: NAME_W, width: NAME_W }}
                >
                  {row.folkName}
                </td>
                <td className="px-3 py-2.5 text-center text-xs">{row.total}</td>
                <td className="px-3 py-2.5 text-center text-xs border-r border-border">
                  <span className="font-medium">{row.submitted}</span>
                  {row.total > 0 && (
                    <span className="text-muted-foreground ml-1">
                      ({Math.round((row.submitted / row.total) * 100)}%)
                    </span>
                  )}
                </td>
                {residentFields.map(d => {
                  const displayVal = row.displayAvgs[d.key];
                  const scoredVal  = row.scoredAvgs[d.key];
                  const display    = formatDisplay(d.key, displayVal);
                  const colorCls   = cellColorClass(scoredVal, d.maxPoints);
                  return (
                    <td key={d.key} className={`px-2 py-2.5 text-center text-xs ${colorCls}`}>
                      {display}
                    </td>
                  );
                })}
                {/* Avg % */}
                <td className={`px-3 py-2.5 text-center text-xs border-l border-border ${avgScoreColor(row.avgScore)}`}>
                  {row.avgScore != null ? `${row.avgScore}%` : '—'}
                </td>
                {/* Weighted Score — sticky right */}
                <td className={`px-3 py-2.5 text-center text-sm border-l border-border sticky right-0 z-10 bg-card ${weightedScoreColor(row.weightedScore ?? null)}`}>
                  {row.weightedScore != null ? `${row.weightedScore}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground px-1">
        Ranking: Weighted Score = Avg % × (Submitted ÷ Total Members) · Preach &amp; Books show FOLK totals for the period.
      </p>
    </div>
  );
}
