import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BookOpen, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getMyBvQuizSubmissions } from 'zite-endpoints-sdk';
import type { GetMyBvQuizSubmissionsOutputType } from 'zite-endpoints-sdk';
import BvQuizTaker from './BvQuizTaker';
import { format } from 'date-fns';

interface Props {
  userId: string;
  onQuizDatesChange?: (dates: { date: string; percentage: number }[]) => void;
}

type QuizData = GetMyBvQuizSubmissionsOutputType;

export default function BvQuizSection({ userId, onQuizDatesChange }: Props) {
  const [data, setData] = useState<QuizData | null>(null);
  const [loading, setLoading] = useState(true);
  const [takingQuizId, setTakingQuizId] = useState<string | null>(null);
  const [takingQuizTitle, setTakingQuizTitle] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await getMyBvQuizSubmissions({});
      setData(r as QuizData);
      onQuizDatesChange?.(r.quizDates as { date: string; percentage: number }[]);
    } catch { toast.error('Failed to load quizzes'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [userId]);

  if (loading) return (
    <Card><CardContent className="py-4 flex justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </CardContent></Card>
  );

  // Return null when no pending quizzes — section disappears entirely
  if (!data || data.pendingQuizzes.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">BV Quizzes</h3>
        </div>
        {data.stats.totalTaken > 0 && (
          <Badge variant="outline" className="text-xs">
            Avg: {data.stats.avgPercent}%
          </Badge>
        )}
      </div>

      {/* Pending quizzes */}
      <div className="space-y-2">
        {data.pendingQuizzes.map((q: any) => (
          <Card
            key={q.id}
            className="border-l-4 border-l-primary cursor-pointer hover:shadow-sm transition-shadow"
            onClick={() => { setTakingQuizTitle(q.title); setTakingQuizId(q.id); }}
          >
            <CardContent className="py-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm">{q.title}</p>
                  <Badge className="text-xs bg-primary/10 text-primary border-primary/20">New</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {q.questionCount} questions
                  {q.createdAt ? ` · ${format(new Date(q.createdAt), 'd MMM')}` : ''}
                </p>
              </div>
              <Button size="sm" variant="default" className="shrink-0 text-xs h-8 gap-1">
                Start <ChevronRight className="w-3 h-3" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quiz Dialog popup */}
      <Dialog open={!!takingQuizId} onOpenChange={open => { if (!open) setTakingQuizId(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">{takingQuizTitle}</DialogTitle>
          </DialogHeader>
          {takingQuizId && (
            <BvQuizTaker
              quizId={takingQuizId}
              onBack={() => setTakingQuizId(null)}
              onSubmitted={() => { load(); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
