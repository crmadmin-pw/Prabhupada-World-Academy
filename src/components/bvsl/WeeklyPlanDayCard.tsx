import { useState } from 'react';
import { format, addDays } from 'date-fns';
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import StatusButtons from './WeeklyPlanStatusButtons';

export type PlanActivity = { goal: string; status: string };

export type DayData = {
  activities: PlanActivity[];
  duration: number; reason: string; success: string;
};

const MAX_ACTIVITIES = 12;

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
  const activities = data.activities?.length ? data.activities : [
    { goal: '', status: 'White' },
    { goal: '', status: 'White' },
  ];
  const showReason = activities.some(activity => activity.status === 'Red');

  const updateActivity = (index: number, patch: Partial<PlanActivity>) => {
    onChange('activities', activities.map((activity, i) => i === index ? { ...activity, ...patch } : activity));
  };

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
          <div className="flex flex-wrap gap-1 ml-1 max-w-[7rem]">
            {activities.map((activity, i) => (
              <div key={i} className={`w-2.5 h-2.5 rounded-full ${statusColor(activity.status)}`} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data.duration > 0 && <span className="text-xs text-muted-foreground">{data.duration} min</span>}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t">
          {activities.map((activity, i) => (
            <div key={i} className={i === 0 ? 'pt-3 space-y-1.5' : 'space-y-1.5'}>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-medium">Activity {i + 1}</Label>
                <div className="flex items-center gap-1">
                  <StatusButtons value={activity.status} onChange={v => updateActivity(i, { status: v })} />
                  {i >= 2 && (
                    <button
                      type="button"
                      onClick={() => onChange('activities', activities.filter((_, index) => index !== i))}
                      className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                      aria-label={`Remove activity ${i + 1}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <Input
                placeholder={i === 0 ? 'e.g. Book distribution at campus' : 'e.g. 1-on-1 meeting with contact'}
                value={activity.goal}
                onChange={e => updateActivity(i, { goal: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
          ))}

          {activities.length < MAX_ACTIVITIES && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => onChange('activities', [...activities, { goal: '', status: 'White' }])}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add activity
            </Button>
          )}

          {/* Duration */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Time (minutes)</Label>
            <Input
              type="number"
              inputMode="numeric"
              step="1"
              min="0"
              max="1440"
              placeholder="0"
              value={data.duration || ''}
              onChange={e => {
                const raw = e.target.value.replace(/[^\d]/g, '');
                onChange('duration', raw === '' ? 0 : Math.min(1440, parseInt(raw, 10)));
              }}
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
