import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MEETING_DAYS,
  formatMeetingSchedule,
  meetingScheduleError,
  type MeetingDayKey,
} from '@/lib/meetingSchedule';

const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1));
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'));

type Period = 'AM' | 'PM' | '';

function parseClock(value24: string): { hour: string; minute: string; period: Period } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value24.trim());
  if (!match) return { hour: '', minute: '', period: '' };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59 || minutes % 5 !== 0) return { hour: '', minute: '', period: '' };
  return {
    hour: String(hours % 12 || 12),
    minute: String(minutes).padStart(2, '0'),
    period: hours >= 12 ? 'PM' : 'AM',
  };
}

function to24(hour: string, minute: string, period: Period): string {
  if (!hour || !minute || !period) return '';
  let hours = Number(hour);
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${minute}`;
}

function ClockField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value24: string) => void;
}) {
  const [hour, setHour] = useState('');
  const [minute, setMinute] = useState('');
  const [period, setPeriod] = useState<Period>('');

  useEffect(() => {
    const parsed = parseClock(value);
    setHour(parsed.hour);
    setMinute(parsed.minute);
    setPeriod(parsed.period);
  }, [value]);

  const update = (nextHour: string, nextMinute: string, nextPeriod: Period) => {
    setHour(nextHour);
    setMinute(nextMinute);
    setPeriod(nextPeriod);
    const next = to24(nextHour, nextMinute, nextPeriod);
    if (next) onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      <div className="grid grid-cols-[1fr_1fr_4.5rem] gap-1.5">
        <Select value={hour || undefined} onValueChange={next => next && update(next, minute, period)}>
          <SelectTrigger className="h-9" aria-label={`${label} hour`}>
            <SelectValue placeholder="Hour" />
          </SelectTrigger>
          <SelectContent>
            {HOURS.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={minute || undefined} onValueChange={next => next && update(hour, next, period)}>
          <SelectTrigger className="h-9" aria-label={`${label} minute`}>
            <SelectValue placeholder="Min" />
          </SelectTrigger>
          <SelectContent>
            {MINUTES.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={period || undefined} onValueChange={next => (next === 'AM' || next === 'PM') && update(hour, minute, next)}>
          <SelectTrigger className="h-9 px-2" aria-label={`${label} AM or PM`}>
            <SelectValue placeholder="AM" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AM">AM</SelectItem>
            <SelectItem value="PM">PM</SelectItem>
          </SelectContent>
        </Select>
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
  const summary = formatMeetingSchedule(startTime, endTime, days);
  const timeError = startTime && endTime ? meetingScheduleError(startTime, endTime, days.length ? days : ['mon']) : null;
  const showTimeError = timeError === 'End time must be after the start time';

  const toggleDay = (day: MeetingDayKey) => {
    onDaysChange(days.includes(day) ? days.filter(item => item !== day) : [...days, day]);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ClockField label="Start time *" value={startTime} onChange={onStartTimeChange} />
        <ClockField label="End time *" value={endTime} onChange={onEndTimeChange} />
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
