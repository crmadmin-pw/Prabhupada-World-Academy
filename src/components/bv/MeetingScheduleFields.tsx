import { useEffect, useState } from 'react';
import { ChevronDown, Clock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  MEETING_DAYS,
  formatClock,
  formatMeetingSchedule,
  meetingScheduleError,
  type MeetingDayKey,
} from '@/lib/meetingSchedule';

const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1));
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'));

type Period = 'AM' | 'PM' | '';
type TimeTarget = 'start' | 'end';
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

function TimeButton({
  label,
  value,
  open,
  onToggle,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
}) {
  const display = formatClock(value);
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        onClick={onToggle}
        className={`flex h-9 w-full items-center gap-2 rounded-lg border bg-background px-2.5 text-left text-sm transition-colors ${
          open ? 'border-primary ring-3 ring-primary/20' : 'border-input hover:bg-muted/40'
        }`}
      >
        <Clock className="size-3.5 shrink-0 text-primary" />
        <span className={`min-w-0 flex-1 truncate ${display ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
          {display || 'Select time'}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
}

function ChoiceGrid({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="grid grid-cols-6 gap-1">
        {options.map(option => {
          const isSelected = option === selected;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(option)}
              className={`h-8 rounded-md text-xs font-medium transition-colors ${
                isSelected
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/60 text-foreground hover:bg-muted'
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimePanel({
  draft,
  onChange,
}: {
  draft: ClockDraft;
  onChange: (draft: ClockDraft) => void;
}) {
  const committed = to24(draft);
  const preview = committed
    ? formatClock(committed)
    : draft.hour || draft.minute || draft.period
      ? `${draft.hour || '–'}:${draft.minute || '––'}${draft.period ? ` ${draft.period}` : ''}`
      : 'Choose hour, minute, and AM or PM';

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm ${committed ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{preview}</p>
        <div className="flex rounded-md border border-border bg-background p-0.5" role="group" aria-label="AM or PM">
          {(['AM', 'PM'] as const).map(period => (
            <button
              key={period}
              type="button"
              aria-pressed={draft.period === period}
              onClick={() => onChange({ ...draft, period })}
              className={`h-7 rounded px-2.5 text-xs font-semibold ${
                draft.period === period ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {period}
            </button>
          ))}
        </div>
      </div>
      <ChoiceGrid label="Hour" options={HOURS} selected={draft.hour} onSelect={hour => onChange({ ...draft, hour })} />
      <ChoiceGrid label="Minute" options={MINUTES} selected={draft.minute} onSelect={minute => onChange({ ...draft, minute })} />
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
  const [open, setOpen] = useState<TimeTarget | null>(null);
  const [startDraft, setStartDraft] = useState<ClockDraft>(() => parseClock(startTime));
  const [endDraft, setEndDraft] = useState<ClockDraft>(() => parseClock(endTime));
  const summary = formatMeetingSchedule(startTime, endTime, days);
  const timeError = startTime && endTime ? meetingScheduleError(startTime, endTime, days.length ? days : ['mon']) : null;
  const showTimeError = timeError === 'End time must be after the start time';

  useEffect(() => { setStartDraft(parseClock(startTime)); }, [startTime]);
  useEffect(() => { setEndDraft(parseClock(endTime)); }, [endTime]);

  const updateDraft = (target: TimeTarget, draft: ClockDraft) => {
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
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
        <TimeButton
          label="Start time *"
          value={startTime}
          open={open === 'start'}
          onToggle={() => setOpen(current => current === 'start' ? null : 'start')}
        />
        <span className="pb-2 text-xs text-muted-foreground">to</span>
        <TimeButton
          label="End time *"
          value={endTime}
          open={open === 'end'}
          onToggle={() => setOpen(current => current === 'end' ? null : 'end')}
        />
      </div>
      {open && (
        <TimePanel
          draft={open === 'start' ? startDraft : endDraft}
          onChange={draft => updateDraft(open, draft)}
        />
      )}
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
