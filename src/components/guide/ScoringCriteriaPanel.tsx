import { useState, useEffect } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';

const RESIDENT_CRITERIA = [
  { field: 'MA / NA / Guru Vandana', max: 3,    rule: '3 = full 23 min | 2 = 18-22 min | 1 = 12-17 min | 0 = less than 12 min' },
  { field: 'Quotes + Tulasi Pranama', max: 1,   rule: '1 = attended fully | 0 = not attended or partial' },
  { field: 'Bath (penalty)',          max: 0,   rule: 'Minus 1 point if attended morning program without taking a bath' },
  { field: 'Japa Visible',            max: 2,   rule: '2 = 25-30 min visible | 1 = 10-25 min | 0 = less than 10 min' },
  { field: 'Srimad Bhagavatam',       max: 2,   rule: '2 = 25-30 min in MT Hall | 1 = 15-24 min | 0 = less than 15 min' },
  { field: 'Cleanliness',             max: 1,   rule: '1 = cleaned before 8 AM | 0 = not cleaned or after 8 AM' },
  { field: 'Report Filling',          max: 1,   rule: '1 = filled same day (Before 12 midnight) | 0 = backdated or late' },
  { field: 'Daily Assigned Service',  max: 2,   rule: '2 = done fully | 0 = done partially or not done' },
  { field: 'SP Book Reading',         max: 3,   rule: 'More than 6 months: 3 = >40 min, 2 = 31-40 min, 1 = 20-30 min | 3-6 months: 3 = >30 min, 2 = 21-30 min, 1 = 10-20 min | 0-3 months: 3 = >20 min, 2 = 15-20 min, 1 = 5-14 min' },
  { field: 'Chanting Rounds',         max: 4,   rule: 'More than 6 months: 4 = >=16r, 3 = 10-15r, 2 = 5-9r, 1 = 4r | 3-6 months: 4 = >=8r, 3 = 6-7r, 2 = 3-5r, 1 = 2r | 0-3 months: 4 = >=4r, 3 = 3r, 2 = 2r, 1 = 1r' },
  { field: 'Sleep Quality',           max: 1,   rule: '1 = slept before 10:30 PM | 0 = slept after 10:30 PM' },
];

const NR_CRITERIA = [
  { field: 'Wake-up Time',      max: 4, rule: 'Upasaka: by 6:00 AM | Caranashraya: by 5:00 AM | Harinam Diksha: by 4:00 AM | Deduct 1 point per 15-min delay' },
  { field: 'Sleep Time',        max: 4, rule: 'Upasaka: by 11:00 PM | Caranashraya: by 10:30 PM | Harinam Diksha: by 10:00 PM | Deduct 1 point per 15-min delay' },
  { field: 'Chanting Rounds',   max: 8, rule: 'Jigyasa/Shraddhavan: 1r | Sevak: 4r | Sadhaka: 8r | Upasaka: 12r | Caranashraya/Harinam: 16r | Pro-rata scoring' },
  { field: 'Reading Time',      max: 4, rule: 'Jigyasa/Shraddhavan: 5 min | Sevak: 10 min | Sadhaka: 15 min | Upasaka: 20 min | Caranashraya: 30 min | Harinam: 60 min | Pro-rata scoring' },
  { field: 'Hearing Time',      max: 4, rule: 'Same targets as Reading. BV session = 50% hearing + 50% reading for scoring. Pro-rata scoring' },
  { field: 'Filled Same Day',   max: 4, rule: '4 points if filled same day | Minus 2 points per day of delay | Sevak and above only | Jigyasa/Shraddhavan: N/A' },
  { field: 'Seva / Service',    max: 4, rule: 'Upasaka: 20 min target | Caranashraya: 30 min target | Harinam: 60 min target | Pro-rata 4 pts | Sevak/Sadhaka: leaderboard only (Yes/No) | Jigyasa/Shraddhavan: N/A' },
  { field: 'Bhakti Vriksha',    max: 4, rule: 'Caranashraya+: 30 min target, pro-rata 4 pts | Sevak/Sadhaka/Upasaka: leaderboard only (Yes/No) | Jigyasa/Shraddhavan: N/A' },
];

const TH = 'px-3 py-2 text-left text-xs font-bold text-foreground border-b border-border bg-muted whitespace-nowrap';
const TD = 'px-3 py-2 text-xs border-b border-border/50 align-top';

function CriteriaTable({ title, rows }: { title: string; rows: typeof RESIDENT_CRITERIA }) {
  return (
    <div>
      <p className="text-xs font-bold text-foreground mb-2 uppercase tracking-wide">{title}</p>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[160px] min-w-[140px]`}>Field</th>
              <th className={`${TH} w-[80px] text-center`}>Max Points</th>
              <th className={TH}>Scoring Rules</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}>
                <td className={`${TD} font-semibold text-foreground`}>{row.field}</td>
                <td className={`${TD} text-center font-bold ${row.max > 0 ? 'text-primary' : 'text-destructive'}`}>
                  {row.max > 0 ? row.max : 'Penalty'}
                </td>
                <td className={`${TD} text-muted-foreground leading-relaxed`}>{row.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ScoringCriteriaPanel() {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground h-8">
          <Info className="w-4 h-4" />
          <span className="text-sm font-medium">Scoring Criteria</span>
          {open ? <ChevronDown className="w-4 h-4 ml-auto" /> : <ChevronRight className="w-4 h-4 ml-auto" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border rounded-lg p-4 mt-1 space-y-6 bg-card">
        <CriteriaTable title="Resident Scoring Criteria" rows={RESIDENT_CRITERIA} />
        <div className="border-t pt-4">
          <CriteriaTable title="Non-Resident Scoring Criteria" rows={NR_CRITERIA} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
