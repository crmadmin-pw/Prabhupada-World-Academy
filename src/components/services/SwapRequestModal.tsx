import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { requestServiceSwap } from 'zite-endpoints-sdk';

interface Props {
  open: boolean;
  onClose: () => void;
  allocationId: string;
  serviceName: string;
  onRequested: (allocationId: string) => void;
}

export default function SwapRequestModal({ open, onClose, allocationId, serviceName, onRequested }: Props) {
  const [swapType, setSwapType] = useState<'open_swap' | 'delegate'>('open_swap');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!reason.trim()) { toast.error('Please provide a reason'); return; }
    setLoading(true);
    try {
      await requestServiceSwap({ allocationId, swapType, reason });
      toast.success('Swap request posted to community ✓');
      onRequested(allocationId);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to request swap');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Request Swap — {serviceName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm">Swap type</Label>
            <RadioGroup value={swapType} onValueChange={v => setSwapType(v as any)} className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="open_swap" id="open" />
                <Label htmlFor="open" className="text-sm font-normal cursor-pointer">Open (anyone can pick up)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="delegate" id="delegate" />
                <Label htmlFor="delegate" className="text-sm font-normal cursor-pointer">Delegate (specific person)</Label>
              </div>
            </RadioGroup>
            {swapType === 'delegate' && (
              <p className="text-xs text-muted-foreground bg-muted rounded px-2 py-1.5">Note: Delegate to a specific person is not yet supported in this version. Use open swap instead.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Reason</Label>
            <Textarea
              placeholder="e.g., traveling, health issue, family commitment…"
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="resize-none text-sm"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={loading || swapType === 'delegate'}>
            {loading ? 'Posting…' : 'Post Swap Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
