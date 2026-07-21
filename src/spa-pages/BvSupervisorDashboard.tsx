import { useEffect, useState } from 'react';
import { Users, Leaf, Clock, CheckCircle2, UserCheck, ShieldCheck, BarChart3, CalendarClock, BookOpen, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { DashboardLayout } from '@/layouts';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { getBvSupervisorOverview, GetBvSupervisorOverviewOutputType } from 'zite-endpoints-sdk';
import SuperBvRegistrationsTab from '@/components/super/SuperBvRegistrationsTab';
import BvSection from '@/components/guide/BvSection';
import BvslOneToOneTab from '@/components/bvsl/BvslOneToOneTab';
import TabRouter, { TabConfig } from '@/shared/TabRouter';

export default function BvSupervisorDashboard() {
  const { profile } = useUserProfile();
  const [data, setData] = useState<GetBvSupervisorOverviewOutputType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOverview();
  }, []);

  const loadOverview = async () => {
    setLoading(true);
    try {
      const res = await getBvSupervisorOverview({});
      setData(res);
    } catch {
      toast.error('Failed to load BV Supervisor data');
    } finally {
      setLoading(false);
    }
  };

  const pendingCount = data?.pendingRegistrations || 0;

  const tabs: TabConfig[] = [
    { value: 'overview', label: 'Overview', icon: Layers },
    { value: 'rgfs', label: 'Facilitators (RGFs)', icon: Users },
    { value: 'registrations', label: `Pending Registrations${pendingCount > 0 ? ` (${pendingCount})` : ''}`, icon: Clock },
    { value: 'bvreport', label: 'BV Report', icon: BarChart3 },
    { value: 'callreports', label: '1:1 Call Reports', icon: CalendarClock },
  ];

  return (
    <DashboardLayout
      title={`Hare Krishna, ${profile?.fullName || 'Supervisor'} Prabhu`}
      subtitle="Bhakti Vriksha Supervisor Dashboard"
      role="GUIDE"
      maxWidth="max-w-6xl"
      showProfile={true}
    >
      {loading ? (
        <div className="space-y-4 py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        <TabRouter tabs={tabs} defaultTab="overview" desktopCols={5}>
          {(activeTab) => (
            <>
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Card className="border-l-4 border-l-primary">
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-muted-foreground font-medium">Facilitators (RGF)</p>
                            <p className="text-2xl font-bold text-foreground mt-1">{data?.rgfCount || 0}</p>
                          </div>
                          <UserCheck className="w-8 h-8 text-primary/70" />
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-l-4 border-l-blue-500">
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-muted-foreground font-medium">Active Reading Groups</p>
                            <p className="text-2xl font-bold text-foreground mt-1">{data?.groupCount || 0}</p>
                          </div>
                          <Users className="w-8 h-8 text-blue-500/70" />
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-l-4 border-l-green-500">
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-muted-foreground font-medium">Total Members</p>
                            <p className="text-2xl font-bold text-foreground mt-1">{data?.totalMembers || 0}</p>
                          </div>
                          <ShieldCheck className="w-8 h-8 text-green-500/70" />
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-l-4 border-l-orange-500">
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-muted-foreground font-medium">Pending Registrations</p>
                            <p className="text-2xl font-bold text-foreground mt-1">{data?.pendingRegistrations || 0}</p>
                          </div>
                          <Clock className="w-8 h-8 text-orange-500/70" />
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Group Summary Table */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Leaf className="w-4 h-4 text-primary" /> Active Reading Groups Overview
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Overview of active Bhakti Vriksha reading groups, assigned facilitators, and member strength.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {(!data?.groups || data.groups.length === 0) ? (
                        <div className="py-8 text-center text-muted-foreground text-sm">
                          No active reading groups found.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {data.groups.map(g => (
                            <div key={g.id} className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-accent/40 transition-colors">
                              <div>
                                <p className="font-semibold text-sm">{g.groupName}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Facilitator: <span className="font-medium text-foreground">{g.bvslName}</span>
                                  {g.meetingTime ? ` · ${g.meetingTime}` : ''}
                                </p>
                              </div>
                              <Badge variant="secondary" className="font-mono text-xs">
                                {g.memberCount} members
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {activeTab === 'rgfs' && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-primary" /> Reading Group Facilitators (RGF) & Groups
                    </CardTitle>
                    <CardDescription className="text-xs">
                      All active Reading Group Facilitators and their assigned Bhakti Vriksha groups.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(!data?.groups || data.groups.length === 0) ? (
                      <p className="text-sm text-muted-foreground py-6 text-center">No RGFs found.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {data.groups.map(g => (
                          <Card key={g.id} className="border shadow-none">
                            <CardContent className="pt-4 pb-4 space-y-2">
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="font-bold text-sm text-primary">{g.bvslName}</p>
                                  <p className="text-xs text-muted-foreground">Reading Group Facilitator</p>
                                </div>
                                <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
                                  {g.memberCount} Devotees
                                </Badge>
                              </div>
                              <div className="bg-muted/40 p-2.5 rounded text-xs space-y-1">
                                <p className="font-medium text-foreground">📖 {g.groupName}</p>
                                {g.meetingTime && <p className="text-muted-foreground">⏰ {g.meetingTime}</p>}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {activeTab === 'registrations' && (
                <SuperBvRegistrationsTab />
              )}

              {activeTab === 'bvreport' && (
                <BvSection guideId={profile?.userId || 'ALL'} bvslMode />
              )}

              {activeTab === 'callreports' && (
                <BvslOneToOneTab />
              )}
            </>
          )}
        </TabRouter>
      )}
    </DashboardLayout>
  );
}
