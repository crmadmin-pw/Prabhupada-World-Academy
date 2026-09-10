import { MemberBottomNav } from '@/components/mobile/DashboardNavigation';
import { lazy, Suspense, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookOpen, Leaf, Trophy, ClipboardCheck, Sparkles, Building2, Settings2 } from 'lucide-react';
import { FEATURES } from '@/config/features';
import { getUserDashboardData, getSadhanaLeaderboard } from '@/lib/endpoints-sdk';
import { format } from 'date-fns';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { isManagementProfile } from '@/lib/userDashboardRoutes';
import { DashboardLayout } from '@/layouts';
import { LoadingPage } from '@/shared';
import TabTransition from '@/components/TabTransition';
import SadhanaTab from '@/components/dashboard/SadhanaTab';
import { useQuery } from '@/hooks/useQuery';
import SectionErrorBoundary from '@/components/SectionErrorBoundary';
import PushNotificationBanner from '@/components/dashboard/PushNotificationBanner';
import { initReminderVisibilityCheck, scheduleSadhanaReminder, hasSubmittedToday } from '@/utils/sadhanaNotification';
import {
  consumePendingSadhanaEntrySaved,
  mergeSavedSadhanaIntoDashboardData,
  SADHANA_ENTRY_SAVED_EVENT,
  type SavedSadhanaEntryPayload,
} from '@/utils/sadhanaDashboardRefresh';

const UserServicesTab = lazy(() => import('@/components/services/UserServicesTab'));
const GuideServicesTab = lazy(() => import('@/components/services/GuideServicesTab'));
const BvTab = lazy(() => import('@/components/dashboard/BvTab'));
const LeaderboardTab = lazy(() => import('@/components/dashboard/LeaderboardTab'));
const AttendanceTab = lazy(() => import('@/components/dashboard/AttendanceTab'));
const CleanlinessCalendarTab = lazy(() => import('@/components/cleanliness/CleanlinessCalendarTab'));
const CleanlinessManagerDashboard = lazy(() => import('@/components/cleanliness/CleanlinessManagerDashboard'));

export default function FolkUserDashboard() {
  const { profile } = useUserProfile();

  const initialTab = window.location.hash.slice(1) || 'sadhana';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [lbRequested, setLbRequested] = useState(initialTab === 'leaderboard');
  const [sadhanaRefreshVersion, setSadhanaRefreshVersion] = useState(0);
  const pendingSavedEntryRef = useRef<SavedSadhanaEntryPayload | null>(null);

  useEffect(() => {
    const stopVisibilityCheck = initReminderVisibilityCheck('FOLK');
    void scheduleSadhanaReminder(hasSubmittedToday(), 'FOLK');
    return stopVisibilityCheck;
  }, []);

  useEffect(() => {
    const onPop = () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        setActiveTab(hash);
        if (hash === 'leaderboard') setLbRequested(true);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
    window.history.pushState(null, '', `#${tab}`);
    if (tab === 'leaderboard') setLbRequested(true);
  }, []);

  const { data: dashboardData, loading: dashLoading, setData: setDashboardData, refetch: refetchDashboard } = useQuery({
    key: profile?.userId ? `dashboard:${profile.userId}` : null,
    fetcher: () => getUserDashboardData({ userId: profile!.userId, days: 30 }),
    ttl: 60_000,
    realtimeChannels: ['sadhana', 'attendance', 'groups', 'quizzes'],
  });

  useEffect(() => {
    if (!profile?.userId) return;

    const applySavedEntry = (payload: SavedSadhanaEntryPayload) => {
      if (payload.userId !== profile.userId) return;
      pendingSavedEntryRef.current = payload;
      if (dashboardData) {
        setDashboardData(mergeSavedSadhanaIntoDashboardData(dashboardData, payload) as any);
        pendingSavedEntryRef.current = null;
      }
      setSadhanaRefreshVersion(version => version + 1);
      void refetchDashboard();
    };

    const pending = consumePendingSadhanaEntrySaved(profile.userId);
    if (pending) applySavedEntry(pending);

    const onSaved = (event: Event) => {
      applySavedEntry((event as CustomEvent<SavedSadhanaEntryPayload>).detail);
    };
    window.addEventListener(SADHANA_ENTRY_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(SADHANA_ENTRY_SAVED_EVENT, onSaved);
  }, [profile?.userId, dashboardData, setDashboardData, refetchDashboard]);

  useEffect(() => {
    const pending = pendingSavedEntryRef.current;
    if (!dashboardData || !pending) return;
    setDashboardData(mergeSavedSadhanaIntoDashboardData(dashboardData, pending) as any);
    pendingSavedEntryRef.current = null;
    setSadhanaRefreshVersion(version => version + 1);
  }, [dashboardData, setDashboardData]);

  const { data: leaderboardData } = useQuery({
    key: lbRequested && profile?.userId ? `lb:${profile.userId}:${format(new Date(), 'yyyy-MM-dd')}` : null,
    fetcher: () => getSadhanaLeaderboard({ userId: profile!.userId }),
    ttl: 60_000,
    realtimeChannels: ['sadhana'],
  });

  const isResident = useMemo(() => !!(profile?.residencyGuideVerified && profile?.selectedFolkResidency), [profile]);

  if (dashLoading || !profile) return <LoadingPage rows={3} />;

  const dd = dashboardData as any;
  const metrics = (dd?.metrics || dd) ?? {};
  const metricsNorm = {
    todayScore: metrics.todayScore ?? null,
    todayPercent: metrics.todayPercent ?? null,
    todaySubmitted: metrics.todaySubmitted ?? false,
    todayEntryId: metrics.todayEntryId ?? null,
    currentStreak: metrics.currentStreak ?? 0,
    weeklyAverage: metrics.weeklyAverage ?? 0,
    weeklyAveragePercent: metrics.weeklyAveragePercent ?? null,
    weeklySubmissionRate: metrics.weeklySubmissionRate ?? 0,
    entriesThisWeek: metrics.entriesThisWeek ?? 0,
    weekNumber: metrics.weekNumber ?? 0,
    weekStartDate: metrics.weekStartDate ?? null,
    weekEndDate: metrics.weekEndDate ?? null,
    streakAtRisk: metrics.streakAtRisk ?? false,
  };

  const history = ((dd?.recentEntries || dd?.entries) ?? []).map((e: any) => ({
    entryId: e.entryId ?? '',
    entryDate: e.entryDate ?? '',
    totalScore: e.totalScore ?? 0,
    scorePercent: e.scorePercent ?? null,
    submittedAt: e.submittedAt ?? '',
    flagSick: e.flagSick ?? false,
    flagOs: e.flagOs ?? false,
  }));

  const subtitle = [
    !isManagementProfile(profile) ? `Ashraya: ${profile?.ashrayLevel || 'Jigyasa'}` : null,
    profile?.guideName ? `FOLK Guide: ${profile.guideName}` : null,
    profile?.residencyName && isResident ? `Residency: ${profile.residencyName}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <DashboardLayout
      title={`Hare Krishna, ${profile.fullName}!`}
      subtitle={subtitle}
      hasBottomNavigation
    >
      <PushNotificationBanner />
      <MemberBottomNav activeId={activeTab} onSelect={handleTabChange} items={[
          { id: 'sadhana', label: 'Sadhana', icon: BookOpen },
          { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
          { id: 'bv', label: 'Bhakti Vriksha', icon: Leaf },
          ...(profile.isBvMember ? [{ id: 'attendance', label: 'Attendance', icon: ClipboardCheck }] : []),
          ...(isResident && profile.selectedFolkResidency ? [{ id: 'cleanliness', label: 'Cleanliness', icon: Sparkles }] : []),
          ...(FEATURES.SERVICE_ALLOCATION && isResident && profile.selectedFolkResidency ? [{ id: 'services', label: 'FOLK Services', icon: Building2 }] : []),
          ...(FEATURES.SERVICE_ALLOCATION && profile.isServiceAllocator ? [{ id: 'folk-mgmt', label: 'FOLK Management', icon: Settings2 }] : []),
        ]} />
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="hidden md:flex mb-6 w-full md:w-auto flex-wrap h-auto gap-1">
          <TabsTrigger value="sadhana" className="flex items-center gap-1.5">
            <BookOpen className="w-4 h-4" />Sadhana
          </TabsTrigger>
          <TabsTrigger value="leaderboard" className="flex items-center gap-1.5">
            <Trophy className="w-4 h-4" />Leaderboard
          </TabsTrigger>
          <TabsTrigger value="bv" className="flex items-center gap-1.5">
            <Leaf className="w-4 h-4" />
            <span className="sm:hidden">BV</span>
            <span className="hidden sm:inline">Bhakti Vriksha</span>
          </TabsTrigger>
          {!!profile.isBvMember && (
            <TabsTrigger value="attendance" className="flex items-center gap-1.5">
              <ClipboardCheck className="w-4 h-4" />Attendance
            </TabsTrigger>
          )}
          {isResident && !!profile.selectedFolkResidency && (
            <TabsTrigger value="cleanliness" className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />Cleanliness
            </TabsTrigger>
          )}
          {FEATURES.SERVICE_ALLOCATION && isResident && !!profile.selectedFolkResidency && (
            <TabsTrigger value="services" className="flex items-center gap-1.5">
              <Building2 className="w-4 h-4" />
              <span className="hidden sm:inline">FOLK </span>Services
            </TabsTrigger>
          )}
          {FEATURES.SERVICE_ALLOCATION && !!profile.isServiceAllocator && (
            <TabsTrigger value="folk-mgmt" className="flex items-center gap-1.5">
              <Settings2 className="w-4 h-4" />
              <span className="hidden sm:inline">FOLK </span>Mgmt
            </TabsTrigger>
          )}
        </TabsList>
        <Suspense fallback={<LoadingPage rows={2} />}><TabTransition activeTab={activeTab}>
          {activeTab === 'sadhana' && (
            <SectionErrorBoundary sectionName="Sadhana Tab">
              <SadhanaTab
                metrics={metricsNorm}
                history={history}
                userId={profile.userId}
                residencyId={profile.selectedFolkResidency ?? undefined}
                isResident={isResident}
                refreshVersion={sadhanaRefreshVersion}
              />
            </SectionErrorBoundary>
          )}
          {activeTab === 'leaderboard' && (
            <SectionErrorBoundary sectionName="Leaderboard Tab">
              <LeaderboardTab
                leaderboardData={leaderboardData as any}
                userId={profile.userId}
                userResidencyName={profile.residencyName ?? undefined}
              />
            </SectionErrorBoundary>
          )}
          {activeTab === 'bv' && (
            <SectionErrorBoundary sectionName="Bhakti Vriksha Tab">
              <BvTab userId={profile.userId} segment="FOLK" />
            </SectionErrorBoundary>
          )}
          {activeTab === 'attendance' && !!profile.isBvMember && (
            <SectionErrorBoundary sectionName="Attendance Tab">
              <AttendanceTab userId={profile.userId} segment="FOLK" />
            </SectionErrorBoundary>
          )}
          {activeTab === 'cleanliness' && isResident && !!profile.selectedFolkResidency && (
            <SectionErrorBoundary sectionName="Cleanliness Tab">
              {(profile as any).isCleanlinessManager ? (
                <CleanlinessManagerDashboard residencyId={profile.selectedFolkResidency!} residencyName={profile.residencyName ?? undefined} />
              ) : (
                <CleanlinessCalendarTab userId={profile.userId} residencyId={profile.selectedFolkResidency!} />
              )}
            </SectionErrorBoundary>
          )}
          {activeTab === 'services' && FEATURES.SERVICE_ALLOCATION && isResident && !!profile.selectedFolkResidency && (
            <SectionErrorBoundary sectionName="Services Tab">
              <UserServicesTab userId={profile.userId} residencyId={profile.selectedFolkResidency ?? undefined} />
            </SectionErrorBoundary>
          )}
          {activeTab === 'folk-mgmt' && FEATURES.SERVICE_ALLOCATION && !!profile.isServiceAllocator && (
            <SectionErrorBoundary sectionName="FOLK Mgmt Tab">
              <GuideServicesTab residencyId={(profile as any).folkResidencyCustomId ?? undefined} />
            </SectionErrorBoundary>
          )}
        </TabTransition></Suspense>
      </Tabs>
    </DashboardLayout>
  );
}
