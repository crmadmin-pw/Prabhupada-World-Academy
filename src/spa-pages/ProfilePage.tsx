import { useEffect, useState } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Flame, TrendingUp, Leaf, Star } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  getUserProfile, getUserMetrics, getGuides, getAshrayUpgradePath, getAllResidencies,
  getBvAttendance, getAshrayChecklist, getUserCrmData,
} from 'zite-endpoints-sdk';
import type {
  GetUserProfileOutputType, GetGuidesOutputType,
  GetAshrayUpgradePathOutputType, GetUserMetricsOutputType, GetAllResidenciesOutputType,
  GetUserCrmDataOutputType,
} from 'zite-endpoints-sdk';
import AshrayJourneyCard from '@/components/crm/AshrayJourneyCard';
import TripsDuesCard from '@/components/crm/TripsDuesCard';
import RentHistoryCard from '@/components/crm/RentHistoryCard';
import { useUserProfile } from '@/contexts/UserProfileContext';
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

  const loadAll = async () => {
    if (!user?.email) return;
    try {
      const profileRes = await getUserProfile({ email: user.email });
      const p = profileRes?.user;
      if (!p) { navigate('/register'); return; }
      setProfile(p);

      const localDate = format(new Date(), 'yyyy-MM-dd');
      const [guidesRes, ashrayRes, metricsRes, allResRes, bvRes, checklistRes, crmRes] = await Promise.all([
        getGuides({}), getAshrayUpgradePath({}),
        getUserMetrics({ userId: p.userId }), getAllResidencies({}),
        getBvAttendance({ userId: p.userId, localDate, sinceDate: format(new Date(Date.now() - 30 * 86400_000), 'yyyy-MM-dd') }).catch(() => null),
        getAshrayChecklist({ userId: p.userId }).catch(() => null),
        getUserCrmData({ userId: p.userId || '' }).catch(() => null),
      ]);
      setGuides(guidesRes.guides);
      setAshrayData(ashrayRes);
      setMetrics(metricsRes);
      setAllResidencies(allResRes);
      if (bvRes) setBvWeeklyScore(bvRes.userTotalPointsThisWeek);
      if (checklistRes) setAshrayCheckedCount(checklistRes.checkedItems.length);
      if (crmRes) setCrmData(crmRes);
    } catch (err) {
      console.error('Profile load error:', err);
      toast.error('Failed to load profile');
    } finally { setLoading(false); }
  };

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

  const isPwMember = profile.selectedGuideId === 'MENTOR-PW-HIRANYAVARNA' || (profile.guideName || '').includes('Hiranyavarna') || (guideName || '').includes('Hiranyavarna');

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3 max-w-7xl">
          <Button variant="ghost" size="sm" onClick={() => navigate('/user/dashboard')}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <h1 className="text-xl font-bold">My Profile</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-7xl space-y-6">
        {/* SAD-C02 FIX: isResident requires guide-verified approval + valid residency ID */}
        <ProfileHero fullName={profile.fullName} email={user?.email || ''}
          isResident={!!(profile.residencyGuideVerified && profile.selectedFolkResidency)} ashrayLevel={profile.ashrayLevel}
          role={profile.role} isBvsl={profile.isBvsl} isSadhanaMentor={profile.isSadhanaMentor}
          isFolkLead={profile.isFolkLead} isTripCoordinator={profile.isTripCoordinator} isBvMentor={profile.isBvMentor} />

        <div className="grid md:grid-cols-3 gap-6">
          <PersonalInfoCard email={user?.email || ''} fullName={profile.fullName}
            phone={String(profile.phone || '')} ashrayLevel={profile.ashrayLevel}
            onUpdated={() => handleProfileChanged()} />
          {!isPwMember && (
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
          <AccountCard createdAt={profile.createdAt ?? undefined} lastLoginAt={profile.lastLoginAt ?? undefined} />
          <NotificationCard />
        </div>

        {/* FIX 4: Sadhana Graph first — FIX 5: exactly 4 stat items */}
        {metrics && (
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

        {/* Mini CRM — role-aware view of user's own trips, rent & ashray history */}
        {crmData && (() => {
          const role = profile.role || '';
          const canEditTrips = ['GUIDE', 'SUPER_GUIDE'].includes(role) || !!profile.isTripCoordinator;
          const canEditRent = ['GUIDE', 'SUPER_GUIDE'].includes(role) || !!profile.isFolkLead;
          const isResident = !!(profile.residencyGuideVerified && profile.selectedFolkResidency);
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

        {/* FIX 4: Ashraya Checklist last */}
        {ashrayData && ashrayData.practiceGroups.length > 0 && (
          <AshrayCriteriaGrid currentLevel={profile.ashrayLevel || 'Jigyasa'}
            userId={profile.userId} practiceGroups={ashrayData.practiceGroups} />
        )}
      </main>
    </div>
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
