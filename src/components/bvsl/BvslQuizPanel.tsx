import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import GroupSelect from '@/components/bvsl/GroupSelect';
import {
  Plus, Trash2, CheckCircle2, Circle, ChevronDown, ChevronUp,
  BookOpen, ArrowLeft, BarChart2, Users, Loader2, GripVertical, FileDown, Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  createBvQuiz,
  deleteBvQuiz,
  getBvQuizDetail,
  getBvQuizzes,
  getBvQuizSubmissions,
} from '@/lib/endpoints-sdk';
import type { GetBvQuizzesOutputType } from '@/lib/endpoints-sdk';
import { useEffect } from 'react';
import { format } from 'date-fns';

// --- Types ---
interface QuizQuestion {
  id: string;
  text: string;
  type: 'single' | 'multiple';
  options: string[];
  correctAnswers: number[];
  explanation: string;
}

interface Props {
  groups: { id: string; groupName: string }[];
}

type QuizListItem = GetBvQuizzesOutputType['quizzes'][0];
type EditableQuiz = {
  id: string;
  title?: string;
  description?: string;
  isActive?: boolean;
  quizDate?: string;
};

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyQuestion(): QuizQuestion {
  return {
    id: generateId(),
    text: '',
    type: 'single',
    options: ['', ''],
    correctAnswers: [],
    explanation: '',
  };
}

// --- Quiz Editor ---
export function QuizEditor({
  groupId,
  editingQuiz,
  department = 'FOLK',
  onSaved,
  onCancel,
}: {
  groupId?: string;
  editingQuiz: EditableQuiz | null;
  department?: 'FOLK' | 'PW';
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(editingQuiz?.title || 'Untitled Quiz');
  const [description, setDescription] = useState(editingQuiz?.description || '');
  const [isActive, setIsActive] = useState(editingQuiz?.isActive ?? true);
  const [quizDate, setQuizDate] = useState(() => {
    if (editingQuiz?.quizDate) return editingQuiz.quizDate;
    return format(new Date(), 'yyyy-MM-dd');
  });
  const [questions, setQuestions] = useState<QuizQuestion[]>(() => {
    // We don't have questions in list view, start fresh or load from detail
    return [emptyQuestion()];
  });
  const [saving, setSaving] = useState(false);
  const [loadingQuiz, setLoadingQuiz] = useState(!!editingQuiz);
  const [loadError, setLoadError] = useState('');
  const [expandedQ, setExpandedQ] = useState<string>(questions[0]?.id || '');

  useEffect(() => {
    if (!editingQuiz) return;
    getBvQuizDetail({ quizId: editingQuiz.id, department, includeAnswers: true })
      .then((quiz: any) => {
        setTitle(quiz.title || 'Untitled Quiz');
        setDescription(quiz.description || '');
        setIsActive(quiz.isActive === true);
        setQuizDate(quiz.quizDate || format(new Date(), 'yyyy-MM-dd'));
        const loadedQuestions = (quiz.questions || []).map((question: any) => ({
          id: question.id || generateId(),
          text: question.text || '',
          type: question.type === 'multiple' ? 'multiple' : 'single',
          options: Array.isArray(question.options) ? question.options : ['', ''],
          correctAnswers: Array.isArray(question.correctAnswers) ? question.correctAnswers : [],
          explanation: question.explanation || '',
        }));
        setQuestions(loadedQuestions.length ? loadedQuestions : [emptyQuestion()]);
        setExpandedQ(loadedQuestions[0]?.id || '');
      })
      .catch((error: any) => {
        const message = error.message || 'Failed to load quiz for editing';
        setLoadError(message);
        toast.error(message);
      })
      .finally(() => setLoadingQuiz(false));
  }, [department, editingQuiz?.id]);

  const addQuestion = () => {
    const q = emptyQuestion();
    setQuestions(prev => [...prev, q]);
    setExpandedQ(q.id);
  };

  const removeQuestion = (id: string) => {
    setQuestions(prev => prev.filter(q => q.id !== id));
  };

  const updateQuestion = (id: string, patch: Partial<QuizQuestion>) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, ...patch } : q));
  };

  const addOption = (qId: string) => {
    updateQuestion(qId, {
      options: [...(questions.find(q => q.id === qId)?.options || []), ''],
    });
  };

  const updateOption = (qId: string, idx: number, val: string) => {
    const q = questions.find(q => q.id === qId);
    if (!q) return;
    const opts = [...q.options];
    opts[idx] = val;
    updateQuestion(qId, { options: opts });
  };

  const removeOption = (qId: string, idx: number) => {
    const q = questions.find(q => q.id === qId);
    if (!q || q.options.length <= 2) return;
    const opts = q.options.filter((_, i) => i !== idx);
    const correct = q.correctAnswers.filter(c => c !== idx).map(c => c > idx ? c - 1 : c);
    updateQuestion(qId, { options: opts, correctAnswers: correct });
  };

  const toggleCorrect = (qId: string, idx: number) => {
    const q = questions.find(q => q.id === qId);
    if (!q) return;
    if (q.type === 'single') {
      updateQuestion(qId, { correctAnswers: [idx] });
    } else {
      const already = q.correctAnswers.includes(idx);
      updateQuestion(qId, {
        correctAnswers: already ? q.correctAnswers.filter(c => c !== idx) : [...q.correctAnswers, idx],
      });
    }
  };

  const handleSave = async () => {
    if (!title.trim()) return toast.error('Quiz title is required');
    for (const q of questions) {
      if (!q.text.trim()) return toast.error('All questions must have text');
      if (q.options.some(o => !o.trim())) return toast.error('All options must be filled in');
      if (q.correctAnswers.length === 0) return toast.error('Each question must have at least one correct answer');
    }
    setSaving(true);
    try {
      await createBvQuiz({
        quizId: editingQuiz?.id,
        department,
        title,
        description,
        groupId: department === 'PW' ? undefined : (groupId || undefined),
        questions,
        isActive,
        quizDate,
      });
      toast.success(editingQuiz ? 'Quiz updated!' : 'Quiz created!');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save quiz');
    } finally {
      setSaving(false);
    }
  };

  if (loadingQuiz) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (loadError) {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="font-medium">Unable to open this quiz for editing</p>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button variant="outline" size="sm" onClick={onCancel}><ArrowLeft className="w-4 h-4 mr-1" />Back to quizzes</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="quiz-active" checked={isActive} onCheckedChange={setIsActive} />
            <Label htmlFor="quiz-active" className="text-sm">{department === 'PW' ? 'Published' : 'Active'}</Label>
          </div>
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            {editingQuiz ? 'Update Quiz' : 'Publish Quiz'}
          </Button>
        </div>
      </div>

      {/* Quiz Title & Description */}
      <Card className="border-l-4 border-l-primary">
        <CardContent className="pt-4 pb-4 space-y-3">
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Quiz title..."
            className="text-lg font-semibold border-none shadow-none px-0 focus-visible:ring-0 bg-transparent"
          />
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Description (optional)..."
            className="border-none shadow-none px-0 focus-visible:ring-0 resize-none text-sm text-muted-foreground bg-transparent"
            rows={2}
          />
        </CardContent>
      </Card>

      {/* Quiz Date */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <Label htmlFor="quiz-date" className="text-sm font-medium whitespace-nowrap">Quiz Date</Label>
            <Input
              id="quiz-date"
              type="date"
              value={quizDate}
              onChange={e => setQuizDate(e.target.value)}
              className="h-8 w-auto text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Questions */}
      {questions.map((q, qi) => (
        <QuestionCard
          key={q.id}
          question={q}
          index={qi}
          isExpanded={expandedQ === q.id}
          onToggle={() => setExpandedQ(prev => prev === q.id ? '' : q.id)}
          onUpdate={patch => updateQuestion(q.id, patch)}
          onAddOption={() => addOption(q.id)}
          onUpdateOption={(idx, val) => updateOption(q.id, idx, val)}
          onRemoveOption={idx => removeOption(q.id, idx)}
          onToggleCorrect={idx => toggleCorrect(q.id, idx)}
          onRemove={questions.length > 1 ? () => removeQuestion(q.id) : undefined}
        />
      ))}

      {/* Add Question */}
      <button
        onClick={addQuestion}
        className="w-full border-2 border-dashed border-border rounded-xl py-4 flex items-center justify-center gap-2 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
      >
        <Plus className="w-5 h-5" />
        <span className="font-medium">Add Question</span>
      </button>
    </div>
  );
}

// --- Question Card ---
function QuestionCard({
  question, index, isExpanded, onToggle, onUpdate,
  onAddOption, onUpdateOption, onRemoveOption, onToggleCorrect, onRemove,
}: {
  question: QuizQuestion;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<QuizQuestion>) => void;
  onAddOption: () => void;
  onUpdateOption: (idx: number, val: string) => void;
  onRemoveOption: (idx: number) => void;
  onToggleCorrect: (idx: number) => void;
  onRemove?: () => void;
}) {
  return (
    <Card className={`transition-shadow ${isExpanded ? 'shadow-md' : ''}`}>
      <CardContent className="pt-3 pb-3">
        {/* Collapsed header */}
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={onToggle}
        >
          <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground font-medium shrink-0 w-6">Q{index + 1}</span>
          <span className={`flex-1 text-sm truncate ${!question.text ? 'text-muted-foreground italic' : ''}`}>
            {question.text || 'Untitled Question'}
          </span>
          <Badge variant="outline" className="text-xs shrink-0">
            {question.type === 'single' ? 'Single' : 'Multiple'}
          </Badge>
          {question.correctAnswers.length > 0 && (
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
          )}
          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="mt-4 space-y-4">
            {/* Question text */}
            <Textarea
              value={question.text}
              onChange={e => onUpdate({ text: e.target.value })}
              placeholder="Question text..."
              className="text-sm font-medium resize-none"
              rows={2}
            />

            {/* Type toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => onUpdate({ type: 'single', correctAnswers: [] })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${question.type === 'single' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary'}`}
              >
                <Circle className="w-3 h-3" /> Single answer
              </button>
              <button
                onClick={() => onUpdate({ type: 'multiple', correctAnswers: [] })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${question.type === 'multiple' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary'}`}
              >
                <CheckCircle2 className="w-3 h-3" /> Multiple answers
              </button>
            </div>

            {/* Options */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Options — click ✓ to mark correct answer(s)</p>
              {question.options.map((opt, idx) => {
                const isCorrect = question.correctAnswers.includes(idx);
                return (
                  <div key={idx} className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${isCorrect ? 'border-green-400 bg-green-50 dark:bg-green-950/30' : 'border-border'}`}>
                    <button
                      onClick={() => onToggleCorrect(idx)}
                      className={`shrink-0 transition-colors ${isCorrect ? 'text-green-500' : 'text-muted-foreground hover:text-green-400'}`}
                    >
                      {isCorrect ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                    </button>
                    <Input
                      value={opt}
                      onChange={e => onUpdateOption(idx, e.target.value)}
                      placeholder={`Option ${idx + 1}...`}
                      className="h-8 border-none shadow-none focus-visible:ring-0 bg-transparent text-sm flex-1 px-0"
                    />
                    {question.options.length > 2 && (
                      <button onClick={() => onRemoveOption(idx)} className="shrink-0 text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                onClick={onAddOption}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors mt-1"
              >
                <Plus className="w-4 h-4" /> Add option
              </button>
            </div>

            {/* Explanation */}
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-1">Explanation (shown after submit)</p>
              <Textarea
                value={question.explanation}
                onChange={e => onUpdate({ explanation: e.target.value })}
                placeholder="Explain the correct answer... (optional)"
                className="text-sm resize-none"
                rows={2}
              />
            </div>

            {/* Remove */}
            {onRemove && (
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" className="text-destructive h-7 text-xs" onClick={onRemove}>
                  <Trash2 className="w-3 h-3 mr-1" /> Remove Question
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Quiz Result Panel ---
export function QuizResultsPanel({
  quiz,
  groupId,
  department = 'FOLK',
  onBack,
}: {
  quiz: EditableQuiz & { title: string };
  groupId?: string;
  department?: 'FOLK' | 'PW';
  onBack: () => void;
}) {
  const [subs, setSubs] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadResults = useReactiveLoader(async (read, silent = false) => {
    if (!silent) !read.background && setLoading(true);
    try {
      const result = await read(() => getBvQuizSubmissions({ quizId: quiz.id, department, groupId }));
      setSubs(result.submissions);
      setAnalytics(result.analytics);
    } catch {
      if (read.cancelled) return;
      if (!silent) toast.error('Failed to load submissions');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [department, groupId, quiz.id]);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);


  const handleExportCsv = () => {
    if (subs.length === 0) return toast.error('No submissions to export');
    const headers = ['Name', 'Group', 'Score', 'Total Questions', 'Percentage', 'Submitted At'];
    const rows = subs.map(s => [
      s.userName,
      s.groupName,
      String(s.score),
      String(s.totalQuestions),
      `${s.percentage}%`,
      s.submittedAt ? format(new Date(s.submittedAt), 'dd MMM yyyy, h:mm a') : '',
    ]);
    const csvCell = (value: unknown) => {
      const text = String(value ?? '');
      const formulaSafe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return `"${formulaSafe.replace(/"/g, '""')}"`;
    };
    const csvContent = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${quiz.title.replace(/\s+/g, '-')}-results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <h2 className="font-semibold text-sm">{quiz.title} — Results</h2>
        </div>
        <Button size="sm" variant="outline" onClick={handleExportCsv} disabled={loading || subs.length === 0}>
          <FileDown className="w-3.5 h-3.5 mr-1" />Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-3 pb-3 text-center">
          <div className="text-2xl font-bold">{subs.length}</div>
          <div className="text-xs text-muted-foreground">Submissions</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <div className="text-2xl font-bold text-primary">
            {analytics?.averagePercentage ?? (subs.length > 0 ? Math.round(subs.reduce((s, r) => s + r.percentage, 0) / subs.length) : 0)}%
          </div>
          <div className="text-xs text-muted-foreground">Avg Score</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <div className="text-2xl font-bold text-green-500">
            {analytics?.passingCount ?? subs.filter(s => s.percentage >= 70).length}
          </div>
          <div className="text-xs text-muted-foreground">≥70%</div>
        </CardContent></Card>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : subs.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">No submissions yet</div>
      ) : (
        <div className="space-y-2">
          {subs.map(s => (
            <Card key={s.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{s.userName}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.submittedAt ? format(new Date(s.submittedAt), 'd MMM, h:mm a') : ''}
                  </p>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-bold ${s.percentage >= 70 ? 'text-green-500' : s.percentage >= 40 ? 'text-yellow-500' : 'text-red-500'}`}>
                    {s.percentage}%
                  </div>
                  <div className="text-xs text-muted-foreground">{s.score}/{s.totalQuestions}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && (analytics?.questionAnalytics || []).length > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold text-sm">Question-wise Analysis</h3>
            <p className="text-xs text-muted-foreground">Accuracy and option selection across the visible submissions.</p>
          </div>
          {(analytics.questionAnalytics as any[]).map((question, index) => (
            <Card key={question.questionId}>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium"><span className="text-muted-foreground mr-1">Q{index + 1}.</span>{question.questionText}</p>
                  <Badge variant="outline" className="shrink-0">{question.correctPercentage}% correct</Badge>
                </div>
                <div className="space-y-1.5">
                  {(question.options || []).map((option: string, optionIndex: number) => {
                    const count = question.optionCounts?.[optionIndex] || 0;
                    const percentage = question.responses ? Math.round((count / question.responses) * 100) : 0;
                    return (
                      <div key={optionIndex} className="flex items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate">{option}</span>
                        <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${percentage}%` }} />
                        </div>
                        <span className="w-12 text-right text-muted-foreground">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main Panel ---
export default function BvslQuizPanel({
  groups,
}: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState(() => groups[0]?.id || '');
  const [quizzes, setQuizzes] = useState<QuizListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [permissions, setPermissions] = useState<any>(null);
  const [view, setView] = useState<'list' | 'create' | 'results'>('list');
  const [editingQuiz, setEditingQuiz] = useState<QuizListItem | null>(null);
  const [viewingQuiz, setViewingQuiz] = useState<QuizListItem | null>(null);

  const loadQuizzes = useReactiveLoader(async (read, gId: string, silent = false) => {
    if (!gId) return;
    if (!silent) !read.background && setLoading(true);
    try {
      const r = await read(() => getBvQuizzes({
        department: 'FOLK',
        groupId: gId,
      }));
      setQuizzes(r.quizzes);
      setPermissions(r.permissions);
    } catch {
      if (read.cancelled) return; toast.error('Failed to load quizzes'); }
    finally { if (!silent) setLoading(false); }
  }, []);

  useEffect(() => {
    if (selectedGroupId) loadQuizzes(selectedGroupId);
  }, [selectedGroupId, loadQuizzes]);


  const handleDelete = async (quizId: string) => {
    try {
      await deleteBvQuiz({ quizId, department: 'FOLK' });
      toast.success('Quiz deleted');
      loadQuizzes(selectedGroupId);
    } catch { toast.error('Failed to delete quiz'); }
  };

  const effectiveCanManage = permissions?.canManageContent !== false;

  if (groups.length === 0) return (
    <div className="text-center py-12 text-muted-foreground">
      <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="font-medium">No groups found</p>
      <p className="text-sm mt-1">Create a BV group first to add quizzes.</p>
    </div>
  );

  if (view === 'create') {
    return (
      <QuizEditor
        groupId={selectedGroupId}
        editingQuiz={editingQuiz}
        onCancel={() => { setView('list'); setEditingQuiz(null); }}
        onSaved={() => { setView('list'); setEditingQuiz(null); loadQuizzes(selectedGroupId); }}
      />
    );
  }

  if (view === 'results' && viewingQuiz) {
    return <QuizResultsPanel
      quiz={viewingQuiz}
      groupId={selectedGroupId && selectedGroupId !== 'ALL' ? selectedGroupId : undefined}
      onBack={() => { setView('list'); setViewingQuiz(null); }}
    />;
  }

  return (
    <div className="space-y-4">
      {/* Group selector + New Quiz */}
      <div className="flex items-center justify-between flex-wrap gap-3 bg-card p-3 rounded-xl border border-border/80 shadow-xs">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
              Select Reading Group:
            </span>
          </div>
          {groups.length > 0 ? (
            <GroupSelect
              groups={groups}
              selectedGroupId={selectedGroupId}
              onSelectGroup={setSelectedGroupId}
            />
          ) : (
            <span className="text-xs text-muted-foreground">No groups created yet</span>
          )}
        </div>
        {effectiveCanManage && (
          <Button size="sm" onClick={() => { setEditingQuiz(null); setView('create'); }}>
            <Plus className="w-4 h-4 mr-1" /> New Quiz
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : quizzes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No quizzes yet</p>
          <p className="text-sm mt-1">
            {effectiveCanManage ? 'Create your first quiz' : 'An Admin has not published any quizzes yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {quizzes.map(q => (
            <Card key={q.id} className={`border-l-4 ${q.isActive ? 'border-l-green-400' : 'border-l-muted'}`}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm truncate">{q.title}</span>
                      <Badge
                        variant={q.isActive ? 'default' : 'outline'}
                        className="text-xs shrink-0"
                      >
                        {q.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    {q.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{q.description}</p>}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span>{q.questionCount} questions</span>
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" />{q.submissionCount} submitted</span>
                      {q.createdAt && <span>{format(new Date(q.createdAt), 'd MMM yyyy')}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs"
                      onClick={() => { setViewingQuiz(q); setView('results'); }}>
                      <BarChart2 className="w-4 h-4" />
                    </Button>
                    {effectiveCanManage && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => { setEditingQuiz(q); setView('create'); }}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Quiz?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete &quot;{q.title}&quot;. Submissions will also be removed.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(q.id)}
                                className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
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
