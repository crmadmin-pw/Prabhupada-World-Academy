import { useState, useEffect } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { useNavigate } from 'react-router-dom';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users as UsersIcon, CheckSquare, BarChart3, Database, CalendarCheck, Building2, MessageSquare, AlertCircle, TrendingUp, Wallet, GitBranch, Flame, ClipboardCheck, Sparkles, BookOpen, LayoutGrid } from 'lucide-react';
import { FEATURES } from '@/config/features';
import GuideServicesTab from '@/components/services/GuideServicesTab';
import OneToOneTab from '@/components/guide/OneToOneTab';
import { getCurrentGuide, getPendingApprovals, getGuideRequests, getResidencyTransferRequests } from 'zite-endpoints-sdk';
import { DashboardLayout } from '@/layouts';
import { LoadingPage } from '@/shared';
import TabTransition from '@/components/TabTransition';
import { motion } from 'framer-motion';
import OverviewTab from '@/components/guide/OverviewTab';
import ApprovalsTab from '@/components/guide/ApprovalsTab';
import UsersTab from '@/components/guide/UsersTab';
import SadhanaSection from '@/components/guide/SadhanaSection';
import MissingSadhanaTab from '@/components/guide/MissingSadhanaTab';
import BvSection from '@/components/guide/BvSection';
import RentTripsTab from '@/components/guide/RentTripsTab';
import PreachingDataReportTab from '@/components/super/PreachingDataReportTab';
import PipelineReportTab from '@/components/guide/PipelineReportTab';
import ChallengeDashboardTab from '@/components/guide/ChallengeDashboardTab';
import GuideAttendanceTab from '@/components/guide/GuideAttendanceTab';
import { useQuery } from '@/hooks/useQuery';
import SectionErrorBoundary from '@/components/SectionErrorBoundary';
import CleanlinessTab from '@/components/guide/CleanlinessTab';
import JigyasaTrackerTab from '@/components/jigyasa/JigyasaTrackerTab';

export default function GuideDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { profile } = useUserProfile();
  const [approvalCount, setApprovalCount] = useState(0);

  const initialTab = typeof window !== 'undefined' ? window.location.hash.slice(1) || 'reports' : 'reports';
  const [activeTab, setActiveTab] = useState(initialTab);

  // Sync with browser back/forward buttons
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
    window.history.pushState(null, '', `#${tab}`);
  };

  const { data: guideData, loading } = useQuery({
    key: user?.email ? `guide:dashboard:${user.email}` : null,
    fetcher: () => getCurrentGuide({}),
  });

  // Prefetch approval count as soon as guideId is known — badge shows before tab is visited
  useEffect(() => {
    const gd = (guideData as any)?.guide;
    if (!gd?.guideId) return;
    const gId = gd.guideId;
    Promise.all([
      getPendingApprovals({ guideId: gId }),
      getGuideRequests({ guideId: gId }),
      getResidencyTransferRequests({ guideId: gId } as any),
    ]).then(([pending, requests, resTrans]) => {
      setApprovalCount(
        pending.length + requests.guideTransfers.length + requests.ashrayUpgrades.length + resTrans.length
      );
    }).catch(() => {/* silent — count is decorative */});
  }, [(guideData as any)?.guide?.guideId]);

  if (loading) return <LoadingPage rows={4} />;

  const guide = (guideData as any)?.guide;

  if (!guide?.guideId) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>Unable to verify guide identity</CardDescription>
        </CardHeader>
        <CardContent><Button onClick={() => logout()}>Logout</Button></CardContent>
      </Card>
    </div>
  );

  const guideId = guide.guideId;
  const guideName = guide.fullName || guide.name || '';

  const SidebarButton = ({ value, label, icon: Icon, badge }: { value: string; label: string; icon: any; badge?: number }) => {
    const isActive = activeTab === value;
    return (
      <button
        onClick={() => handleTabChange(value)}
        className="relative w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg transition-colors text-muted-foreground hover:text-foreground"
      >
        {isActive && (
          <motion.div
            layoutId="guideActiveHighlight"
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
      title={`Hare Krishna ${guideName} Prabhu!`}
      subtitle="FOLK Guide"
      role="GUIDE"
      maxWidth="max-w-none"
      showProfile={false}
    >
      {/* Mobile Select Tab Selector */}
      <div className="block md:hidden mb-4">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
          Navigate Dashboard
        </label>
        <Select value={activeTab} onValueChange={(val) => val && handleTabChange(val)}>
          <SelectTrigger className="w-full bg-card border">
            <SelectValue placeholder="Select tab..." />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sadhana & Progress</SelectLabel>
              <SelectItem value="reports">Sadhana Report</SelectItem>
              <SelectItem value="missing-sadhana">Missing Sadhana</SelectItem>
              <SelectItem value="pipeline">Pipeline</SelectItem>
              <SelectItem value="challenges">Challenges</SelectItem>
              <SelectItem value="attendance">Attendance</SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Devotee Care</SelectLabel>
              <SelectItem value="users">Users</SelectItem>
              <SelectItem value="approvals">Approvals ({approvalCount})</SelectItem>
              <SelectItem value="one-to-one">One-to-One</SelectItem>
              <SelectItem value="bv">BhaktiVriksha</SelectItem>
              <SelectItem value="jigyasa">Jigyasa</SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Operations & Metrics</SelectLabel>
              <SelectItem value="preaching">Preaching Data</SelectItem>
              <SelectItem value="overview">Overview</SelectItem>
              <SelectItem value="rent-trips">Rent & Trips</SelectItem>
              <SelectItem value="cleanliness">Cleanliness</SelectItem>
              {FEATURES.SERVICE_ALLOCATION && <SelectItem value="services">FOLK Services</SelectItem>}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Desktop Sidebar Navigation */}
        <div className="hidden md:block w-64 shrink-0 sticky top-[93px] self-start max-h-[calc(100vh-125px)] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="bg-card border rounded-xl p-3 space-y-0.5 shadow-sm">
            <SidebarButton value="reports" label="Sadhana Report" icon={Database} />
            <SidebarButton value="missing-sadhana" label="Missing Sadhana" icon={AlertCircle} />
            <SidebarButton value="pipeline" label="Pipeline" icon={GitBranch} />
            <SidebarButton value="challenges" label="Challenges" icon={Flame} />
            <SidebarButton value="attendance" label="Attendance" icon={ClipboardCheck} />
            <SidebarButton value="users" label="Users" icon={UsersIcon} />
            <SidebarButton value="approvals" label="Approvals" icon={CheckSquare} badge={approvalCount} />
            <SidebarButton value="one-to-one" label="One-to-One" icon={MessageSquare} />
            <SidebarButton value="bv" label="BhaktiVriksha" icon={CalendarCheck} />
            <SidebarButton value="jigyasa" label="Jigyasa" icon={BookOpen} />
            <SidebarButton value="preaching" label="Preaching Data" icon={TrendingUp} />
            <SidebarButton value="overview" label="Overview" icon={BarChart3} />
            <SidebarButton value="rent-trips" label="Rent & Trips" icon={Wallet} />
            <SidebarButton value="cleanliness" label="Cleanliness" icon={Sparkles} />
            {FEATURES.SERVICE_ALLOCATION && (
              <SidebarButton value="services" label="FOLK Services" icon={Building2} />
            )}
          </div>
        </div>

        {/* Content Pane */}
        <div className="flex-1 min-w-0 bg-card border rounded-xl p-6 shadow-sm min-h-[500px]">
          <TabTransition activeTab={activeTab}>
            {activeTab === 'reports'          && <SectionErrorBoundary sectionName="Sadhana Report"><SadhanaSection guideId={guideId} senderName={guideName} /></SectionErrorBoundary>}
            {activeTab === 'missing-sadhana' && <SectionErrorBoundary sectionName="Missing Sadhana"><MissingSadhanaTab guideId={guideId} /></SectionErrorBoundary>}
            {activeTab === 'overview'  && <SectionErrorBoundary sectionName="Overview"><OverviewTab guideId={guideId} onTabChange={handleTabChange} /></SectionErrorBoundary>}
            {activeTab === 'approvals' && <SectionErrorBoundary sectionName="Approvals"><ApprovalsTab guideId={guideId} onCountLoaded={setApprovalCount} /></SectionErrorBoundary>}
            {activeTab === 'users'     && <SectionErrorBoundary sectionName="Users"><UsersTab guideId={guideId} /></SectionErrorBoundary>}
            {activeTab === 'bv'        && <SectionErrorBoundary sectionName="BhaktiVriksha"><BvSection guideId={guideId} /></SectionErrorBoundary>}
            {activeTab === 'preaching' && <SectionErrorBoundary sectionName="Preaching Data"><PreachingDataReportTab /></SectionErrorBoundary>}
            {activeTab === 'one-to-one' && <SectionErrorBoundary sectionName="One-to-One"><OneToOneTab guideId={guideId} /></SectionErrorBoundary>}
            {activeTab === 'rent-trips' && <SectionErrorBoundary sectionName="Rent & Trips"><RentTripsTab guideId={guideId} /></SectionErrorBoundary>}
            {activeTab === 'pipeline'   && <SectionErrorBoundary sectionName="Pipeline"><PipelineReportTab guideId={guideId} /></SectionErrorBoundary>}
            {activeTab === 'challenges' && <SectionErrorBoundary sectionName="Challenges"><ChallengeDashboardTab /></SectionErrorBoundary>}
            {activeTab === 'attendance' && <SectionErrorBoundary sectionName="Attendance"><GuideAttendanceTab guideId={guideId} /></SectionErrorBoundary>}
            {activeTab === 'jigyasa' && <SectionErrorBoundary sectionName="Jigyasa"><JigyasaTrackerTab canUpload={true} /></SectionErrorBoundary>}
            {activeTab === 'cleanliness' && <SectionErrorBoundary sectionName="Cleanliness"><CleanlinessTab guideId={guideId} residencies={(guideData as any)?.residencies || []} /></SectionErrorBoundary>}
            {FEATURES.SERVICE_ALLOCATION && activeTab === 'services' && <SectionErrorBoundary sectionName="FOLK Services"><GuideServicesTab guideId={guideId} /></SectionErrorBoundary>}
          </TabTransition>
        </div>
      </div>
    </DashboardLayout>
  );
}
