/**
 * SadhanaSection — wrapper with sub-tabs: Report | Stats | Improvement | Leaderboard
 * Sub-tab state is persisted in sessionStorage.
 */
import { useState, useEffect } from 'react';
import { Database, BarChart3, TrendingUp, Trophy } from 'lucide-react';
import ReportsTab from '@/components/guide/ReportsTab';
import StatsOverviewPanel from '@/components/guide/StatsOverviewPanel';
import ImprovementTab from '@/components/guide/ImprovementTab';
import GuideLeaderboardTab from '@/components/guide/GuideLeaderboardTab';

interface SadhanaSectionProps {
  guideId: string;
  senderName?: string;
  bvslMode?: boolean;
  mentorMode?: boolean;
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

export default function SadhanaSection({ guideId, senderName, bvslMode, mentorMode }: SadhanaSectionProps) {
  const [subTab, setSubTab] = useState<SubTab>(readStoredSubTab);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, subTab); } catch {}
  }, [subTab]);

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-0 border-b border-border overflow-x-auto">
        {SUB_TABS.map(({ value, label, icon: Icon }) => (
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
      {subTab === 'report' && (
        <ReportsTab guideId={guideId} senderName={senderName} bvslMode={bvslMode} mentorMode={mentorMode} />
      )}
      {subTab === 'stats' && (
        <StatsOverviewPanel guideId={guideId} bvslMode={bvslMode} mentorMode={mentorMode} />
      )}
      {subTab === 'improvement' && (
        <ImprovementTab guideId={guideId} bvslMode={bvslMode} mentorMode={mentorMode} />
      )}
      {subTab === 'leaderboard' && (
        <GuideLeaderboardTab guideId={guideId} />
      )}
    </div>
  );
}
