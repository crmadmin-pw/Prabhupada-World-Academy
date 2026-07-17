import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, CheckCircle2, XCircle, Home, MessageSquare, Camera } from 'lucide-react';
import { getUserCleanlinessCalendar } from 'zite-endpoints-sdk';
import { format } from 'date-fns';

interface DayRecord {
  id: string;
  date: string;
  score: number;
  comment: string;
  photo: string | null;
}

export default function CleanlinessCalendarTab({ userId, residencyId }: { userId: string; residencyId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null);

  useEffect(() => {
    getUserCleanlinessCalendar({ userId, residencyId }).then(res => {
      setData(res);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [userId, residencyId]);

  if (loading) {
    return <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}</div>;
  }

  const summary = data?.summary || { cleanDays: 0, totalDays: 0, percentage: 0 };
  const days: DayRecord[] = data?.days || [];
  const roomNumber = data?.roomNumber;
  const noRoom = data?.noRoom;

  if (noRoom) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4" /> Room Cleanliness
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">You are not assigned to any room yet. Please contact your guide.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4" /> Room Cleanliness
            {roomNumber && (
              <Badge variant="outline" className="text-xs gap-1 font-normal">
                <Home className="w-3 h-3" /> Room {roomNumber}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summary.totalDays === 0 ? (
            <p className="text-sm text-muted-foreground">No inspections recorded yet for your room.</p>
          ) : (
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-primary">{summary.cleanDays}</p>
                <p className="text-xs text-muted-foreground">Clean Days</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.totalDays}</p>
                <p className="text-xs text-muted-foreground">Total Days</p>
              </div>
              <div>
                <p className={`text-2xl font-bold ${summary.percentage >= 70 ? 'text-primary' : 'text-destructive'}`}>{summary.percentage}%</p>
                <p className="text-xs text-muted-foreground">Score</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily Log */}
      {days.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Inspection History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {days.map(day => (
                <div key={day.id} className="px-4 py-3 flex items-start gap-3">
                  <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    day.score === 1 ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
                  }`}>
                    {day.score === 1 ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {format(new Date(day.date + 'T12:00:00'), 'EEEE, d MMM yyyy')}
                      </span>
                      <Badge variant={day.score === 1 ? 'default' : 'destructive'} className="text-xs shrink-0">
                        {day.score === 1 ? 'Clean' : 'Not Clean'}
                      </Badge>
                    </div>
                    {day.comment && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                        <MessageSquare className="w-3 h-3 shrink-0 mt-0.5" />
                        <span>{day.comment}</span>
                      </p>
                    )}
                    {day.photo && (
                      <button onClick={() => setExpandedPhoto(expandedPhoto === day.photo ? null : day.photo)} className="mt-1.5 flex items-center gap-1 text-xs text-primary hover:underline">
                        <Camera className="w-3 h-3" /> View photo
                      </button>
                    )}
                    {expandedPhoto === day.photo && day.photo && (
                      <div className="relative mt-2 w-full h-48 bg-muted rounded-md overflow-hidden animate-pulse border">
                        <img
                          src={day.photo}
                          alt="Inspection"
                          className="w-full h-full object-cover opacity-0 transition-opacity duration-300"
                          onLoad={(e) => {
                            e.currentTarget.parentElement?.classList.remove('animate-pulse');
                            e.currentTarget.classList.remove('opacity-0');
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
