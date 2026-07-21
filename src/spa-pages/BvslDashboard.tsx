import { useEffect, useState, useCallback } from 'react';
import { Users, CheckSquare, BarChart3, BookOpen, FileText, Brain, GraduationCap, CalendarClock, ClipboardList, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getBvslGroups, getPendingBvRegistrations } from 'zite-endpoints-sdk';
import { useNavigate } from 'react-router-dom';
import type { GetBvslGroupsOutputType } from 'zite-endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useAuth } from 'zite-auth-sdk';
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

export default function BvslDashboard() {
  const { profile } = useUserProfile();
  const { user: authUser } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GetBvslGroupsOutputType['groups']>([]);
  const [loading, setLoading] = useState(true);
  const [bvRegCount, setBvRegCount] = useState(0);

  useEffect(() => { if (profile?.userId) loadGroups(); }, [profile?.userId]);

  const loadGroups = useCallback(async () => {
    const bvslId = profile?.userId;
    if (!bvslId) return;
    setLoading(true);
    try {
      const [res, bvRegs] = await Promise.all([
        getBvslGroups({ bvslId }),
        getPendingBvRegistrations({}).catch(() => []),
      ]);
      setGroups(res.groups);
      setBvRegCount(Array.isArray(bvRegs) ? bvRegs.length : 0);
    } catch { toast.error('Failed to load groups'); }
    finally { setLoading(false); }
  }, [profile?.userId]);

  if (!profile) return <LoadingPage />;

  const bvslId = profile.userId || '';

  const isSubFacilitatorOnly = Boolean(
    profile.isBvSubFacilitator &&
    !profile.isBvFacilitator &&
    !profile.isBvsl &&
    !profile.isBvSupervisor &&
    !profile.isBvAdmin &&
    !profile.isBvSuperAdmin
  );
  const canView1on1 = !isSubFacilitatorOnly;

  const tabs: TabConfig[] = [
    { value: 'weekplan',  label: 'Weekly Plan', icon: ClipboardList },
    { value: 'groups',    label: 'Groups',      icon: Users },
    { value: 'session',   label: 'Attendance',  icon: CheckSquare },
    { value: 'pending',   label: `Pending Applicants${bvRegCount > 0 ? ` (${bvRegCount})` : ''}`, icon: Clock },
    { value: 'quizzes',   label: 'Quizzes',     icon: Brain },
    { value: 'bvreport',  label: 'BV Report',   icon: BarChart3 },
    { value: 'report',    label: 'Sadhana',     icon: FileText },
    { value: 'members',   label: 'Members',     icon: BarChart3 },
    ...(canView1on1 ? [{ value: 'onetone', label: '1:1 Call Reports', icon: CalendarClock }] : []),
  ];

  const roleTitle = isSubFacilitatorOnly ? 'Reading Group Sub-Facilitator' : 'Reading Group Facilitator';
  const subtitle = [
    roleTitle,
    profile.ashrayLevel ? `Ashray: ${profile.ashrayLevel}` : null,
    profile.guideName ? `Guide: ${profile.guideName}` : null,
    profile.residencyName ? `FOLK: ${profile.residencyName}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <DashboardLayout
      title={`Hare Krishna, ${profile.fullName} Prabhu`}
      subtitle={subtitle}
      maxWidth="max-w-6xl"
    >
      <Toaster />
      {loading ? <LoadingPage rows={2} /> : (
        <TabRouter tabs={tabs} defaultTab="weekplan" desktopCols={9}>
          {(activeTab) => (
            <>
              {activeTab === 'weekplan' && <BvslWeeklyPlanTab userEmail={authUser?.email || ''} />}
              {activeTab === 'groups' && (
                <BvslGroupsPanel bvslId={bvslId} groups={groups}
                  onGroupSelect={(groupId) => navigate(`/bvsl/groups/${groupId}`)}
                  onRefresh={loadGroups} />
              )}
              {activeTab === 'session' && <BvslSessionPanel bvslId={bvslId} groups={groups} />}
              {activeTab === 'pending' && <SuperBvRegistrationsTab />}
              {activeTab === 'members' && <BvslMembersTable bvslId={bvslId} />}
              {activeTab === 'bvreport' && <BvSection guideId={bvslId} bvslMode />}
              {activeTab === 'report' && <BvslSadhanaReportPanel bvslId={bvslId} />}
              {activeTab === 'quizzes' && (
                <BvslQuizPanel
                  bvslId={bvslId}
                  groups={groups.map((g: any) => ({ id: g.id, groupName: g.groupName }))}
                />
              )}
              {activeTab === 'onetone' && <BvslOneToOneTab />}
            </>
          )}
        </TabRouter>
      )}
    </DashboardLayout>
  );
}
