import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Home, Users, BarChart2, CalendarCheck, BookOpen, LayoutGrid, AlertCircle, TrendingUp, GitBranch, Zap, ClipboardCheck, Database } from 'lucide-react';
import { useAuth } from 'zite-auth-sdk';
import { DashboardLayout } from '@/layouts';
import SuperBvReportTab from '@/components/super/SuperBvReportTab';
import SuperHostelsPanel from '@/components/super/SuperHostelsPanel';
import SuperUsersPanel from '@/components/super/SuperUsersPanel';
import SuperGuidesPanel from '@/components/super/SuperGuidesPanel';
import SuperStatsPanel from '@/components/super/SuperStatsPanel';
import SendRemindersPanel from '@/components/super/SendRemindersPanel';
import ArchiveDataPanel from '@/components/super/ArchiveDataPanel';
import ReportsTab from '@/components/guide/ReportsTab';
import PreachingDataReportTab from '@/components/super/PreachingDataReportTab';
import MissingSadhanaTab from '@/components/guide/MissingSadhanaTab';
import PipelineReportTab from '@/components/guide/PipelineReportTab';
import TagMangoConfigTab from '@/components/super/TagMangoConfigTab';
import SuperAttendanceTab from '@/components/super/SuperAttendanceTab';
import JigyasaTrackerTab from '@/components/jigyasa/JigyasaTrackerTab';
import TabTransition from '@/components/TabTransition';
import { motion } from 'framer-motion';
import ApprovalsTab from '@/components/guide/ApprovalsTab';
import { getCurrentGuide, getPushSubscriptionStats, GetPushSubscriptionStatsOutputType } from 'zite-endpoints-sdk';

export default function SuperGuideDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [guideName, setGuideName] = useState('');
  const [pushStats, setPushStats] = useState<GetPushSubscriptionStatsOutputType | null>(null);

  const initialTab = typeof window !== 'undefined' ? window.location.hash.slice(1) || 'sadhana' : 'sadhana';
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

  useEffect(() => {
    if (user?.email) {
      getCurrentGuide({ email: user.email }).then(r => {
        if (r.guide) setGuideName(r.guide.fullName || '');
      }).catch(() => {});
      getPushSubscriptionStats({}).then(setPushStats).catch(() => {});
    }
  }, [user?.email]);

  const SidebarButton = ({ value, label, icon: Icon }: { value: string; label: string; icon: any }) => {
    const isActive = activeTab === value;
    return (
      <button
        onClick={() => handleTabChange(value)}
        className="relative w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors text-muted-foreground hover:text-foreground"
      >
        {isActive && (
          <motion.div
            layoutId="superActiveHighlight"
            className="absolute inset-0 bg-primary/10 rounded-lg border border-primary/20"
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          />
        )}
        <Icon className={`relative z-10 w-4 h-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
        <span className={isActive ? 'relative z-10 text-primary font-semibold text-left' : 'relative z-10 text-left'}>{label}</span>
      </button>
    );
  };

  return (
    <DashboardLayout
      title="Super FOLK Guide Dashboard"
      subtitle={guideName ? `Hare Krishna ${guideName} Prabhu!` : undefined}
      role="SUPER_GUIDE"
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
            <SelectItem value="sadhana">Sadhana Report</SelectItem>
            <SelectItem value="bv">Bhakti Vriksha Report</SelectItem>
            <SelectItem value="preaching">Preaching Data</SelectItem>
            <SelectItem value="pipeline">Pipeline</SelectItem>
            <SelectItem value="hostels">FOLK Hostels</SelectItem>
            <SelectItem value="guides">Guides</SelectItem>
            <SelectItem value="users">Users</SelectItem>
            <SelectItem value="approvals">Approvals</SelectItem>
            <SelectItem value="stats">Stats</SelectItem>
            <SelectItem value="missing-sadhana">Missing Sadhana</SelectItem>
            <SelectItem value="attendance">Attendance</SelectItem>
            <SelectItem value="jigyasa">Jigyasa</SelectItem>
            <SelectItem value="tagmango">TagMango</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Desktop Sidebar Navigation */}
        <div className="hidden md:block w-64 shrink-0 sticky top-[93px] self-start max-h-[calc(100vh-125px)] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="bg-card border rounded-xl p-3 space-y-0.5 shadow-sm">
            <SidebarButton value="sadhana" label="Sadhana Report" icon={Database} />
            <SidebarButton value="bv" label="Bhakti Vriksha Report" icon={CalendarCheck} />
            <SidebarButton value="preaching" label="Preaching Data" icon={TrendingUp} />
            <SidebarButton value="pipeline" label="Pipeline" icon={GitBranch} />
            <SidebarButton value="hostels" label="FOLK Hostels" icon={Home} />
            <SidebarButton value="guides" label="Guides" icon={BarChart2} />
            <SidebarButton value="users" label="Users" icon={Users} />
            <SidebarButton value="approvals" label="Approvals" icon={ClipboardCheck} />
            <SidebarButton value="stats" label="Stats" icon={LayoutGrid} />
            <SidebarButton value="missing-sadhana" label="Missing Sadhana" icon={AlertCircle} />
            <SidebarButton value="attendance" label="Attendance" icon={ClipboardCheck} />
            <SidebarButton value="jigyasa" label="Jigyasa" icon={BookOpen} />
            <SidebarButton value="tagmango" label="TagMango" icon={Zap} />
          </div>
        </div>

        {/* Content Pane */}
        <div className="flex-1 min-w-0 bg-card border rounded-xl p-6 shadow-sm min-h-[500px]">
          <TabTransition activeTab={activeTab}>
            {activeTab === 'approvals' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Approvals</h2>
                  <p className="text-sm text-muted-foreground">Approve Guide transfers, FOLK Hostel transfers, and pending registrations across all centers</p>
                </div>
                <ApprovalsTab guideId="ALL" isSuperGuide={true} />
              </div>
            )}
            {activeTab === 'sadhana' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Sadhana Report</h2>
                  <p className="text-sm text-muted-foreground">Cross-guide sadhana data for all members</p>
                </div>
                <ReportsTab guideId="ALL" />
              </div>
            )}

            {activeTab === 'bv' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Bhakti Vriksha Report</h2>
                  <p className="text-sm text-muted-foreground">BV attendance and group stats across all guides</p>
                </div>
                <SuperBvReportTab />
              </div>
            )}

            {activeTab === 'preaching' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Preaching Data Report</h2>
                  <p className="text-sm text-muted-foreground">Weekly preaching metrics across all FOLK centers</p>
                </div>
                <PreachingDataReportTab />
              </div>
            )}

            {activeTab === 'pipeline' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Pipeline Report</h2>
                  <p className="text-sm text-muted-foreground">Monthly sadhana & preaching metrics for all members across all guides</p>
                </div>
                <PipelineReportTab />
              </div>
            )}

            {activeTab === 'hostels' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">FOLK Hostels</h2>
                  <p className="text-sm text-muted-foreground">All active FOLK residencies with quarterly sadhana averages</p>
                </div>
                <SuperHostelsPanel />
              </div>
            )}

            {activeTab === 'guides' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Guides</h2>
                  <p className="text-sm text-muted-foreground">All active FOLK guides and their member counts</p>
                </div>
                <SuperGuidesPanel />
              </div>
            )}

            {activeTab === 'users' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">All Users</h2>
                  <p className="text-sm text-muted-foreground">All members across all guides — sortable, filterable, with guide and BVSL assignment</p>
                </div>
                <SuperUsersPanel />
              </div>
            )}

            {activeTab === 'stats' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Stats</h2>
                  <p className="text-sm text-muted-foreground">Aggregate metrics across all guides and hostels</p>
                </div>
                <div className="space-y-6">
                  <SendRemindersPanel />
                  <ArchiveDataPanel />
                  {pushStats && (
                    <div className="rounded-lg border bg-card p-4 space-y-3">
                      <h3 className="font-semibold flex items-center gap-2">🔔 Push Notification Subscribers</h3>
                      <p className="text-2xl font-bold text-primary">{pushStats.totalSubscriptions}</p>
                      <p className="text-sm text-muted-foreground">{pushStats.subscribers.length} unique users subscribed</p>
                      {pushStats.subscribers.length > 0 && (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View subscribers</summary>
                          <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                            {pushStats.subscribers.map((s: any, i: number) => (
                              <li key={i} className="flex justify-between text-xs py-1 border-b border-border last:border-0">
                                <span>{s.name}</span>
                                <span className="text-muted-foreground">{s.email}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                  <SuperStatsPanel />
                </div>
              </div>
            )}

            {activeTab === 'missing-sadhana' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Missing Sadhana Report</h2>
                  <p className="text-sm text-muted-foreground">Track which users haven't filled their sadhana across all groups</p>
                </div>
                <MissingSadhanaTab guideId="ALL" />
              </div>
            )}

            {activeTab === 'attendance' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Attendance Report</h2>
                  <p className="text-sm text-muted-foreground">Course attendance records across all guides and centers</p>
                </div>
                <SuperAttendanceTab />
              </div>
            )}

            {activeTab === 'jigyasa' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Jigyasa Attendance Tracker</h2>
                  <p className="text-sm text-muted-foreground">Upload TagMango CSVs and track session attendance</p>
                </div>
                <JigyasaTrackerTab canUpload={true} />
              </div>
            )}

            {activeTab === 'tagmango' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">TagMango Configuration</h2>
                  <p className="text-sm text-muted-foreground">Manage API credentials and course ID mappings for auto-enrollment</p>
                </div>
                <TagMangoConfigTab />
              </div>
            )}
          </TabTransition>
        </div>
      </div>
    </DashboardLayout>
  );
}
