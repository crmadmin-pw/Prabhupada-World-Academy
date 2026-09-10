import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { User, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getUserProfile, getUserHistory } from '@/lib/endpoints-sdk';
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
  isSuperAdmin?: boolean;
  isBvAdmin?: boolean;
  isBvSuperAdmin?: boolean;
  segment?: 'PW' | 'FOLK' | null;
}

export default function ProfileHero({ fullName, email, isResident, ashrayLevel, role, isBvsl, isSadhanaMentor, isFolkLead, isTripCoordinator, isBvMentor, isSuperAdmin, isBvAdmin, isBvSuperAdmin, segment }: Props) {
  const [exporting, setExporting] = useState(false);
  const normalizedRole = String(role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const isManagement = Boolean(isSuperAdmin || isBvAdmin || isBvSuperAdmin ||
    ['GUIDE', 'SUPER_GUIDE', 'ADMIN', 'SUPER_ADMIN', 'PW_ADMIN'].includes(normalizedRole));

  const handleExport = async () => {
    setExporting(true);
    try {
      // Export the signed-in member's own profile/history through the same
      // authorized endpoints as their dashboard, including every history page.
      const [profileResult, firstPage] = await Promise.all([
        getUserProfile({}), getUserHistory({ limit: 200, offset: 0, includeFieldValues: true }),
      ]);
      if (!profileResult.user) throw new Error('Profile unavailable');
      const profile = profileResult.user;
      const entries = [...firstPage.entries];
      let page = firstPage;
      while (page.hasMore) {
        if (!page.entries.length) throw new Error('History pagination did not advance');
        page = await getUserHistory({ limit: 200, offset: entries.length, includeFieldValues: true });
        entries.push(...page.entries);
      }
      entries.sort((a, b) => b.entryDate.localeCompare(a.entryDate));
      const fieldKeys = [...new Set(entries.flatMap(entry => Object.keys(entry.fieldValues)))].sort();
      const headers = [
        'Date', 'Template', 'Ashray Level', 'Total Score', 'Max Score', 'Score %',
        'Rounds', 'SP Reading (min)', 'Preaching (min)', 'Sleep (min)', 'Sick', 'OS',
        'Submitted At', ...fieldKeys,
      ];
      const rows = [
        ['Field', 'Value'],
        ['Full Name', profile.fullName], ['Email', profile.email], ['Phone', profile.phone],
        ['Ashray Level', profile.ashrayLevel], ['Guide', profile.guideName],
        ['Resident', profile.isResident ? 'Yes' : 'No'], ['Residency', profile.residencyName],
        [], ['--- SADHANA ENTRIES ---'], headers,
        ...entries.map(entry => [
          entry.entryDate, entry.templateMode, entry.ashrayLevelUsed, entry.totalScore,
          entry.maxScore, entry.scorePercent ?? '', entry.roundsCount, entry.spReadingMinutes,
          entry.preachingMinutes, entry.sleepMinutes, entry.flagSick ? 'Yes' : '',
          entry.flagOs ? 'Yes' : '', entry.submittedAt,
          ...fieldKeys.map(key => {
            const value = entry.fieldValues[key];
            return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
          }),
        ]),
      ];
      exportToCsv(rows, `sadhana_data_${fullName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
      toast.success(`Exported ${entries.length} sadhana entries`);
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
          {(() => {
            const isFolk = segment === 'FOLK';
            const normalizedRole = String(role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
            let roleBadgeText = '';
            if (isSuperAdmin || isBvSuperAdmin || normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_GUIDE') {
              roleBadgeText = isFolk ? '👑 Super Guide' : '👑 Super Admin';
            } else if (normalizedRole === 'GUIDE' || normalizedRole === 'ADMIN' || normalizedRole === 'PW_ADMIN' || isBvAdmin) {
              roleBadgeText = isFolk ? 'Guide' : 'Admin';
            }
            if (!roleBadgeText) return null;
            return (
              <Badge className={isSuperAdmin || roleBadgeText.includes('👑') ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30" : "bg-primary/10 text-primary border border-primary/30"}>
                {roleBadgeText}
              </Badge>
            );
          })()}
          {isBvsl && <Badge className="bg-primary/10 text-primary border border-primary/30">📖 RGF</Badge>}
          {isSadhanaMentor && <Badge className="bg-amber-100 text-amber-800 border border-amber-300">🎓 Sadhana Mentor</Badge>}
          {isBvMentor && <Badge className="bg-purple-100 text-purple-800 border border-purple-300">👁️ Supervisor</Badge>}
          {isFolkLead && <Badge className="bg-blue-100 text-blue-800 border border-blue-300">👑 FOLK Lead</Badge>}
          {isTripCoordinator && <Badge className="bg-indigo-100 text-indigo-800 border border-indigo-300">🗺️ Trip Coordinator</Badge>}
          {isResident && <Badge variant="secondary">🏠 Resident</Badge>}
          {!isSuperAdmin && !isBvAdmin && !isBvSuperAdmin && !['GUIDE', 'SUPER_GUIDE', 'ADMIN', 'SUPER_ADMIN', 'PW_ADMIN'].includes(String(role || '').trim().toUpperCase().replace(/[\s-]+/g, '_')) && ashrayLevel && <Badge variant="secondary">✨ {ashrayLevel}</Badge>}
        </div>
      </div>
      {!isManagement && (
        <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} className="shrink-0">
          {exporting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
          Export
        </Button>
      )}
    </div>
  );
}
