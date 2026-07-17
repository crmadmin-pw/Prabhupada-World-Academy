import { useState } from 'react';
import { format, addDays } from 'date-fns';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import StatusButtons from './WeeklyPlanStatusButtons';

type DayData = {
  goal1: string; goal2: string;
  status1: string; status2: string;
  duration: number; reason: string; success: string;
};

const DAY_INDEX: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

interface Props {
  dayKey: string;
  label: string;
  short: string;
  data: DayData;
  weekStart: string;
  onChange: (field: keyof DayData, value: any) => void;
}

function statusColor(s: string) {
  if (s === 'Green') return 'bg-green-500';
  if (s === 'Yellow') return 'bg-yellow-400';
  if (s === 'Red') return 'bg-red-500';
  return 'bg-muted-foreground/20';
}

export default function WeeklyPlanDayCard({ dayKey, label, short, data, weekStart, onChange }: Props) {
  const [expanded, setExpanded] = useState(true);
  const dateStr = format(addDays(new Date(weekStart + 'T00:00:00'), DAY_INDEX[dayKey]), 'd MMM');
  const showReason = data.status1 === 'Red' || data.status2 === 'Red';
  const hasGoals = !!(data.goal1 || data.goal2);

  return (
    <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{short}</span>
          <span className="text-xs text-muted-foreground">{dateStr}</span>
          {/* Mini status dots */}
          <div className="flex gap-1 ml-1">
            <div className={`w-2.5 h-2.5 rounded-full ${statusColor(data.status1)}`} />
            <div className={`w-2.5 h-2.5 rounded-full ${statusColor(data.status2)}`} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data.duration > 0 && <span className="text-xs text-muted-foreground">{data.duration}h</span>}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t">
          {/* Goal 1 */}
          <div className="pt-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Activity 1</Label>
              <StatusButtons value={data.status1} onChange={v => onChange('status1', v)} />
            </div>
            <Input
              placeholder="e.g. Book distribution at campus"
              value={data.goal1}
              onChange={e => onChange('goal1', e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          {/* Goal 2 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Activity 2</Label>
              <StatusButtons value={data.status2} onChange={v => onChange('status2', v)} />
            </div>
            <Input
              placeholder="e.g. 1-on-1 meeting with contact"
              value={data.goal2}
              onChange={e => onChange('goal2', e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          {/* Duration */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Duration (Hours)</Label>
            <Input
              type="number"
              step="0.5"
              min="0"
              max="24"
              placeholder="0"
              value={data.duration || ''}
              onChange={e => onChange('duration', parseFloat(e.target.value) || 0)}
              className="h-9 text-sm w-28"
            />
          </div>

          {/* Reason (if Red) */}
          {showReason && (
            <div className="space-y-1 bg-red-50 dark:bg-red-950/30 rounded-lg p-2">
              <Label className="text-xs font-medium text-red-700 dark:text-red-400">Reason for Not Done</Label>
              <Textarea
                placeholder="What prevented you from completing the activity?"
                value={data.reason}
                onChange={e => onChange('reason', e.target.value)}
                className="text-sm min-h-[60px]"
              />
            </div>
          )}

          {/* Success / Challenges */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Success Stories / Challenges</Label>
            <Textarea
              placeholder="Any highlights or challenges today..."
              value={data.success}
              onChange={e => onChange('success', e.target.value)}
              className="text-sm min-h-[50px]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
