import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle, XCircle, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { getPendingBvJoinRequests, approveBvJoinRequest } from 'zite-endpoints-sdk';
import type { GetPendingBvJoinRequestsOutputType } from 'zite-endpoints-sdk';
import { format } from 'date-fns';

type Request = GetPendingBvJoinRequestsOutputType['requests'][0];

interface Props {
  bvslId: string;
  onRefresh?: () => void;
}

export default function BvslJoinRequestsPanel({ bvslId, onRefresh }: Props) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => { loadRequests(); }, [bvslId]);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const res = await getPendingBvJoinRequests({ bvslId } as any);
      setRequests(res.requests);
    } catch { toast.error('Failed to load join requests'); }
    finally { setLoading(false); }
  };

  const handleDecision = async (req: Request, action: 'approve' | 'reject') => {
    setProcessing(req.logId);
    try {
      await approveBvJoinRequest({ logId: req.logId, action } as any);
      toast.success(action === 'approve' ? `${req.userName} added to ${req.groupName}` : 'Request rejected');
      setRequests(prev => prev.filter(r => r.logId !== req.logId));
      onRefresh?.();
    } catch { toast.error('Failed to process request'); }
    finally { setProcessing(null); }
  };

  if (loading) return <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <UserPlus className="w-5 h-5" />Join Requests
        {requests.length > 0 && <Badge className="bg-orange-500">{requests.length}</Badge>}
      </h3>

      {requests.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          <UserPlus className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>No pending join requests</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {requests.map(req => (
            <Card key={req.logId}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{req.userName}</p>
                    {req.userPhone && <p className="text-sm text-muted-foreground">{req.userPhone}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">{req.groupName}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {req.requestedAt ? format(new Date(req.requestedAt), 'MMM d, yyyy') : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" className="text-red-600 border-red-200"
                      disabled={processing === req.logId}
                      onClick={() => handleDecision(req, 'reject')}>
                      <XCircle className="w-4 h-4" />
                    </Button>
                    <Button size="sm" className="bg-green-600 hover:bg-green-700"
                      disabled={processing === req.logId}
                      onClick={() => handleDecision(req, 'approve')}>
                      <CheckCircle className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
