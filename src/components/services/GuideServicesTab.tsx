import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { List, Award, Calendar, Building2, LayoutGrid, Brush, Heart, Sparkles, Star, Trophy, BarChart2, FileSpreadsheet } from 'lucide-react';
import { getResidenciesForGuide } from 'zite-endpoints-sdk';
import ServiceListTab from './ServiceListTab';
import UserSkillsTab from './UserSkillsTab';
import AvailabilityOverviewTab from './AvailabilityOverviewTab';
import AllocationBoardTab from './AllocationBoardTab';
import ServiceLeaderboardTab from './ServiceLeaderboardTab';
import ServiceAnalyticsTab from './ServiceAnalyticsTab';

interface Props { guideId?: string; residencyId?: string; }

const SERVICE_TYPE_TABS = [
  { value: 'Weekly',                  label: 'Weekly',             icon: Building2,  desc: 'Regular weekly services' },
  { value: 'Saturday Maha Cleaning',  label: 'Maha Cleaning',      icon: Brush,      desc: 'Saturday deep cleaning duty' },
  { value: 'Sunday Love Feast',       label: 'Love Feast',         icon: Heart,      desc: 'Sunday love feast preparation & serving' },
  { value: 'Occasional',              label: 'Occasional',         icon: Sparkles,   desc: 'One-off or irregular services' },
  { value: 'Festivals',               label: 'Festivals',          icon: Star,       desc: 'Festival & special event services' },
];

function ServiceTypeContent({ serviceType, guideId, residencyId }: { serviceType: string; guideId?: string; residencyId?: string }) {
  return (
    <Tabs defaultValue="board">
      <TabsList className="w-full md:w-auto flex-wrap h-auto gap-1">
        <TabsTrigger value="board" className="flex items-center gap-1.5">
          <LayoutGrid className="w-4 h-4" />{serviceType === 'Weekly' ? 'Allocation' : 'Assignments'}
        </TabsTrigger>
        <TabsTrigger value="services" className="flex items-center gap-1.5">
          <List className="w-4 h-4" />Services
        </TabsTrigger>
        {serviceType === 'Weekly' && (
          <>
            <TabsTrigger value="leaderboard" className="flex items-center gap-1.5">
              <Trophy className="w-4 h-4" />Leaderboard
            </TabsTrigger>
            <TabsTrigger value="skills" className="flex items-center gap-1.5">
              <Award className="w-4 h-4" />Skills
            </TabsTrigger>
            <TabsTrigger value="availability" className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />Availability
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-1.5">
              <BarChart2 className="w-4 h-4" />Analytics
            </TabsTrigger>
          </>
        )}
      </TabsList>
      <TabsContent value="board" className="mt-4">
        <AllocationBoardTab guideId={guideId} residencyId={residencyId} serviceType={serviceType} />
      </TabsContent>
      <TabsContent value="services" className="mt-4">
        <ServiceListTab residencyId={residencyId} serviceType={serviceType} />
      </TabsContent>
      {serviceType === 'Weekly' && (
        <>
          <TabsContent value="leaderboard" className="mt-4">
            <ServiceLeaderboardTab isGuide={true} residencyId={residencyId} />
          </TabsContent>
          <TabsContent value="skills" className="mt-4">
            <UserSkillsTab />
          </TabsContent>
          <TabsContent value="availability" className="mt-4">
            <AvailabilityOverviewTab />
          </TabsContent>
          <TabsContent value="analytics" className="mt-4">
            <ServiceAnalyticsTab residencyId={residencyId} />
          </TabsContent>
        </>
      )}
    </Tabs>
  );
}

export default function GuideServicesTab({ guideId, residencyId: residencyIdProp }: Props) {
  const navigate = useNavigate();
  const [residencyId, setResidencyId] = useState<string | undefined>(residencyIdProp);

  useEffect(() => {
    if (residencyIdProp) {
      setResidencyId(residencyIdProp);
    } else if (guideId) {
      getResidenciesForGuide({ guideId }).then(res => {
        if (res && res.length > 0) setResidencyId(res[0].residencyId);
      }).catch(() => {});
    }
  }, [guideId, residencyIdProp]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            FOLK Services
          </h2>
          <p className="text-sm text-muted-foreground">Organize services by program type. Use "Publish & Notify" when the weekly allocation is ready.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate('/service-management')} className="shrink-0">
          <FileSpreadsheet className="w-4 h-4 mr-1.5" />
          Export / Import
        </Button>
      </div>

      <Tabs defaultValue="Weekly">
        <TabsList className="w-full md:w-auto flex-wrap h-auto gap-1 mb-1">
          {SERVICE_TYPE_TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.value} value={tab.value} className="flex items-center gap-1.5 text-xs sm:text-sm">
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {SERVICE_TYPE_TABS.map(tab => (
          <TabsContent key={tab.value} value={tab.value} className="mt-4">
            <div className="mb-3">
              <p className="text-xs text-muted-foreground">{tab.desc}</p>
            </div>
            <ServiceTypeContent serviceType={tab.value} guideId={guideId} residencyId={residencyId} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
