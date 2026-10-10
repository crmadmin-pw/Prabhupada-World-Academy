import { useReactiveEffect } from '@/hooks/useReactiveEffect';
import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import React, { useEffect, useState, useCallback } from 'react';
import { Users, CheckSquare, BarChart3, BookOpen, FileText, Brain, GraduationCap, CalendarClock, ClipboardList, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getBvslGroups, getCurrentGuide } from '@/lib/endpoints-sdk';
import { useNavigate } from 'react-router-dom';
import type { GetBvslGroupsOutputType } from '@/lib/endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useAuth } from '@/lib/auth-sdk';
import { DashboardLayout } from '@/layouts';
import { LoadingPage } from '@/shared';
import TabRouter from '@/shared/TabRouter';
import type { TabConfig } from '@/shared/TabRouter';
import BvslGroupsPanel from '@/components/bvsl/BvslGroupsPanel';
import BvslSessionPanel from '@/components/bvsl/BvslSessionPanel';
import BvslMembersTable from '@/components/bvsl/BvslMembersTable';
import BvslSadhanaReportPanel from '@/components/bvsl/BvslSadhanaReportPanel';
import BvslQuizPanel from '@/components/bvsl/BvslQuizPanel';
import BvSection from '@/components/guide/BvSection';
import BvslOneToOneTab from '@/components/bvsl/BvslOneToOneTab';
import BvslWeeklyPlanTab from '@/components/bvsl/BvslWeeklyPlanTab';
import SuperBvRegistrationsTab from '@/components/super/SuperBvRegistrationsTab';
import { Toaster } from '@/components/ui/sonner';
import MeetingsAndMomTab from '@/components/super/MeetingsAndMomTab';

export default function BvslDashboard() {
  const { profile } = useUserProfile();
  const { user: authUser } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GetBvslGroupsOutputType['groups']>([]);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');

  const isFolk = profile?.segment === 'FOLK';
  const isSuperAdmin = !!(profile?.isBvSuperAdmin || profile?.role === 'SUPER_ADMIN' || profile?.isBvAdmin);
  const isSubFacilitatorOnly = Boolean(
    profile?.isBvSubFacilitator &&
    !profile?.isBvFacilitator &&
    !profile?.isBvsl &&
    !profile?.isBvSupervisor &&
    !profile?.isBvAdmin &&
    !profile?.isBvSuperAdmin
  );

  useReactiveEffect((read) => {
    if (authUser?.email && !isSuperAdmin) {
      read(() => getCurrentGuide({})).then(r => {
        if (r.guide?.fullName) !read.cancelled && setDisplayName(r.guide.fullName);
      }).catch(() => {});
    }
  }, [authUser?.email, isSuperAdmin]);

  const loadGroups = useReactiveLoader(async (read, silent = false) => {
    const bvslId = profile?.userId;
    if (!bvslId) return;
    if (!silent) !read.background && setLoading(true);
    try {
      const res = await read(() => getBvslGroups({ bvslId, viewRole: isSubFacilitatorOnly ? 'RGSF' : 'RGF' }));
      setGroups(res.groups);
    } catch {
      if (read.cancelled) return; toast.error('Failed to load groups'); }
    finally { if (!silent) setLoading(false); }
  }, [profile?.userId, isSubFacilitatorOnly]);

  useEffect(() => { if (profile?.userId) loadGroups(); }, [profile?.userId, loadGroups]);


  if (!profile) return <LoadingPage />;

  const bvslId = profile.userId || '';
  const reportGroups = groups.map(group => ({
    id: group.id,
    groupId: group.groupId || group.id,
    groupName: group.groupName,
  }));

  const canView1on1 = !isSubFacilitatorOnly;

  const tabs: TabConfig[] = [
    { value: 'weekplan',  label: 'Weekly Plan', icon: ClipboardList },
    { value: 'groups',    label: 'Groups',      icon: Users },
    { value: 'session',   label: 'Attendance',  icon: CheckSquare },
    ...(isFolk ? [{ value: 'quizzes', label: 'Quizzes', icon: Brain }] : []),
    { value: 'bvreport',  label: 'BV Report',   icon: BarChart3 },
    { value: 'report',    label: 'Sadhana',     icon: FileText },
    { value: 'members',   label: 'Members',     icon: BarChart3 },
    ...(canView1on1 ? [{ value: 'onetone', label: '1:1 Call Reports', icon: CalendarClock }] : []),
    ...(!isFolk ? [{ value: 'meetings',  label: 'Meetings & MoM', icon: Video }] : []),
  ];

  const defaultName = isFolk ? 'FOLK' : 'Prabhupada World';
  const headerName = isSuperAdmin ? defaultName : (displayName || defaultName);
  const roleTitle = isSubFacilitatorOnly ? 'RGSF Dashboard' : 'RGF Dashboard';
  const subtitle = [
    `Hare Krishna, ${headerName}!`,
    isSubFacilitatorOnly ? 'RGSF' : 'RGF',
    profile.ashrayLevel ? `Ashray: ${profile.ashrayLevel}` : null,
    profile.guideName ? `Guide: ${profile.guideName}` : null,
    profile.residencyName ? `FOLK: ${profile.residencyName}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <DashboardLayout
      title={roleTitle}
      subtitle={subtitle}
      role={profile.isBvSubFacilitator ? 'RGSF' : 'RGF'}
      maxWidth="max-w-6xl"
    >
      <Toaster />
      {loading ? <LoadingPage rows={2} /> : (
        <TabRouter tabs={tabs} defaultTab="weekplan" desktopCols={canView1on1 ? 9 : 8} preloadTabs={['groups', 'session', 'members']}>
          {(activeTab) => (
            <>
              {activeTab === 'weekplan' && <BvslWeeklyPlanTab userEmail={authUser?.email || ''} />}
              {activeTab === 'groups' && (
                <BvslGroupsPanel bvslId={bvslId} groups={groups}
                  onGroupSelect={(groupId) => navigate(`/bvsl/groups/${groupId}`)}
                  onRefresh={loadGroups} />
              )}
              {activeTab === 'session' && <BvslSessionPanel bvslId={bvslId} groups={groups} />}
              {activeTab === 'members' && <BvslMembersTable bvslId={bvslId} />}
              {activeTab === 'bvreport' && <BvSection guideId={bvslId} bvslMode groupOptions={reportGroups} />}
              {activeTab === 'report' && <BvslSadhanaReportPanel bvslId={bvslId} groupOptions={reportGroups} />}
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
