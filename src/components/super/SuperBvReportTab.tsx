import DashboardPanel from '@/components/DashboardPanel';
import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import BvSection from '@/components/guide/BvSection';
import SuperGuideBvSection from './SuperGuideBvSection';
import SuperBvPreachingAnalytics from './SuperBvPreachingAnalytics';
import { getGuides } from '@/lib/endpoints-sdk';
import type { GetGuidesOutputType } from '@/lib/endpoints-sdk';
import { BarChart3, TrendingUp } from 'lucide-react';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useEndpointQuery } from '@/hooks/useEndpointQuery';

type SubTab = 'overview' | 'preaching';

const SUB_TABS: { value: SubTab; label: string; icon: React.ElementType; desc: string }[] = [
  { value: 'overview',  label: 'BV Overview',         icon: BarChart3,   desc: 'Attendance, sessions, and group stats' },
  { value: 'preaching', label: 'Preaching Analytics', icon: TrendingUp,  desc: 'Center-wise RGF/RGSF preaching field breakdown' },
];

interface SuperBvReportTabProps {
  isPwAdmin?: boolean;
  segment?: 'PW' | 'FOLK';
  guideId?: string;
  isSuperAdminOverride?: boolean;
}

export default function SuperBvReportTab({ isPwAdmin = false, segment, guideId, isSuperAdminOverride }: SuperBvReportTabProps) {
  const { profile } = useUserProfile();
  const userEmail = ((profile as any)?.email || profile?.userId || '').toLowerCase();
  const isSuperAdmin = isSuperAdminOverride !== undefined ? isSuperAdminOverride : !!(
    profile?.isBvSuperAdmin ||
    profile?.role === 'SUPER_ADMIN' ||
    profile?.role === 'SUPER_GUIDE'
  );
  const scopedGuideId = guideId || userEmail;

  const [selectedGuide, setSelectedGuide] = useState(() => (isSuperAdmin ? 'all' : scopedGuideId));
  const [subTab, setSubTab]               = useState<SubTab>('overview');

  const effectiveSegment = segment || (isPwAdmin ? 'PW' : 'FOLK');

  const guideQuery = useEndpointQuery<GetGuidesOutputType>('getGuides', { segment: effectiveSegment });
  const guides = guideQuery.data?.guides || [];

  useEffect(() => {
    if (profile && !isSuperAdmin) {
      setSelectedGuide(scopedGuideId);
    }
  }, [profile, isSuperAdmin, scopedGuideId]);

  return (
    <div className="space-y-4">
      {/* Sub-tab nav */}
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

      {/* ── BV Overview (existing) ── */}
      <DashboardPanel active={subTab === 'overview'}>{(
        <div className="space-y-4">
          {isSuperAdmin && (
            <div className="flex items-center gap-3 flex-wrap">
              <Label className="text-sm shrink-0">{isPwAdmin ? "Filter by Admin / Mentor:" : "Filter by Guide:"}</Label>
              <Select value={selectedGuide} onValueChange={(v) => setSelectedGuide(v || 'all')}>
                <SelectTrigger className="w-56 h-9">
                  <SelectValue>{selectedGuide === 'all' ? (isPwAdmin ? "All Admins (Overview)" : "All Guides (Overview)") : guides.find((g: any) => g.guideId === selectedGuide)?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isPwAdmin ? "All Admins (Overview)" : "All Guides (Overview)"}</SelectItem>
                  {guides.map((g: any) => (
                    <SelectItem key={g.guideId} value={g.guideId}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {selectedGuide === 'all' && !isPwAdmin
            ? <SuperGuideBvSection />
            : <BvSection guideId={selectedGuide === 'all' ? 'ALL' : selectedGuide} segment={effectiveSegment} showManagementTab={false} />
          }
        </div>
      )}</DashboardPanel>

      {/* ── Preaching Analytics (new) ── */}
      <DashboardPanel active={subTab === 'preaching'}>{<SuperBvPreachingAnalytics />}</DashboardPanel>
    </div>
  );
}
