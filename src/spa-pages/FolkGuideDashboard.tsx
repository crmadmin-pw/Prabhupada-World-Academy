import { useReactiveEffect } from '@/hooks/useReactiveEffect';
import { MobileSectionNav } from '@/components/mobile/DashboardNavigation';
import DashboardPanel from '@/components/DashboardPanel';
import { useDashboardPrefetch } from '@/hooks/useDashboardPrefetch';
import { dashboardScope } from '@/lib/dashboardScope';
import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Users, CalendarCheck, BookOpen, LayoutGrid, AlertCircle, Zap, ClipboardCheck, Database, Building2, CalendarClock } from 'lucide-react';
import { useAuth } from '@/lib/auth-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { getUserDashboardPath } from '@/lib/userDashboardRoutes';
import { DashboardLayout } from '@/layouts';
import TabTransition from '@/components/TabTransition';
import { motion } from 'framer-motion';
import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { LoadingPage } from '@/shared';
import {
  getCurrentGuide, getPushSubscriptionStats, GetPushSubscriptionStatsOutputType,
  getPendingApprovals, getGuideRequests, getResidencyTransferRequests, getCleanlinessReviews, getPendingBvRegistrations,
} from '@/lib/endpoints-sdk';

const BvslOneToOneTab = lazy(() => import('@/components/bvsl/BvslOneToOneTab'));
const SuperBvReportTab = lazy(() => import('@/components/super/SuperBvReportTab'));
const SuperUsersPanel = lazy(() => import('@/components/super/SuperUsersPanel'));
const SuperStatsPanel = lazy(() => import('@/components/super/SuperStatsPanel'));
const SendRemindersPanel = lazy(() => import('@/components/super/SendRemindersPanel'));
const ReportsTab = lazy(() => import('@/components/guide/ReportsTab'));
const MissingSadhanaTab = lazy(() => import('@/components/guide/MissingSadhanaTab'));
const TagMangoConfigTab = lazy(() => import('@/components/super/TagMangoConfigTab'));
const SuperAttendanceTab = lazy(() => import('@/components/super/SuperAttendanceTab'));
const JigyasaTrackerTab = lazy(() => import('@/components/jigyasa/JigyasaTrackerTab'));
const ApprovalsTab = lazy(() => import('@/components/guide/ApprovalsTab'));
const SuperBvRegistrationsTab = lazy(() => import('@/components/super/SuperBvRegistrationsTab'));
const BvAdminManagementTab = lazy(() => import('@/components/super/BvAdminManagementTab'));
const FolkResidencyManagement = lazy(() => import('@/components/super/FolkResidencyManagement'));
const AshrayExamDateSettings = lazy(() => import('@/components/profile/AshrayExamDateSettings'));

export default function FolkGuideDashboard() {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const navigate = useNavigate();
  const userEmail = (user?.email || '').toLowerCase();

  const queryParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const isForceGuideMode = queryParams.get('mode') === 'guide';
  const normalizedProfileRole = String(profile?.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');

  const isSuperAdmin = !isForceGuideMode && !!(
    profile?.isBvSuperAdmin ||
    normalizedProfileRole === 'SUPER_ADMIN' ||
    normalizedProfileRole === 'SUPER_GUIDE'
  );

  const dashboardTitle = isSuperAdmin
    ? "FOLK Super Guide Dashboard"
    : "FOLK Guide Dashboard";

  const isFolk = profile?.segment === 'FOLK';

  const isBvAdminUser = isSuperAdmin || isForceGuideMode || !!(
    profile?.isBvAdmin ||
    normalizedProfileRole === 'GUIDE' ||
    normalizedProfileRole === 'ADMIN' ||
    normalizedProfileRole === 'SUPER_ADMIN'
  );

  useEffect(() => {
    if (profile) {
      if (!isBvAdminUser) {
        navigate(getUserDashboardPath(profile), { replace: true });
      } else if (profile.segment !== 'FOLK') {
        navigate('/pw-admin/dashboard', { replace: true });
      }
    }
  }, [profile, isBvAdminUser, navigate]);

  const dashboardRole = isSuperAdmin ? "SUPER_ADMIN" : (isBvAdminUser ? "ADMIN" : "USER");
  const [adminName, setAdminName] = useState(profile?.fullName || "");
  const [guideId, setGuideId] = useState<string>('');

  const initialTab = typeof window !== 'undefined' ? window.location.hash.slice(1) || 'sadhana' : 'sadhana';
  const [activeTab, setActiveTab] = useState(initialTab);
  const prefetchTab = useDashboardPrefetch({ enabled: !!profile && isBvAdminUser && isFolk && (isSuperAdmin || !!guideId), segment: 'FOLK', isSuperAdmin, guideId, activeTab, residencyId: (profile as any)?.folkResidencyCustomId });
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

  useEffect(() => {
    const onPop = () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        setActiveTab(hash);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    const search = typeof window !== 'undefined' ? window.location.search : '';
    window.history.pushState(null, '', `${search}#${tab}`);
  };

  useReactiveEffect((read) => {
    if (user?.email) {
      read(() => getCurrentGuide({})).then(r => {
        if (r.guide?.fullName) !read.cancelled && setAdminName(r.guide.fullName);
        // Use the endpoint's resolved guide identity for scoped RGF/group reads.
        const resolvedGuideId = r.guide?.guideId || '';
        if (resolvedGuideId) !read.cancelled && setGuideId(resolvedGuideId);
      }).catch(() => {});

    }
  }, [user?.email]);

  const fetchCounts = useReactiveLoader(async (read) => {
    if (!user?.email || (!isSuperAdmin && !guideId)) return Promise.resolve();
    return read(() => Promise.all([
          getPendingApprovals({ guideId: isSuperAdmin ? 'ALL' : guideId }).catch(() => []),
          getGuideRequests({ guideId: isSuperAdmin ? 'ALL' : guideId }).catch(() => ({ guideTransfers: [], ashrayUpgrades: [] })),
          getResidencyTransferRequests({ guideId: isSuperAdmin ? 'ALL' : guideId } as any).catch(() => []),
          getCleanlinessReviews({ guideId: isSuperAdmin ? 'ALL' : guideId }).catch(() => []),
          getPendingBvRegistrations({ segment: 'FOLK', ...(!isSuperAdmin && guideId ? { guideId } : {}) }).catch(() => []),
        ])).then(([pending, requests, resTrans, cleanReviews, bvRegs]) => {
          const pendingArr = Array.isArray(pending) ? pending : (pending as any).records || [];
          const guideTransfers = Array.isArray(requests?.guideTransfers) ? requests.guideTransfers : [];
          const ashrayUpgrades = Array.isArray(requests?.ashrayUpgrades) ? requests.ashrayUpgrades : [];
          const resTransfers = Array.isArray(resTrans) ? resTrans : [];
          const cleanliness = Array.isArray(cleanReviews) ? cleanReviews : [];

          const totalUserApprovals = pendingArr.length + guideTransfers.length + ashrayUpgrades.length + resTransfers.length + cleanliness.length;
          setApprovalCount(totalUserApprovals);

          const bvRegsArr = Array.isArray(bvRegs) ? bvRegs : (bvRegs as any).records || [];
          const fetchedIds = new Set(bvRegsArr.map((reg: any) => String(reg.id)));
          for (const resolvedId of resolvedBvRegistrationIdsRef.current) {
            if (!fetchedIds.has(resolvedId)) {
              resolvedBvRegistrationIdsRef.current.delete(resolvedId);
            }
          }
          setBvRegCount(bvRegsArr.filter(
            (reg: any) => !resolvedBvRegistrationIdsRef.current.has(String(reg.id)),
          ).length);
        }).catch(() => {});
  }, [user?.email, guideId, isSuperAdmin]);

  const handleBvRegistrationResolved = useCallback((registrationId: string) => {
    resolvedBvRegistrationIdsRef.current.add(registrationId);
    setBvRegCount(current => Math.max(0, current - 1));
  }, []);

  useEffect(() => { void fetchCounts(); }, [fetchCounts]);

  const navItems = [
    { id: 'sadhana', label: 'Sadhana Report', icon: BookOpen },
    { id: 'bv', label: 'Bhakti Vriksha Report', icon: LayoutGrid },
    { id: 'users', label: 'Members / Users', icon: Users },
    { id: 'approvals', label: 'Approvals', icon: AlertCircle, count: approvalCount },
    { id: 'bhakti-vriksha', label: 'Bhakti Vriksha', icon: ClipboardCheck, count: bvRegCount },
    { id: 'missing-sadhana', label: 'Missing Sadhana', icon: AlertCircle },
    { id: 'reminders', label: 'Notifications', icon: Zap },
    ...(isSuperAdmin ? [
      { id: 'stats', label: 'Stats', icon: Zap },
      { id: 'residencies', label: 'Residencies / Hostels', icon: Building2 },
    ] : []),
    { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
    { id: 'callreports', label: '1:1 Call Reports', icon: CalendarClock },
    { id: 'jigyasa', label: 'Jigyasa', icon: BookOpen },
    ...(isSuperAdmin ? [
      { id: 'tagmango', label: 'TagMango Sync', icon: Zap },
    ] : []),
  ];

  const cleanAdminName = (adminName || '').replace(/Super Guide/gi, '').replace(/Guide/gi, '').trim();

  return (
    <DashboardLayout
      title={dashboardTitle}
      subtitle={`Hare Krishna, ${profile?.fullName || cleanAdminName || 'Guide'}!`}
      role={dashboardRole}
      maxWidth="max-w-none"
    >
      <div className="flex flex-col md:flex-row gap-6">
      <MobileSectionNav items={navItems.map(item => ({ id: item.id, label: item.label, icon: item.icon, badge: item.count }))}
        activeId={['bv-registrations', 'bv-admins'].includes(activeTab) ? 'bhakti-vriksha' : activeTab}
        onSelect={handleTabChange} onIntent={prefetchTab} />

        <aside className="hidden md:block w-60 shrink-0">
          <div className="sticky top-20 space-y-1 bg-card p-3 rounded-xl border border-border shadow-sm">
            {navItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id || (item.id === 'bhakti-vriksha' && (activeTab === 'bv-registrations' || activeTab === 'bv-admins'));
              return (
                <button
                  key={item.id}
                  onClick={() => handleTabChange(item.id)}
                  onMouseEnter={() => prefetchTab(item.id)}
                  onFocus={() => prefetchTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </div>
                  {item.count != null && item.count > 0 && (
                    <Badge variant={isActive ? "secondary" : "default"} className="ml-2 text-xs shrink-0">
                      {item.count}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          <Suspense fallback={<LoadingPage rows={2} />}>
          <TabTransition key={dashboardScope(profile)} activeTab={activeTab}>
            {visitedTabs.has('sadhana') && (
              <DashboardPanel active={activeTab === 'sadhana'}>
                <ReportsTab segment="FOLK" guideId={isSuperAdmin ? '' : guideId} isSuperAdminOverride={isSuperAdmin} />
              </DashboardPanel>
            )}
            {visitedTabs.has('bv') && (
              <DashboardPanel active={activeTab === 'bv'}>
                <SuperBvReportTab segment="FOLK" guideId={isSuperAdmin ? '' : guideId} isSuperAdminOverride={isSuperAdmin} />
              </DashboardPanel>
            )}
            {visitedTabs.has('users') && (
              <DashboardPanel active={activeTab === 'users'}>
                <SuperUsersPanel segment="FOLK" isSuperAdminOverride={isSuperAdmin} />
              </DashboardPanel>
            )}
            {visitedTabs.has('approvals') && (
              <DashboardPanel active={activeTab === 'approvals'}>
                <div className="mb-6">
                  <AshrayExamDateSettings department="FOLK" />
                </div>
                <ApprovalsTab guideId={isSuperAdmin ? 'ALL' : guideId} isSuperGuide={isSuperAdmin} />
              </DashboardPanel>
            )}
            {(visitedTabs.has('bhakti-vriksha') || visitedTabs.has('bv-registrations') || visitedTabs.has('bv-admins')) && (
              <div className={(activeTab === 'bhakti-vriksha' || activeTab === 'bv-registrations' || activeTab === 'bv-admins') ? 'space-y-8 block' : 'hidden'}>
                <SuperBvRegistrationsTab
                  segment="FOLK"
                  guideId={guideId}
                  isSuperGuide={isSuperAdmin}
                  onRegistrationResolved={handleBvRegistrationResolved}
                />
                <div className="pt-6 border-t border-border">
                  <div className="mb-4">
                    <h2 className="text-lg font-bold text-foreground">Bhakti Vriksha Groups & Roles</h2>
                    <p className="text-sm text-muted-foreground">Manage Bhakti Vriksha reading groups, assign supervisors, RGFs, RGSFs, and member allocations</p>
                  </div>
                  <BvAdminManagementTab segment="FOLK" guideId={guideId} isSuperGuide={isSuperAdmin} />
                </div>
              </div>
            )}
            {visitedTabs.has('residencies') && isSuperAdmin && (
              <DashboardPanel active={activeTab === 'residencies'}>
                <FolkResidencyManagement />
              </DashboardPanel>
            )}
            {visitedTabs.has('stats') && isSuperAdmin && (
              <DashboardPanel active={activeTab === 'stats'}>
                <SuperStatsPanel segment="FOLK" />
              </DashboardPanel>
            )}
            {visitedTabs.has('missing-sadhana') && (
              <DashboardPanel active={activeTab === 'missing-sadhana'}>
                <MissingSadhanaTab segment="FOLK" />
              </DashboardPanel>
            )}
            {visitedTabs.has('attendance') && (
              <DashboardPanel active={activeTab === 'attendance'}>
                <SuperAttendanceTab segment="FOLK" />
              </DashboardPanel>
            )}
            {visitedTabs.has('jigyasa') && (
              <DashboardPanel active={activeTab === 'jigyasa'}>
                <JigyasaTrackerTab />
              </DashboardPanel>
            )}
            {visitedTabs.has('tagmango') && isSuperAdmin && (
              <DashboardPanel active={activeTab === 'tagmango'}>
                <TagMangoConfigTab />
              </DashboardPanel>
            )}
            {visitedTabs.has('reminders') && isBvAdminUser && (
              <DashboardPanel active={activeTab === 'reminders'}>
                <SendRemindersPanel segment="FOLK" />
              </DashboardPanel>
            )}
            {visitedTabs.has('callreports') && (
              <DashboardPanel active={activeTab === 'callreports'}>
                <BvslOneToOneTab />
              </DashboardPanel>
            )}
          </TabTransition>
          </Suspense>
        </main>
      </div>
    </DashboardLayout>
  );
}
