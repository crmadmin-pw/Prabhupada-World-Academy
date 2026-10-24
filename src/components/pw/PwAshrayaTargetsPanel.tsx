import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getPwAshrayaTargets, setPwAshrayaTargets } from '@/lib/endpoints-sdk';
import { ASHRAY_LEVELS } from '@/types/enums';
import { toast } from 'sonner';

type LevelTargets = {
  wakeUp: string;
  sleep: string;
  chanting: string;
  readingMin: string;
  hearingMin: string;
  sevaMin: string;
};

const EMPTY: LevelTargets = { wakeUp: '', sleep: '', chanting: '', readingMin: '', hearingMin: '', sevaMin: '' };

function textOf(value: unknown): string {
  return value == null ? '' : String(value);
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default function PwAshrayaTargetsPanel() {
  const [levels, setLevels] = useState<Record<string, LevelTargets>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPwAshrayaTargets({}).then(config => {
      const next: Record<string, LevelTargets> = {};
      for (const level of ASHRAY_LEVELS) {
        const saved = config.levels?.[level] || {};
        next[level] = {
          wakeUp: textOf(saved.wakeUp),
          sleep: textOf(saved.sleep),
          chanting: textOf(saved.chanting),
          readingMin: textOf(saved.readingMin),
          hearingMin: textOf(saved.hearingMin),
          sevaMin: textOf(saved.sevaMin),
        };
      }
      setLevels(next);
    }).catch(() => toast.error('Could not load Ashraya targets'));
  }, []);

  const update = (level: string, key: keyof LevelTargets, value: string) => {
    setLevels(current => ({ ...current, [level]: { ...(current[level] || EMPTY), [key]: value } }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await setPwAshrayaTargets({
        submissionDeadline: '10:00',
        levels: Object.fromEntries(ASHRAY_LEVELS.map(level => {
          const row = levels[level] || EMPTY;
          return [level, {
            wakeUp: row.wakeUp || null,
            sleep: row.sleep || null,
            chanting: numberOrNull(row.chanting),
            readingMin: numberOrNull(row.readingMin),
            hearingMin: numberOrNull(row.hearingMin),
            sevaMin: numberOrNull(row.sevaMin),
          }];
        })),
      });
      toast.success('Saved Ashraya-level sadhana targets');
    } catch (error: any) {
      toast.error(error?.message || 'Could not save Ashraya targets');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Ashraya-level targets</h3>
        <p className="text-sm text-muted-foreground">Used for non-BV members who do not have a sadhana mentor. Members with a mentor use the mentor&apos;s targets instead.</p>
      </div>
      <p className="text-sm text-muted-foreground">PW submission timing (member’s local time zone): 6:00 PM on the Sadhana date through 10:00 AM the next day earns 2 points; after 10:00 AM through 2:00 PM earns 1 point; later earns 0 timely-submission points.</p>
      <form className="overflow-x-auto" autoComplete="off" onSubmit={event => event.preventDefault()}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="p-2">Level</th>
              <th className="p-2">Wake-up</th>
              <th className="p-2">Sleep</th>
              <th className="p-2">Rounds</th>
              <th className="p-2">Reading</th>
              <th className="p-2">Hearing</th>
              <th className="p-2">Seva</th>
            </tr>
          </thead>
          <tbody>
            {ASHRAY_LEVELS.map(level => {
              const row = levels[level] || EMPTY;
              return (
                <tr key={level} className="border-t">
                  <td className="p-2 font-medium whitespace-nowrap">{level}</td>
                  {(['wakeUp', 'sleep'] as const).map(key => (
                    <td key={key} className="p-1">
                      <Input type="time" className="h-8" autoComplete="off" name={`ashraya-${level}-${key}`} value={row[key]} onChange={event => update(level, key, event.target.value)} />
                    </td>
                  ))}
                  {(['chanting', 'readingMin', 'hearingMin', 'sevaMin'] as const).map(key => (
                    <td key={key} className="p-1">
                      <Input
                        inputMode="numeric"
                        className="h-8 w-20"
                        autoComplete="one-time-code"
                        autoCorrect="off"
                        spellCheck={false}
                        name={`ashraya-${level}-${key}`}
                        value={row[key]}
                        onChange={event => update(level, key, event.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </form>
      <Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save Ashraya targets'}</Button>
    </div>
  );
}
