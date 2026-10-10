import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import React, { useEffect, useState, useCallback } from 'react';
import { Users, CheckSquare, BarChart3, Brain, ClipboardList, FileText, CalendarClock, Video } from 'lucide-react';
import { toast } from 'sonner';
import { getBvslGroups } from '@/lib/endpoints-sdk';
import { useNavigate } from 'react-router-dom';
import type { GetBvslGroupsOutputType } from '@/lib/endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useAuth } from '@/lib/auth-sdk';
import { DashboardLayout } from '@/layouts';
import { LoadingPage } from '@/shared';
import TabRouter, { TabConfig } from '@/shared/TabRouter';
import BvslGroupsPanel from '@/components/bvsl/BvslGroupsPanel';
import BvslSessionPanel from '@/components/bvsl/BvslSessionPanel';
import BvslMembersTable from '@/components/bvsl/BvslMembersTable';
import BvslSadhanaReportPanel from '@/components/bvsl/BvslSadhanaReportPanel';
import BvslQuizPanel from '@/components/bvsl/BvslQuizPanel';
import BvSection from '@/components/guide/BvSection';
import BvslWeeklyPlanTab from '@/components/bvsl/BvslWeeklyPlanTab';
import BvslOneToOneTab from '@/components/bvsl/BvslOneToOneTab';
import MeetingsAndMomTab from '@/components/super/MeetingsAndMomTab';

export default function RgsfDashboard() {
  const { profile } = useUserProfile();
  const { user: authUser } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GetBvslGroupsOutputType['groups']>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (profile?.userId) loadGroups(); }, [profile?.userId]);

  const loadGroups = useReactiveLoader(async (read, silent = false) => {
    const bvslId = profile?.userId;
    if (!bvslId) return;
    if (!silent) !read.background && setLoading(true);
    try {
      const res = await read(() => getBvslGroups({ bvslId, viewRole: 'RGSF' }));
      setGroups(res.groups);
    } catch {
      if (read.cancelled) return;
      toast.error('Failed to load RGSF groups');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [profile?.userId]);


  if (!profile) return <LoadingPage />;

  const bvslId = profile.userId || '';
  const reportGroups = groups.map(group => ({
    id: group.id,
    groupId: group.groupId || group.id,
    groupName: group.groupName,
  }));

  const subtitle = [
    'RGSF',
    profile.ashrayLevel ? `Ashray: ${profile.ashrayLevel}` : null,
    (profile as any).bvReportingFacilitatorName
      ? `Reports to RGF: ${(profile as any).bvReportingFacilitatorName}`
      : profile.guideName ? `Guide: ${profile.guideName}` : null,
  ].filter(Boolean).join(' · ');

  const isFolk = profile?.segment === 'FOLK';

  // RGSF Assistant Tabs (No 1:1 confidential reports or registration queues)
  const tabs: TabConfig[] = [
    { value: 'weekplan', label: 'Weekly Plan', icon: ClipboardList },
    { value: 'groups', label: 'Assigned Groups', icon: Users },
    { value: 'session', label: 'Attendance', icon: CheckSquare },
    { value: 'members', label: 'Group Members', icon: Users },
    { value: 'bvreport', label: 'BV Report', icon: BarChart3 },
    { value: 'report', label: 'Sadhana', icon: FileText },
    ...(isFolk ? [{ value: 'quizzes', label: 'Quizzes', icon: Brain }] : []),
    { value: 'onetone', label: '1:1 Calls', icon: CalendarClock },
    ...(!isFolk ? [{ value: 'meetings', label: 'Meetings & MoM', icon: Video }] : []),
  ];

  return (
    <DashboardLayout
      title={`Hare Krishna, ${profile.fullName}!`}
      subtitle={subtitle}
      role="RGSF"
      maxWidth="max-w-6xl"
    >
      {loading ? <LoadingPage rows={2} /> : (
        <TabRouter tabs={tabs} defaultTab="weekplan" desktopCols={9} preloadTabs={['groups', 'session', 'members']}>
          {(activeTab) => (
            <>
              {activeTab === 'weekplan' && <BvslWeeklyPlanTab userEmail={authUser?.email || ''} />}
              {activeTab === 'groups' && (
                <BvslGroupsPanel
                  bvslId={bvslId}
                  groups={groups}
                  onGroupSelect={(groupId) => navigate(`/bvsl/groups/${groupId}`)}
                  onRefresh={loadGroups}
                />
              )}
              {activeTab === 'session' && <BvslSessionPanel bvslId={bvslId} groups={groups} />}
              {activeTab === 'members' && <BvslMembersTable bvslId={bvslId} detailBasePath="/rgsf/users" />}
              {activeTab === 'bvreport' && (
                <BvSection
                  guideId={bvslId}
                  bvslMode
                  segment={isFolk ? 'FOLK' : 'PW'}
                  improvementDetailBasePath="/rgsf/users"
                  groupOptions={reportGroups}
                />
              )}
              {activeTab === 'report' && <BvslSadhanaReportPanel bvslId={bvslId} hideImprovement={!isFolk} groupOptions={reportGroups} />}
              {isFolk && activeTab === 'quizzes' && (
                <BvslQuizPanel
                  groups={groups.map((g: any) => ({ id: g.id, groupName: g.groupName }))}
                />
              )}
              {activeTab === 'onetone' && <BvslOneToOneTab />}
              {!isFolk && activeTab === 'meetings' && <MeetingsAndMomTab department="PW" />}
            </>
          )}
        </TabRouter>
      )}
    </DashboardLayout>
  );
}
