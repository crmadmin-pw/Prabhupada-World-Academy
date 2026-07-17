import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Flame, CheckCircle2, XCircle, Leaf, LogOut, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getUserBvStatus, getBvAttendance, leaveBvGroup } from 'zite-endpoints-sdk';
import { format } from 'date-fns';
import type { GetUserBvStatusOutputType, GetBvAttendanceOutputType } from 'zite-endpoints-sdk';
import BvCalendarView from '@/components/bv/BvCalendarView';
import BvLeaderboard from '@/components/dashboard/BvLeaderboard';
import BvQuizSection from '@/components/bv/BvQuizSection';

interface Props { userId: string; }

type BvStatus = GetUserBvStatusOutputType;
type BvAttendance = GetBvAttendanceOutputType;



export default function BvTab({ userId }: Props) {
  const [status, setStatus] = useState<BvStatus | null>(null);
  const [attendance, setAttendance] = useState<BvAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [leavingGroup, setLeavingGroup] = useState(false);
  const [quizDates, setQuizDates] = useState<{ date: string; percentage: number }[]>([]);

  useEffect(() => { if (userId) load(); }, [userId]);

  const load = async () => {
    setLoading(true);
    try {
      const localDate = format(new Date(), 'yyyy-MM-dd');
      const [statusRes, attendanceRes] = await Promise.all([
        getUserBvStatus({ userId, localDate }),
        getBvAttendance({ userId, localDate }),
      ]);
      setStatus(statusRes);
      setAttendance(attendanceRes);
    } catch { toast.error('Failed to load BV status'); }
    finally { setLoading(false); }
  };

  const handleLeaveGroup = async () => {
    if (!status?.myGroup) return;
    setLeavingGroup(true);
    try {
      await leaveBvGroup({ userId, groupId: status.myGroup.groupId });
      toast.success('You have left the group');
      load();
    } catch { toast.error('Failed to leave group'); }
    finally { setLeavingGroup(false); }
  };


  if (loading) return (
    <div className="space-y-3">
      <Skeleton className="h-20" />
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );

  if (!status) return null;

  const attendanceRate = status.totalSessions > 0
    ? Math.round((status.presentCount / status.totalSessions) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* BV Quizzes — at top when in group */}
      {status.myGroup && (
        <BvQuizSection userId={userId} onQuizDatesChange={setQuizDates} />
      )}

      {/* Group Status */}
      {status.myGroup ? (
        <Card className="border-l-4 border-l-primary">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <Leaf className="w-4 h-4 text-primary" />
              <span className="font-semibold">{status.myGroup.groupName}</span>
              <Badge className="bg-green-500 text-xs">Member</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Led by {status.myGroup.bvslName} · {status.myGroup.memberCount} members
            </p>
            <div className="mt-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-xs text-destructive h-7 px-2">
                    <LogOut className="w-3 h-3 mr-1" />Leave Group
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Leave BV Group?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Once you leave <strong>{status.myGroup.groupName}</strong>, you cannot rejoin this group. You may join a different group after leaving.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleLeaveGroup} disabled={leavingGroup}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      {leavingGroup && <Loader2 className="w-4 h-4 animate-spin mr-1" />}Leave Group
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Attendance Stats */}
      {status.myGroup && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              {attendance?.userStatus === 'P' ? (
                <div className="flex items-center justify-center gap-1 text-green-600">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="font-bold text-sm">Present</span>
                </div>
              ) : attendance?.userStatus === 'A' ? (
                <div className="flex items-center justify-center gap-1 text-red-500">
                  <XCircle className="w-4 h-4" />
                  <span className="font-bold text-sm">Absent</span>
                </div>
              ) : (
                <div className="text-sm font-bold text-muted-foreground">—</div>
              )}
              <div className="text-xs text-muted-foreground mt-0.5">Today</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <div className="flex items-center justify-center gap-1">
                <Flame className="w-4 h-4 text-orange-500" />
                <span className="text-xl font-bold">{status.streak}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Streak</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <div className="text-xl font-bold text-primary">{attendanceRate}%</div>
              <div className="text-xs text-muted-foreground mt-0.5">{status.presentCount}/{status.totalSessions}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Calendar (only if in a group) */}
      {status.myGroup && attendance && (
        <BvCalendarView history={attendance.userHistory} quizDates={quizDates} />
      )}

      {/* Leaderboard (only if in a group) */}
      {status.myGroup && attendance && attendance.leaderboard.length > 0 && (
        <BvLeaderboard leaderboard={attendance.leaderboard} currentUserId={userId} />
      )}

      {/* NI-07: Replace join request UI with static message */}
      {!status.myGroup && (
        <Card className="border-l-4 border-l-primary/40">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <Leaf className="w-5 h-5 text-primary shrink-0" />
              <div>
                <p className="font-medium text-sm">Not in a BV group yet</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Ask your Bhakti Vriksha Servant Leader or Guide to add you in the group.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
