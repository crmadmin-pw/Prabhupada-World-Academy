import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Lightbulb, Users, Square as Grid3X3, Activity, Settings2 } from 'lucide-react';
import BvReportTab from '@/components/guide/BvReportTab';
import BvStatsPanel from '@/components/guide/BvStatsPanel';
import BvImprovementTab from '@/components/guide/BvImprovementTab';
import GuideBvTab from '@/components/guide/GuideBvTab';
import BvSessionMatrixTab from '@/components/guide/BvSessionMatrixTab';
import SadhanaSection from '@/components/guide/SadhanaSection';
import BvslManagementTab from '@/components/guide/BvslManagementTab';

interface Props {
  guideId: string;
  bvslMode?: boolean;
  residencyIds?: string[];
}

type SubTab = 'report' | 'stats' | 'improvement' | 'groups' | 'bvmatrix' | 'sadhana' | 'management';

const STORAGE_KEY = 'folk_bv_subtab_v4';

function readStoredSubTab(): SubTab {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    const valid: SubTab[] = ['report', 'stats', 'improvement', 'groups', 'bvmatrix', 'sadhana', 'management'];
    if (valid.includes(v as SubTab)) return v as SubTab;
  } catch {}
  return 'bvmatrix';
}

export default function BvSection({ guideId, bvslMode, residencyIds }: Props) {
  const [subTab, setSubTab] = useState<SubTab>(readStoredSubTab);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, subTab); } catch {}
  }, [subTab]);

  const tabs = [
    { value: 'bvmatrix'    as SubTab, label: 'BV Report',    icon: Grid3X3    },
    { value: 'report'      as SubTab, label: 'BVSL Report',  icon: BarChart3  },
    { value: 'sadhana'     as SubTab, label: 'BVSL Sadhana', icon: Activity   },
    { value: 'stats'       as SubTab, label: 'Stats',        icon: TrendingUp },
    { value: 'improvement' as SubTab, label: 'Improvement',  icon: Lightbulb  },
    { value: 'groups'      as SubTab, label: 'Groups',       icon: Users      },
    ...(!bvslMode ? [{ value: 'management' as SubTab, label: 'Management', icon: Settings2 }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-0 border-b border-border overflow-x-auto">
        {tabs.map(({ value, label, icon: Icon }) => (
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

      {subTab === 'bvmatrix'    && <BvSessionMatrixTab guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} />}
      {subTab === 'report'      && <BvReportTab guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} />}
      {subTab === 'sadhana'     && <SadhanaSection guideId={guideId} bvslMode={bvslMode} />}
      {subTab === 'stats'       && <BvStatsPanel guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} />}
      {subTab === 'improvement' && <BvImprovementTab guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} />}
      {subTab === 'groups'      && <GuideBvTab guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} />}
      {subTab === 'management'  && !bvslMode && <BvslManagementTab guideId={guideId} />}
    </div>
  );
}
