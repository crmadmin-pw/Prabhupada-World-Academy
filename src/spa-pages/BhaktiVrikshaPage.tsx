import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Leaf, Users, Flame, CheckCircle2, XCircle, Clock, LogOut, Loader2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { format, subMonths, subDays } from 'date-fns';
import { getUserBvStatus, getBvAttendance, requestJoinBvGroup, leaveBvGroup, acknowledgeBvApprovalNotice, acknowledgeBvRejectionNotice } from '@/lib/endpoints-sdk';
import type { GetUserBvStatusOutputType, GetBvAttendanceOutputType } from '@/lib/endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { getUserDashboardPath } from '@/lib/userDashboardRoutes';
import BvCalendarView from '@/components/bv/BvCalendarView';
import BvLeaderboard from '@/components/dashboard/BvLeaderboard';
import BvRegistrationModal from '@/components/bv/BvRegistrationModal';

export default function BhaktiVrikshaPage() {
  const { profile, refreshProfile } = useUserProfile();
  const navigate = useNavigate();
  const [bvStatus, setBvStatus] = useState<GetUserBvStatusOutputType | null>(null);
  const [bvData, setBvData] = useState<GetBvAttendanceOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [leavingGroup, setLeavingGroup] = useState(false);
  const [regModalOpen, setRegModalOpen] = useState(false);
  const [clearingNotice, setClearingNotice] = useState(false);


  const handleAcknowledgeApproval = async () => {
    setClearingNotice(true);
    try {
      await acknowledgeBvApprovalNotice({});
      await refreshProfile();
    } catch {
      toast.error('Failed to acknowledge approval notice');
    } finally {
      setClearingNotice(false);
    }
  };

  const handleAcknowledgeRejection = async () => {
    setClearingNotice(true);
    try {
      await acknowledgeBvRejectionNotice({});
      await refreshProfile();
    } catch {
      toast.error('Failed to acknowledge rejection notice');
    } finally {
      setClearingNotice(false);
    }
  };

  useEffect(() => { if (profile?.userId) load(); }, [profile?.userId]);

  const load = useReactiveLoader(async (read) => {
    if (!profile?.userId) return;
    !read.background && setLoading(true);
    try {
      const localDate = format(new Date(), 'yyyy-MM-dd');
      const sinceDate = format(subDays(new Date(), 90), 'yyyy-MM-dd'); // BUG-057 FIX: last 90 days
      const [status, bv] = await Promise.all([
        read(() => getUserBvStatus({ userId: profile.userId, localDate })), // BUG-014 FIX
        read(() => getBvAttendance({ userId: profile.userId, localDate, sinceDate })),
      ]);
      setBvStatus(status);
      setBvData(bv);
    } catch {
      if (read.cancelled) return; toast.error('Failed to load BhaktiVriksha data'); }
    finally { setLoading(false); }
  }, []);

  const handleLeaveGroup = async () => {
    if (!profile?.userId || !bvStatus?.myGroup) return;
    setLeavingGroup(true);
    try {
      await leaveBvGroup({ userId: profile.userId, groupId: bvStatus.myGroup.groupId });
      await refreshProfile();
      toast.success('You have left the group');
      load();
    } catch { toast.error('Failed to leave group'); }
    finally { setLeavingGroup(false); }
  };

  const handleJoin = async (groupId: string, groupName: string) => {
    if (!profile?.userId) return;
    setRequesting(groupId);
    try {
      const res = await requestJoinBvGroup({ userId: profile.userId, groupId });
      if (res.alreadyMember) { toast.info('Already a member'); return; }
      if (res.alreadyRequested) { toast.info('Request already pending'); return; }
      if (res.success) {
        toast.success(`Join request sent for ${groupName}`);
        setRequestedIds(prev => new Set([...prev, groupId]));
        load();
      }
    } catch { toast.error('Failed to send request'); }
    finally { setRequesting(null); }
  };

  if (loading) return (
    <div className="min-h-screen bg-background p-4 space-y-4">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-24" />
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );

  const attendanceRate = bvStatus && bvStatus.totalSessions > 0
    ? Math.round((bvStatus.presentCount / bvStatus.totalSessions) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => {
            // P1-004 FIX: Use browser history if available
            if (window.history.length > 1) {
              navigate(-1);
            } else {
              navigate(getUserDashboardPath(profile));
            }
          }}>
            <ArrowLeft className="w-4 h-4 mr-1" />Back
          </Button>
          <div className="flex items-center gap-2">
            <Leaf className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-lg font-bold text-primary">Bhakti Vriksha</h1>
              <p className="text-xs text-muted-foreground">Group attendance tracking</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-4xl space-y-5">

        {/* Welcome Notice (One-time) */}
        {profile?.pendingBvApprovalNotice && bvStatus?.myGroup && (
          <Card className="border-2 border-green-500 bg-green-50/50 dark:bg-green-950/20 shadow-md">
            <CardContent className="pt-5 pb-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-lg text-green-900 dark:text-green-100 flex items-center gap-1.5">
                    🎉 Application Accepted!
                  </h3>
                  <p className="text-sm text-green-800 dark:text-green-200">
                    Your Bhakti Vriksha application has been accepted! You have been successfully assigned to the reading group: <strong>{bvStatus.myGroup.groupName}</strong>.
                  </p>
                  <div className="pt-2 text-xs space-y-1 text-green-700 dark:text-green-300">
                    <p>👨‍🏫 <strong>RGF:</strong> {bvStatus.myGroup.bvslName || 'Unassigned'}</p>
                    <p>👥 <strong>RGSF:</strong> {bvStatus.myGroup.rgsfName || 'None'}</p>
                  </div>
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <Button
                  onClick={handleAcknowledgeApproval}
                  disabled={clearingNotice}
                  className="bg-green-600 hover:bg-green-700 text-white font-semibold shadow-sm text-xs px-4 py-2"
                >
                  {clearingNotice && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                  OK, start!
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Rejection Notice (One-time) */}
        {profile?.pendingBvRejectionNotice && (
          <Card className="border-2 border-destructive bg-destructive/5 shadow-md">
            <CardContent className="pt-5 pb-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                  <XCircle className="w-6 h-6 text-destructive" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-lg text-destructive flex items-center gap-1.5">
                    Application Update
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Your application to join Bhakti Vriksha was rejected. Please contact {profile?.segment === 'PW' || profile?.isPrabhupadaWorldUser ? 'the admin' : 'your supervisor or spiritual guide'} for further guidance.
                  </p>
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <Button
                  variant="outline"
                  onClick={handleAcknowledgeRejection}
                  disabled={clearingNotice}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 text-xs px-4 py-2"
                >
                  {clearingNotice && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                  Acknowledge
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Group Info Card */}
        {bvStatus?.myGroup ? (
          <Card className="border-l-4 border-l-primary">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Leaf className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{bvStatus.myGroup.groupName}</span>
                    <Badge className="bg-green-500 text-xs">Active Member</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    RGF: <span className="font-medium">{bvStatus.myGroup.bvslName}</span>
                    {' · '}{bvStatus.myGroup.memberCount} members
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    ℹ️ Attendance is marked by your RGF during BV sessions.
                  </p>
                  <div className="mt-3">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-xs text-destructive border-destructive/40">
                          <LogOut className="w-3 h-3 mr-1" />Leave Group
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Leave BV Group?</AlertDialogTitle>
                          <AlertDialogDescription>
                            You will be removed from <strong>{bvStatus.myGroup.groupName}</strong>. You can request to join another group later.
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
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (['pending approval', 'pending', 'awaiting approval'].includes(String((profile as any)?.bvRegistrationStatus || '').trim().toLowerCase()) || bvStatus?.pendingRequest) ? (
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
        ) : String((profile as any)?.bvRegistrationStatus || '').trim().toLowerCase() === 'approved' ? (
          <Card className="border-l-4 border-l-primary">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-base">Not Assigned Yet</span>
                <Badge className="bg-green-500 text-xs">Approved</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Your Bhakti Vriksha registration has been approved. The form cannot be filled again. An administrator will assign your Reading Group.
              </p>
            </CardContent>
          </Card>
        ) : String((profile as any)?.bvRegistrationStatus || '').trim().toLowerCase() === 'rejected' ? (
          <Card className="border-2 border-dashed border-border bg-muted/30">
            <CardContent className="py-8 text-center space-y-2">
              <p className="font-bold text-lg">Bhakti Vriksha form already submitted</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                This form can be filled only once. Your earlier application is closed, so it cannot be submitted again.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-2 border-dashed border-primary/30 bg-primary/5">
            <CardContent className="py-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto text-primary">
                <Leaf className="w-6 h-6" />
              </div>
              <div>
                <p className="font-bold text-lg text-primary">Unassigned</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  You are not a member of any Bhakti Vriksha group yet. Click <strong>Join Now</strong> to fill out your details and get assigned to a Reading Group!
                </p>
              </div>
              <Button size="lg" className="mt-2 font-semibold shadow-md gap-2" onClick={() => setRegModalOpen(true)}>
                <Leaf className="w-4 h-4" /> Join Now
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Attendance Stats (only if in a group) */}
        {bvStatus?.myGroup && (
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                {bvStatus.todayStatus === 'P' ? (
                  <div className="flex items-center justify-center gap-1 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="text-lg font-bold">Present</span>
                  </div>
                ) : bvStatus.todayStatus === 'A' ? (
                  <div className="flex items-center justify-center gap-1 text-red-500">
                    <XCircle className="w-5 h-5" />
                    <span className="text-lg font-bold">Absent</span>
                  </div>
                ) : (
                  <div className="text-lg font-bold text-muted-foreground">—</div>
                )}
                <div className="text-xs text-muted-foreground mt-0.5">Today</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <div className="flex items-center justify-center gap-1">
                  <Flame className="w-5 h-5 text-orange-500" />
                  <div className="text-2xl font-bold">{bvStatus.streak}</div>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Session Streak</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <div className="text-2xl font-bold text-primary">{attendanceRate}%</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {bvStatus.presentCount}/{bvStatus.totalSessions} sessions
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Read-only Attendance Calendar (no userId = no edit) — BUG-051 FIX: limit to 3 months */}
        {bvData && bvStatus?.myGroup && (() => {
          const threeMonthsAgo = format(subMonths(new Date(), 3), 'yyyy-MM-dd');
          const recentHistory = bvData.userHistory.filter((h: any) => h.attendanceDate >= threeMonthsAgo);
          return <BvCalendarView history={recentHistory} />;
        })()}

        {/* Leaderboard */}
        {bvData && bvData.leaderboard.length > 0 && bvStatus?.myGroup && (
          <BvLeaderboard
            leaderboard={bvData.leaderboard}
            currentUserId={profile?.userId ?? ''}

          />
        )}

        {/* Available Groups (only if not in a group AND no pending request) */}
        {!bvStatus?.myGroup && !bvStatus?.pendingRequest && !String((profile as any)?.bvRegistrationStatus || '').trim() && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              <h3 className="font-semibold">Available BV Groups</h3>
            </div>
            {(!bvStatus?.availableGroups || bvStatus.availableGroups.length === 0) ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p>No BV groups available yet</p>
                  <p className="text-xs mt-1">Check back later or contact your guide</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {bvStatus.availableGroups.map((g: any) => (
                  <Card key={g.groupId}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{g.groupName}</p>
                          <p className="text-sm text-muted-foreground">
                            RGF: {g.bvslName} · {g.memberCount} members
                          </p>
                          {g.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{g.description}</p>
                          )}
                        </div>
                        {requestedIds.has(g.groupId) ? (
                          <Badge variant="outline" className="text-xs shrink-0 flex items-center gap-1">
                            <Clock className="w-3 h-3" />Pending
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={requesting === g.groupId}
                            onClick={() => handleJoin(g.groupId, g.groupName)}
                          >
                            {requesting === g.groupId ? 'Sending...' : 'Request to Join'}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        <BvRegistrationModal
          open={regModalOpen}
          onOpenChange={setRegModalOpen}
          onSuccess={load}
        />
      </main>
    </div>
  );
}
