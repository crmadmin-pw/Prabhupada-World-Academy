import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, UserCheck, ShieldCheck, BarChart3, CalendarClock, FileText, Layers, ChevronRight, Video } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { DashboardLayout } from '@/layouts';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { getBvSupervisorOverview } from '@/lib/endpoints-sdk';
import BvSection from '@/components/guide/BvSection';
import SadhanaSection from '@/components/guide/SadhanaSection';
import BvslOneToOneTab from '@/components/bvsl/BvslOneToOneTab';
import MeetingsAndMomTab from '@/components/super/MeetingsAndMomTab';
import TabRouter, { TabConfig } from '@/shared/TabRouter';

interface SupervisorGroup {
  id: string;
  groupName: string;
  bvslName: string;
  meetingTime?: string;
  memberCount: number;
}

function FacilitatorGroupCard({ group, onOpen }: { group: SupervisorGroup; onOpen?: () => void }) {
  const interactive = Boolean(onOpen);

  return (
    <Card
      className={`border shadow-none transition-all ${interactive
        ? 'group cursor-pointer hover:shadow-md hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
        : ''}`}
      onClick={onOpen}
      onKeyDown={interactive ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen?.();
        }
      } : undefined}
      role={interactive ? 'link' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <CardContent className="pt-4 pb-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-sm text-primary truncate">{group.groupName}</p>
            <p className="text-xs text-muted-foreground">Bhakti Vriksha Reading Group</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
              {group.memberCount} {group.memberCount === 1 ? 'Devotee' : 'Devotees'}
            </Badge>
            {interactive && (
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            )}
          </div>
        </div>
        <div className={`bg-muted/40 p-2.5 rounded text-xs space-y-1 ${interactive ? 'group-hover:bg-primary/5 transition-colors' : ''}`}>
          <p className={`font-medium text-foreground ${interactive ? 'group-hover:text-primary transition-colors' : ''}`}>
            👤 RGF: {group.bvslName}
          </p>
          {group.meetingTime && <p className="text-muted-foreground">⏰ {group.meetingTime}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function BvSupervisorDashboard() {
  const { profile } = useUserProfile();
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof getBvSupervisorOverview>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOverview();
  }, []);

  const loadOverview = useReactiveLoader(async (read, silent = false) => {
    if (!silent) !read.background && setLoading(true);
    try {
      const res = await read(() => getBvSupervisorOverview({}));
      setData(res);
    } catch {
      if (read.cancelled) return;
      toast.error('Failed to load BV Supervisor data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);


  const isFolk = String(profile?.segment || '').trim().toUpperCase() === 'FOLK';

  const tabs: TabConfig[] = [
    { value: 'overview', label: 'Overview', icon: Layers },
    { value: 'rgfs', label: 'RGFs & Groups', icon: Users },
    { value: 'bvreport', label: 'BV Report', icon: BarChart3 },
    { value: 'sadhana', label: 'Sadhana', icon: FileText },
    { value: 'callreports', label: '1:1 Call Reports', icon: CalendarClock },
    ...(!isFolk ? [{ value: 'meetings', label: 'Meetings & MoMs', icon: Video }] : []),
  ];

  return (
    <DashboardLayout
      title={`${isFolk ? 'FOLK' : 'Prabhupada World'} Bhakti Vriksha Supervisor Dashboard`}
      subtitle={[
        `Hare Krishna, ${profile?.fullName || 'Supervisor'}!`,
        (profile as any)?.bvReportingAdminName
          ? `${isFolk ? 'Guide' : 'Admin'}: ${(profile as any).bvReportingAdminName}`
          : null,
      ].filter(Boolean).join(' · ')}
      role="SUPERVISOR"
      maxWidth="max-w-6xl"
      showProfile={true}
      meetingDepartment={isFolk ? "FOLK" : "PW"}
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
        <TabRouter tabs={tabs} defaultTab="overview" desktopCols={7} keepAlive preloadTabs={['rgfs']}>
          {(activeTab) => (
            <>
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card className="border-l-4 border-l-primary">
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-muted-foreground font-medium">RGFs</p>
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
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Users className="w-4 h-4 text-primary" /> Supervised Reading Groups
                      </CardTitle>
                      <CardDescription className="text-xs">
                        An overview of active Reading Groups and their RGFs.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {(!data?.groups || data.groups.length === 0) ? (
                        <p className="text-sm text-muted-foreground py-6 text-center">No supervised Reading Groups found.</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {data.groups.map((group: SupervisorGroup) => (
                            <FacilitatorGroupCard key={group.id} group={group} />
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
                      <UserCheck className="w-4 h-4 text-primary" /> RGFs & Groups
                    </CardTitle>
                    <CardDescription className="text-xs">
                      All active RGFs and their assigned Bhakti Vriksha groups. Click any card to view group details.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(!data?.groups || data.groups.length === 0) ? (
                      <p className="text-sm text-muted-foreground py-6 text-center">No RGFs found.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {data.groups.map((group: SupervisorGroup) => (
                          <FacilitatorGroupCard
                            key={group.id}
                            group={group}
                            onOpen={() => navigate(`/bvsl/groups/${group.id}`)}
                          />
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}


              {activeTab === 'bvreport' && (
                <BvSection
                  guideId={profile?.userId || 'ALL'}
                  bvslMode
                  segment={isFolk ? 'FOLK' : 'PW'}
                  summaryOnlyGroups
                  groupOptions={(data?.groups || []).map((group: any) => ({
                    id: group.id,
                    groupId: group.id,
                    groupName: group.groupName,
                  }))}
                />
              )}

              {activeTab === 'sadhana' && (
                <SadhanaSection
                  guideId={profile?.userId || ''}
                  bvslMode
                  hideImprovement={!isFolk}
                  groupOptions={(data?.groups || []).map((group: any) => ({
                    id: group.id,
                    groupId: group.groupId,
                    groupName: group.groupName,
                  }))}
                />
              )}

              {activeTab === 'callreports' && (
                <BvslOneToOneTab department={isFolk ? "FOLK" : "PW"} />
              )}

              {!isFolk && activeTab === 'meetings' && (
                <MeetingsAndMomTab department="PW" />
              )}
            </>
          )}
        </TabRouter>
      )}
    </DashboardLayout>
  );
}
