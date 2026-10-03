import DashboardPanel from '@/components/DashboardPanel';
/**
 * SadhanaSection — wrapper with sub-tabs: Report | Stats | Improvement | Leaderboard
 * Sub-tab state is persisted in sessionStorage.
 */
import { lazy, Suspense, useState, useEffect } from 'react';
import { Database, BarChart3, TrendingUp, Trophy } from 'lucide-react';
import type { SadhanaGroupOption } from '@/components/guide/ReportsTab';
import { LoadingPage } from '@/shared';

const ReportsTab = lazy(() => import('@/components/guide/ReportsTab'));
const StatsOverviewPanel = lazy(() => import('@/components/guide/StatsOverviewPanel'));
const ImprovementTab = lazy(() => import('@/components/guide/ImprovementTab'));
const GuideLeaderboardTab = lazy(() => import('@/components/guide/GuideLeaderboardTab'));

interface SadhanaSectionProps {
  guideId: string;
  senderName?: string;
  bvslMode?: boolean;
  mentorMode?: boolean;
  facilitatorMode?: boolean;
  groupOptions?: SadhanaGroupOption[];
  hideImprovement?: boolean;
}

type SubTab = 'report' | 'stats' | 'improvement' | 'leaderboard';

const STORAGE_KEY = 'folk_sadhana_subtab';

const SUB_TABS = [
  { value: 'report'      as SubTab, label: 'Report',      icon: Database    },
  { value: 'stats'       as SubTab, label: 'Stats',       icon: BarChart3   },
  { value: 'improvement' as SubTab, label: 'Improvement', icon: TrendingUp  },
  { value: 'leaderboard' as SubTab, label: 'Leaderboard', icon: Trophy      },
] as const;

function readStoredSubTab(): SubTab {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === 'report' || v === 'stats' || v === 'improvement' || v === 'leaderboard') return v;
  } catch {}
  return 'report';
}

export default function SadhanaSection({ guideId, senderName, bvslMode, mentorMode, facilitatorMode, groupOptions = [], hideImprovement = false }: SadhanaSectionProps) {
  const [subTab, setSubTab] = useState<SubTab>(readStoredSubTab);
  const [visited, setVisited] = useState<Set<SubTab>>(() => new Set([readStoredSubTab()]));

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, subTab); } catch {}
    setVisited(current => current.has(subTab) ? current : new Set([...current, subTab]));
  }, [subTab]);

  // Preload only code during idle time; data remains scoped and loads when a
  // sub-tab is first visited.
  useEffect(() => {
    const preload = () => void Promise.allSettled([
      import('@/components/guide/StatsOverviewPanel'),
      import('@/components/guide/ImprovementTab'),
      import('@/components/guide/GuideLeaderboardTab'),
    ]);
    const browser = window as typeof window & { requestIdleCallback?: (callback: () => void) => number; cancelIdleCallback?: (id: number) => void };
    if (browser.requestIdleCallback) {
      const id = browser.requestIdleCallback(preload);
      return () => browser.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(preload, 500);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-0 border-b border-border overflow-x-auto overflow-y-hidden scrollbar-none [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {SUB_TABS.filter(tab => !(hideImprovement && tab.value === 'improvement')).map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setSubTab(value)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              subTab === value
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      <Suspense fallback={<LoadingPage rows={2} />}>
      {visited.has('report') && (
        <DashboardPanel active={subTab === 'report'}><ReportsTab
          guideId={guideId}
          senderName={senderName}
          bvslMode={bvslMode}
          mentorMode={mentorMode}
          facilitatorMode={facilitatorMode}
          groupOptions={groupOptions}
        /></DashboardPanel>
      )}
      {visited.has('stats') && (
        <DashboardPanel active={subTab === 'stats'}><StatsOverviewPanel guideId={guideId} bvslMode={bvslMode} mentorMode={mentorMode} facilitatorMode={facilitatorMode} groupOptions={groupOptions} /></DashboardPanel>
      )}
      {!hideImprovement && visited.has('improvement') && (
        <DashboardPanel active={subTab === 'improvement'}><ImprovementTab guideId={guideId} bvslMode={bvslMode} mentorMode={mentorMode} facilitatorMode={facilitatorMode} /></DashboardPanel>
      )}
      {visited.has('leaderboard') && (
        <DashboardPanel active={subTab === 'leaderboard'}><GuideLeaderboardTab guideId={guideId} bvslMode={bvslMode} facilitatorMode={facilitatorMode} groupOptions={groupOptions} /></DashboardPanel>
      )}
      </Suspense>
    </div>
  );
}
