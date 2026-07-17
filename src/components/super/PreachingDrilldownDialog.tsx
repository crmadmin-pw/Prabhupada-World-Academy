import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { getPreachingDrilldown, GetPreachingDrilldownOutputType } from 'zite-endpoints-sdk';

type UserItem = GetPreachingDrilldownOutputType['users'][0];

const DETAIL_LABELS: Record<string, string> = {
  'Avg Hours Preaching': 'Hours',
  'No of Meetings': 'Meetings',
  'BV Groups Attendance': 'Group / Sessions',
  'Books Distributed': 'Books',
  'No of BV Groups': 'BVSL Leader',
  'Boys Chanting 16 Rounds': 'Avg Rounds',
};

const NAME_LABEL: Record<string, string> = {
  'No of BV Groups': 'Group Name',
};

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  metricKey: string;
  centerId: string;
  weekLabel?: string;
  startDate: string;
  endDate: string;
}

export default function PreachingDrilldownDialog({
  open, onClose, title, metricKey, centerId, weekLabel, startDate, endDate,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserItem[]>([]);

  const detailLabel = DETAIL_LABELS[metricKey] || '';
  const nameLabel = NAME_LABEL[metricKey] || 'Name';
  const isGroups = metricKey === 'No of BV Groups';

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setUsers([]);
    getPreachingDrilldown({ metricKey, centerId, weekLabel, startDate, endDate })
      .then(res => setUsers(res.users))
      .catch(() => toast.error('Failed to load details'))
      .finally(() => setLoading(false));
  }, [open, metricKey, centerId, weekLabel, startDate, endDate]);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold leading-snug pr-6">{title}</DialogTitle>
          <DialogDescription className="text-xs">
            {loading ? 'Loading…' : `${users.length} ${isGroups ? 'groups' : 'people'}`}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 min-h-0 -mx-6 px-6">
          {loading ? (
            <div className="space-y-2 py-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-2 text-muted-foreground">
              <Users className="w-8 h-8 opacity-30" />
              <p className="text-sm">No data found for this selection</p>
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border sticky top-0 bg-background z-10">
                  <th className="text-left py-2.5 px-2 font-medium text-muted-foreground w-8">#</th>
                  <th className="text-left py-2.5 px-2 font-medium text-muted-foreground">{nameLabel}</th>
                  <th className="text-left py-2.5 px-2 font-medium text-muted-foreground">
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" />Phone</span>
                  </th>
                  {detailLabel && (
                    <th className="text-left py-2.5 px-2 font-medium text-muted-foreground">{detailLabel}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={`${u.userId}-${i}`} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                    <td className="py-2 px-2 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 px-2 font-medium">{u.fullName || '—'}</td>
                    <td className="py-2 px-2 text-muted-foreground font-mono">
                      {u.phone ? (
                        <a href={`tel:${u.phone}`} className="hover:text-primary hover:underline">{u.phone}</a>
                      ) : '—'}
                    </td>
                    {detailLabel && (
                      <td className="py-2 px-2 text-muted-foreground">{u.detail || '—'}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
