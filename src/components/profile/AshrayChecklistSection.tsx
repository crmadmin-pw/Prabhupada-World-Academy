import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2 } from 'lucide-react';

const CATEGORY_LABELS: Record<string, string> = {
  SADHANA: '🕉️ Sadhana',
  SADACHAR: '🌿 Sadachar',
  SIDDHANTA: '📚 Siddhanta',
  SERVICE: '🙏 Service',

};

interface Practice {
  fieldKey: string;
  fieldLabel: string;
  requirements: Record<string, string>;
}

interface Props {
  category: string;
  practices: Practice[];
  currentLevel: string;
  checkedItems: Set<string>;
  onToggle: (fieldKey: string, checked: boolean) => void;
  readOnly: boolean;
}

function isRequired(req: string): boolean {
  return !!req && req !== '-' && req !== '—';
}

export default function AshrayChecklistSection({
  category, practices, currentLevel, checkedItems, onToggle, readOnly,
}: Props) {
  const items = practices.filter(p => isRequired(p.requirements[currentLevel] || ''));
  if (items.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
        {CATEGORY_LABELS[category] || category}
      </p>
      {items.map(practice => {
        const req = practice.requirements[currentLevel];
        const checked = checkedItems.has(practice.fieldKey);
        return (
          <div
            key={practice.fieldKey}
            className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
              checked ? 'bg-primary/5 border-primary/30' : 'bg-card'
            }`}
          >
            <Checkbox
              id={practice.fieldKey}
              checked={checked}
              disabled={readOnly}
              onCheckedChange={val => !readOnly && onToggle(practice.fieldKey, !!val)}
              className="mt-0.5 shrink-0"
            />
            <label
              htmlFor={readOnly ? undefined : practice.fieldKey}
              className={`flex-1 text-sm leading-snug ${
                readOnly ? '' : 'cursor-pointer'
              }`}
            >
              <span className={`font-medium ${checked ? 'line-through text-muted-foreground' : ''}`}>
                {practice.fieldLabel}
              </span>
              <span className="ml-2">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{req}</Badge>
              </span>
            </label>
            {checked && <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />}
          </div>
        );
      })}
    </div>
  );
}
