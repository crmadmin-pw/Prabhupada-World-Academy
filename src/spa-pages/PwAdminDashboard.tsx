import { useReactiveEffect } from '@/hooks/useReactiveEffect';
import { MobileSectionNav } from '@/components/mobile/DashboardNavigation';
import DashboardPanel from '@/components/DashboardPanel';
import { useDashboardPrefetch } from '@/hooks/useDashboardPrefetch';
import { dashboardScope } from '@/lib/dashboardScope';
import React, { useCallback, useEffect, useRef, useState, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, CalendarCheck, LayoutGrid, AlertCircle, ClipboardCheck, Database, Leaf, CalendarClock, Bell, Video, Brain } from 'lucide-react';
import { useAuth } from '@/lib/auth-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { getUserDashboardPath } from '@/lib/userDashboardRoutes';
import { DashboardLayout } from '@/layouts';
import { LoadingPage } from '@/shared';
import TabTransition from '@/components/TabTransition';
import TabErrorBoundary from '@/components/TabErrorBoundary';
import { motion } from 'framer-motion';
import { useReactiveLoader } from '@/hooks/useReactiveLoader';

const SuperBvReportTab = lazy(() => import('@/components/super/SuperBvReportTab'));
const SuperUsersPanel = lazy(() => import('@/components/super/SuperUsersPanel'));
const SuperStatsPanel = lazy(() => import('@/components/super/SuperStatsPanel'));
const SendRemindersPanel = lazy(() => import('@/components/super/SendRemindersPanel'));
const ReportsTab = lazy(() => import('@/components/guide/ReportsTab'));
const MissingSadhanaTab = lazy(() => import('@/components/guide/MissingSadhanaTab'));
const ApprovalsTab = lazy(() => import('@/components/guide/ApprovalsTab'));
const SuperBvRegistrationsTab = lazy(() => import('@/components/super/SuperBvRegistrationsTab'));
const BvAdminManagementTab = lazy(() => import('@/components/super/BvAdminManagementTab'));
const MeetingsAndMomTab = lazy(() => import('@/components/super/MeetingsAndMomTab'));
const BvslOneToOneTab = lazy(() => import('@/components/bvsl/BvslOneToOneTab'));
const PwQuizPanel = lazy(() => import('@/components/bv/PwQuizPanel'));
import {
  getCurrentGuide, getPushSubscriptionStats, GetPushSubscriptionStatsOutputType,
  getPendingApprovals, getGuideRequests, getCleanlinessReviews,
  getPendingBvRegistrations,
} from '@/lib/endpoints-sdk';

export default function PwAdminDashboard() {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const navigate = useNavigate();
  const isFolk = profile?.segment === 'FOLK';

  const isSuperAdmin = !!(
    profile?.isBvSuperAdmin ||
    profile?.role === 'SUPER_ADMIN'
  );

  const dashboardTitle = isSuperAdmin
    ? "Prabhupada World Super Admin Dashboard"
    : "Prabhupada World Admin Dashboard";

  const isBvAdminUser = isSuperAdmin || !!(profile?.isBvAdmin || (profile?.role as string) === 'ADMIN' || (profile?.role as string) === 'SUPER_ADMIN');

  useEffect(() => {
    if (profile) {
      if (!isBvAdminUser) {
        const targetUserDashboard = getUserDashboardPath(profile);
        navigate(targetUserDashboard, { replace: true });
      } else if (isFolk) {
        navigate('/folk-guide/dashboard', { replace: true });
      }
    }
  }, [profile, isBvAdminUser, isFolk, navigate]);

  const dashboardRole = isSuperAdmin ? "SUPER_ADMIN" : (isBvAdminUser ? "ADMIN" : "USER");
  const adminGroupScopeId = profile?.userId || user?.email || '';
  const [adminName, setAdminName] = useState(profile?.fullName || 'Administrator');
  const [pushStats, setPushStats] = useState<GetPushSubscriptionStatsOutputType | null>(null);

  const requestedInitialTab = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
  const initialTab = ['attendance', 'jigyasa', 'tagmango'].includes(requestedInitialTab)
    ? 'sadhana'
    : requestedInitialTab || 'sadhana';
  const [activeTab, setActiveTab] = useState(initialTab);
  const prefetchTab = useDashboardPrefetch({ enabled: !!profile && isBvAdminUser && !isFolk, segment: 'PW', isSuperAdmin, guideId: adminGroupScopeId, activeTab, residencyId: (profile as any)?.folkResidencyCustomId });
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([initialTab]));
  useEffect(() => {
    setVisitedTabs(prev => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);
  const [approvalCount, setApprovalCount] = useState(0);
  const [bvRegCount, setBvRegCount] = useState(0);
  const resolvedBvRegistrationIdsRef = useRef<Set<string>>(new Set());
  const approvalCountEpoch = useRef(0);
  const approvalGuideId = isSuperAdmin ? 'ALL' : adminGroupScopeId;
  const reportApprovalCount = useCallback((count: number) => {
    approvalCountEpoch.current += 1;
    setApprovalCount(count);
  }, []);

  // Sync with browser back/forward buttons
  useEffect(() => {
    const onPop = () => {
      const hash = window.location.hash.slice(1);
      if (hash && !['attendance', 'jigyasa', 'tagmango'].includes(hash)) {
        setActiveTab(hash);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    window.history.pushState(null, '', `#${tab}`);
  };

  useReactiveEffect((read) => {
    if (user?.email) {
      read(() => getCurrentGuide({})).then(r => {
        if (r.guide?.fullName) !read.cancelled && setAdminName(r.guide.fullName);
      }).catch(() => {});
      read(() => getPushSubscriptionStats({ segment: 'PW' })).then(setPushStats).catch(() => {});
    }
  }, [user?.email]);

  const fetchCounts = useReactiveLoader(async (read) => {
      const epoch = approvalCountEpoch.current;
      await read(() => Promise.all([
        getPendingApprovals({ guideId: approvalGuideId }),
        getGuideRequests({ guideId: approvalGuideId }),
        getPendingBvRegistrations({ segment: 'PW' }).catch(() => []),
      ])).then(([pending, requests, bvRegs]) => {
        const registrations = Array.isArray(bvRegs) ? bvRegs : [];
        const fetchedIds = new Set(registrations.map(reg => String(reg.id)));
        for (const resolvedId of resolvedBvRegistrationIdsRef.current) {
          if (!fetchedIds.has(resolvedId)) {
            resolvedBvRegistrationIdsRef.current.delete(resolvedId);
          }
        }
        // The open Approvals page reports the lists the admin can actually see.
        // Ignore an older sidebar read that still includes a request just approved.
        if (epoch === approvalCountEpoch.current) {
          setApprovalCount(
            pending.length + (requests?.ashrayUpgrades || []).length
          );
        }
        setBvRegCount(registrations.filter(
          reg => !resolvedBvRegistrationIdsRef.current.has(String(reg.id)),
        ).length);
      }).catch(() => {});
  }, [approvalGuideId]);

  const handleBvRegistrationResolved = useCallback((registrationId: string) => {
    resolvedBvRegistrationIdsRef.current.add(registrationId);
    setBvRegCount(current => Math.max(0, current - 1));
  }, []);

  // One initial scoped read, followed by event-driven updates from Firestore.
  useEffect(() => { void fetchCounts(); }, [fetchCounts]);

  const navItems = [
    { value: 'sadhana', label: 'Sadhana Report', icon: Database },
    { value: 'bv', label: 'Bhakti Vriksha Report', icon: CalendarCheck },
    { value: 'users', label: 'Members / Users', icon: Users },
    { value: 'approvals', label: 'Approvals', icon: ClipboardCheck, badge: approvalCount },
    { value: 'bhakti-vriksha', label: 'Bhakti Vriksha', icon: Leaf, badge: bvRegCount },
    { value: 'quizzes', label: 'Quizzes', icon: Brain },
    { value: 'meetings', label: 'Meetings & MoM', icon: Video },
    { value: 'reminders', label: 'Notifications', icon: Bell },
    ...(isSuperAdmin ? [{ value: 'stats', label: 'Stats', icon: LayoutGrid }] : []),
    { value: 'missing-sadhana', label: 'Missing Sadhana', icon: AlertCircle },
    { value: 'callreports', label: '1:1 Call Reports', icon: CalendarClock },
  ];

  const SidebarButton = ({ value, label, icon: Icon, badge }: { value: string; label: string; icon: any; badge?: number }) => {
    const isActive = activeTab === value || (value === 'bhakti-vriksha' && activeTab === 'bv-registrations');
    return (
      <button
        onClick={() => handleTabChange(value)}
        onMouseEnter={() => prefetchTab(value)}
        onFocus={() => prefetchTab(value)}
        className="relative w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
      >
        {isActive && (
          <motion.div
            layoutId="pwActiveHighlight"
            className="absolute inset-0 bg-primary/10 rounded-lg border border-primary/20"
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          />
        )}
        <div className="relative z-10 flex items-center gap-2">
          <Icon className={`w-4 h-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
          <span className={isActive ? 'text-primary font-semibold text-left' : 'text-left'}>{label}</span>
        </div>
        {badge != null && badge > 0 && (
          <span className="relative z-10 bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
            {badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <DashboardLayout
      title={dashboardTitle}
      subtitle={`Hare Krishna, ${profile?.fullName || adminName || 'Admin'}!`}
      role={dashboardRole}
      maxWidth="max-w-none"
    >
      <MobileSectionNav items={navItems.map(item => ({ id: item.value, label: item.label, icon: item.icon, badge: item.badge }))}
        activeId={['bv-registrations', 'bv-admins'].includes(activeTab) ? 'bhakti-vriksha' : activeTab}
        onSelect={handleTabChange} onIntent={prefetchTab} />

      <div className="flex flex-col md:flex-row gap-6">
        {/* Desktop Sidebar Navigation */}
        <div className="hidden md:block w-64 shrink-0 sticky top-[93px] self-start max-h-[calc(100vh-125px)] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="bg-card border rounded-xl p-3 space-y-0.5 shadow-sm">
            {navItems.map((item) => (
              <SidebarButton
                key={item.value}
                value={item.value}
                label={item.label}
                icon={item.icon}
                badge={item.badge}
              />
            ))}
          </div>
        </div>

        {/* Content Pane */}
        <div className="flex-1 min-w-0 bg-card border rounded-xl p-3 sm:p-4 lg:p-6 shadow-sm min-h-[500px]">
          <TabErrorBoundary tabName={activeTab}>
            <Suspense fallback={<LoadingPage rows={2} />}>
              <TabTransition key={dashboardScope(profile)} activeTab={activeTab}>
                {visitedTabs.has('sadhana') && (
                  <DashboardPanel active={activeTab === 'sadhana'}>
                    <div className="space-y-1 mb-4">
                      <h2 className="text-lg font-bold">Sadhana Reports</h2>
                      <p className="text-sm text-muted-foreground">Overview of all Prabhupada World sadhana records</p>
                    </div>
                    <ReportsTab guideId="ALL" />
                  </DashboardPanel>
                )}

                {visitedTabs.has('bv') && (
                  <DashboardPanel active={activeTab === 'bv'}>
                    <div className="space-y-1 mb-4">
                      <h2 className="text-lg font-bold">Bhakti Vriksha Report</h2>
                      <p className="text-sm text-muted-foreground">Attendance, chanting, and reading</p>
                    </div>
                    <SuperBvReportTab
                      isPwAdmin={true}
                      guideId={adminGroupScopeId}
                      isSuperAdminOverride={isSuperAdmin}
                    />
                  </DashboardPanel>
                )}

                {visitedTabs.has('users') && (
                  <DashboardPanel active={activeTab === 'users'}>
                    <div className="space-y-1 mb-4">
                      <h2 className="text-lg font-bold">Prabhupada World Members</h2>
                      <p className="text-sm text-muted-foreground">All registered members — sortable, filterable, with role management</p>
                    </div>
                    <SuperUsersPanel isPwAdmin={true} />
                  </DashboardPanel>
                )}

                {visitedTabs.has('approvals') && (
                  <DashboardPanel active={activeTab === 'approvals'}>
                    <div className="space-y-1 mb-4">
                      <h2 className="text-lg font-bold">Registrations & Ashraya Approvals</h2>
                      <p className="text-sm text-muted-foreground">Review new registrations and Ashraya upgrade requests for Prabhupada World members</p>
                    </div>
                    <ApprovalsTab guideId={approvalGuideId} isSuperGuide={isSuperAdmin} isPwAdmin={true} onCountLoaded={reportApprovalCount} />
                  </DashboardPanel>
                )}

                {(visitedTabs.has('bhakti-vriksha') || visitedTabs.has('bv-registrations')) && (
                  <div className={(activeTab === 'bhakti-vriksha' || activeTab === 'bv-registrations') ? 'space-y-6 block' : 'hidden'}>
                    <SuperBvRegistrationsTab
                      segment="PW"
                      guideId={adminGroupScopeId}
                      isSuperGuide={isSuperAdmin}
                      onRegistrationResolved={handleBvRegistrationResolved}
                    />
                    <hr className="my-6 border-t" />
                    <BvAdminManagementTab
                      segment="PW"
                      guideId={adminGroupScopeId}
                      isSuperGuide={isSuperAdmin}
                    />
                  </div>
                )}

                {visitedTabs.has('reminders') && (
                  <DashboardPanel active={activeTab === 'reminders'}>
                    <div className="space-y-1 mb-4">
                      <h2 className="text-lg font-bold">Sadhana Reminders & Notifications</h2>
                      <p className="text-sm text-muted-foreground">Configure automatic Sadhana reminders, custom schedule times, and dispatch instant push notifications</p>
                    </div>
                    <div className="space-y-6">
                      <SendRemindersPanel segment="PW" />
                    </div>
                  </DashboardPanel>
                )}

                {visitedTabs.has('stats') && isSuperAdmin && (
                  <DashboardPanel active={activeTab === 'stats'}>
                    <div className="space-y-1 mb-4">
                      <h2 className="text-lg font-bold">System Stats & Administration</h2>
                      <p className="text-sm text-muted-foreground">Aggregate metrics and data management</p>
                    </div>
                    <div className="space-y-6">
                      <SuperStatsPanel isActive={activeTab === 'stats'} />
                    </div>
                  </DashboardPanel>
                )}

                {visitedTabs.has('missing-sadhana') && (
                  <DashboardPanel active={activeTab === 'missing-sadhana'}>
                    <MissingSadhanaTab guideId="ALL" />
                  </DashboardPanel>
                )}

                {visitedTabs.has('quizzes') && (
                  <DashboardPanel active={activeTab === 'quizzes'}>
                    <div className="space-y-1 mb-4">
                      <h2 className="text-lg font-bold">Quizzes</h2>
                      <p className="text-sm text-muted-foreground">Create quizzes for Prabhupada World. Facilitators turn each quiz on for their own reading groups.</p>
                    </div>
                    <PwQuizPanel mode="admin" />
                  </DashboardPanel>
                )}

                {visitedTabs.has('meetings') && (
                  <DashboardPanel active={activeTab === 'meetings'}>
                    <MeetingsAndMomTab allowSchedule={true} />
                  </DashboardPanel>
                )}

                {visitedTabs.has('callreports') && (
                  <DashboardPanel active={activeTab === 'callreports'}>
                    <div className="space-y-1 mb-4">
                      <h2 className="text-lg font-bold">1:1 Call Reports</h2>
                      <p className="text-sm text-muted-foreground">All one-on-one call logs between RGFs and their members</p>
                    </div>
                    <BvslOneToOneTab />
                  </DashboardPanel>
                )}
              </TabTransition>
            </Suspense>
          </TabErrorBoundary>
        </div>
      </div>
    </DashboardLayout>
  );
}
