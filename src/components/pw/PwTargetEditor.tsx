import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { setPwSadhanaTargets } from '@/lib/endpoints-sdk';
import { toast } from 'sonner';

export interface PwTargetValues {
  wakeUp?: string | null;
  sleep?: string | null;
  chanting?: number | null;
  readingMin?: number | null;
  hearingMin?: number | null;
  sevaMin?: number | null;
}

function textOf(value: unknown): string {
  return value == null || value === '' ? '' : String(value);
}

function wholeNumber(value: string): number | null | undefined {
  if (value.trim() === '') return null;
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function PwTargetEditor({ userId, fullName, targets }: {
  userId: string;
  fullName: string;
  targets?: PwTargetValues | null;
}) {
  const [open, setOpen] = useState(false);
  const [wakeUp, setWakeUp] = useState('');
  const [sleep, setSleep] = useState('');
  const [chanting, setChanting] = useState('');
  const [reading, setReading] = useState('');
  const [hearing, setHearing] = useState('');
  const [seva, setSeva] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWakeUp(textOf(targets?.wakeUp));
    setSleep(textOf(targets?.sleep));
    setChanting(textOf(targets?.chanting));
    setReading(textOf(targets?.readingMin));
    setHearing(textOf(targets?.hearingMin));
    setSeva(textOf(targets?.sevaMin));
  }, [userId, targets?.wakeUp, targets?.sleep, targets?.chanting, targets?.readingMin, targets?.hearingMin, targets?.sevaMin]);

  const save = async () => {
    const chantingRounds = wholeNumber(chanting);
    const readingMinutes = wholeNumber(reading);
    const hearingMinutes = wholeNumber(hearing);
    const sevaMinutes = wholeNumber(seva);
    if ([chantingRounds, readingMinutes, hearingMinutes, sevaMinutes].some(value => value === undefined)) {
      toast.error('Enter whole numbers, or leave a field empty');
      return;
    }
    if ((wakeUp && !/^\d{2}:\d{2}$/.test(wakeUp)) || (sleep && !/^\d{2}:\d{2}$/.test(sleep))) {
      toast.error('Use a time like 04:30');
      return;
    }
    setSaving(true);
    try {
      await setPwSadhanaTargets({
        userId,
        wakeUp: wakeUp || null,
        sleep: sleep || null,
        chantingRounds: chantingRounds ?? null,
        readingMinutes: readingMinutes ?? null,
        hearingMinutes: hearingMinutes ?? null,
        sevaMinutes: sevaMinutes ?? null,
      });
      toast.success(`Saved sadhana targets for ${fullName}`);
      setOpen(false);
    } catch (error: any) {
      toast.error(error?.message || 'Could not save the sadhana targets');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={event => event.stopPropagation()}>
          Targets
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" onClick={event => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Sadhana targets for {fullName}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor={`${userId}-wake`}>Wake-up</Label>
            <Input id={`${userId}-wake`} type="time" value={wakeUp} onChange={event => setWakeUp(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${userId}-sleep`}>Sleep</Label>
            <Input id={`${userId}-sleep`} type="time" value={sleep} onChange={event => setSleep(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${userId}-chant`}>Chanting rounds</Label>
            <Input id={`${userId}-chant`} inputMode="numeric" value={chanting} onChange={event => setChanting(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${userId}-read`}>Reading minutes</Label>
            <Input id={`${userId}-read`} inputMode="numeric" value={reading} onChange={event => setReading(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${userId}-hear`}>Hearing minutes</Label>
            <Input id={`${userId}-hear`} inputMode="numeric" value={hearing} onChange={event => setHearing(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${userId}-seva`}>Seva minutes</Label>
            <Input id={`${userId}-seva`} inputMode="numeric" value={seva} onChange={event => setSeva(event.target.value)} />
          </div>
        </div>
        <Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save targets'}</Button>
      </DialogContent>
    </Dialog>
  );
}
