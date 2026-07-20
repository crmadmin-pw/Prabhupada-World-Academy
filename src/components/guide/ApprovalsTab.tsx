import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CheckCircle, XCircle, Edit, UserCheck, ArrowRightLeft, Star, Home, ClipboardList, ExternalLink, Sparkles } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  getPendingApprovals, approveUser, rejectUser, getResidenciesForGuide,
  getGuideRequests, approveGuideTransfer, approveAshrayUpgrade,
  getResidencyTransferRequests, approveResidencyTransfer, getGuides,
  getCleanlinessReviews, resolveCleanlinessReview,
} from 'zite-endpoints-sdk';
import type {
  GetPendingApprovalsOutputType, GetResidenciesForGuideOutputType,
  GetGuideRequestsOutputType, GetResidencyTransferRequestsOutputType,
  GetGuidesOutputType,
} from 'zite-endpoints-sdk';
import { useNavigate } from 'react-router-dom';
import { fmt } from '@/lib/fmt';
import { EmptyState, ConfirmDialog, AsyncButton } from '@/shared';
import { ASHRAY_LEVELS } from '@/types/enums';

type PendingUser = GetPendingApprovalsOutputType[0];
type GuideRequest = GetGuideRequestsOutputType['guideTransfers'][0];
type AshrayRequest = GetGuideRequestsOutputType['ashrayUpgrades'][0];
type ResidencyTransfer = GetResidencyTransferRequestsOutputType[0];

interface ApprovalsTabProps {
  guideId: string;
  reviewerGuideId?: string;
  isSuperGuide?: boolean;
  onCountLoaded?: (count: number) => void;
}

export default function ApprovalsTab({ guideId, reviewerGuideId, isSuperGuide = false, onCountLoaded }: ApprovalsTabProps) {
  const navigate = useNavigate();
  const actionGuideId = reviewerGuideId || guideId;
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [guideTransfers, setGuideTransfers] = useState<GuideRequest[]>([]);
  const [ashrayUpgrades, setAshrayUpgrades] = useState<AshrayRequest[]>([]);
  const [residencyTransfers, setResidencyTransfers] = useState<ResidencyTransfer[]>([]);
  const [cleanlinessReviews, setCleanlinessReviews] = useState<any[]>([]);
  const [residencies, setResidencies] = useState<GetResidenciesForGuideOutputType>([]);
  const [allGuides, setAllGuides] = useState<GetGuidesOutputType['guides']>([]);
  const [loading, setLoading] = useState(true);

  // Confirm dialogs
  const [approveTarget, setApproveTarget] = useState<PendingUser | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingUser | null>(null);
  const [editUser, setEditUser] = useState<PendingUser | null>(null);

  // Edit dialog state
  const [editedResidency, setEditedResidency] = useState('');
  const [editedAshray, setEditedAshray] = useState('');
  const [editedGuideId, setEditedGuideId] = useState('');
  const [makeResident, setMakeResident] = useState(false);

  useEffect(() => { loadAll(); }, [guideId]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const residencyFetchId = guideId === 'ALL' ? (reviewerGuideId || guideId) : guideId;
      const [pendingRes, residencyRes, requestsRes, residencyTransferRes, guidesRes, cleanReviews] = await Promise.all([
        getPendingApprovals({ guideId }),
        getResidenciesForGuide({ guideId: residencyFetchId }),
        getGuideRequests({ guideId }),
        getResidencyTransferRequests({ guideId } as any),
        getGuides({}),
        getCleanlinessReviews({ guideId }).catch(() => []),
      ]);
      setPendingUsers(pendingRes);
      setResidencies(residencyRes);
      setGuideTransfers(requestsRes.guideTransfers);
      setAshrayUpgrades(requestsRes.ashrayUpgrades);
      setResidencyTransfers(residencyTransferRes);
      setCleanlinessReviews(Array.isArray(cleanReviews) ? cleanReviews : []);
      setAllGuides(guidesRes.guides);
      onCountLoaded?.(pendingRes.length + requestsRes.guideTransfers.length + requestsRes.ashrayUpgrades.length + residencyTransferRes.length + (Array.isArray(cleanReviews) ? cleanReviews.length : 0));
    } catch {
      toast.error('Failed to load approvals');
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (user: PendingUser) => {
    setEditUser(user);
    setEditedResidency(user.selectedFolkResidency || '');
    setEditedAshray(user.ashrayLevel || '');
    setEditedGuideId(user.guideId || '');
    // Default to resident if the user claimed residency OR already has a residency assigned
    setMakeResident(!!(user.residencyUserClaim || user.selectedFolkResidency));
  };

  const showEnrollmentToast = (name: string, result: { enrollmentStatus?: string; enrollmentError?: string }) => {
    if (result.enrollmentStatus === 'Enrolled') {
      toast.success(`🎓 ${name} enrolled on TagMango`);
    } else if (result.enrollmentStatus === 'Failed') {
      toast.error(`⚠️ TagMango enrollment failed for ${name}: ${result.enrollmentError || 'Unknown error'}. You can retry later.`);
    }
    // 'Skipped' is silent — no toast needed
  };

  const handleApprove = async () => {
    if (!approveTarget) return;
    const result = await approveUser({
      userId: approveTarget.userId,
      guideId: actionGuideId,
      residencyApproved: !!(approveTarget.residencyUserClaim && approveTarget.selectedFolkResidency),
      selectedFolkResidency: approveTarget.selectedFolkResidency || undefined,
    });
    toast.success(`✅ ${approveTarget.fullName} approved`);
    showEnrollmentToast(approveTarget.fullName, result);
    loadAll();
  };

  const handleSaveAndApprove = async () => {
    if (!editUser) return;
    const result = await approveUser({
      userId: editUser.userId,
      guideId: actionGuideId,
      residencyApproved: makeResident && !!editedResidency,
      selectedFolkResidency: (makeResident && editedResidency && editedResidency !== 'none') ? editedResidency : undefined,
      ashrayLevel: editedAshray || undefined,
      newGuideId: editedGuideId && editedGuideId !== editUser.guideId ? editedGuideId : undefined,
    });
    toast.success(`✅ ${editUser.fullName} details saved & approved`);
    showEnrollmentToast(editUser.fullName, result);
    setEditUser(null);
    loadAll();
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    await rejectUser({ userId: rejectTarget.userId, rowId: rejectTarget.rowId, rejectedBy: actionGuideId });
    toast.success(`${rejectTarget.fullName} rejected`);
    loadAll();
  };

  const handleTransferAction = async (req: GuideRequest, action: 'approve' | 'reject') => {
    await approveGuideTransfer({ logId: req.logId, action } as any);
    toast.success(`Guide transfer ${action === 'approve' ? 'approved' : 'rejected'} for ${req.userName}`);
    loadAll();
  };

  const handleAshrayAction = async (req: AshrayRequest, action: 'approve' | 'reject' | 'pass' | 'fail') => {
    const result = await approveAshrayUpgrade({ logId: req.logId, action } as any) as any;
    const msgs: Record<string, string> = {
      approve: `✅ Approved — now choose Pass or Fail for ${req.userName}`,
      reject: `Request rejected for ${req.userName}`,
      pass: `🎉 ${req.userName} passed — level advanced!`,
      fail: `${req.userName} did not pass — level unchanged`,
    };
    toast.success(msgs[action] || 'Done');
    if (result?.tagMangoMigration) {
      const m = result.tagMangoMigration;
      if (m.enrollResult?.status === 'Enrolled') {
        toast.success(`🎓 ${req.userName} moved to ${req.details?.requestedLevel || 'new level'} on TagMango`);
      } else if (m.enrollResult?.status === 'Failed') {
        toast.error(`⚠️ Level updated but TagMango migration failed: ${m.enrollResult.error || 'Unknown error'}`);
      }
    }
    loadAll();
  };

  const handleResidencyTransferAction = async (req: ResidencyTransfer, action: 'approve' | 'reject') => {
    await approveResidencyTransfer({ rowId: req.rowId, action } as any);
    toast.success(`Residency transfer ${action === 'approve' ? 'approved' : 'rejected'} for ${req.userName}`);
    loadAll();
  };

  const getResidencyName = (id: string) =>
    residencies.find((r: any) => r.residencyId === id)?.residencyName || 'Unknown';

  const defaultSubTab = isSuperGuide 
    ? (guideTransfers.length > 0 ? 'transfers' : (residencyTransfers.length > 0 ? 'folk_transfer' : 'registrations'))
    : (pendingUsers.length > 0 ? 'registrations' : (ashrayUpgrades.length > 0 ? 'ashray' : 'registrations'));

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading...</div>;

  return (
    <>
      <Tabs defaultValue={defaultSubTab}>
        <TabsList className="mb-4 w-full sm:w-auto">
          {(!isSuperGuide || pendingUsers.length > 0) && (
            <TabsTrigger value="registrations" className="gap-1 text-xs sm:text-sm">
              <UserCheck className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Registrations</span>
              <span className="sm:hidden">Reg.</span>
              {pendingUsers.length > 0 && <Badge className="ml-1 text-xs px-1.5">{pendingUsers.length}</Badge>}
            </TabsTrigger>
          )}

          {(isSuperGuide || guideTransfers.length > 0) && (
            <TabsTrigger value="transfers" className="gap-1 text-xs sm:text-sm">
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Guide Transfers</span>
              <span className="sm:hidden">Transfers</span>
              {guideTransfers.length > 0 && <Badge className="ml-1 text-xs px-1.5">{guideTransfers.length}</Badge>}
            </TabsTrigger>
          )}

          {(isSuperGuide || residencyTransfers.length > 0) && (
            <TabsTrigger value="folk_transfer" className="gap-1 text-xs sm:text-sm">
              <Home className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">FOLK Transfer</span>
              <span className="sm:hidden">FOLK</span>
              {residencyTransfers.length > 0 && <Badge className="ml-1 text-xs px-1.5">{residencyTransfers.length}</Badge>}
            </TabsTrigger>
          )}

          {(!isSuperGuide || ashrayUpgrades.length > 0) && (
            <TabsTrigger value="ashray" className="gap-1 text-xs sm:text-sm">
              <Star className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ashraya Requests</span>
              <span className="sm:hidden">Ashraya</span>
              {ashrayUpgrades.length > 0 && <Badge className="ml-1 text-xs px-1.5">{ashrayUpgrades.length}</Badge>}
            </TabsTrigger>
          )}

          {cleanlinessReviews.length > 0 && (
            <TabsTrigger value="cleanliness" className="gap-1 text-xs sm:text-sm">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Cleanliness</span>
              <span className="sm:hidden">Clean.</span>
              <Badge className="ml-1 text-xs px-1.5">{cleanlinessReviews.length}</Badge>
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Registration Approvals ── */}
        <TabsContent value="registrations">
          <Card>
            <CardHeader>
              <CardTitle>Pending Registrations</CardTitle>
              <CardDescription>Review details, correct any mistakes, then approve or reject</CardDescription>
            </CardHeader>
            <CardContent>
              {pendingUsers.length === 0 ? (
                <EmptyState icon={ClipboardList} title="No pending registrations" />
              ) : (
                <>
                  {/* Mobile */}
                  <div className="block md:hidden space-y-4">
                    {pendingUsers.map(user => (
                      <Card key={user.userId} className="border">
                        <CardContent className="pt-4 space-y-3">
                          <div>
                            <p className="font-semibold">{user.fullName}</p>
                            <p className="text-sm text-muted-foreground">{user.email}</p>
                            <p className="text-sm text-muted-foreground">{user.phone}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {user.ashrayLevel && <Badge variant="outline">✨ {user.ashrayLevel}</Badge>}
                            {user.residencyUserClaim
                              ? <Badge variant="secondary">🏠 {user.selectedFolkResidency ? getResidencyName(user.selectedFolkResidency) : 'Resident'}</Badge>
                              : <Badge variant="outline">Non-Resident</Badge>}
                            {user.createdAt && <span className="text-xs text-muted-foreground">{fmt.date(user.createdAt)}</span>}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => openEdit(user)}>
                              <Edit className="w-3.5 h-3.5 mr-1" /> Edit Details
                            </Button>
                            <Button size="sm" onClick={() => setApproveTarget(user)}>
                              <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => setRejectTarget(user)}>
                              <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Desktop */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b">
                          <th className="text-left p-2 font-medium bg-card">Name</th>
                          <th className="text-left p-2 font-medium bg-card">Email</th>
                          <th className="text-left p-2 font-medium bg-card">Phone</th>
                          <th className="text-left p-2 font-medium bg-card">Ashraya</th>
                          <th className="text-left p-2 font-medium bg-card">Residency</th>
                          <th className="text-left p-2 font-medium bg-card">Registered</th>
                          <th className="text-right p-2 font-medium bg-card">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingUsers.map(user => (
                          <tr key={user.userId} className="border-b hover:bg-muted/30">
                            <td className="p-2 font-medium">{user.fullName}</td>
                            <td className="p-2 text-muted-foreground">{user.email}</td>
                            <td className="p-2">{user.phone}</td>
                            <td className="p-2">
                              {user.ashrayLevel
                                ? <Badge variant="outline" className="text-xs">✨ {user.ashrayLevel}</Badge>
                                : <span className="text-muted-foreground text-xs">—</span>}
                            </td>
                            <td className="p-2">
                              {user.residencyUserClaim
                                ? <Badge variant="secondary">🏠 {user.selectedFolkResidency ? getResidencyName(user.selectedFolkResidency) : 'Resident'}</Badge>
                                : <Badge variant="outline">Non-Resident</Badge>}
                            </td>
                            <td className="p-2 text-muted-foreground">{fmt.date(user.createdAt)}</td>
                            <td className="p-2 text-right space-x-2">
                              <Button size="sm" variant="outline" onClick={() => openEdit(user)}>
                                <Edit className="w-4 h-4 mr-1" /> Edit Details
                              </Button>
                              <Button size="sm" onClick={() => setApproveTarget(user)}>
                                <CheckCircle className="w-4 h-4 mr-1" /> Approve
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => setRejectTarget(user)}>
                                <XCircle className="w-4 h-4 mr-1" /> Reject
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Guide Transfer Requests ── */}
        <TabsContent value="transfers">
          <Card>
            <CardHeader>
              <CardTitle>Guide Transfer Requests</CardTitle>
              <CardDescription>Users requesting to be transferred to your group</CardDescription>
            </CardHeader>
            <CardContent>
              {guideTransfers.length === 0 ? (
                <EmptyState icon={ArrowRightLeft} title="No pending transfer requests" />
              ) : (
                <>
                  <div className="block md:hidden space-y-4">
                    {guideTransfers.map(req => (
                      <Card key={req.logId} className="border">
                        <CardContent className="pt-4 space-y-3">
                          <div>
                            <button className="font-semibold text-left hover:underline text-primary cursor-pointer flex items-center gap-1" onClick={() => navigate(`/guide/users/${req.userId}`)}>
                              {req.userName}<ExternalLink className="w-3 h-3" />
                            </button>
                            <p className="text-sm text-muted-foreground">{req.userEmail}</p>
                            <p className="text-xs font-semibold text-primary mt-1">
                              Transfer: <span className="text-foreground font-normal">{req.fromGuideName}</span> ➔ <span className="text-foreground font-normal">{req.toGuideName}</span>
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">{fmt.dateFull(String(req.timestamp ?? ''))}</p>
                          </div>
                          <div className="flex gap-2">
                            <AsyncButton size="sm" onClickAsync={() => handleTransferAction(req, 'approve')}>
                              <CheckCircle className="w-3.5 h-3.5 mr-1" /> Accept
                            </AsyncButton>
                            <AsyncButton size="sm" variant="destructive" onClickAsync={() => handleTransferAction(req, 'reject')}>
                              <XCircle className="w-3.5 h-3.5 mr-1" /> Decline
                            </AsyncButton>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b">
                          <th className="text-left p-2 font-medium bg-card">Name</th>
                          <th className="text-left p-2 font-medium bg-card">Email</th>
                          <th className="text-left p-2 font-medium bg-card">Transfer Request</th>
                          <th className="text-left p-2 font-medium bg-card">Requested On</th>
                          <th className="text-right p-2 font-medium bg-card">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {guideTransfers.map(req => (
                          <tr key={req.logId} className="border-b hover:bg-muted/30">
                            <td className="p-2 font-medium">
                              <button className="hover:underline text-primary cursor-pointer text-left flex items-center gap-1" onClick={() => navigate(`/guide/users/${req.userId}`)}>
                                {req.userName}<ExternalLink className="w-3 h-3" />
                              </button>
                            </td>
                            <td className="p-2 text-muted-foreground">{req.userEmail}</td>
                            <td className="p-2 text-muted-foreground font-normal">
                              {req.fromGuideName} ➔ {req.toGuideName}
                            </td>
                            <td className="p-2 text-muted-foreground">{fmt.dateFull(String(req.timestamp ?? ''))}</td>
                            <td className="p-2 text-right space-x-2">
                              <AsyncButton size="sm" onClickAsync={() => handleTransferAction(req, 'approve')}>
                                <CheckCircle className="w-4 h-4 mr-1" /> Accept
                              </AsyncButton>
                              <AsyncButton size="sm" variant="destructive" onClickAsync={() => handleTransferAction(req, 'reject')}>
                                <XCircle className="w-4 h-4 mr-1" /> Decline
                              </AsyncButton>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Ashray Upgrade Requests ── */}
        <TabsContent value="ashray">
          <Card>
            <CardHeader>
              <CardTitle>Ashraya Level Requests</CardTitle>
              <CardDescription>Step 1: Approve or Reject. Step 2 (after Approve): Pass or Fail.</CardDescription>
            </CardHeader>
            <CardContent>
              {ashrayUpgrades.length === 0 ? (
                <EmptyState icon={Star} title="No pending level requests" />
              ) : (
                <>
                  <div className="block md:hidden space-y-4">
                    {ashrayUpgrades.map(req => {
                      const isPending = req.status === 'PENDING';
                      const isApproved = req.status === 'APPROVED';
                      return (
                        <Card key={req.logId} className="border">
                          <CardContent className="pt-4 space-y-3">
                            <div>
                              <button className="font-semibold text-left hover:underline text-primary cursor-pointer flex items-center gap-1" onClick={() => navigate(`/guide/users/${req.userId}`)}>
                                {req.userName}<ExternalLink className="w-3 h-3" />
                              </button>
                              <p className="text-sm text-muted-foreground">{req.userEmail}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <Badge variant="secondary">✨ {req.details.currentLevel}</Badge>
                                <span className="text-muted-foreground text-xs">→</span>
                                <Badge variant="outline">{req.details.requestedLevel}</Badge>
                                {isApproved && <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs">Awaiting Pass/Fail</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">{fmt.dateFull(String(req.timestamp ?? ''))}</p>
                            </div>
                            {isPending && (
                              <div className="flex flex-wrap gap-2">
                                <AsyncButton size="sm" onClickAsync={() => handleAshrayAction(req, 'approve')}><CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve</AsyncButton>
                                <AsyncButton size="sm" variant="destructive" onClickAsync={() => handleAshrayAction(req, 'reject')}><XCircle className="w-3.5 h-3.5 mr-1" /> Reject</AsyncButton>
                              </div>
                            )}
                            {isApproved && (
                              <div className="flex flex-wrap gap-2">
                                <AsyncButton size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClickAsync={() => handleAshrayAction(req, 'pass')}><CheckCircle className="w-3.5 h-3.5 mr-1" /> Pass</AsyncButton>
                                <AsyncButton size="sm" variant="outline" className="border-destructive text-destructive" onClickAsync={() => handleAshrayAction(req, 'fail')}><XCircle className="w-3.5 h-3.5 mr-1" /> Fail</AsyncButton>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b">
                          <th className="text-left p-2 font-medium bg-card">Name</th>
                          <th className="text-left p-2 font-medium bg-card">Level Request</th>
                          <th className="text-left p-2 font-medium bg-card">Stage</th>
                          <th className="text-left p-2 font-medium bg-card">Requested On</th>
                          <th className="text-right p-2 font-medium bg-card">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ashrayUpgrades.map(req => {
                          const isPending = req.status === 'PENDING';
                          const isApproved = req.status === 'APPROVED';
                          return (
                            <tr key={req.logId} className="border-b hover:bg-muted/30">
                              <td className="p-2">
                                <button className="font-medium hover:underline text-primary cursor-pointer text-left flex items-center gap-1" onClick={() => navigate(`/guide/users/${req.userId}`)}>
                                  {req.userName}<ExternalLink className="w-3 h-3" />
                                </button>
                                <p className="text-xs text-muted-foreground">{req.userEmail}</p>
                              </td>
                              <td className="p-2">
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">✨ {req.details.currentLevel}</Badge>
                                  <span className="text-muted-foreground text-xs">→</span>
                                  <Badge variant="outline">{req.details.requestedLevel}</Badge>
                                </div>
                              </td>
                              <td className="p-2">
                                {isPending && <Badge variant="outline" className="text-xs">Step 1: Approve/Reject</Badge>}
                                {isApproved && <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs">Step 2: Pass/Fail</Badge>}
                              </td>
                              <td className="p-2 text-muted-foreground">{fmt.dateFull(String(req.timestamp ?? ''))}</td>
                              <td className="p-2 text-right space-x-2">
                                {isPending && (
                                  <>
                                    <AsyncButton size="sm" onClickAsync={() => handleAshrayAction(req, 'approve')}><CheckCircle className="w-4 h-4 mr-1" /> Approve</AsyncButton>
                                    <AsyncButton size="sm" variant="destructive" onClickAsync={() => handleAshrayAction(req, 'reject')}><XCircle className="w-4 h-4 mr-1" /> Reject</AsyncButton>
                                  </>
                                )}
                                {isApproved && (
                                  <>
                                    <AsyncButton size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClickAsync={() => handleAshrayAction(req, 'pass')}><CheckCircle className="w-4 h-4 mr-1" /> Pass</AsyncButton>
                                    <AsyncButton size="sm" variant="outline" className="border-destructive text-destructive" onClickAsync={() => handleAshrayAction(req, 'fail')}><XCircle className="w-4 h-4 mr-1" /> Fail</AsyncButton>
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── FOLK Residency Transfer Requests ── */}
        <TabsContent value="folk_transfer">
          <Card>
            <CardHeader>
              <CardTitle>FOLK Residency Transfer Requests</CardTitle>
              <CardDescription>Users requesting to join or change their FOLK residency</CardDescription>
            </CardHeader>
            <CardContent>
              {residencyTransfers.length === 0 ? (
                <EmptyState icon={Home} title="No pending residency transfer requests" />
              ) : (
                <>
                  <div className="block md:hidden space-y-4">
                    {residencyTransfers.map(req => (
                      <Card key={req.userId} className="border">
                        <CardContent className="pt-4 space-y-3">
                          <div>
                            <p className="font-semibold">{req.userName}</p>
                            <p className="text-sm text-muted-foreground">{req.userEmail}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {req.oldResidencyName && <Badge variant="secondary">{req.oldResidencyName}</Badge>}
                              {req.oldResidencyName && <span className="text-xs text-muted-foreground">→</span>}
                              <Badge variant="outline" className="border-blue-300 text-blue-600">{req.newResidencyName}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{fmt.date(req.requestedAt)}</p>
                          </div>
                          <div className="flex gap-2">
                            <AsyncButton size="sm" onClickAsync={() => handleResidencyTransferAction(req, 'approve')}><CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve</AsyncButton>
                            <AsyncButton size="sm" variant="destructive" onClickAsync={() => handleResidencyTransferAction(req, 'reject')}><XCircle className="w-3.5 h-3.5 mr-1" /> Reject</AsyncButton>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b">
                          <th className="text-left p-2 font-medium bg-card">Name</th>
                          <th className="text-left p-2 font-medium bg-card">Email</th>
                          <th className="text-left p-2 font-medium bg-card">Transfer Request</th>
                          <th className="text-left p-2 font-medium bg-card">Requested On</th>
                          <th className="text-right p-2 font-medium bg-card">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {residencyTransfers.map(req => (
                          <tr key={req.userId} className="border-b hover:bg-muted/30">
                            <td className="p-2 font-medium">{req.userName}</td>
                            <td className="p-2 text-muted-foreground">{req.userEmail}</td>
                            <td className="p-2 text-muted-foreground font-normal">
                              {req.oldResidencyName || 'Non-resident'} ➔ {req.newResidencyName}
                            </td>
                            <td className="p-2 text-muted-foreground">{fmt.date(req.requestedAt)}</td>
                            <td className="p-2 text-right space-x-2">
                              <AsyncButton size="sm" onClickAsync={() => handleResidencyTransferAction(req, 'approve')}><CheckCircle className="w-4 h-4 mr-1" /> Approve</AsyncButton>
                              <AsyncButton size="sm" variant="destructive" onClickAsync={() => handleResidencyTransferAction(req, 'reject')}><XCircle className="w-4 h-4 mr-1" /> Reject</AsyncButton>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Cleanliness Review Requests ── */}
        {cleanlinessReviews.length > 0 && (
          <TabsContent value="cleanliness">
            <Card>
              <CardHeader>
                <CardTitle>Cleanliness Review Requests</CardTitle>
                <CardDescription>Users disputing a cleanliness score of 0</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {cleanlinessReviews.map((rev: any) => (
                  <Card key={rev.reviewId} className="border">
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-sm">{rev.userFullName} · Room {rev.roomNumber}</p>
                          <p className="text-xs text-muted-foreground">
                            {rev.date ? new Date(rev.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} · Score: {rev.score}
                          </p>
                        </div>
                      </div>
                      {(rev.photo || rev.comment) && (
                        <div className="border rounded-lg p-3 bg-muted/50 space-y-2">
                          {rev.photo && (
                            <div className="relative w-full h-32 bg-muted rounded-md overflow-hidden animate-pulse">
                              <img
                                src={rev.photo}
                                alt="Inspection"
                                className="w-full h-full object-cover opacity-0 transition-opacity duration-300"
                                onLoad={(e) => {
                                  e.currentTarget.parentElement?.classList.remove('animate-pulse');
                                  e.currentTarget.classList.remove('opacity-0');
                                }}
                              />
                            </div>
                          )}
                          {rev.comment && (
                            <p className="text-xs text-muted-foreground italic">"{rev.comment}"</p>
                          )}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <AsyncButton
                          size="sm"
                          className="flex-1"
                          onClickAsync={async () => {
                            await resolveCleanlinessReview({ reviewId: rev.reviewId, action: 'approve' });
                            toast.success(`Cleanliness approved for ${rev.userFullName} — score updated to 1`);
                            loadAll();
                          }}
                        >
                          <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve (→ 1)
                        </AsyncButton>
                        <AsyncButton
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClickAsync={async () => {
                            await resolveCleanlinessReview({ reviewId: rev.reviewId, action: 'dismiss' });
                            toast.success(`Review dismissed for ${rev.userFullName}`);
                            loadAll();
                          }}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" /> Dismiss
                        </AsyncButton>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* ── Edit Details Dialog ── */}
      <Dialog open={!!editUser} onOpenChange={o => !o && setEditUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User Details</DialogTitle>
            <DialogDescription>
              Correct details for <strong>{editUser?.fullName}</strong> before approving.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Assign Guide</Label>
              <Select value={editedGuideId} onValueChange={(v) => setEditedGuideId(v || '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Select guide">
                    {allGuides.find((g: any) => g.guideId === editedGuideId)?.name || editedGuideId}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {allGuides.map((g: any) => (
                    <SelectItem key={g.guideId} value={g.guideId}>{g.name || g.abbr}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Ashraya Level</Label>
              <Select value={editedAshray} onValueChange={(v) => setEditedAshray(v || '')}>
                <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                <SelectContent>
                  {ASHRAY_LEVELS.map((l: any) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>FOLK Resident</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{makeResident ? 'Yes — Resident' : 'No — Non-Resident'}</span>
                  <Switch checked={makeResident} onCheckedChange={v => { setMakeResident(v); if (!v) setEditedResidency(''); }} />
                </div>
              </div>
              {makeResident && (
                <>
                  <Select value={editedResidency} onValueChange={(v) => setEditedResidency(v || '')}>
                    <SelectTrigger><SelectValue placeholder="Select FOLK residency…" /></SelectTrigger>
                    <SelectContent>
                      {residencies.map((r: any) => (
                        <SelectItem key={r.residencyId} value={r.residencyId}>{r.residencyName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {editedResidency ? (
                    <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                      ✅ Will be approved as a FOLK Resident
                    </p>
                  ) : (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      ⚠️ Please select a FOLK residency to complete approval
                    </p>
                  )}
                </>
              )}
              {!makeResident && (
                <p className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1">
                  Will be approved as a Non-Resident
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <AsyncButton
              onClickAsync={handleSaveAndApprove}
              loadingText="Saving..."
              disabled={makeResident && !editedResidency && residencies.length > 0}
            >
              Save &amp; Approve
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Approve Confirm ── */}
      <ConfirmDialog
        open={!!approveTarget}
        onOpenChange={o => !o && setApproveTarget(null)}
        title="Approve User Registration"
        description={`Approve ${approveTarget?.fullName}? They will be able to log in and submit sadhana entries.`}
        confirmLabel="Approve"
        onConfirm={handleApprove}
      />

      {/* ── Reject Confirm ── */}
      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={o => !o && setRejectTarget(null)}
        title="Reject User Registration"
        description={`Reject ${rejectTarget?.fullName}? They will not be able to access the system.`}
        confirmLabel="Reject"
        variant="destructive"
        onConfirm={handleReject}
      />
    </>
  );
}
