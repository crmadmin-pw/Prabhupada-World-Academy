import DashboardPanel from '@/components/DashboardPanel';
import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Lightbulb, Users, Square as Grid3X3, Activity, Settings2 } from 'lucide-react';
import BvReportTab from '@/components/guide/BvReportTab';
import BvStatsPanel from '@/components/guide/BvStatsPanel';
import BvImprovementTab from '@/components/guide/BvImprovementTab';
import GuideBvTab from '@/components/guide/GuideBvTab';
import BvSessionMatrixTab from '@/components/guide/BvSessionMatrixTab';
import SadhanaSection from '@/components/guide/SadhanaSection';
import BvslManagementTab from '@/components/guide/BvslManagementTab';
import BvAdminManagementTab from '@/components/super/BvAdminManagementTab';
import ImprovementTab from '@/components/guide/ImprovementTab';
import { useUserProfile } from '@/contexts/UserProfileContext';
import type { SadhanaGroupOption } from '@/components/guide/ReportsTab';

interface Props {
  guideId: string;
  bvslMode?: boolean;
  residencyIds?: string[];
  groupOptions?: SadhanaGroupOption[];
  /** Supervisor dashboard already has navigable group cards in its main Groups tab. */
  summaryOnlyGroups?: boolean;
  /** Route for member details when this section is embedded in a scoped dashboard. */
  improvementDetailBasePath?: string;
  segment?: 'PW' | 'FOLK';
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

export default function BvSection({ guideId, bvslMode, residencyIds, groupOptions, summaryOnlyGroups, improvementDetailBasePath, segment }: Props) {
  const { profile } = useUserProfile();
  const [subTab, setSubTab] = useState<SubTab>(readStoredSubTab);

  const roleUpper = String(profile?.role || '').toUpperCase();
  const isSupervisorOrAbove =
    !bvslMode ||
    !!profile?.isBvAdmin ||
    !!profile?.isBvSuperAdmin ||
    !!profile?.isBvSupervisor ||
    !!profile?.isBvMentor ||
    ['ADMIN', 'SUPER_ADMIN', 'SUPERVISOR', 'MENTOR', 'GUIDE', 'SUPER_GUIDE', 'PW_ADMIN'].includes(roleUpper);
  // RGFs and RGSFs improve the Sadhana of the members in their own groups.
  // Supervisors need both sides of the picture: the member Sadhana analysis
  // that was previously available in this tab and the BV-preaching analysis
  // for the RGFs/RGSFs reporting to them.
  const useMemberSadhanaImprovements = !isSupervisorOrAbove && (
    !!bvslMode || !!profile?.isBvSubFacilitator
  );
  const isBvSupervisorDashboard = !!bvslMode && isSupervisorOrAbove;

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, subTab); } catch {}
  }, [subTab]);

  const activeSubTab = (!isSupervisorOrAbove && subTab === 'report') ? 'bvmatrix' : subTab;

  const tabs = [
    { value: 'bvmatrix'    as SubTab, label: 'BV Report',    icon: Grid3X3    },
    ...(isSupervisorOrAbove ? [{ value: 'report' as SubTab, label: 'RGF/RGSF Report', icon: BarChart3 }] : []),
    ...(!bvslMode ? [{ value: 'sadhana'     as SubTab, label: 'RGF/RGSF Sadhana', icon: Activity   }] : []),
    { value: 'stats'       as SubTab, label: 'Stats',        icon: TrendingUp },
    { value: 'improvement' as SubTab, label: 'Improvement',  icon: Lightbulb  },
    { value: 'groups'      as SubTab, label: 'Groups',       icon: Users      },
    ...(!bvslMode ? [{ value: 'management' as SubTab, label: 'Manage Groups', icon: Settings2 }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-0 border-b border-border overflow-x-auto overflow-y-hidden scrollbar-none [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {tabs.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setSubTab(value)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              activeSubTab === value
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      <DashboardPanel active={activeSubTab === 'bvmatrix'}>{<BvSessionMatrixTab guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} segment={segment} />}</DashboardPanel>
      <DashboardPanel active={activeSubTab === 'report'}>{<BvReportTab guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} segment={segment} />}</DashboardPanel>
      <DashboardPanel active={activeSubTab === 'sadhana'}>{<SadhanaSection guideId={guideId} bvslMode={bvslMode} facilitatorMode />}</DashboardPanel>
      <DashboardPanel active={activeSubTab === 'stats'}>{<BvStatsPanel guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} showIndividualStats={isSupervisorOrAbove} groupOptions={groupOptions} segment={segment} />}</DashboardPanel>
      <DashboardPanel active={activeSubTab === 'improvement'}>{(isBvSupervisorDashboard ? (
        <div className="space-y-6">
          <div className="rounded-xl border bg-card px-4 py-3">
            <h3 className="text-sm font-semibold">Member Sadhana Improvement</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Sadhana trends, action items, and members who need personal attention.
            </p>
          </div>
          <ImprovementTab
            guideId={guideId}
            bvslMode
            initialPeriod="this_month"
            detailBasePath={improvementDetailBasePath || '/guide/users'}
          />

          <div className="rounded-xl border bg-card px-4 py-3">
            <h3 className="text-sm font-semibold">RGF/RGSF Improvement</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              RGF/RGSF preaching performance and follow-up priorities for your hierarchy.
            </p>
          </div>
          <BvImprovementTab guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} segment={segment} />
        </div>
      ) : useMemberSadhanaImprovements ? (
        <ImprovementTab
          guideId={guideId}
          bvslMode
          initialPeriod="this_month"
          detailBasePath={improvementDetailBasePath || (profile?.isBvSubFacilitator ? '/rgsf/users' : '/guide/users')}
        />
      ) : (
        <BvImprovementTab guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} segment={segment} />
      ))}</DashboardPanel>
      <DashboardPanel active={activeSubTab === 'groups'}>{<GuideBvTab guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} summaryOnly={summaryOnlyGroups} segment={segment} />}</DashboardPanel>
      <DashboardPanel active={activeSubTab === 'management'}>{!bvslMode && (
        guideId === 'ALL' && segment
          ? <BvAdminManagementTab segment={segment} isSuperGuide />
          : <BvslManagementTab guideId={guideId} />
      )}</DashboardPanel>
    </div>
  );
}
