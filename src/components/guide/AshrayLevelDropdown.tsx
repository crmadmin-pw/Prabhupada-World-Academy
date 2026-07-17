import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { setAshrayLevel } from 'zite-endpoints-sdk';
import { ASHRAY_LEVELS } from '@/types/enums';

interface AshrayLevelDropdownProps {
  userId: string;
  currentLevel: string;
  onUpdated?: () => void;
  compact?: boolean;
}

export default function AshrayLevelDropdown({ userId, currentLevel, onUpdated, compact }: AshrayLevelDropdownProps) {
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState(currentLevel || 'Jigyasa');

  const handleChange = async (newLevel: string) => {
    if (newLevel === value) return;
    setSaving(true);
    try {
      const result = await setAshrayLevel({ userId, ashrayLevel: newLevel }) as any;
      setValue(newLevel);
      toast.success(`Ashray level changed to ${newLevel}`);
      if (result?.tagMangoMigration) {
        const m = result.tagMangoMigration;
        if (m.enrollResult?.status === 'Enrolled') {
          toast.success(`🎓 TagMango course migrated to ${newLevel}`);
        } else if (m.enrollResult?.status === 'Failed') {
          toast.error(`⚠️ Level updated but TagMango migration failed: ${m.enrollResult.error || 'Unknown error'}`);
        }
      }
      onUpdated?.();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update ashray level');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Select value={value} onValueChange={handleChange} disabled={saving}>
      <SelectTrigger className={compact ? 'h-7 text-xs w-[130px]' : 'h-8 text-sm w-[150px]'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ASHRAY_LEVELS.map(l => (
          <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
