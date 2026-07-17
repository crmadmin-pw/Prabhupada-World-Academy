import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  normalizeFieldType, parseNumericValue, parseOptions, parseCriteria,
  isNRCriteria, calculateNRPoints, calculateResidentPoints,
  getTogglePoints, minutesToTimeString, timeStringToMinutes,
} from '@/lib/scoring';

export type ContextTag = 'today_morning' | 'today' | 'tonight' | 'last_night' | null;

interface FieldDef {
  fieldId: string; fieldKey: string; fieldLabel: string; fieldType: string;
  isRequired: boolean; contributesToScore: boolean; criteria?: string | null;
  helpText?: string | null; options?: any[];
  contextTag?: ContextTag;
  minValue?: number;
  maxValue?: number;
}

interface Props {
  field: FieldDef;
  value: any;
  onChange: (key: string, value: any) => void;
  ashrayLevel: string;
  entryDate: string;
  residencyBucket: string;
  durationInput?: string;
  onDurationInputChange?: (key: string, text: string) => void;
  contextBadgeLabel?: string;
  disabled?: boolean;
}

/** Returns badge styles for each context tag type */
function ContextBadge({ label }: { label: string }) {
  const isTonight = label.includes('Tonight');
  const isLastNight = label.includes('Last Night');
  const isMorning = label.includes('Morning');

  let cls = '';
  let icon = '';
  if (isTonight) {
    cls = 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800';
    icon = '🌙';
  } else if (isLastNight) {
    cls = 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800';
    icon = '🌙';
  } else if (isMorning) {
    cls = 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800';
    icon = '🌅';
  } else {
    cls = 'bg-green-100 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800';
    icon = '📅';
  }

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border leading-tight ${cls}`}>
      {icon} {label}
    </span>
  );
}

// BUG-002 FIX: clamp hours (0-23) and minutes (0-59)
function clampHHMM(h: number, m: number): string {
  const clampedH = Math.min(Math.max(0, h), 23);
  const clampedM = Math.min(Math.max(0, m), 59);
  return `${String(clampedH).padStart(2, '0')}:${String(clampedM).padStart(2, '0')}`;
}

/** Normalize time input to HH:MM with clamping */
function applyAutoColon(raw: string, prevText: string): string {
  const lengthDiff = raw.length - prevText.length;
  const rawDigits = raw.replace(/\D/g, '');
  if (lengthDiff > 1 || (rawDigits.length === 4 && !raw.includes(':'))) {
    const digits = rawDigits.slice(0, 4);
    if (digits.length >= 3) {
      const h = parseInt(digits.slice(0, digits.length - 2) || '0');
      const m = parseInt(digits.slice(-2));
      return clampHHMM(h, m);
    }
    return digits;
  }
  let text = raw.replace(/[^\d:]/g, '').slice(0, 5);
  const isForward = raw.length > prevText.length;
  if (isForward && !text.includes(':') && text.length === 2) {
    text = text + ':';
  }
  if (/^\d{1,2}:\d{2}$/.test(text)) {
    const [hStr, mStr] = text.split(':');
    return clampHHMM(parseInt(hStr), parseInt(mStr));
  }
  return text;
}

// 12-hour AM/PM constants
const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES_5 = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

// OPT-8: Remove default export from function declaration — wrap with React.memo below
function SadhanaFieldRenderer({
  field, value, onChange, ashrayLevel, entryDate, residencyBucket,
  durationInput, onDurationInputChange, contextBadgeLabel, disabled,
}: Props) {
  const nt = normalizeFieldType(field.fieldType, field.fieldKey);
  const options = parseOptions({ ...field, options: field.options || [] } as any);
  const criteria = parseCriteria(field.criteria);
  const hasObjCriteria = criteria && typeof criteria === 'object' && !Array.isArray(criteria);

  const displayLabel = field.fieldLabel;

  const fieldLabel = (
    <div className="flex flex-wrap items-center gap-2">
      <Label className="text-base font-medium">
        {displayLabel} {field.isRequired && <span className="text-destructive">*</span>}
      </Label>
      {contextBadgeLabel && <ContextBadge label={contextBadgeLabel} />}
    </div>
  );

  const PointsBadge = ({ pts, max, penaltyOnly }: { pts: number; max?: number; penaltyOnly?: boolean }) => {
    let label: string;
    if (penaltyOnly && pts < 0) {
      label = `${Math.abs(pts)} ${Math.abs(pts) === 1 ? 'point' : 'points'} deducted`;
    } else if (max != null) {
      label = `${pts} / ${max} pts`;
    } else if (pts < 0) {
      label = `Minus ${Math.abs(pts)} ${Math.abs(pts) === 1 ? 'point' : 'points'} deducted`;
    } else {
      label = `${pts} ${Math.abs(pts) === 1 ? 'point' : 'points'}`;
    }
    return (
      <p className={`text-sm font-medium ${pts > 0 ? 'text-primary' : pts < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
        {label}
      </p>
    );
  };

  const getNrResult = () => {
    const nrCrit = parseCriteria(field.criteria);
    return isNRCriteria(nrCrit) && field.contributesToScore
      ? calculateNRPoints(nrCrit, value, ashrayLevel, entryDate) : null;
  };

  const getResidentPts = () => {
    if (!hasObjCriteria || !field.contributesToScore || isNRCriteria(criteria)) return null;
    return calculateResidentPoints(criteria, parseNumericValue(value), residencyBucket);
  };

  if (nt === 'radio' || nt === 'dropdown') {
    const sel = options.find(opt => String(opt.storedValue) === String(value));
    const handleChange = (v: string) => {
      const opt = options.find(o => String(o.storedValue) === v);
      onChange(field.fieldKey, opt ? opt.storedValue : parseNumericValue(v));
    };

    if (nt === 'radio') return (
      <div className="space-y-3">
        {fieldLabel}
        <RadioGroup value={value?.toString() || ''} onValueChange={handleChange}>
          {options.map((o, i) => (
            <div key={i} className="flex items-center space-x-2">
              <RadioGroupItem value={String(o.storedValue)} id={`${field.fieldKey}_${i}`} />
              <Label htmlFor={`${field.fieldKey}_${i}`} className="font-normal cursor-pointer">{o.displayLabel}</Label>
            </div>
          ))}
        </RadioGroup>
        {sel && field.contributesToScore && <PointsBadge pts={sel.pointsValue} />}
      </div>
    );

    return (
      <div className="space-y-2">
        {fieldLabel}
        <Select value={value?.toString() || ''} onValueChange={handleChange}>
          <SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger>
          <SelectContent>
            {options.map((o, i) => (
              <SelectItem key={i} value={String(o.storedValue)}>{o.displayLabel}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sel && field.contributesToScore && <PointsBadge pts={sel.pointsValue} />}
      </div>
    );
  }

  if (nt === 'multiselect') {
    const sv = Array.isArray(value) ? value : [];
    const totalPts = field.contributesToScore
      ? options.filter(o => sv.includes(o.storedValue)).reduce((s, o) => s + o.pointsValue, 0) : 0;
    return (
      <div className="space-y-3">
        {fieldLabel}
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex items-center space-x-2">
              <Checkbox id={`${field.fieldKey}_${i}`} checked={sv.includes(o.storedValue)}
                onCheckedChange={(c) => onChange(field.fieldKey, c ? [...sv, o.storedValue] : sv.filter((v: any) => v !== o.storedValue))} />
              <Label htmlFor={`${field.fieldKey}_${i}`} className="font-normal cursor-pointer">{o.displayLabel}</Label>
            </div>
          ))}
        </div>
        {sv.length > 0 && field.contributesToScore && totalPts > 0 && <PointsBadge pts={totalPts} />}
      </div>
    );
  }

  if (nt === 'toggle') {
    const isChecked = value === true || String(value) === 'true';
    const nrRes = getNrResult();
    const hasOptionScoring = options.length >= 2 && field.contributesToScore && !nrRes;
    const rawOffPts = hasOptionScoring ? options[0].pointsValue : 0;
    const rawOnPts  = hasOptionScoring ? options[1].pointsValue : getTogglePoints(field as any);
    const isPenaltyToggle = hasOptionScoring && rawOffPts > 0 && rawOnPts < 0;
    const offPts = isPenaltyToggle ? 0 : rawOffPts;
    const onPts  = rawOnPts;
    const currentPts = isChecked ? onPts : offPts;
    const maxPts = isPenaltyToggle ? 0 : (hasOptionScoring ? Math.max(offPts, onPts) : (onPts > 0 ? onPts : 0));
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>{fieldLabel}</div>
          <Switch id={field.fieldKey} checked={isChecked} disabled={disabled}
            onCheckedChange={(c) => !disabled && onChange(field.fieldKey, c)} />
        </div>
        {nrRes && nrRes.target !== null && !nrRes.isLeaderboard && (
          nrRes.target === 'all'
            ? <PointsBadge pts={nrRes.points} max={nrRes.maxPoints} />
            : isChecked ? <PointsBadge pts={nrRes.points} max={nrRes.maxPoints} /> : null
        )}
        {hasOptionScoring && isChecked && (!isPenaltyToggle || currentPts !== 0) && <PointsBadge pts={currentPts} max={isPenaltyToggle ? undefined : maxPts} penaltyOnly={isPenaltyToggle} />}
        {!nrRes && !hasOptionScoring && field.contributesToScore && isChecked && onPts > 0 && <PointsBadge pts={onPts} />}
      </div>
    );
  }

  // ── 12h AM/PM Time Input — dropdown selectors for reliable mobile input ──
  if (nt === 'time') {
    const stored24 = value || '';
    const parsedStored = stored24.match?.(/^(\d{1,2}):(\d{2})$/);
    const h24 = parsedStored ? parseInt(parsedStored[1]) : -1;
    const m24 = parsedStored ? parseInt(parsedStored[2]) : -1;

    const isDefaultPM = field.fieldKey.toLowerCase().includes('sleep');
    const isPM = h24 >= 0 ? h24 >= 12 : isDefaultPM;
    const h12 = h24 >= 0 ? (h24 % 12 === 0 ? 12 : h24 % 12) : -1;

    const nrRes = getNrResult();
    const hasTimeVal = h24 >= 0;

    const store24h = (h12Val: number, mVal: number, pm: boolean) => {
      if (h12Val < 1) return; // no hour selected yet
      let h = h12Val;
      if (pm && h12Val !== 12) h = h12Val + 12;
      if (!pm && h12Val === 12) h = 0;
      const val24 = `${String(h).padStart(2, '0')}:${String(Math.min(mVal, 59)).padStart(2, '0')}`;
      onChange(field.fieldKey, val24);
    };

    const handleHourChange = (hStr: string) => {
      const h = parseInt(hStr);
      if (isNaN(h)) return;
      const currentMin = m24 >= 0 ? m24 : 0;
      store24h(h, currentMin, isPM);
    };

    const handleMinuteChange = (mStr: string) => {
      const m = parseInt(mStr);
      if (isNaN(m)) return;
      const currentH12 = h12 > 0 ? h12 : (isDefaultPM ? 10 : 6);
      store24h(currentH12, m, isPM);
    };

    const togglePM = (newPM: boolean) => {
      if (!hasTimeVal) {
        const defH = isDefaultPM ? 10 : 6;
        store24h(defH, 0, newPM);
        return;
      }
      store24h(h12, m24 >= 0 ? m24 : 0, newPM);
    };

    return (
      <div className="space-y-2">
        {fieldLabel}
        <div className="flex gap-1.5 items-center flex-wrap">
          <select
            className="h-9 rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring w-[70px]"
            value={h12 > 0 ? String(h12) : ''}
            onChange={e => handleHourChange(e.target.value)}
          >
            <option value="">HH</option>
            {HOURS_12.map(h => <option key={h} value={String(h)}>{String(h).padStart(2, '0')}</option>)}
          </select>
          <span className="text-lg font-bold text-muted-foreground">:</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring w-[70px]"
            value={m24 >= 0 ? String(m24) : ''}
            onChange={e => handleMinuteChange(e.target.value)}
          >
            <option value="">MM</option>
            {MINUTES_5.map(m => <option key={m} value={String(m)}>{String(m).padStart(2, '0')}</option>)}
          </select>
          <div className="flex rounded-md border border-border overflow-hidden">
            <button type="button" onClick={() => togglePM(false)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${!isPM ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}>
              AM
            </button>
            <button type="button" onClick={() => togglePM(true)}
              className={`px-3 py-1.5 text-xs font-semibold border-l border-border transition-colors ${isPM ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}>
              PM
            </button>
          </div>
        </div>
        {nrRes && nrRes.target !== null && nrRes.target !== 'enabled' && !nrRes.isLeaderboard && hasTimeVal && (
          <PointsBadge pts={nrRes.points} max={nrRes.maxPoints} />
        )}
      </div>
    );
  }

  if (nt === 'number') {
    const displayVal = (value === undefined || value === null || value === '')
      ? ''
      : String(Number(value));
    const numericVal = typeof value === 'number' ? value : parseFloat(String(value || '')) || 0;
    const hasPositiveVal = numericVal > 0;
    const nrRes = getNrResult();
    const resPts = getResidentPts();
    return (
      <div className="space-y-2">
        {fieldLabel}
        <Input
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="0"
          value={displayVal}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, '');
            if (raw === '') { onChange(field.fieldKey, ''); return; }
            let val = parseInt(raw, 10);
            if (field.maxValue !== undefined && val > field.maxValue) {
              val = field.maxValue;
            }
            if (field.minValue !== undefined && val < field.minValue) {
              val = field.minValue;
            }
            onChange(field.fieldKey, val);
          }}
        />
        {nrRes && nrRes.target !== null && hasPositiveVal && (
          nrRes.isLeaderboard ? null
            : <PointsBadge pts={nrRes.points} max={nrRes.maxPoints} />
        )}
        {!nrRes && resPts && resPts.maxPoints > 0 && hasPositiveVal && <PointsBadge pts={resPts.points} max={resPts.maxPoints} />}
      </div>
    );
  }

  if (nt === 'duration') {
    const curMins = value || 0;
    const durationHours = Math.floor(curMins / 60);
    const durationMins = curMins % 60;
    const hasDurationVal = curMins > 0;
    const nrRes = getNrResult();
    const resPts = (!nrRes && hasDurationVal) ? getResidentPts() : null;

    const handleDurHourChange = (hStr: string) => {
      const h = parseInt(hStr) || 0;
      onChange(field.fieldKey, h * 60 + durationMins);
    };
    const handleDurMinChange = (mStr: string) => {
      const m = parseInt(mStr) || 0;
      onChange(field.fieldKey, durationHours * 60 + m);
    };

    const DURATION_HOURS = Array.from({ length: 24 }, (_, i) => i);
    const DURATION_MINS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

    // Snap display minute to nearest 5 for dropdown, but keep actual value
    const displayMin = DURATION_MINS.reduce((prev, curr) =>
      Math.abs(curr - durationMins) < Math.abs(prev - durationMins) ? curr : prev, 0);

    return (
      <div className="space-y-2">
        {fieldLabel}
        <div className="flex gap-1.5 items-center">
          <select
            className="h-9 rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring w-[75px]"
            value={String(durationHours)}
            onChange={e => handleDurHourChange(e.target.value)}
          >
            {DURATION_HOURS.map(h => <option key={h} value={String(h)}>{String(h).padStart(2, '0')} hr</option>)}
          </select>
          <span className="text-lg font-bold text-muted-foreground">:</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring w-[80px]"
            value={String(displayMin)}
            onChange={e => handleDurMinChange(e.target.value)}
          >
            {DURATION_MINS.map(m => <option key={m} value={String(m)}>{String(m).padStart(2, '0')} min</option>)}
          </select>
        </div>
        {nrRes && nrRes.target !== null && hasDurationVal && !nrRes.isLeaderboard && (
          <PointsBadge pts={nrRes.points} max={nrRes.maxPoints} />
        )}
        {resPts && resPts.maxPoints > 0 && hasDurationVal && <PointsBadge pts={resPts.points} max={resPts.maxPoints} />}
      </div>
    );
  }

  if (nt === 'text') return (
    <div className="space-y-2">
      {fieldLabel}
      <Textarea value={value || ''} onChange={(e) => onChange(field.fieldKey, e.target.value)} rows={3} />
    </div>
  );

  return (
    <div className="space-y-2">
      {fieldLabel}
      <Input type="text" value={value || ''} onChange={(e) => onChange(field.fieldKey, e.target.value)}
        placeholder={`Enter ${field.fieldLabel.toLowerCase()}`} />
    </div>
  );
}

// OPT-8: React.memo with custom comparator — prevents cascade re-renders when only unrelated fields change
export default React.memo(SadhanaFieldRenderer, (prev, next) => {
  return (
    prev.value === next.value &&
    prev.durationInput === next.durationInput &&
    prev.ashrayLevel === next.ashrayLevel &&
    prev.entryDate === next.entryDate &&
    prev.residencyBucket === next.residencyBucket &&
    prev.field.fieldKey === next.field.fieldKey &&
    prev.onChange === next.onChange &&
    prev.onDurationInputChange === next.onDurationInputChange &&
    prev.contextBadgeLabel === next.contextBadgeLabel &&
    prev.disabled === next.disabled
  );
});
