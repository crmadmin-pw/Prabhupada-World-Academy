import { useEffect, useState } from 'react';
import { ChevronDown, Clock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  MEETING_DAYS,
  formatMeetingSchedule,
  meetingScheduleError,
  type MeetingDayKey,
} from '@/lib/meetingSchedule';

const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1));
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'));

type Period = 'AM' | 'PM' | '';
type ClockDraft = { hour: string; minute: string; period: Period };

const EMPTY_DRAFT: ClockDraft = { hour: '', minute: '', period: '' };

function parseClock(value24: string): ClockDraft {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value24.trim());
  if (!match) return EMPTY_DRAFT;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59 || minutes % 5 !== 0) return EMPTY_DRAFT;
  return {
    hour: String(hours % 12 || 12),
    minute: String(minutes).padStart(2, '0'),
    period: hours >= 12 ? 'PM' : 'AM',
  };
}

function to24(draft: ClockDraft): string {
  if (!draft.hour || !draft.minute || !draft.period) return '';
  let hours = Number(draft.hour);
  if (draft.period === 'PM' && hours < 12) hours += 12;
  if (draft.period === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${draft.minute}`;
}

function TimeSelect({
  label,
  value,
  options,
  placeholder,
  menuTitle,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  menuTitle: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={label}
        className="group inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-secondary/80 px-2 text-xs font-semibold outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary/30 data-open:bg-secondary data-open:ring-2 data-open:ring-primary/25"
      >
        <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
          {value || placeholder}
        </span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground transition-transform group-data-open:rotate-180" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-auto gap-1.5 rounded-xl bg-popover p-2 shadow-lg ring-1 ring-primary/15"
      >
        <p className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">{menuTitle}</p>
        <div className="grid grid-cols-4 gap-1" role="listbox" aria-label={label}>
          {options.map(option => {
            const selected = value === option;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={cn(
                  'h-8 w-9 rounded-lg text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  selected
                    ? 'bg-primary font-semibold text-primary-foreground shadow-xs'
                    : 'text-foreground hover:bg-secondary',
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TimeField({
  label,
  draft,
  onChange,
}: {
  label: string;
  draft: ClockDraft;
  onChange: (draft: ClockDraft) => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      <div className="flex items-center gap-1 rounded-lg border border-input bg-background px-1.5 py-1" role="group" aria-label={label}>
        <Clock className="size-3.5 shrink-0 text-primary" aria-hidden />
        <TimeSelect
          label={`${label} hour`}
          value={draft.hour}
          options={HOURS}
          placeholder="Hr"
          menuTitle="Hour"
          onChange={hour => onChange({ ...draft, hour })}
        />
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">:</span>
        <TimeSelect
          label={`${label} minute`}
          value={draft.minute}
          options={MINUTES}
          placeholder="Min"
          menuTitle="Minute"
          onChange={minute => onChange({ ...draft, minute })}
        />
        <div className="ml-auto flex shrink-0 rounded-md bg-muted/70 p-0.5" role="group" aria-label={`${label} AM or PM`}>
          {(['AM', 'PM'] as const).map(period => (
            <button
              key={period}
              type="button"
              aria-pressed={draft.period === period}
              onClick={() => onChange({ ...draft, period })}
              className={`h-6 rounded px-1.5 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                draft.period === period ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {period}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface MeetingScheduleFieldsProps {
  startTime: string;
  endTime: string;
  days: MeetingDayKey[];
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  onDaysChange: (days: MeetingDayKey[]) => void;
}

export default function MeetingScheduleFields({
  startTime,
  endTime,
  days,
  onStartTimeChange,
  onEndTimeChange,
  onDaysChange,
}: MeetingScheduleFieldsProps) {
  const [startDraft, setStartDraft] = useState<ClockDraft>(() => parseClock(startTime));
  const [endDraft, setEndDraft] = useState<ClockDraft>(() => parseClock(endTime));
  const summary = formatMeetingSchedule(startTime, endTime, days);
  const timeError = startTime && endTime ? meetingScheduleError(startTime, endTime, days.length ? days : ['mon']) : null;
  const showTimeError = timeError === 'End time must be after the start time';

  useEffect(() => { setStartDraft(parseClock(startTime)); }, [startTime]);
  useEffect(() => { setEndDraft(parseClock(endTime)); }, [endTime]);

  const updateDraft = (target: 'start' | 'end', draft: ClockDraft) => {
    if (target === 'start') setStartDraft(draft);
    else setEndDraft(draft);
    const next = to24(draft);
    if (!next) return;
    if (target === 'start') onStartTimeChange(next);
    else onEndTimeChange(next);
  };

  const toggleDay = (day: MeetingDayKey) => {
    onDaysChange(days.includes(day) ? days.filter(item => item !== day) : [...days, day]);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TimeField label="Start time *" draft={startDraft} onChange={draft => updateDraft('start', draft)} />
        <TimeField label="End time *" draft={endDraft} onChange={draft => updateDraft('end', draft)} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Days *</Label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Meeting days">
          {MEETING_DAYS.map(day => {
            const selected = days.includes(day.key);
            return (
              <button
                key={day.key}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleDay(day.key)}
                className={`h-8 min-w-11 rounded-md border px-2 text-xs font-medium transition-colors ${
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted'
                }`}
              >
                {day.label}
              </button>
            );
          })}
        </div>
      </div>
      {showTimeError ? (
        <p className="text-xs text-destructive">{timeError}</p>
      ) : summary ? (
        <p className="text-xs text-muted-foreground">{summary}</p>
      ) : null}
    </div>
  );
}
