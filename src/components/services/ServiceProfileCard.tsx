import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronUp, Star, Flame, CheckCircle2 } from 'lucide-react';
import { getServiceProfile } from 'zite-endpoints-sdk';
import type { GetServiceProfileOutputType } from 'zite-endpoints-sdk';

interface Props { userId?: string; }

export default function ServiceProfileCard({ userId }: Props) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<GetServiceProfileOutputType | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && !profile) load();
  }, [open]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getServiceProfile({ userId });
      setProfile(res);
    } catch {}
    finally { setLoading(false); }
  };

  const scoreColor = (score: number) =>
    score >= 90 ? 'text-green-600' : score >= 70 ? 'text-yellow-600' : 'text-destructive';

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Star className="w-4 h-4 text-primary" />My Service Profile</span>
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {loading ? (
              <p className="text-xs text-muted-foreground text-center py-3">Loading…</p>
            ) : profile ? (
              <div className="space-y-4">
                {/* Key stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center rounded-lg bg-muted/50 py-3">
                    <p className={`text-2xl font-bold ${scoreColor(profile.reliabilityScore)}`}>{profile.reliabilityScore}%</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Reliability</p>
                  </div>
                  <div className="text-center rounded-lg bg-muted/50 py-3">
                    <p className="text-2xl font-bold flex items-center justify-center gap-1">
                      <Flame className="w-5 h-5 text-orange-500" />{profile.currentStreak}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Week streak</p>
                  </div>
                  <div className="text-center rounded-lg bg-muted/50 py-3">
                    <p className="text-2xl font-bold flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-5 h-5 text-green-500" />{profile.totalCompleted}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Completed</p>
                  </div>
                </div>

                {/* Monthly breakdown */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Monthly</p>
                  {profile.monthlyBreakdown.map(m => (
                    <div key={m.month} className="flex items-center gap-3">
                      <span className="text-xs w-20 shrink-0 text-muted-foreground">{m.month}</span>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: m.total > 0 ? `${Math.round((m.completed / m.total) * 100)}%` : '0%' }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right">{m.completed}/{m.total}</span>
                    </div>
                  ))}
                </div>

                {/* Skills */}
                {profile.skills.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Skills</p>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.skills.map(s => (
                        <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
