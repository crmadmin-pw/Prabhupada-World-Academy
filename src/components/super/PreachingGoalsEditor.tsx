import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { savePreachingGoals } from 'zite-endpoints-sdk';

const METRIC_KEYS = [
  'Folk Residency Strength Bs',
  'No of Bs Non Residents',
  'Avg Hours Preaching',
  'No of Meetings',
  'BV Groups Attendance',
  'Books Distributed',
  'No of BV Groups',
  'Folk Residency Strength',
  'Boys Chanting 16 Rounds',
];

const METRIC_LABELS: Record<string, string> = {
  'Folk Residency Strength Bs': "Folk Res. Strength - B's",
  'No of Bs Non Residents': "No. of B's (Non Residents)",
  'Avg Hours Preaching': 'Avg. Hours Preaching/week',
  'No of Meetings': 'No. of Meetings',
  'BV Groups Attendance': 'BV Groups Attendance/week',
  'Books Distributed': 'Books Distributed/week',
  'No of BV Groups': 'No. of BV Groups',
  'Folk Residency Strength': 'Folk Residency Strength',
  'Boys Chanting 16 Rounds': 'Boys Chanting 16 Rounds',
};

interface Center { id: string; shortName: string; }
interface GoalItem { metricName: string; centerId: string; yearlyGoal: number; initialValue: number; }

interface Props {
  open: boolean;
  onClose: () => void;
  centers: Center[];
  existingGoals: GoalItem[];
}

export default function PreachingGoalsEditor({ open, onClose, centers, existingGoals }: Props) {
  const [selectedMetric, setSelectedMetric] = useState(METRIC_KEYS[0]);
  const [goals, setGoals] = useState<Record<string, { yearlyGoal: string; initialValue: string }>>({});
  const [saving, setSaving] = useState(false);

  const getVal = (centerId: string, field: 'yearlyGoal' | 'initialValue') => {
    const key = `${selectedMetric}::${centerId}`;
    if (goals[key]) return goals[key][field];
    const existing = existingGoals.find(g => g.metricName === selectedMetric && g.centerId === centerId);
    return existing ? String(existing[field]) : '';
  };

  const setVal = (centerId: string, field: 'yearlyGoal' | 'initialValue', val: string) => {
    const key = `${selectedMetric}::${centerId}`;
    setGoals(prev => ({ ...prev, [key]: { yearlyGoal: getVal(centerId, 'yearlyGoal'), initialValue: getVal(centerId, 'initialValue'), [field]: val } }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const year = new Date().getFullYear();
      const records = METRIC_KEYS.flatMap(metric =>
        centers.map(c => {
          const key = `${metric}::${c.id}`;
          const edited = goals[key];
          const existing = existingGoals.find(g => g.metricName === metric && g.centerId === c.id);
          const yearlyGoal = edited ? parseFloat(edited.yearlyGoal) || 0 : (existing?.yearlyGoal || 0);
          const initialValue = edited ? parseFloat(edited.initialValue) || 0 : (existing?.initialValue || 0);
          return { metricName: metric, centerId: c.id, yearlyGoal, initialValue, year };
        })
      );
      await savePreachingGoals({ goals: records });
      toast.success('Goals saved successfully');
      onClose();
    } catch { toast.error('Failed to save goals'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Yearly Goals</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium mb-1.5 block">Select Metric</Label>
            <Select value={selectedMetric} onValueChange={setSelectedMetric}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METRIC_KEYS.map(k => <SelectItem key={k} value={k}>{METRIC_LABELS[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>Center</span><span>Yearly Goal</span><span>Initial Value</span>
            </div>
            {centers.map(c => (
              <div key={c.id} className="grid grid-cols-3 gap-2 items-center">
                <span className="text-sm font-medium">{c.shortName}</span>
                <Input type="number" className="h-8 text-xs" placeholder="0" value={getVal(c.id, 'yearlyGoal')} onChange={e => setVal(c.id, 'yearlyGoal', e.target.value)} />
                <Input type="number" className="h-8 text-xs" placeholder="0" value={getVal(c.id, 'initialValue')} onChange={e => setVal(c.id, 'initialValue', e.target.value)} />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Goals'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
