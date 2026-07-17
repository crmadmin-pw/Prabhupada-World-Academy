import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { User, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { exportUserData } from 'zite-endpoints-sdk';
import { exportToCsv } from '@/utils/exportCsv';

interface Props {
  fullName: string;
  email: string;
  isResident: boolean;
  ashrayLevel: string | null;
  role?: string;
  isBvsl?: boolean;
  isSadhanaMentor?: boolean;
  isFolkLead?: boolean;
  isTripCoordinator?: boolean;
  isBvMentor?: boolean;
}

export default function ProfileHero({ fullName, email, isResident, ashrayLevel, isBvsl, isSadhanaMentor, isFolkLead, isTripCoordinator, isBvMentor }: Props) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await exportUserData({});
      const headers = [
        'Date', 'Total Score', 'Max Score', 'Score %', 'Rounds', 'Japa Finish Time',
        'SP Reading (min)', 'Sleep', 'Study (min)', 'Preaching (min)', 'Books Distributed',
        'MA/NA/GV', 'Quotes/Tulasi', 'Japa Visible', 'SB', 'Cleanliness',
        'Report Sending', 'Daily Service', 'Sleep Quality', 'Sick', 'OS',
      ];
      const rows = [
        ['Field', 'Value'],
        ['Full Name', data.profile.fullName],
        ['Email', data.profile.email],
        ['Phone', data.profile.phone],
        ['Ashraya Level', data.profile.ashrayLevel],
        ['Guide', data.profile.guideName],
        ['Resident', data.profile.isResident ? 'Yes' : 'No'],
        ['Residency', data.profile.residency],
        ['Member Since', data.profile.memberSince],
        [],
        ['--- SADHANA ENTRIES ---'],
        headers,
        ...data.entries.map((e: any) => [
          e.date, e.totalScore, e.maxScore ?? '', e.scorePercent != null ? `${e.scorePercent}%` : '',
          e.rounds ?? '', e.japaFinishTime, e.spReadingMinutes ?? '', e.sleepHours,
          e.studyMinutes ?? '', e.preachingMinutes ?? '', e.booksDistributed ?? '',
          e.maNaGv, e.quotesTulasi, e.japaVisible, e.sb, e.cleanliness,
          e.reportSending, e.dailyService, e.sleepQuality,
          e.flagSick ? 'Yes' : '', e.flagOs ? 'Yes' : '',
        ]),
      ];
      exportToCsv(rows, `sadhana_data_${fullName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
      toast.success(`Exported ${data.totalEntries} sadhana entries`);
    } catch { toast.error('Failed to export data'); }
    finally { setExporting(false); }
  };

  return (
    <div className="flex items-center gap-4 p-5 bg-card rounded-xl border">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <User className="w-8 h-8 text-primary" />
      </div>
      <div className="flex-1">
        <h2 className="text-2xl font-bold">{fullName}</h2>
        <p className="text-sm text-muted-foreground">{email}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {isBvsl && <Badge className="bg-primary/10 text-primary border border-primary/30">🌟 BVSL</Badge>}
          {isSadhanaMentor && <Badge className="bg-amber-100 text-amber-800 border border-amber-300">🎓 Sadhana Mentor</Badge>}
          {isBvMentor && <Badge className="bg-purple-100 text-purple-800 border border-purple-300">🍃 BV Mentor</Badge>}
          {isFolkLead && <Badge className="bg-blue-100 text-blue-800 border border-blue-300">👑 FOLK Lead</Badge>}
          {isTripCoordinator && <Badge className="bg-indigo-100 text-indigo-800 border border-indigo-300">🗺️ Trip Coordinator</Badge>}
          {isResident && <Badge variant="secondary">🏠 Resident</Badge>}
          {ashrayLevel && <Badge variant="secondary">✨ {ashrayLevel}</Badge>}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} className="shrink-0">
        {exporting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
        Export
      </Button>
    </div>
  );
}
