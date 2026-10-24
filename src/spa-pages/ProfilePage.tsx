import { useReactiveEffect } from '@/hooks/useReactiveEffect';
import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-sdk';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Flame, TrendingUp, Leaf, Star, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  getUserProfile, getUserMetrics, getGuides, getAshrayUpgradePath, getAllResidencies,
  getBvAttendance, getAshrayChecklist, getUserCrmData, getGuideResidencyAssignments,
} from '@/lib/endpoints-sdk';
import type {
  GetUserProfileOutputType, GetGuidesOutputType,
  GetAshrayUpgradePathOutputType, GetUserMetricsOutputType, GetAllResidenciesOutputType,
  GetUserCrmDataOutputType,
} from '@/lib/endpoints-sdk';
import AshrayJourneyCard from '@/components/crm/AshrayJourneyCard';
import TripsDuesCard from '@/components/crm/TripsDuesCard';
import RentHistoryCard from '@/components/crm/RentHistoryCard';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { getManagementDashboardPath, getUserDashboardPath, isManagementProfile } from '@/lib/userDashboardRoutes';
import { organizationalDepartment } from '@/lib/directoryDepartment';
import PersonalInfoCard from '@/components/profile/PersonalInfoCard';
import GuideResidencyCard from '@/components/profile/GuideResidencyCard';
import AccountCard from '@/components/profile/AccountCard';
import ProfileHero from '@/components/profile/ProfileHero';
import AshrayCriteriaGrid from '@/components/profile/AshrayCriteriaGrid';
import NotificationCard from '@/components/profile/NotificationCard';

type ProfileType = NonNullable<GetUserProfileOutputType['user']>;

function isRequired(req: string): boolean {
  return !!req && req !== '-' && req !== '—';
}

export default function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { refreshProfile } = useUserProfile();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileType | null>(null);
  const [guides, setGuides] = useState<GetGuidesOutputType['guides']>([]);
  const [metrics, setMetrics] = useState<GetUserMetricsOutputType | null>(null);
  const [ashrayData, setAshrayData] = useState<GetAshrayUpgradePathOutputType | null>(null);
  const [allResidencies, setAllResidencies] = useState<GetAllResidenciesOutputType>([]);
  const [bvWeeklyScore, setBvWeeklyScore] = useState<number | null>(null);
  const [ashrayCheckedCount, setAshrayCheckedCount] = useState<number>(0);
  const [crmData, setCrmData] = useState<GetUserCrmDataOutputType | null>(null);

  useEffect(() => { if (user?.email) loadAll(); }, [user]);

  const loadAll = useReactiveLoader(async (read) => {
    if (!user?.email) return;
    try {
      const profileRes = await read(() => getUserProfile({ email: user.email! }));
      const p = profileRes?.user;
      if (!p) { navigate('/register'); return; }
      !read.cancelled && setProfile(p);

      const localDate = format(new Date(), 'yyyy-MM-dd');
      const [guidesRes, ashrayRes, metricsRes, allResRes, bvRes, checklistRes, crmRes] = await Promise.all([
        read(() => getGuides({ segment: organizationalDepartment(p) === 'FOLK' ? 'FOLK' : 'PW' })), read(() => getAshrayUpgradePath({})),
        read(() => getUserMetrics({ userId: p.userId })), read(() => getAllResidencies({})),
        read(() => getBvAttendance({ userId: p.userId, localDate, sinceDate: format(new Date(Date.now() - 30 * 86400_000), 'yyyy-MM-dd') })).catch(() => null),
        read(() => getAshrayChecklist({ userId: p.userId })).catch(() => null),
        read(() => getUserCrmData({ userId: p.userId || '' })).catch(() => null),
      ]);
      !read.cancelled && setGuides(guidesRes.guides);
      !read.cancelled && setAshrayData(ashrayRes);
      !read.cancelled && setMetrics(metricsRes);
      !read.cancelled && setAllResidencies(allResRes);
      if (bvRes) !read.cancelled && setBvWeeklyScore(bvRes.userTotalPointsThisWeek);
      if (checklistRes) !read.cancelled && setAshrayCheckedCount(checklistRes.checkedItems.length);
      if (crmRes) !read.cancelled && setCrmData(crmRes);
    } catch (err) {
      if (read.cancelled) return;
      console.error('Profile load error:', err);
      toast.error('Failed to load profile');
    } finally { !read.cancelled && setLoading(false); }
  }, []);

  const handleProfileChanged = async () => {
    await Promise.all([loadAll(), refreshProfile()]);
  };

  if (loading) return <ProfileSkeleton />;
  if (!profile) return null;

  const guideName = guides.find((g: any) => g.guideId === profile.selectedGuideId)?.name || '—';
  // SAD-C03 FIX: look up by ID first; never fall back to raw ID — show '—' instead
  const residencyName = allResidencies.find(
    (r: any) => r.residencyId === profile.selectedFolkResidency
  )?.residencyName || '—';

  // FIX 5: Compute total required ashray items
  const ashrayTotalRequired = ashrayData
    ? ashrayData.practiceGroups
        .flatMap((g: any) => g.practices)
        .filter((p: any) => isRequired(p.requirements[profile.ashrayLevel || 'Jigyasa'] || ''))
        .length
    : 0;

  const isSuperAdmin =
    ['SUPER_ADMIN', 'SUPER_GUIDE'].includes(String(profile.role || '').toUpperCase().replace(/[\s-]+/g, '_')) ||
    !!(profile as any).isBvSuperAdmin;

  const isBvAdminUser =
    isSuperAdmin ||
    profile.role === 'ADMIN' ||
    profile.role === 'GUIDE' ||
    !!(profile as any).isBvAdmin;

  // Admin profiles are operational accounts rather than member-progress
  // profiles. Keep the spiritual-progress cards and member CRM sections out
  // of both Admin and Super Admin views (without also hiding them for Guides).
  const isManagement = isManagementProfile(profile as any);

  const isPwUser = !!(profile as any).isPrabhupadaWorldUser || profile.segment === 'PW';
  const showGuideResidencyCard = !isPwUser && !isBvAdminUser;
  const isFolk = profile.segment === 'FOLK';
  const adminDashboardPath = getManagementDashboardPath(profile as any);
  // A profile may have both guide and super-guide access. In that case the
  // residency card still represents only the residencies assigned to them as
  // a guide; it must not expand to every FOLK residency.
  const folkRole = String(profile.role || '').toUpperCase().replace(/[\s-]+/g, '_');
  const showGuideResidencyAssignmentCard = isFolk && (folkRole === 'GUIDE' || folkRole === 'SUPER_GUIDE');

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3 max-w-7xl">
          <Button variant="ghost" size="sm" onClick={() => navigate(isBvAdminUser ? adminDashboardPath : getUserDashboardPath(profile))}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <h1 className="text-xl font-bold">My Profile</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-7xl space-y-6">
        {/* SAD-C02 FIX: isResident requires guide-verified approval + valid residency ID */}
        <ProfileHero fullName={profile.fullName} email={user?.email || ''} segment={profile.segment}
          isResident={!!(profile.residencyGuideVerified && profile.selectedFolkResidency)} ashrayLevel={isManagement ? null : profile.ashrayLevel}
          role={profile.role} isBvsl={profile.isBvsl} isSadhanaMentor={profile.isSadhanaMentor}
          isFolkLead={profile.isFolkLead} isTripCoordinator={profile.isTripCoordinator} isBvMentor={profile.isBvMentor}
          isSuperAdmin={isSuperAdmin} isBvAdmin={!!(profile as any).isBvAdmin} isBvSuperAdmin={!!(profile as any).isBvSuperAdmin} />

        <div className="grid md:grid-cols-3 gap-6">
          <PersonalInfoCard email={user?.email || ''} fullName={profile.fullName}
            phone={String(profile.phone || '')} ashrayLevel={isManagement ? null : profile.ashrayLevel}
            isSuperAdmin={isSuperAdmin} isManagementProfile={isManagement}
            onUpdated={() => handleProfileChanged()} />
          {showGuideResidencyAssignmentCard && (
            <GuideResidencyAssignmentCard />
          )}
          {showGuideResidencyCard && (
            <GuideResidencyCard email={user?.email || ''} fullName={profile.fullName}
              phone={String(profile.phone || '')} guideName={guideName}
              currentGuideId={profile.selectedGuideId} guides={guides}
              isResident={!!(profile.residencyGuideVerified && profile.selectedFolkResidency)} residencyName={residencyName}
              residencyGuideVerified={profile.residencyGuideVerified ?? undefined}
              selectedFolkResidency={profile.selectedFolkResidency}
              allResidencies={allResidencies} ashrayLevel={profile.ashrayLevel}
              residencyJoinDate={profile.residencyJoinDate}
              hasPendingGuideTransfer={(profile as any).hasPendingGuideTransfer}
              hasPendingResidencyTransfer={(profile as any).hasPendingResidencyTransfer}
              isPendingResidencyLeave={(profile as any).isPendingResidencyLeave}
              onProfileChanged={handleProfileChanged} />
          )}
          <AccountCard
            createdAt={profile.createdAt ?? undefined}
            lastLoginAt={profile.lastLoginAt ?? undefined}
          />
          <NotificationCard />
        </div>

        {/* Sadhana Graph & Stat cards — member profiles only */}
        {!isManagement && metrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatMini icon={Flame} iconColor="text-orange-500"
              value={metrics.currentStreak} label="Sadhana Streak" />
            <StatMini icon={TrendingUp} iconColor="text-primary"
              value={metrics.weeklyAveragePercent != null ? `${metrics.weeklyAveragePercent}%` : '—'}
              label="Sadhana Avg Score" />
            <StatMini icon={Leaf} iconColor="text-green-600"
              value={bvWeeklyScore !== null ? bvWeeklyScore : '—'}
              label="BV Weekly Score" />
            <StatMini icon={Star} iconColor="text-amber-500"
              value={`${ashrayCheckedCount}/${ashrayTotalRequired}`}
              label="Ashraya Checked" />
          </div>
        )}

        {/* Mini CRM — Ashray Journey & Trips/Dues are member-profile sections. */}
        {crmData && (() => {
          const role = profile.role || '';
          const canEditRent = ['GUIDE', 'SUPER_GUIDE'].includes(role) || !!profile.isFolkLead;
          const isResident = !!(profile.residencyGuideVerified && profile.selectedFolkResidency);

          if (isManagement) return null;

          const canEditTrips = ['GUIDE', 'SUPER_GUIDE'].includes(role) || !!profile.isTripCoordinator;
          return (
            <div className="space-y-4">
              <AshrayJourneyCard ashrayHistory={crmData.ashrayHistory} currentLevel={profile.ashrayLevel || ''} />
              <TripsDuesCard
                userId={profile.userId || ''}
                trips={crmData.trips}
                canEdit={canEditTrips}
                isOwnProfile={true}
                onRefresh={loadAll}
              />
              <RentHistoryCard
                userId={profile.userId || ''}
                rentPayments={crmData.rentPayments}
                canEdit={canEditRent}
                isOwnProfile={true}
                isResident={isResident}
                onRefresh={loadAll}
              />
            </div>
          );
        })()}

        {/* Ashraya Checklist — member profiles only */}
        {!isManagement && ashrayData && ashrayData.practiceGroups.length > 0 && (
          <AshrayCriteriaGrid currentLevel={profile.ashrayLevel || 'Jigyasa'}
            userId={profile.userId} practiceGroups={ashrayData.practiceGroups} />
        )}
      </main>
    </div>
  );
}

function GuideResidencyAssignmentCard() {
  const [loading, setLoading] = useState(true);
  const [assigned, setAssigned] = useState<any[]>([]);

  useReactiveEffect((read) => {
    let cancelled = false;

    read(() => getGuideResidencyAssignments({} as any))
      .then((res: any) => {
        if (cancelled) return;
        const nextAssigned = Array.isArray(res?.assignedResidencies) ? res.assignedResidencies : [];
        !read.cancelled && setAssigned(nextAssigned);
      })
      .catch(() => {
        if (!cancelled) !read.background && !read.cancelled && setAssigned([]);
      })
      .finally(() => {
        if (!cancelled) !read.cancelled && setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" /> Assigned FOLK Residencies</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {assigned.length > 0 ? assigned.map((r: any) => <span key={r.id} className="rounded-full bg-primary/10 px-3 py-1 text-primary font-medium">{r.residencyName}</span>) : <span className="text-muted-foreground">No residency assigned yet.</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatMini({ icon: Icon, iconColor, value, label }: { icon: any; iconColor: string; value: any; label: string }) {
  return (
    <Card>
      <CardContent className="pt-4 text-center">
        <Icon className={`w-6 h-6 ${iconColor} mx-auto mb-1`} />
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function ProfileSkeleton() {
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="container mx-auto max-w-7xl space-y-6 pt-6">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid md:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-lg" />)}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}
