import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Flame, CheckCircle2, XCircle, Leaf, LogOut, Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { getUserBvStatus, getBvAttendance, leaveBvGroup } from 'zite-endpoints-sdk';
import { format } from 'date-fns';
import type { GetUserBvStatusOutputType, GetBvAttendanceOutputType } from 'zite-endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import BvCalendarView from '@/components/bv/BvCalendarView';
import BvLeaderboard from '@/components/dashboard/BvLeaderboard';
import BvQuizSection from '@/components/bv/BvQuizSection';
import BvRegistrationModal from '@/components/bv/BvRegistrationModal';

interface Props { userId: string; }

type BvStatus = GetUserBvStatusOutputType;
type BvAttendance = GetBvAttendanceOutputType;

export default function BvTab({ userId }: Props) {
  const { profile } = useUserProfile();
  const [status, setStatus] = useState<BvStatus | null>(null);
  const [attendance, setAttendance] = useState<BvAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [leavingGroup, setLeavingGroup] = useState(false);
  const [quizDates, setQuizDates] = useState<{ date: string; percentage: number }[]>([]);
  const [regModalOpen, setRegModalOpen] = useState(false);

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
    } catch {
      toast.error('Failed to load Bhakti Vriksha details');
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!status?.myGroup) return;
    setLeavingGroup(true);
    try {
      await leaveBvGroup({ userId, groupId: status.myGroup.groupId });
      toast.success('Left group successfully');
      load();
    } catch {
      toast.error('Failed to leave group');
    } finally {
      setLeavingGroup(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 py-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const isPending = (profile as any)?.bvRegistrationStatus === 'Pending Approval' || status?.pendingRequest;

  const attendanceRate = status?.totalSessions && status.totalSessions > 0
    ? Math.round((status.presentCount / status.totalSessions) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Group Status Card */}
      {status?.myGroup ? (
        <Card className="border-l-4 border-l-primary">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base">{status.myGroup.groupName}</span>
                  <Badge className="bg-green-500 text-xs">Active Member</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Servant Leader: <span className="font-medium">{status.myGroup.bvslName}</span> · {status.myGroup.memberCount} members
                </p>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-xs text-destructive border-destructive/40 shrink-0">
                    <LogOut className="w-3.5 h-3.5 mr-1" /> Leave Group
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Leave Group?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You will be removed from <strong>{status.myGroup.groupName}</strong>.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleLeave} disabled={leavingGroup} className="bg-destructive text-destructive-foreground">
                      {leavingGroup && <Loader2 className="w-4 h-4 animate-spin mr-1" />} Confirm Leave
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      ) : isPending ? (
        <Card className="border-l-4 border-l-orange-400 bg-orange-50/40 dark:bg-orange-950/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <Clock className="w-8 h-8 text-orange-500 shrink-0 mt-0.5" />
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-base">Bhakti Vriksha Registration Pending</p>
                  <Badge variant="outline" className="border-orange-400 text-orange-600 bg-orange-100 dark:bg-orange-900/40">
                    Awaiting Admin Approval
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Your registration has been received! A Bhakti Vriksha Admin will approve your request and assign you to an active Reading Group shortly.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-2 border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto text-primary">
              <Leaf className="w-6 h-6" />
            </div>
            <div>
              <p className="font-bold text-lg text-primary">Not a Member of Any Bhakti Vriksha Group</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                You are not a member of any Bhakti Vriksha group yet. Click <strong>Join Now</strong> to fill out your details and start your spiritual journey!
              </p>
            </div>
            <Button size="lg" className="mt-2 font-semibold shadow-md gap-2" onClick={() => setRegModalOpen(true)}>
              <Leaf className="w-4 h-4" /> Join Now
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Attendance Stats (only if in a group) */}
      {status?.myGroup && (
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
      {status?.myGroup && attendance && (
        <BvCalendarView history={attendance.userHistory} quizDates={quizDates} />
      )}

      {/* Leaderboard (only if in a group) */}
      {status?.myGroup && attendance && attendance.leaderboard.length > 0 && (
        <BvLeaderboard leaderboard={attendance.leaderboard} currentUserId={userId} />
      )}

      {/* Registration Modal */}
      <BvRegistrationModal
        open={regModalOpen}
        onOpenChange={setRegModalOpen}
        onSuccess={load}
      />
    </div>
  );
}
