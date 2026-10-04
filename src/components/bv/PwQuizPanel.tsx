import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import GroupSelect from '@/components/bvsl/GroupSelect';
import { QuizEditor, QuizResultsPanel } from '@/components/bvsl/BvslQuizPanel';
import { BarChart2, BookOpen, Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { deleteBvQuiz, getBvQuizzes, setBvQuizGroupActive } from '@/lib/endpoints-sdk';
import { format } from 'date-fns';

type QuizListItem = {
  id: string;
  title: string;
  description: string;
  isActive: boolean;
  isActiveForGroup: boolean;
  questionCount: number;
  submissionCount: number;
  createdAt: string;
  quizDate?: string;
};

type QuizGroup = { id: string; groupName: string };

export default function PwQuizPanel({ mode }: { mode: 'admin' | 'facilitator' }) {
  const [groups, setGroups] = useState<QuizGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(mode === 'admin' ? 'ALL' : '');
  const [quizzes, setQuizzes] = useState<QuizListItem[]>([]);
  const [canManageContent, setCanManageContent] = useState(mode === 'admin');
  const [canToggleGroups, setCanToggleGroups] = useState(false);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState('');
  const [view, setView] = useState<'list' | 'edit' | 'results'>('list');
  const [editingQuiz, setEditingQuiz] = useState<QuizListItem | null>(null);
  const [viewingQuiz, setViewingQuiz] = useState<QuizListItem | null>(null);

  const loadQuizzes = useReactiveLoader(async (read, groupId?: string) => {
    !read.background && setLoading(true);
    try {
      const result = await read(() => getBvQuizzes({
        department: 'PW',
        groupId: groupId || undefined,
      }));
      const nextGroups = (result.groups || []) as QuizGroup[];
      setGroups(nextGroups);
      setSelectedGroupId(current => {
        if (mode === 'admin') return current || 'ALL';
        if (current && nextGroups.some(group => group.id === current)) return current;
        return nextGroups[0]?.id || '';
      });
      setQuizzes((result.quizzes || []) as QuizListItem[]);
      setCanManageContent(!!result.permissions?.canManageContent);
      setCanToggleGroups(!!result.permissions?.canToggleGroups);
    } catch (error: any) {
      if (read.cancelled) return;
      toast.error(error?.message || 'Failed to load quizzes');
    } finally {
      if (!read.cancelled) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const groupId = selectedGroupId && selectedGroupId !== 'ALL' ? selectedGroupId : undefined;
    void loadQuizzes(groupId);
  }, [loadQuizzes, selectedGroupId]);

  const toggleGroup = async (quiz: QuizListItem, active: boolean) => {
    if (!selectedGroupId) return toast.error('Select a reading group first');
    setTogglingId(quiz.id);
    try {
      await setBvQuizGroupActive({ quizId: quiz.id, groupId: selectedGroupId, active });
      toast.success(active ? 'Quiz turned on for this group' : 'Quiz turned off for this group');
      await loadQuizzes(selectedGroupId);
    } catch (error: any) {
      toast.error(error?.message || 'Could not update this group');
    } finally {
      setTogglingId('');
    }
  };

  const handleDelete = async (quizId: string) => {
    try {
      await deleteBvQuiz({ quizId, department: 'PW' });
      toast.success('Quiz deleted');
      await loadQuizzes(selectedGroupId || undefined);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete quiz');
    }
  };

  if (view === 'edit') {
    return (
      <QuizEditor
        department="PW"
        editingQuiz={editingQuiz}
        onCancel={() => { setView('list'); setEditingQuiz(null); }}
        onSaved={() => {
          setView('list');
          setEditingQuiz(null);
          const groupId = selectedGroupId && selectedGroupId !== 'ALL' ? selectedGroupId : undefined;
          void loadQuizzes(groupId);
        }}
      />
    );
  }

  if (view === 'results' && viewingQuiz) {
    return (
      <QuizResultsPanel
        quiz={viewingQuiz}
        department="PW"
        groupId={selectedGroupId && selectedGroupId !== 'ALL' ? selectedGroupId : undefined}
        onBack={() => { setView('list'); setViewingQuiz(null); }}
      />
    );
  }

  const selectedGroup = groups.find(group => group.id === selectedGroupId);
  const groupChoices = mode === 'admin' ? [{ id: 'ALL', groupName: 'All groups' }, ...groups] : groups;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3 bg-card p-3 rounded-xl border border-border/80 shadow-xs">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider">Reading group</span>
          </div>
          {groupChoices.length > 0 ? (
            <GroupSelect groups={groupChoices} selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} />
          ) : (
            <span className="text-xs text-muted-foreground">No reading groups yet</span>
          )}
        </div>
        {canManageContent && (
          <Button size="sm" onClick={() => { setEditingQuiz(null); setView('edit'); }}>
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
            {canManageContent ? 'Create a quiz for Prabhupada World facilitators to turn on.' : 'An admin has not published any quizzes yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {quizzes.map(quiz => (
            <Card key={quiz.id} className={`border-l-4 ${quiz.isActiveForGroup ? 'border-l-green-400' : 'border-l-muted'}`}>
              <CardContent className="pt-3 pb-3 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm truncate">{quiz.title}</span>
                      <Badge variant={quiz.isActive ? 'default' : 'outline'} className="text-xs">
                        {quiz.isActive ? 'Published' : 'Unpublished'}
                      </Badge>
                      {selectedGroup && (
                        <Badge variant="outline" className="text-xs">
                          {quiz.isActiveForGroup ? 'On for this group' : 'Off for this group'}
                        </Badge>
                      )}
                    </div>
                    {quiz.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{quiz.description}</p>}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span>{quiz.questionCount} questions</span>
                      <span>{quiz.submissionCount} submitted</span>
                      {quiz.createdAt && <span>{format(new Date(quiz.createdAt), 'd MMM yyyy')}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => { setViewingQuiz(quiz); setView('results'); }}>
                      <BarChart2 className="w-4 h-4" />
                    </Button>
                    {canManageContent && (
                      <>
                        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => { setEditingQuiz(quiz); setView('edit'); }}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive"><Trash2 className="w-4 h-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete quiz?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This permanently deletes “{quiz.title}” and its submissions.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(quiz.id)} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </div>
                </div>
                {canToggleGroups && selectedGroup && quiz.isActive && (
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`quiz-${quiz.id}`}
                      checked={quiz.isActiveForGroup}
                      disabled={togglingId === quiz.id}
                      onCheckedChange={checked => toggleGroup(quiz, checked)}
                    />
                    <Label htmlFor={`quiz-${quiz.id}`} className="text-sm">
                      {quiz.isActiveForGroup ? 'On' : 'Off'} for {selectedGroup.groupName}
                    </Label>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
