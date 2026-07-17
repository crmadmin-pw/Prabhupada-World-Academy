import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import BvSection from '@/components/guide/BvSection';
import SuperGuideBvSection from './SuperGuideBvSection';
import SuperBvPreachingAnalytics from './SuperBvPreachingAnalytics';
import { getGuides } from 'zite-endpoints-sdk';
import type { GetGuidesOutputType } from 'zite-endpoints-sdk';
import { BarChart3, TrendingUp } from 'lucide-react';

type SubTab = 'overview' | 'preaching';

const SUB_TABS: { value: SubTab; label: string; icon: React.ElementType; desc: string }[] = [
  { value: 'overview',  label: 'BV Overview',         icon: BarChart3,   desc: 'Attendance, sessions, and group stats' },
  { value: 'preaching', label: 'Preaching Analytics', icon: TrendingUp,  desc: 'Center-wise BVSL preaching field breakdown' },
];

export default function SuperBvReportTab() {
  const [guides, setGuides]               = useState<GetGuidesOutputType['guides']>([]);
  const [selectedGuide, setSelectedGuide] = useState('all');
  const [subTab, setSubTab]               = useState<SubTab>('overview');

  useEffect(() => {
    getGuides({}).then(r => setGuides(r.guides)).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      {/* Sub-tab nav */}
      <div className="flex gap-0 border-b border-border overflow-x-auto">
        {SUB_TABS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setSubTab(value)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              subTab === value
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── BV Overview (existing) ── */}
      {subTab === 'overview' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Label className="text-sm shrink-0">Filter by Guide:</Label>
            <Select value={selectedGuide} onValueChange={setSelectedGuide}>
              <SelectTrigger className="w-52 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Guides (Overview)</SelectItem>
                {guides.map(g => (
                  <SelectItem key={g.guideId} value={g.guideId}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedGuide === 'all'
            ? <SuperGuideBvSection />
            : <BvSection guideId={selectedGuide} />
          }
        </div>
      )}

      {/* ── Preaching Analytics (new) ── */}
      {subTab === 'preaching' && <SuperBvPreachingAnalytics />}
    </div>
  );
}
