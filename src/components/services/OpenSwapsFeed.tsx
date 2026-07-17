import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ArrowLeftRight, ChevronDown, ChevronUp, Clock, User } from 'lucide-react';
import { toast } from 'sonner';
import { acceptSwap } from 'zite-endpoints-sdk';
import type { GetOpenSwapsOutputType } from 'zite-endpoints-sdk';

type SwapItem = GetOpenSwapsOutputType['swaps'][0];

import { SERVICE_DAY_LABELS, SERVICE_DAYS } from '@/lib/serviceWeek';
const DAY_LABELS: Record<string, string> = Object.fromEntries([...SERVICE_DAYS].map((d, i) => [d, SERVICE_DAY_LABELS[i]]));

interface Props {
  swaps: SwapItem[];
  currentUserId: string;
  onAccepted: () => void;
}

export default function OpenSwapsFeed({ swaps, currentUserId, onAccepted }: Props) {
  const [open, setOpen] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  const available = swaps.filter(s => s.requesterId !== currentUserId);

  const handleAccept = async (requestId: string) => {
    setAccepting(requestId);
    try {
      await acceptSwap({ requestId });
      toast.success('Swap accepted! Service added to your schedule ✓');
      onAccepted();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to accept swap');
    } finally {
      setAccepting(null);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-primary" />
                Open Swaps Feed
                {available.length > 0 && (
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">{available.length}</Badge>
                )}
              </span>
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-2">
            {available.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">No open swaps right now 🙏</p>
            ) : (
              available.map(swap => (
                <div key={swap.requestId} className="flex items-start justify-between gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">{swap.serviceName}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{swap.timeSlot}</span>
                      <span>·</span>
                      <span>{DAY_LABELS[swap.dayOfWeek] ?? swap.dayOfWeek}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <User className="w-3 h-3" />
                      <span>{swap.requesterName}</span>
                      {swap.reason && <span>· "{swap.reason}"</span>}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 text-xs border-orange-300"
                    disabled={accepting === swap.requestId}
                    onClick={() => handleAccept(swap.requestId)}
                  >
                    {accepting === swap.requestId ? '…' : 'Pick Up'}
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
