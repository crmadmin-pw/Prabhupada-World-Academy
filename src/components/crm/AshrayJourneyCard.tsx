import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BookOpen, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { format } from 'date-fns';
import type { GetUserCrmDataOutputType } from 'zite-endpoints-sdk';

type AshrayHistoryItem = GetUserCrmDataOutputType['ashrayHistory'][0];

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; dot: string; badge: string }> = {
  Passed: { icon: CheckCircle2, dot: 'bg-green-500 border-green-500', badge: 'text-green-700 bg-green-50 border-green-200' },
  Failed: { icon: XCircle, dot: 'bg-destructive border-destructive', badge: 'text-destructive bg-destructive/5 border-destructive/20' },
  Pending: { icon: Clock, dot: 'bg-amber-400 border-amber-400', badge: 'text-amber-700 bg-amber-50 border-amber-200' },
};

function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status || 'Pending';
  const cfg = STATUS_CONFIG[s] || STATUS_CONFIG.Pending;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.badge}`}>
      <Icon className="w-3 h-3" />{s}
    </span>
  );
}

export default function AshrayJourneyCard({
  ashrayHistory,
  currentLevel,
}: {
  ashrayHistory: AshrayHistoryItem[];
  currentLevel: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-amber-600" />
          Ashraya Journey
          {currentLevel && (
            <Badge variant="outline" className="ml-auto text-amber-700 bg-amber-50 border-amber-200 font-medium">
              📿 {currentLevel}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ashrayHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No upgrade requests on record yet.
          </p>
        ) : (
          <div className="relative pl-6">
            <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />
            <div className="space-y-5">
              {ashrayHistory.map((item) => {
                const cfg = STATUS_CONFIG[item.status || ''] || STATUS_CONFIG.Pending;
                return (
                  <div key={item.id} className="relative">
                    <div className={`absolute -left-4 top-1.5 w-2.5 h-2.5 rounded-full border-2 ${cfg.dot}`} />
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1.5">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">
                          {item.currentLevel || '?'} → {item.requestedLevel || '?'}
                        </div>
                        {item.reason && (
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">{item.reason}</div>
                        )}
                        {item.reviewedBy && item.status !== 'Pending' && (
                          <div className="text-xs text-muted-foreground">
                            Reviewed by: {item.reviewedBy}
                            {item.reviewedAt && (
                              <> · {format(new Date(item.reviewedAt), 'dd MMM yyyy')}</>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={item.status} />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {item.createdAt ? format(new Date(item.createdAt), 'dd MMM yyyy') : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
