import DashboardPanel from '@/components/DashboardPanel';
import { useState, useEffect, lazy, Suspense } from 'react';
import { BarChart3, TrendingUp, Lightbulb, Users, Square as Grid3X3, Activity, Settings2 } from 'lucide-react';
import BvSessionMatrixTab from '@/components/guide/BvSessionMatrixTab';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserProfile } from '@/contexts/UserProfileContext';
import type { SadhanaGroupOption } from '@/components/guide/ReportsTab';

// The report matrix is the tab users land on. The other panels, including the
// charting library, load only when their tab is opened.
const BvReportTab = lazy(() => import('@/components/guide/BvReportTab'));
const BvStatsPanel = lazy(() => import('@/components/guide/BvStatsPanel'));
const BvImprovementTab = lazy(() => import('@/components/guide/BvImprovementTab'));
const GuideBvTab = lazy(() => import('@/components/guide/GuideBvTab'));
const SadhanaSection = lazy(() => import('@/components/guide/SadhanaSection'));
const StatsOverviewPanel = lazy(() => import('@/components/guide/StatsOverviewPanel'));
const BvslManagementTab = lazy(() => import('@/components/guide/BvslManagementTab'));
const BvAdminManagementTab = lazy(() => import('@/components/super/BvAdminManagementTab'));
const ImprovementTab = lazy(() => import('@/components/guide/ImprovementTab'));

function PanelFallback() {
  return <Skeleton className="h-40 w-full" />;
}

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
  showManagementTab?: boolean;
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

export default function BvSection({ guideId, bvslMode, residencyIds, groupOptions, summaryOnlyGroups, improvementDetailBasePath, segment, showManagementTab = !bvslMode }: Props) {
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

  const requestedSubTab = !showManagementTab && subTab === 'management'
    ? 'groups'
    : ((!isSupervisorOrAbove && subTab === 'report') ? 'bvmatrix' : subTab);
  const activeSubTab = segment === 'PW' && (requestedSubTab === 'report' || requestedSubTab === 'improvement')
    ? 'bvmatrix'
    : requestedSubTab;

  const tabs = [
    { value: 'bvmatrix'    as SubTab, label: 'BV Report',    icon: Grid3X3    },
    ...(isSupervisorOrAbove && segment !== 'PW' ? [{ value: 'report' as SubTab, label: 'RGF/RGSF Report', icon: BarChart3 }] : []),
    ...(!bvslMode ? [{ value: 'sadhana'     as SubTab, label: 'RGF/RGSF Sadhana', icon: Activity   }] : []),
    { value: 'stats'       as SubTab, label: 'Stats',        icon: TrendingUp },
    ...(segment === 'PW' ? [] : [{ value: 'improvement' as SubTab, label: 'Improvement', icon: Lightbulb }]),
    { value: 'groups'      as SubTab, label: 'Groups',       icon: Users      },
    ...(showManagementTab ? [{ value: 'management' as SubTab, label: 'Manage Groups', icon: Settings2 }] : []),
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
      <DashboardPanel active={activeSubTab === 'report'}><Suspense fallback={<PanelFallback />}><BvReportTab guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} segment={segment} /></Suspense></DashboardPanel>
      <DashboardPanel active={activeSubTab === 'sadhana'}><Suspense fallback={<PanelFallback />}><SadhanaSection guideId={guideId} bvslMode={bvslMode} facilitatorMode hideImprovement={segment === 'PW'} /></Suspense></DashboardPanel>
      <DashboardPanel active={activeSubTab === 'stats'}><Suspense fallback={<PanelFallback />}>{segment === 'PW'
        ? <StatsOverviewPanel guideId={guideId} bvslMode={bvslMode} groupOptions={groupOptions} />
        : <BvStatsPanel guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} showIndividualStats={isSupervisorOrAbove} groupOptions={groupOptions} segment={segment} />
      }</Suspense></DashboardPanel>
      <DashboardPanel active={activeSubTab === 'improvement'}><Suspense fallback={<PanelFallback />}>{(isBvSupervisorDashboard ? (
        <div className="space-y-6">
          {segment !== 'PW' && (
          <>
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
          </>
          )}

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
      ))}</Suspense></DashboardPanel>
      <DashboardPanel active={activeSubTab === 'groups'}><Suspense fallback={<PanelFallback />}><GuideBvTab guideId={guideId} bvslMode={bvslMode} residencyIds={residencyIds} summaryOnly={summaryOnlyGroups} segment={segment} /></Suspense></DashboardPanel>
      <DashboardPanel active={activeSubTab === 'management'}><Suspense fallback={<PanelFallback />}>{!bvslMode && (
        guideId === 'ALL' && segment
          ? <BvAdminManagementTab segment={segment} isSuperGuide />
          : <BvslManagementTab guideId={guideId} />
      )}</Suspense></DashboardPanel>
    </div>
  );
}
