import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle2, XCircle, ChevronRight, ChevronLeft,
  Trophy, ArrowLeft, Loader2, BookOpen, Circle, CheckSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { getBvQuizDetail, submitBvQuiz } from 'zite-endpoints-sdk';
import type { GetBvQuizDetailOutputType } from 'zite-endpoints-sdk';
import { AnimatePresence, motion } from 'framer-motion';

type QuizDetail = GetBvQuizDetailOutputType;
type Question = QuizDetail['questions'][0];

interface SubmitResult {
  score: number;
  total: number;
  percentage: number;
  results: {
    questionId: string;
    selected: number[];
    correct: number[];
    isCorrect: boolean;
    explanation: string;
  }[];
}

interface Props {
  quizId: string;
  onBack: () => void;
  onSubmitted?: () => void;
}

export default function BvQuizTaker({ quizId, onBack, onSubmitted }: Props) {
  const [quiz, setQuiz] = useState<QuizDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<string, number[]>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [showReview, setShowReview] = useState(false);

  useEffect(() => {
    getBvQuizDetail({ quizId })
      .then(setQuiz)
      .catch(() => toast.error('Failed to load quiz'))
      .finally(() => setLoading(false));
  }, [quizId]);

  const currentQ = quiz?.questions[currentIndex];
  const selected = currentQ ? (answers.get(currentQ.id) || []) : [];

  const toggleOption = (idx: number) => {
    if (!currentQ || result) return;
    const current = answers.get(currentQ.id) || [];
    if (currentQ.type === 'single') {
      setAnswers(prev => new Map(prev).set(currentQ.id, [idx]));
    } else {
      const newSel = current.includes(idx)
        ? current.filter(c => c !== idx)
        : [...current, idx];
      setAnswers(prev => new Map(prev).set(currentQ.id, newSel));
    }
  };

  const handleSubmit = async () => {
    if (!quiz) return;
    const answersPayload = quiz.questions.map(q => ({
      questionId: q.id,
      selected: answers.get(q.id) || [],
    }));
    setSubmitting(true);
    try {
      const res = await submitBvQuiz({ quizId, answers: answersPayload });
      setResult(res as SubmitResult);
      onSubmitted?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to submit quiz');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  );
  if (!quiz) return null;

  // Result screen
  if (result && !showReview) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
        <Card className="text-center overflow-hidden">
          <div className={`py-8 px-6 ${result.percentage >= 70 ? 'bg-green-500' : result.percentage >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}>
            <Trophy className="w-12 h-12 text-white mx-auto mb-2" />
            <div className="text-5xl font-bold text-white">{result.percentage}%</div>
            <div className="text-white/80 mt-1 text-lg">{result.score} / {result.total} correct</div>
          </div>
          <CardContent className="pt-5 pb-5">
            <h2 className="text-xl font-bold mb-1">
              {result.percentage >= 70 ? '🎉 Well done!' : result.percentage >= 40 ? '📚 Keep learning!' : '💪 Try reviewing the material!'}
            </h2>
            <p className="text-muted-foreground text-sm mb-4">You answered {result.score} out of {result.total} questions correctly.</p>
            <Button onClick={() => setShowReview(true)} className="w-full">
              Review Answers <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // Review screen
  if (result && showReview) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setShowReview(false)}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Result
        </Button>
        <h2 className="font-semibold text-base px-1">Answer Review</h2>
        {quiz.questions.map((q, qi) => {
          const res = result.results.find(r => r.questionId === q.id);
          return (
            <ReviewQuestion key={q.id} question={q} index={qi} result={res} />
          );
        })}
        <Button onClick={onBack} className="w-full">Done</Button>
      </div>
    );
  }

  // Taking quiz
  const progress = ((currentIndex + 1) / quiz.questions.length) * 100;
  const allAnswered = quiz.questions.every(q => (answers.get(q.id) || []).length > 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
        <span className="text-sm text-muted-foreground font-medium">{currentIndex + 1} / {quiz.questions.length}</span>
      </div>

      {/* Progress */}
      <div className="space-y-1">
        <Progress value={progress} className="h-1.5" />
        <p className="text-xs text-muted-foreground font-semibold truncate">{quiz.title}</p>
      </div>

      {/* Question */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.18 }}
        >
          {currentQ && (
            <Card>
              <CardContent className="pt-5 pb-5 space-y-4">
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="text-xs shrink-0 mt-0.5">Q{currentIndex + 1}</Badge>
                  <p className="font-medium text-base leading-snug">{currentQ.text}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {currentQ.type === 'single' ? 'Choose one answer' : 'Choose all that apply'}
                </p>
                <div className="space-y-2">
                  {currentQ.options.map((opt, idx) => {
                    const isSelected = selected.includes(idx);
                    return (
                      <button
                        key={idx}
                        onClick={() => toggleOption(idx)}
                        className={`w-full flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all ${
                          isSelected
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border hover:border-muted-foreground/40'
                        }`}
                      >
                        <span className={`shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}>
                          {currentQ.type === 'single'
                            ? (isSelected ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />)
                            : (isSelected ? <CheckSquare className="w-5 h-5" /> : <Circle className="w-5 h-5" />)
                          }
                        </span>
                        <span className="text-sm flex-1">{opt}</span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={currentIndex === 0}
          onClick={() => setCurrentIndex(i => i - 1)}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        <div className="flex gap-1.5 flex-1 justify-center flex-wrap">
          {quiz.questions.map((q, i) => (
            <button
              key={i}
              onClick={() => setCurrentIndex(i)}
              className={`w-7 h-7 rounded-full text-xs font-medium transition-colors ${
                i === currentIndex
                  ? 'bg-primary text-primary-foreground'
                  : (answers.get(q.id) || []).length > 0
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        {currentIndex < quiz.questions.length - 1 ? (
          <Button
            size="sm"
            onClick={() => setCurrentIndex(i => i + 1)}
          >
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!allAnswered || submitting}
            onClick={handleSubmit}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Submit
          </Button>
        )}
      </div>
      {!allAnswered && currentIndex === quiz.questions.length - 1 && (
        <p className="text-xs text-center text-muted-foreground">Answer all questions to submit</p>
      )}
    </div>
  );
}

// --- Review Question Component ---
function ReviewQuestion({ question, index, result }: {
  question: Question;
  index: number;
  result?: SubmitResult['results'][0];
}) {
  return (
    <Card className={`border-l-4 ${result?.isCorrect ? 'border-l-green-400' : 'border-l-red-400'}`}>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-start gap-2">
          <span className={`shrink-0 mt-0.5 ${result?.isCorrect ? 'text-green-500' : 'text-red-500'}`}>
            {result?.isCorrect ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
          </span>
          <div className="flex-1">
            <p className="font-medium text-sm">{question.text}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          {question.options.map((opt, idx) => {
            const isSelected = result?.selected.includes(idx);
            const isCorrect = result?.correct.includes(idx);
            let style = 'border-border text-foreground/70';
            if (isCorrect && isSelected) style = 'border-green-400 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300';
            else if (isCorrect && !isSelected) style = 'border-green-300 bg-green-50/60 dark:bg-green-950/20 text-green-600 dark:text-green-400';
            else if (!isCorrect && isSelected) style = 'border-red-400 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400';

            return (
              <div key={idx} className={`flex items-center gap-2 p-2.5 rounded-lg border-2 text-sm transition-colors ${style}`}>
                {isCorrect && isSelected && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
                {isCorrect && !isSelected && <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />}
                {!isCorrect && isSelected && <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                {!isCorrect && !isSelected && <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />}
                <span className="flex-1">{opt}</span>
                {isCorrect && !isSelected && <Badge variant="outline" className="text-xs text-green-600 border-green-400 shrink-0">Correct</Badge>}
              </div>
            );
          })}
        </div>

        {result?.explanation && (
          <div className="bg-muted/50 rounded-lg p-3 flex gap-2">
            <BookOpen className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">{result.explanation}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
