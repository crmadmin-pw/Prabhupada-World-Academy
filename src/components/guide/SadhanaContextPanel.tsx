import { useEffect, useState } from 'react';
import { getOneToOneContext } from 'zite-endpoints-sdk';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Flame, BookOpen, Megaphone, Users } from 'lucide-react';

interface Props { userId: string; }

interface ContextData {
  streak: number;
  ashrayLevel: string | null;
  isResident: boolean;
  weeks: { weekDate: string; scorePercent: number | null; entryCount: number; rounds: number | null; readingMins: number | null; hearingMins: number | null; preachingMins: number; books: number }[];
  bvAttendanceCount: number;
  totalPreachingMins: number;
  totalBooks: number;
  improvementAreas: string[];
}

function formatWeekShort(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function SadhanaContextPanel({ userId }: Props) {
  const [data, setData] = useState<ContextData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getOneToOneContext({ userId }).then(r => { setData(r as ContextData); setLoading(false); }).catch(() => setLoading(false));
  }, [userId]);

  if (loading) return (
    <div className="space-y-2 pt-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
  if (!data) return null;

  const scoreColors = (p: number | null) => p == null ? 'text-muted-foreground' : p >= 80 ? 'text-green-600' : p >= 60 ? 'text-amber-600' : 'text-destructive';

  return (
    <div className="space-y-3 pt-1">
      {/* Score trend */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">4-Week Score Trend</p>
        <div className="flex items-center gap-1">
          {data.weeks.map((w, i) => (
            <div key={w.weekDate} className="flex flex-col items-center flex-1">
              <span className={`text-sm font-semibold ${scoreColors(w.scorePercent)}`}>
                {w.scorePercent != null ? `${w.scorePercent}%` : '—'}
              </span>
              <span className="text-[10px] text-muted-foreground">{formatWeekShort(w.weekDate)}</span>
              {i < data.weeks.length - 1 && <span className="sr-only">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-4 gap-2">
        <div className="text-center bg-muted rounded p-2">
          <div className="flex items-center justify-center gap-1"><Flame className="h-3 w-3 text-orange-500" /><span className="text-sm font-bold">{data.streak}</span></div>
          <p className="text-[10px] text-muted-foreground">Streak</p>
        </div>
        <div className="text-center bg-muted rounded p-2">
          <div className="text-sm font-bold">{data.weeks.find(w => w.rounds != null)?.rounds ?? '—'}</div>
          <p className="text-[10px] text-muted-foreground">Rounds</p>
        </div>
        <div className="text-center bg-muted rounded p-2">
          <div className="flex items-center justify-center gap-1"><Megaphone className="h-3 w-3 text-blue-500" /><span className="text-sm font-bold">{data.totalPreachingMins}m</span></div>
          <p className="text-[10px] text-muted-foreground">Preaching</p>
        </div>
        <div className="text-center bg-muted rounded p-2">
          <div className="flex items-center justify-center gap-1"><Users className="h-3 w-3 text-purple-500" /><span className="text-sm font-bold">{data.bvAttendanceCount}</span></div>
          <p className="text-[10px] text-muted-foreground">BV Sessions</p>
        </div>
      </div>

      {/* Improvement areas */}
      {data.improvementAreas.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">💬 Areas for Discussion</p>
          <div className="flex flex-wrap gap-1">
            {data.improvementAreas.map(area => (
              <Badge key={area} variant="outline" className="text-xs border-amber-400 text-amber-700 bg-amber-50">{area}</Badge>
            ))}
          </div>
        </div>
      )}
      {data.totalBooks > 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <BookOpen className="h-3 w-3" /> {data.totalBooks} book(s) distributed in last 4 weeks
        </p>
      )}
    </div>
  );
}
