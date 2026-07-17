/**
 * BvFieldBreakdown — collapsible per-field detail tables for the guide's BVSL Preaching Report.
 * Shown below the main preaching table. Each field accordion shows individual BVSL values
 * sorted by value, plus a center aggregate (total + avg) at the bottom.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

function minsToHHMM(mins: number): string {
  if (!mins || mins <= 0) return '00:00';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface BvslRow {
  id: string;
  fullName: string;
  groupName: string;
  submitted: boolean;
  callingTime: number;
  oneOnOneTime: number;
  bookDistTime: number;
  rduaTime: number;
  planTime: number;
  booksDistributed: number;
  contactsCollected: number;
  uniqueOneOnOnes: number;
  totalMinutes: number;
}

type FieldKey = keyof Omit<BvslRow, 'id' | 'fullName' | 'groupName' | 'submitted'>;

interface FieldConfig {
  key: FieldKey;
  label: string;
  type: 'duration' | 'count';
  description: string;
}

const FIELDS: FieldConfig[] = [
  { key: 'callingTime',     label: 'Calling Time',           type: 'duration', description: 'Time spent in calling' },
  { key: 'oneOnOneTime',    label: '1-on-1 Time',            type: 'duration', description: 'Time spent on 1-on-1 conversations' },
  { key: 'bookDistTime',    label: 'Book Distribution Time', type: 'duration', description: 'Time spent distributing books' },
  { key: 'rduaTime',        label: 'RDUA Hosting Time',      type: 'duration', description: 'Time spent hosting RDUA sessions' },
  { key: 'planTime',        label: 'Plan Time',              type: 'duration', description: 'Time spent making preaching plan' },
  { key: 'booksDistributed',label: 'Books Distributed',      type: 'count',    description: 'Number of books distributed' },
  { key: 'contactsCollected',label:'Contacts Collected',     type: 'count',    description: 'Number of contacts collected' },
  { key: 'uniqueOneOnOnes', label: 'Unique 1-on-1s',         type: 'count',    description: 'Number of unique individuals met 1-on-1' },
];

function fmtVal(val: number, type: 'duration' | 'count'): string {
  return type === 'duration' ? minsToHHMM(val) : String(val);
}

function valColorClass(val: number, type: 'duration' | 'count'): string {
  if (type === 'duration') {
    if (val >= 30) return 'text-green-700 bg-green-50';
    if (val >= 15) return 'text-amber-700 bg-amber-50';
    return 'text-muted-foreground bg-muted';
  }
  if (val >= 2) return 'text-green-700 bg-green-50';
  if (val === 1) return 'text-amber-700 bg-amber-50';
  return 'text-muted-foreground bg-muted';
}

interface Props { bvsls: BvslRow[] }

export default function BvFieldBreakdown({ bvsls }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const submitted = bvsls.filter(r => r.submitted);
  if (submitted.length === 0) return null;

  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  return (
    <div className="space-y-2 mt-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Field-by-Field Breakdown</h3>
        <span className="text-xs text-muted-foreground">{submitted.length} of {bvsls.length} BVSLs submitted</span>
      </div>

      {FIELDS.map(field => {
        const vals = submitted.map(r => Number(r[field.key] ?? 0));
        const total = vals.reduce((s, v) => s + v, 0);
        const avg = submitted.length > 0
          ? (field.type === 'duration'
              ? Math.round(total / submitted.length)
              : Math.round(total / submitted.length * 10) / 10)
          : 0;
        const isOpen = expanded.has(field.key);

        return (
          <div key={field.key} className="border border-border rounded-lg overflow-hidden">
            {/* Accordion Header */}
            <button
              className="w-full flex items-center gap-3 px-4 py-3 text-left bg-card hover:bg-muted/30 transition-colors"
              onClick={() => toggle(field.key)}
            >
              {isOpen
                ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
              <span className="font-medium text-sm flex-1">{field.label}</span>
              <div className="flex items-center gap-3 text-xs shrink-0">
                <span className="text-muted-foreground hidden sm:inline">{field.description}</span>
                <Badge variant="outline" className="text-xs font-mono">
                  Total: {fmtVal(total, field.type)}
                </Badge>
                <Badge variant="secondary" className="text-xs font-mono">
                  Avg: {fmtVal(avg, field.type)}
                </Badge>
              </div>
            </button>

            {/* Accordion Body */}
            {isOpen && (
              <div className="border-t border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">BVSL Name</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Group</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground">{field.label}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...bvsls]
                      .sort((a, b) => Number(b[field.key] ?? 0) - Number(a[field.key] ?? 0))
                      .map(r => {
                        const val = Number(r[field.key] ?? 0);
                        return (
                          <tr key={r.id} className={`border-b border-border/50 last:border-0 ${!r.submitted ? 'opacity-50' : ''}`}>
                            <td className="px-4 py-2 font-medium">
                              {r.fullName}
                              {!r.submitted && (
                                <span className="ml-1.5 text-xs text-destructive font-normal">(missing)</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">{r.groupName}</td>
                            <td className="px-4 py-2 text-right">
                              {r.submitted
                                ? <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono font-medium ${valColorClass(val, field.type)}`}>
                                    {fmtVal(val, field.type)}
                                  </span>
                                : <span className="text-muted-foreground text-xs">—</span>
                              }
                            </td>
                          </tr>
                        );
                      })}

                    {/* Center Aggregate Row */}
                    <tr className="bg-muted/20 border-t-2 border-border">
                      <td className="px-4 py-2.5 text-xs font-semibold text-muted-foreground" colSpan={2}>
                        Center Aggregate ({submitted.length} submitted)
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs text-muted-foreground">
                            Total: <span className="font-bold text-foreground font-mono">{fmtVal(total, field.type)}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Avg: <span className="font-bold text-foreground font-mono">{fmtVal(avg, field.type)}</span>
                          </span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
