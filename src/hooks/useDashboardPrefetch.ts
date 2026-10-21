import { useCallback, useEffect, useRef } from 'react';
import { endOfISOWeek, format, getISOWeek, getISOWeekYear, startOfISOWeek, subDays, subWeeks } from 'date-fns';
import { hasEndpointRequestsInFlight, isEndpointQueryFresh, queryCacheKey, queryEndpoint, subscribeEndpointCache } from '@/lib/app-endpoints-sdk';

type Query = { tab: string; name: string; input: Record<string, unknown>; intentOnly?: boolean };
type Options = { enabled: boolean; segment: 'PW' | 'FOLK'; isSuperAdmin: boolean; guideId: string; activeTab: string; residencyId?: string };

function plan({ segment, isSuperAdmin, guideId }: Options): Query[] {
  const now = new Date();
  const date = (d: Date) => format(d, 'yyyy-MM-dd');
  const previousWeek = subWeeks(now, 1);
  return [
    { tab: 'lookups', name: 'getGuides', input: { segment } },
    { tab: 'lookups', name: 'getAllResidencies', input: { segment } },
    { tab: 'sadhana', name: 'getGuideDetailedReport', input: { guideId: segment === 'PW' ? 'ALL' : isSuperAdmin ? '' : guideId, date: date(subDays(now, 1)), reportType: 'daily', segment } },
    segment === 'FOLK' && isSuperAdmin
      ? { tab: 'bv', name: 'getSuperGuideBvStats', input: { weekNumber: getISOWeek(now), year: getISOWeekYear(now), segment } }
      : { tab: 'bv', name: 'getBvSessionMatrix', input: { guideId: isSuperAdmin ? 'ALL' : guideId, startDate: date(startOfISOWeek(now)), endDate: date(endOfISOWeek(now)), segment } },
    ...(segment === 'PW' ? [
      { tab: 'meetings', name: 'getMeetings', input: { department: segment } },
      { tab: 'meetings', name: 'getMoms', input: { department: segment } },
    ] : []),
    { tab: 'missing-sadhana', name: 'getMissingSadhanaReport', input: { startDate: date(startOfISOWeek(previousWeek)), endDate: date(endOfISOWeek(previousWeek)), segment } },
    // Directories/group management can include many records and history. Load
    // them on navigation intent, never as an unconditional login download.
    // Must match SuperUsersPanel's directory read exactly, including the PW
    // segment, or the intent prefetch is a wasted copy of the heaviest query.
    { tab: 'users', name: 'getGuideUsers', input: { guideId: 'ALL', statusFilter: 'all', segment }, intentOnly: true },
    { tab: 'bhakti-vriksha', name: isSuperAdmin ? 'getBvslGroups' : 'getAllBvGroupsAdmin', input: isSuperAdmin ? { bvslId: 'ALL', segment } : { guideId }, intentOnly: true },
  ];
}

const TAB_MODULES: Record<string, () => Promise<unknown>> = {
  sadhana: () => import('@/components/guide/ReportsTab'),
  bv: () => import('@/components/super/SuperBvReportTab'),
  users: () => import('@/components/super/SuperUsersPanel'),
  meetings: () => import('@/components/super/MeetingsAndMomTab'),
  'bhakti-vriksha': () => import('@/components/super/BvAdminManagementTab'),
  'missing-sadhana': () => import('@/components/guide/MissingSadhanaTab'),
};

/** One background read at a time, only after visible requests finish.
 * The tab open at load is the exception: its reads start with the dashboard,
 * in parallel with its code chunk, and the panel joins those in-flight reads. */
export function useDashboardPrefetch(options: Options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const intent = useRef<string | null>(null);
  const wake = useRef<() => void>(() => {});
  const completed = useRef(new Set<string>());
  const scopeKey = queryCacheKey('dashboard-prefetch', { segment: options.segment, guideId: options.guideId, isSuperAdmin: options.isSuperAdmin });
  useEffect(() => {
    if (!options.enabled) return;
    const opening = optionsRef.current;
    void TAB_MODULES[opening.activeTab]?.().catch(() => {});
    for (const query of plan(opening)) {
      if (query.intentOnly || (query.tab !== opening.activeTab && query.tab !== 'lookups')) continue;
      if (!isEndpointQueryFresh(query.name, query.input)) {
        void queryEndpoint(query.name, query.input).catch(() => { /* The visible panel reports errors. */ });
      }
    }
  }, [options.enabled, scopeKey]);
  useEffect(() => {
    if (!options.enabled) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType || '')) return;
    let cancelled = false;
    completed.current.clear();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      const current = optionsRef.current;
      if (document.visibilityState !== 'visible' || hasEndpointRequestsInFlight()) {
        // Resume on cache completion/visibility events, not a repeating timer.
        return;
      }
      const candidates = plan(current).filter(query => query.tab !== current.activeTab &&
        (!query.intentOnly || query.tab === intent.current) &&
        !completed.current.has(queryCacheKey(query.name, query.input)));
      const next = candidates.find(query => query.tab === intent.current) || candidates[0];
      if (next) {
        const key = queryCacheKey(next.name, next.input);
        completed.current.add(key);
        if (!isEndpointQueryFresh(next.name, next.input)) {
          await queryEndpoint(next.name, next.input).catch(() => { /* Visible queries handle/report retries. */ });
        }
      }
      if (!cancelled && next) timer = setTimeout(tick, 250);
    };
    wake.current = () => { clearTimeout(timer); if (!cancelled) timer = setTimeout(tick, 120); };
    const resume = () => wake.current();
    const unsubscribe = subscribeEndpointCache(resume);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    timer = setTimeout(tick, 1000);
    return () => {
      cancelled = true; clearTimeout(timer); wake.current = () => {};
      unsubscribe();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, [options.enabled, scopeKey]);
  return useCallback((tab: string) => {
    intent.current = tab;
    void TAB_MODULES[tab]?.().catch(() => {});
    wake.current();
  }, []);
}
