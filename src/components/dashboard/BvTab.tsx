import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useCallback, useEffect, useState } from 'react';
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
import { getUserBvStatus, getBvAttendance, leaveBvGroup } from '@/lib/endpoints-sdk';
import { format } from 'date-fns';
import { invalidateUserDashboardCache } from '@/utils/cache';
import type { GetUserBvStatusOutputType, GetBvAttendanceOutputType } from '@/lib/endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import BvLeaderboard from '@/components/dashboard/BvLeaderboard';
import BvQuizSection from '@/components/bv/BvQuizSection';
import BvRegistrationModal from '@/components/bv/BvRegistrationModal';

interface Props { userId: string; segment?: 'PW' | 'FOLK'; }

type BvStatus = GetUserBvStatusOutputType;
type BvAttendance = GetBvAttendanceOutputType;

export default function BvTab({ userId, segment }: Props) {
  const { profile, refreshProfile } = useUserProfile();
  const [status, setStatus] = useState<BvStatus | null>(null);
  const [attendance, setAttendance] = useState<BvAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [leavingGroup, setLeavingGroup] = useState(false);
  const [regModalOpen, setRegModalOpen] = useState(false);
  const todayAttendance = attendance?.userHistory.find(entry => entry.attendanceDate === format(new Date(), 'yyyy-MM-dd'))?.status;

  const load = useReactiveLoader(async (read, silent = false) => {
    try {
      const localDate = format(new Date(), 'yyyy-MM-dd');
      const [statusRes, attendanceRes] = await Promise.all([
        read(() => getUserBvStatus({ userId, localDate })),
        read(() => getBvAttendance({ userId, localDate })),
      ]);
      setStatus(statusRes);
      setAttendance(attendanceRes);
    } catch {
      if (read.cancelled) return;
      if (!silent) toast.error('Failed to load Bhakti Vriksha details');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      // The state updates occur after the endpoint promises settle; this is an
      // initial async synchronization, not a synchronous derived-state effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [userId, load]);
  // Approval and group assignment are performed in another signed-in browser.
  // Reconcile this open tab through the existing scoped Firestore invalidation
  // stream without replacing its contents with another loading screen.


  const handleLeave = async () => {
    if (!status?.myGroup) return;
    setLeavingGroup(true);
    try {
      await leaveBvGroup({ userId, groupId: status.myGroup.groupId });
      invalidateUserDashboardCache(userId);
      await refreshProfile();
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

  const normalizedRegistrationStatus = String(profile?.bvRegistrationStatus || '').trim().toLowerCase();
  const isApproved = normalizedRegistrationStatus === 'approved';
  const isPending = !isApproved && !!(
    profile?.bvRegistrationStatus === 'Pending Approval' ||
    profile?.bvRegistrationStatus === 'Pending' ||
    profile?.bvRegistrationStatus === 'Awaiting Approval' ||
    status?.pendingRequest
  );
  // A BV registration can be approved before an administrator assigns a
  // Reading Group. This is an approved state, not a fresh registration.
  const isApprovedAwaitingAssignment = !status?.myGroup && isApproved;

  const attendanceRate = status?.totalSessions && status.totalSessions > 0
    ? Math.round((status.presentCount / status.totalSessions) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Group Status Card */}
      {status?.myGroup ? (
        <Card className="border-l-4 border-l-primary">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-base">{status.myGroup.groupName}</span>
                  <Badge className="bg-green-500 text-xs">Active Member</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  RGF: <span className="font-medium">{status.myGroup.bvslName}</span> · {status.myGroup.memberCount} members
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
      ) : isApprovedAwaitingAssignment ? (
        <Card className="border-l-4 border-l-primary">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-base">Not Assigned Yet</span>
                  <Badge className="bg-green-500 text-xs">Approved</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Reading Group: <span className="font-medium">Not Assigned Yet</span>
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Your Bhakti Vriksha registration has been approved. An administrator will assign your Reading Group soon; your attendance will appear here once it is marked.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : isPending ? (
        <Card className="border-2 border-dashed border-orange-300/80 bg-orange-50/50 dark:bg-orange-950/20">
          <CardContent className="py-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center mx-auto text-orange-600">
              <Clock className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center justify-center gap-2 mb-1">
                <p className="font-bold text-lg text-orange-700 dark:text-orange-300">Bhakti Vriksha Registration Pending</p>
                <Badge variant="outline" className="border-orange-400 text-orange-600 bg-orange-100 dark:bg-orange-900/40 font-medium">
                  Awaiting Admin Approval
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Your Bhakti Vriksha details have been submitted! An Admin will review your application and assign you to an active Reading Group shortly.
              </p>
            </div>
            <Button size="lg" disabled className="mt-2 font-semibold shadow-sm gap-2 bg-orange-100 text-orange-700 border border-orange-300 dark:bg-orange-900/60 dark:text-orange-200 dark:border-orange-700 cursor-not-allowed opacity-90">
              <Clock className="w-4 h-4 text-orange-600" /> Pending Approval
            </Button>
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

      {(segment === 'FOLK' || segment === 'PW') && status?.myGroup && (
        <BvQuizSection userId={userId} />
      )}

      {/* Attendance Stats (only if in a group) */}
      {status?.myGroup && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              {todayAttendance === 'P' ? (
                <div className="flex items-center justify-center gap-1 text-green-600">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="font-bold text-sm">Present</span>
                </div>
              ) : todayAttendance === 'A' ? (
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

      {/* Leaderboard (only if in a group) */}
      {status?.myGroup && attendance && attendance.leaderboard.length > 0 && (
        <BvLeaderboard
          leaderboard={attendance.leaderboard}
          currentUserId={userId}
          isPw={String(segment || profile?.segment || '').trim().toUpperCase() !== 'FOLK'}
        />
      )}

      {/* Registration Modal */}
      <BvRegistrationModal
        open={regModalOpen}
        onOpenChange={setRegModalOpen}
        onSuccess={load}
        segment={segment}
      />
    </div>
  );
}
