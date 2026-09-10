import { MemberBottomNav } from '@/components/mobile/DashboardNavigation';
import { lazy, Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookOpen, Leaf, Trophy } from 'lucide-react';
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

const BvTab = lazy(() => import('@/components/dashboard/BvTab'));
const LeaderboardTab = lazy(() => import('@/components/dashboard/LeaderboardTab'));

export default function PwUserDashboard() {
  const { profile } = useUserProfile();

  const initialTab = window.location.hash.slice(1) || 'sadhana';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [lbRequested, setLbRequested] = useState(initialTab === 'leaderboard');
  const [sadhanaRefreshVersion, setSadhanaRefreshVersion] = useState(0);
  // A submission can navigate here before the initial dashboard response has
  // arrived.  Retain that save until there is data to merge into, rather than
  // consuming it against `undefined` and losing the calendar update.
  const pendingSavedEntryRef = useRef<SavedSadhanaEntryPayload | null>(null);

  useEffect(() => {
    const stopVisibilityCheck = initReminderVisibilityCheck('PW');
    void scheduleSadhanaReminder(hasSubmittedToday(), 'PW');
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
    realtimeChannels: ['sadhana', 'attendance', 'groups'],
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
      // Refresh once in response to this successful submission. The optimistic
      // merge paints the new result immediately; this silent fetch reconciles
      // derived values such as streak and weekly average without polling.
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

    // This is the navigation-time path: the form saved successfully, but the
    // dashboard had not yet loaded when the browser received the event.
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

  // Old bookmarks may still point to #attendance; send them to the Sadhana tab.
  const visibleActiveTab = ['sadhana', 'leaderboard', 'bv'].includes(activeTab) ? activeTab : 'sadhana';

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

  const subtitle = isManagementProfile(profile)
    ? ''
    : `Ashraya: ${profile?.ashrayLevel || 'Jigyasa'}`;

  return (
    <DashboardLayout
      title={`Hare Krishna, ${profile.fullName}!`}
      subtitle={subtitle}
      hasBottomNavigation
    >
      <PushNotificationBanner />
      <MemberBottomNav activeId={visibleActiveTab} onSelect={handleTabChange} items={[
          { id: 'sadhana', label: 'Sadhana', icon: BookOpen },
          { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
          { id: 'bv', label: 'Bhakti Vriksha', icon: Leaf },
        ]} />
      <Tabs value={visibleActiveTab} onValueChange={handleTabChange}>
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
        </TabsList>
        <Suspense fallback={<LoadingPage rows={2} />}><TabTransition activeTab={visibleActiveTab}>
          {visibleActiveTab === 'sadhana' && (
            <SectionErrorBoundary sectionName="Sadhana Tab">
              <SadhanaTab
                metrics={metricsNorm}
                history={history}
                userId={profile.userId}
                isResident={false}
                refreshVersion={sadhanaRefreshVersion}
              />
            </SectionErrorBoundary>
          )}
          {visibleActiveTab === 'leaderboard' && (
            <SectionErrorBoundary sectionName="Leaderboard Tab">
              <LeaderboardTab
                leaderboardData={leaderboardData as any}
                userId={profile.userId}
                isPw
              />
            </SectionErrorBoundary>
          )}
          {visibleActiveTab === 'bv' && (
            <SectionErrorBoundary sectionName="Bhakti Vriksha Tab">
              <BvTab userId={profile.userId} segment="PW" />
            </SectionErrorBoundary>
          )}
        </TabTransition></Suspense>
      </Tabs>
    </DashboardLayout>
  );
}
