import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useCallback, useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BookOpen, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getMyBvQuizSubmissions } from '@/lib/endpoints-sdk';
import BvQuizTaker from './BvQuizTaker';
import { format } from 'date-fns';

interface Props {
  userId: string;
}

type PendingQuiz = {
  id: string;
  title: string;
  questionCount: number;
  createdAt?: string;
};

type QuizSubmission = {
  id: string;
  quizTitle: string;
  percentage: number;
  submittedAt?: string;
};

type QuizData = {
  pendingQuizzes: PendingQuiz[];
  submissions: QuizSubmission[];
  stats: { totalTaken: number; avgPercent: number };
};

export default function BvQuizSection({ userId }: Props) {
  const [data, setData] = useState<QuizData | null>(null);
  const [loading, setLoading] = useState(true);
  const [takingQuizId, setTakingQuizId] = useState<string | null>(null);
  const [takingQuizTitle, setTakingQuizTitle] = useState('');
  const [reviewSubmissionId, setReviewSubmissionId] = useState<string | null>(null);
  const [reviewQuizTitle, setReviewQuizTitle] = useState('');

  const load = useReactiveLoader(async (read, showLoading = true) => {
    if (showLoading) !read.background && setLoading(true);
    try {
      // Quiz publication can change from another signed-in browser. Never
      // reuse an earlier empty result when this view is reopened.
      const r = await read(() => getMyBvQuizSubmissions({ _nocache: true }));
      setData(r as QuizData);
    } catch {
      if (read.cancelled) return; toast.error('Failed to load quizzes'); }
    finally { if (showLoading) setLoading(false); }
  }, []);

  // The request settles asynchronously; this effect only starts the initial
  // synchronization for the currently authenticated member.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [userId, load]);
  // FOLK quiz publication updates are event-driven, without polling.


  // Reconcile after the user returns to this browser/app. This covers a quiz
  // toggle made while the tab was suspended, without introducing polling.
  useEffect(() => {
    if (!userId || typeof window === 'undefined') return;
    const refreshVisibleView = () => { void load(false); };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshVisibleView();
    };
    window.addEventListener('focus', refreshVisibleView);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshVisibleView);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [userId, load]);

  if (loading) return (
    <Card><CardContent className="py-4 flex justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </CardContent></Card>
  );

  if (!data || (data.pendingQuizzes.length === 0 && data.submissions.length === 0)) return null;

  const closeDialog = () => {
    setTakingQuizId(null);
    setReviewSubmissionId(null);
  };

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

      {data.pendingQuizzes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ready to take</p>
        {data.pendingQuizzes.map(q => (
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
      )}

      {data.submissions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Completed quizzes</p>
          {data.submissions.map(submission => (
            <Card
              key={submission.id}
              className="border-l-4 border-l-emerald-500 cursor-pointer hover:shadow-sm transition-shadow"
              onClick={() => { setReviewQuizTitle(submission.quizTitle); setReviewSubmissionId(submission.id); }}
            >
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{submission.quizTitle}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Submitted {submission.submittedAt ? format(new Date(submission.submittedAt), 'd MMM yyyy') : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">
                    {submission.percentage}%
                  </Badge>
                  <Button size="sm" variant="outline" className="text-xs h-8 gap-1">
                    Review <ChevronRight className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Quiz Dialog popup */}
      <Dialog disablePointerDismissal={!!takingQuizId} open={!!takingQuizId || !!reviewSubmissionId} onOpenChange={open => { if (!open) closeDialog(); }}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-4xl max-h-[92vh] overflow-hidden p-0">
          <div className="min-w-0 max-h-[92vh] overflow-y-auto overflow-x-hidden p-5 sm:p-8">
            <DialogHeader className="border-b pb-4 mb-5">
              <DialogTitle className="min-w-0 break-words text-lg sm:text-xl leading-snug pr-8">{takingQuizTitle || reviewQuizTitle}</DialogTitle>
            </DialogHeader>
            {(takingQuizId || reviewSubmissionId) && (
              <BvQuizTaker
                key={reviewSubmissionId || takingQuizId}
                quizId={takingQuizId || ''}
                submissionId={reviewSubmissionId || undefined}
                onBack={closeDialog}
                // Do not replace this dialog with the section skeleton while
                // the result screen is being shown. Refresh the quiz list in
                // the background so the user sees their score immediately.
                onSubmitted={() => { void load(false); }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
