import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LayoutGrid, CalendarDays, CalendarCheck, Settings2, Building2, Brush, Heart, Sparkles, Star, Trophy, Bell } from 'lucide-react';
import { toast } from 'sonner';
import { checkAndMarkOverdue, autoGenerateAllocation, getWeeklySchedule, checkAllocationPublished } from 'zite-endpoints-sdk';
import { format } from 'date-fns';
import UserAllocationBoardTab from './UserAllocationBoardTab';
import ServiceCalendarTab from './ServiceCalendarTab';
import UserAvailabilityTab from './UserAvailabilityTab';
import UserPreferencesTab from './UserPreferencesTab';
import ServiceLeaderboardTab from './ServiceLeaderboardTab';
import ServiceRatingPrompt from './ServiceRatingPrompt';
import { scheduleServiceReminders } from '@/utils/serviceNotification';

import { getCurrentServiceWeekStart } from '@/lib/serviceWeek';
import TodayFolkServiceBoard from './TodayFolkServiceBoard';

interface Props { userId: string; residencyId?: string; }

const SERVICE_TYPE_TABS = [
  { value: 'Weekly',                  label: 'Weekly',        icon: Building2 },
  { value: 'Saturday Maha Cleaning',  label: 'Maha Clean',    icon: Brush },
  { value: 'Sunday Love Feast',       label: 'Love Feast',    icon: Heart },
  { value: 'Occasional',              label: 'Occasional',    icon: Sparkles },
  { value: 'Festivals',               label: 'Festivals',     icon: Star },
];

export default function UserServicesTab({ userId, residencyId }: Props) {
  const [publishBanner, setPublishBanner] = useState<string | null>(null);
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);

  useEffect(() => { init(); }, [userId]);

  const init = async () => {
    const isSunday = new Date().getDay() === 0;
    const currentWeek = getCurrentServiceWeekStart();
    const availWeek = currentWeek; // Sunday IS the week start

    try {
      const overdueRes = await checkAndMarkOverdue({});
      if (overdueRes.overdueCount > 0) {
        toast.error(`🔴 ${overdueRes.overdueCount} service(s) overdue!`, { duration: 6000 });
      }
      if (isSunday) {
        try {
          const res = await autoGenerateAllocation({ weekStartDate: availWeek, scope: 'residency' });
          if (!res.alreadyGenerated && res.allocationsCreated > 0) {
            toast.success(`✨ ${res.allocationsCreated} services allocated for this week!`);
          }
        } catch {}
      }

      try {
        const pubRes = await checkAllocationPublished({ weekStartDate: currentWeek, residencyId });
        if (pubRes.published && pubRes.publishedAt) {
          const seenKey = `svc_pub_seen_${currentWeek}`;
          const seen = localStorage.getItem(seenKey);
          if (seen !== pubRes.publishedAt) {
            setPublishBanner(pubRes.publishedAt);
          }
        }
      } catch {}

      try {
        const schedRes = await getWeeklySchedule({ weekStartDate: currentWeek });
        const todayDow = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
        const todayServices = (schedRes.schedule ?? []).filter((s: any) => s.dayOfWeek === todayDow);
        if (todayServices.length > 0) {
          scheduleServiceReminders(todayServices.map((s: any) => ({
            allocationId: s.allocationId,
            serviceName: s.serviceName,
            timeSlot: s.timeSlot || '',
            status: s.status,
          })));
        }
      } catch {}
    } catch {}

    if (new Date().getHours() >= 21) {
      const ratedKey = `svc_rated_${format(new Date(), 'yyyy-MM-dd')}`;
      if (!localStorage.getItem(ratedKey)) {
        setShowRatingPrompt(true);
      }
    }
  };

  const dismissPublishBanner = () => {
    const currentWeek = getCurrentServiceWeekStart();
    if (publishBanner) {
      localStorage.setItem(`svc_pub_seen_${currentWeek}`, publishBanner);
    }
    setPublishBanner(null);
  };

  const dismissRatingPrompt = () => {
    localStorage.setItem(`svc_rated_${format(new Date(), 'yyyy-MM-dd')}`, 'true');
    setShowRatingPrompt(false);
  };

  return (
    <div className="space-y-3">
      {/* Today's FOLK Service Board — community accountability view */}
      <TodayFolkServiceBoard residencyId={residencyId} currentUserId={userId} />

      {/* Allocation published banner */}
      {publishBanner && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-primary/10 border border-primary/20 text-sm">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary shrink-0" />
            <span className="font-medium text-primary text-xs sm:text-sm">📋 Your services for this week have been published!</span>
          </div>
          <button onClick={dismissPublishBanner} className="text-muted-foreground hover:text-foreground text-xs shrink-0">Dismiss</button>
        </div>
      )}

      {showRatingPrompt && (
        <ServiceRatingPrompt onDismiss={dismissRatingPrompt} />
      )}

      {/* Service type tabs — horizontally scrollable on mobile */}
      <Tabs defaultValue="Weekly">
        <div className="overflow-x-auto -mx-1 px-1 pb-1">
          <TabsList className="flex w-max min-w-full gap-1 mb-3 h-auto">
            {SERVICE_TYPE_TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="flex items-center gap-1 text-xs sm:text-sm whitespace-nowrap px-2.5 py-1.5 sm:px-3"
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {SERVICE_TYPE_TABS.map(tab => (
          <TabsContent key={tab.value} value={tab.value}>
            {/* Inner sub-tabs — also scrollable */}
            <Tabs defaultValue="board">
              <div className="overflow-x-auto -mx-1 px-1 pb-1">
                <TabsList className="flex w-max gap-1 mb-3 h-auto">
                  <TabsTrigger value="board" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap px-2.5 py-1.5">
                    <LayoutGrid className="w-3.5 h-3.5" />Allocation
                  </TabsTrigger>
                  {tab.value === 'Weekly' && (
                    <>
                      <TabsTrigger value="stats" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap px-2.5 py-1.5">
                        <CalendarDays className="w-3.5 h-3.5" />Stats
                      </TabsTrigger>
                      <TabsTrigger value="leaderboard" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap px-2.5 py-1.5">
                        <Trophy className="w-3.5 h-3.5" />Leaderboard
                      </TabsTrigger>
                      <TabsTrigger value="avail" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap px-2.5 py-1.5">
                        <CalendarCheck className="w-3.5 h-3.5" />Availability
                      </TabsTrigger>
                      <TabsTrigger value="prefs" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap px-2.5 py-1.5">
                        <Settings2 className="w-3.5 h-3.5" />Preferences
                      </TabsTrigger>
                    </>
                  )}
                </TabsList>
              </div>

              <TabsContent value="board">
                <UserAllocationBoardTab userId={userId} residencyId={residencyId} />
              </TabsContent>
              {tab.value === 'Weekly' && (
                <>
                  <TabsContent value="stats">
                    <ServiceCalendarTab />
                  </TabsContent>
                  <TabsContent value="leaderboard">
                    <ServiceLeaderboardTab isGuide={false} residencyId={residencyId} />
                  </TabsContent>
                  <TabsContent value="avail">
                    <UserAvailabilityTab />
                  </TabsContent>
                  <TabsContent value="prefs">
                    <UserPreferencesTab userId={userId} residencyId={residencyId} />
                  </TabsContent>
                </>
              )}
            </Tabs>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
