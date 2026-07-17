import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface Props {
  values: Record<string, any>;
  onChange: (values: Record<string, any>) => void;
}

// Duration fields (stored as minutes, rendered as HH:MM)
const DURATION_FIELDS = [
  { key: 'pr_calling_time', label: 'Time spent in Calling' },
  { key: 'pr_one_on_one_time', label: 'Time spent on 1-on-1' },
  { key: 'pr_book_dist_time', label: 'Book Distribution Time' },
  { key: 'pr_rdua_time', label: 'RDUA Hosting Time (if not counted in reading)' },
  { key: 'pr_plan_time', label: 'Time spent in Making Preaching Plan' },
];

const NUMBER_FIELDS = [
  { key: 'pr_books_distributed', label: 'No. of Books Distributed' },
  { key: 'pr_contacts_collected', label: 'No. of Contacts Collected' },
  { key: 'pr_unique_one_on_ones', label: 'No. of 1-to-1s (Unique Individuals)' },
];

export const BV_DURATION_KEYS = DURATION_FIELDS.map(f => f.key);

function minutesToDisplay(mins: number): string {
  if (!mins || mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseTimeText(t: string): number {
  if (!t) return 0;
  const parts = t.split(':');
  if (parts.length !== 2) return 0;
  const [h, m] = parts.map(Number);
  return (h || 0) * 60 + (m || 0);
}

export default function BvslPreachingSection({ values, onChange }: Props) {
  // Track raw text for each duration field so editing isn't broken
  const [rawInputs, setRawInputs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    DURATION_FIELDS.forEach(f => {
      init[f.key] = minutesToDisplay(values[f.key] || 0);
    });
    return init;
  });

  const set = (key: string, val: any) => onChange({ ...values, [key]: val });

  // BUG-002 FIX: clamp hours 0-23 and minutes 0-59
  const clampHHMM = (h: number, m: number): string => {
    const ch = Math.min(Math.max(0, h), 23);
    const cm = Math.min(Math.max(0, m), 59);
    return `${String(ch).padStart(2, '0')}:${String(cm).padStart(2, '0')}`;
  };

  const handleDurationChange = (key: string, raw: string) => {
    const prevText = rawInputs[key] ?? '';
    // Detect paste
    if (raw.length - prevText.length > 1) {
      const digits = raw.replace(/\D/g, '').slice(0, 4);
      if (digits.length >= 3) {
        const h = parseInt(digits.slice(0, digits.length - 2) || '0');
        const m = parseInt(digits.slice(-2));
        const clamped = clampHHMM(h, m);
        setRawInputs(prev => ({ ...prev, [key]: clamped }));
        set(key, parseTimeText(clamped));
        return;
      }
      setRawInputs(prev => ({ ...prev, [key]: digits }));
      return;
    }
    let text = raw.replace(/[^\d:]/g, '').slice(0, 5);
    const isForward = raw.length > prevText.length;
    if (isForward && !text.includes(':') && text.length === 2) {
      text = text + ':';
    }
    // Clamp when fully typed
    if (/^\d{1,2}:\d{2}$/.test(text)) {
      const [hStr, mStr] = text.split(':');
      text = clampHHMM(parseInt(hStr), parseInt(mStr));
    }
    setRawInputs(prev => ({ ...prev, [key]: text }));
    if (/^\d{1,2}:\d{2}$/.test(text)) {
      set(key, parseTimeText(text));
    } else if (!text) {
      set(key, 0);
    }
  };

  return (
    <div className="bg-card border rounded-xl p-4 shadow-sm space-y-4">
      <div className="flex items-center gap-2 pb-1 border-b">
        <span className="text-lg">🌟</span>
        <h3 className="font-semibold text-base">Bhakti Vriksha Report</h3>
      </div>

      {/* Duration fields */}
      <div className="space-y-3">
        {DURATION_FIELDS.map(f => (
          <div key={f.key} className="space-y-1">
            <Label className="text-sm font-medium">{f.label}</Label>
            <Input
              type="text"
              placeholder="HH:MM"
              maxLength={5}
              value={rawInputs[f.key] ?? ''}
              onChange={e => handleDurationChange(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>

      {/* Number fields */}
      <div className="space-y-3">
        {NUMBER_FIELDS.map(f => (
          <div key={f.key} className="space-y-1">
            <Label className="text-sm font-medium">{f.label}</Label>
            <Input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="0"
              value={values[f.key] !== undefined && values[f.key] !== null && values[f.key] !== '' ? String(values[f.key]) : ''}
              onChange={e => {
                const raw = e.target.value.replace(/[^0-9]/g, '');
                set(f.key, raw === '' ? '' : parseInt(raw, 10));
              }}
            />
          </div>
        ))}
      </div>


    </div>
  );
}
