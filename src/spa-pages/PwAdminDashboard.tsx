import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, CalendarCheck, BookOpen, LayoutGrid, AlertCircle, Zap, ClipboardCheck, Database, Leaf } from 'lucide-react';
import { useAuth } from 'zite-auth-sdk';
import { DashboardLayout } from '@/layouts';
import SuperBvReportTab from '@/components/super/SuperBvReportTab';
import SuperUsersPanel from '@/components/super/SuperUsersPanel';
import SuperStatsPanel from '@/components/super/SuperStatsPanel';
import SendRemindersPanel from '@/components/super/SendRemindersPanel';
import ArchiveDataPanel from '@/components/super/ArchiveDataPanel';
import ReportsTab from '@/components/guide/ReportsTab';
import MissingSadhanaTab from '@/components/guide/MissingSadhanaTab';
import TagMangoConfigTab from '@/components/super/TagMangoConfigTab';
import SuperAttendanceTab from '@/components/super/SuperAttendanceTab';
import JigyasaTrackerTab from '@/components/jigyasa/JigyasaTrackerTab';
import TabTransition from '@/components/TabTransition';
import { motion } from 'framer-motion';
import ApprovalsTab from '@/components/guide/ApprovalsTab';
import SuperBvRegistrationsTab from '@/components/super/SuperBvRegistrationsTab';
import BvAdminManagementTab from '@/components/super/BvAdminManagementTab';
import {
  getCurrentGuide, getPushSubscriptionStats, GetPushSubscriptionStatsOutputType,
  getPendingApprovals, getGuideRequests, getResidencyTransferRequests, getCleanlinessReviews,
  getPendingBvRegistrations,
} from 'zite-endpoints-sdk';

export default function PwAdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [adminName, setAdminName] = useState('Hiranyavarna Das');
  const [pushStats, setPushStats] = useState<GetPushSubscriptionStatsOutputType | null>(null);

  const initialTab = typeof window !== 'undefined' ? window.location.hash.slice(1) || 'sadhana' : 'sadhana';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [approvalCount, setApprovalCount] = useState(0);
  const [bvRegCount, setBvRegCount] = useState(0);

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
        if (r.guide?.fullName) setAdminName(r.guide.fullName);
      }).catch(() => {});
      getPushSubscriptionStats({}).then(setPushStats).catch(() => {});
    }
  }, [user?.email]);

  // Fetch pending approvals total count & BV registrations count for badges
  useEffect(() => {
    Promise.all([
      getPendingApprovals({ guideId: 'ALL' }),
      getGuideRequests({ guideId: 'ALL' }),
      getResidencyTransferRequests({ guideId: 'ALL' } as any),
      getCleanlinessReviews({ guideId: 'ALL' }).catch(() => []),
      getPendingBvRegistrations({}).catch(() => []),
    ]).then(([pending, requests, resTrans, cleanReviews, bvRegs]) => {
      setApprovalCount(
        pending.length + requests.guideTransfers.length + requests.ashrayUpgrades.length + resTrans.length + (Array.isArray(cleanReviews) ? cleanReviews.length : 0)
      );
      setBvRegCount(Array.isArray(bvRegs) ? bvRegs.length : 0);
    }).catch(() => {});
  }, []);

  const SidebarButton = ({ value, label, icon: Icon, badge }: { value: string; label: string; icon: any; badge?: number }) => {
    const isActive = activeTab === value;
    return (
      <button
        onClick={() => handleTabChange(value)}
        className="relative w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg transition-colors text-muted-foreground hover:text-foreground"
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
      title="Prabhupada World Super Admin Dashboard"
      subtitle={`Hare Krishna ${adminName} Prabhu!`}
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
            <SelectItem value="users">Members / Users</SelectItem>
            <SelectItem value="approvals">
              Approvals {approvalCount > 0 ? `(${approvalCount})` : ''}
            </SelectItem>
            <SelectItem value="bv-registrations">
              BV Registrations {bvRegCount > 0 ? `(${bvRegCount})` : ''}
            </SelectItem>
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
            <SidebarButton value="users" label="Members / Users" icon={Users} />
            <SidebarButton value="approvals" label="Approvals" icon={ClipboardCheck} badge={approvalCount} />
            <SidebarButton value="bv-registrations" label="BV Registrations" icon={Leaf} badge={bvRegCount} />
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
            {activeTab === 'sadhana' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Prabhupada World Sadhana Report</h2>
                  <p className="text-sm text-muted-foreground">Sadhana metrics for all Prabhupada World members</p>
                </div>
                <ReportsTab guideId="ALL" />
              </div>
            )}

            {activeTab === 'bv' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Bhakti Vriksha Reading Groups Report</h2>
                  <p className="text-sm text-muted-foreground">Reading group attendance & metrics</p>
                </div>
                <SuperBvReportTab />
              </div>
            )}

            {activeTab === 'users' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Prabhupada World Members</h2>
                  <p className="text-sm text-muted-foreground">All registered members — sortable, filterable, with role management</p>
                </div>
                <SuperUsersPanel isPwAdmin={true} />
              </div>
            )}

            {activeTab === 'approvals' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Pending Registrations & Approvals</h2>
                  <p className="text-sm text-muted-foreground">Review and approve new Prabhupada World member registrations</p>
                </div>
                <ApprovalsTab guideId="ALL" isSuperGuide={true} />
              </div>
            )}

            {activeTab === 'bv-registrations' && (
              <div className="space-y-6">
                <BvAdminManagementTab />
                <hr className="my-6 border-t" />
                <SuperBvRegistrationsTab />
              </div>
            )}

            {activeTab === 'stats' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">System Stats & Administration</h2>
                  <p className="text-sm text-muted-foreground">Aggregate metrics, push notifications, and data management</p>
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
                  <p className="text-sm text-muted-foreground">Track which members haven't submitted their daily sadhana</p>
                </div>
                <MissingSadhanaTab guideId="ALL" />
              </div>
            )}

            {activeTab === 'attendance' && (
              <div>
                <div className="space-y-1 mb-4">
                  <h2 className="text-lg font-bold">Attendance Report</h2>
                  <p className="text-sm text-muted-foreground">Course and session attendance records</p>
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
