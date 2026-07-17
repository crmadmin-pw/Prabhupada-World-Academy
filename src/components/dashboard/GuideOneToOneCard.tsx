import { useEffect, useState } from 'react';
import { getMyGuideOneToOne } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { ExternalLink, User, CalendarClock, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface OneToOneData {
  hidden?: boolean;
  isDelegated?: boolean;
  guideName: string | null;
  guideLink: string | null;
  lastMeetingDate: string | null;
  lastMeetingWeeksAgo: number | null;
  durationMinutes: number | null;
}

function urgencyClass(weeksAgo: number | null): string {
  if (weeksAgo === null) return 'border-destructive/60 bg-destructive/5';
  if (weeksAgo <= 1) return 'border-green-500/60 bg-green-500/5';
  if (weeksAgo <= 2) return 'border-amber-500/60 bg-amber-500/5';
  return 'border-destructive/60 bg-destructive/5';
}

function urgencyDot(weeksAgo: number | null): string {
  if (weeksAgo === null) return 'bg-destructive';
  if (weeksAgo <= 1) return 'bg-green-500';
  if (weeksAgo <= 2) return 'bg-amber-500';
  return 'bg-destructive';
}

function lastMeetingLabel(weeksAgo: number | null, lastMeetingDate: string | null): string {
  if (weeksAgo === null || !lastMeetingDate) return "You haven't had a 1:1 yet — schedule one today!";
  if (weeksAgo === 0) return `Last 1:1 this week`;
  if (weeksAgo === 1) return `Last 1:1 last week`;
  try {
    const formatted = format(parseISO(lastMeetingDate), 'MMM d');
    return `Last 1:1: ${formatted} (${weeksAgo} week${weeksAgo !== 1 ? 's' : ''} ago)`;
  } catch {
    return `Last 1:1: ${weeksAgo} week${weeksAgo !== 1 ? 's' : ''} ago`;
  }
}

export default function GuideOneToOneCard() {
  const [data, setData] = useState<OneToOneData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMyGuideOneToOne({})
      .then(r => setData(r as OneToOneData))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Hide while loading, if hidden flag set, or no guide name
  if (loading || !data || data.hidden || !data.guideName) return null;

  const { guideName, guideLink, lastMeetingDate, lastMeetingWeeksAgo, isDelegated } = data;
  const urgent = lastMeetingWeeksAgo === null || lastMeetingWeeksAgo >= 3;
  const firstName = guideName?.split(' ')[0] || '';

  return (
    <div className={`rounded-lg border-2 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 transition-all ${urgencyClass(lastMeetingWeeksAgo)}`}>
      {/* Guide/BVSL info */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <span className={`w-2 h-2 rounded-full shrink-0 ${urgencyDot(lastMeetingWeeksAgo)}`} />
        <div className="flex items-center gap-1.5 text-sm font-medium shrink-0">
          <User className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">{isDelegated ? '1:1 with:' : 'Guide:'}</span>
          <span className="font-semibold">{guideName}</span>
          {isDelegated && (
            <span className="text-[10px] text-blue-600 bg-blue-50 border border-blue-200 px-1 rounded font-normal">via guide</span>
          )}
        </div>
        <span className="text-muted-foreground/40 hidden sm:inline">·</span>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0">
          <CalendarClock className="w-3.5 h-3.5 shrink-0" />
          <span className={urgent ? 'font-medium text-destructive' : ''}>
            {lastMeetingLabel(lastMeetingWeeksAgo, lastMeetingDate)}
          </span>
        </div>
      </div>

      {/* CTA */}
      <div className="shrink-0">
        {guideLink ? (
          <Button
            size="sm"
            variant={urgent ? 'default' : 'outline'}
            className="gap-1.5 h-8 text-xs"
            onClick={() => window.open(guideLink, '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Book 1:1 with {firstName}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Contact {firstName} to schedule
          </span>
        )}
      </div>
    </div>
  );
}
