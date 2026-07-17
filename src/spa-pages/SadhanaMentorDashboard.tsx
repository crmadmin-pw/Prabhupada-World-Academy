import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BookOpen, Users, BarChart3, Phone, MessageCircle, Flame, Search, LayoutDashboard, ArrowUpDown, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { getMentorMembers } from 'zite-endpoints-sdk';
import type { GetMentorMembersOutputType } from 'zite-endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { DashboardLayout } from '@/layouts';
import { LoadingPage } from '@/shared';
import TabRouter from '@/shared/TabRouter';
import type { TabConfig } from '@/shared/TabRouter';
import SadhanaSection from '@/components/guide/SadhanaSection';
import OneToOneTab from '@/components/guide/OneToOneTab';
import { format } from 'date-fns';
import { scoreColor } from '@/lib/scoring';
import { normalizePhoneForLinks } from '@/lib/userUtils';
import { ASHRAY_LEVELS } from '@/types/enums';

type Member = GetMentorMembersOutputType['members'][0];
type SortKey = 'fullName' | 'latestScore' | 'currentStreak' | 'ashrayLevel' | 'residencyName' | 'performanceStatus';
const PERF_ORDER: Record<string, number> = { needs_attention: 0, declining: 1, improving: 2, stable: 3 };

function PerformanceBadge({ status }: { status: Member['performanceStatus'] }) {
  const map: Record<string, { label: string; className: string }> = {
    needs_attention: { label: 'Needs Attention', className: 'bg-destructive/10 text-destructive border-destructive/30' },
    declining:       { label: 'Declining',        className: 'bg-orange-100 text-orange-700 border-orange-300' },
    improving:       { label: 'Improving',         className: 'bg-green-100 text-green-700 border-green-300' },
    stable:          { label: 'Stable',            className: 'bg-blue-100 text-blue-700 border-blue-300' },
  };
  const cfg = map[status] ?? map.stable;
  return <Badge variant="outline" className={`text-xs ${cfg.className}`}>{cfg.label}</Badge>;
}

function safeFormatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr || dateStr.length < 8) return null;
  try {
    const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr);
    return isNaN(d.getTime()) ? null : format(d, 'MMM d');
  } catch { return null; }
}

interface MembersTableProps {
  members: Member[];
  guideName: string;
  onNavigate: (userId: string, from: string) => void;
}

function MembersTable({ members, guideName, onNavigate }: MembersTableProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('fullName');
  const [sortAsc, setSortAsc] = useState(true);
  const [ashrayFilter, setAshrayFilter] = useState('all');
  // Combined location filter: 'all' | 'non_residents' | residencyName
  const [locationFilter, setLocationFilter] = useState('all');

  // Derive distinct ashray levels and residency options from members
  const distinctAshray = useMemo(() =>
    ASHRAY_LEVELS.filter(l => members.some(m => m.ashrayLevel === l)),
  [members]);

  // Location options: All + Non-Resident + each unique residency
  const locationOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [
      { value: 'all', label: 'All Members' },
      { value: 'non_residents', label: 'Non-Resident' },
    ];
    members.forEach(m => {
      if (m.isResident && m.residencyName && !seen.has(m.residencyName)) {
        seen.add(m.residencyName);
        opts.push({ value: m.residencyName, label: m.residencyName.replace(/^FOLK\s+/i, '') });
      }
    });
    return opts;
  }, [members]);

  const filtered = useMemo(() => {
    let result = members;
    if (search) result = result.filter(m =>
      m.fullName.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase())
    );
    if (locationFilter === 'non_residents') result = result.filter(m => !m.isResident);
    else if (locationFilter !== 'all') result = result.filter(m => m.isResident && m.residencyName === locationFilter);
    if (ashrayFilter !== 'all') result = result.filter(m => m.ashrayLevel === ashrayFilter);
    return result;
  }, [members, search, locationFilter, ashrayFilter]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'fullName') cmp = a.fullName.localeCompare(b.fullName);
    else if (sortKey === 'latestScore') cmp = (a.latestScore ?? -1) - (b.latestScore ?? -1);
    else if (sortKey === 'currentStreak') cmp = a.currentStreak - b.currentStreak;
    else if (sortKey === 'ashrayLevel') cmp = (a.ashrayLevel ?? '').localeCompare(b.ashrayLevel ?? '');
    else if (sortKey === 'residencyName') {
      const ar = a.residencyName ?? (a.isResident ? '' : 'ZZZ');
      const br = b.residencyName ?? (b.isResident ? '' : 'ZZZ');
      cmp = ar.localeCompare(br);
    }
    else if (sortKey === 'performanceStatus') {
      cmp = (PERF_ORDER[a.performanceStatus] ?? 3) - (PERF_ORDER[b.performanceStatus] ?? 3);
    }
    return sortAsc ? cmp : -cmp;
  }), [filtered, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(key !== 'latestScore' && key !== 'currentStreak'); }
  };

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      className={`flex items-center gap-1 font-medium hover:text-foreground transition-colors ${sortKey === k ? 'text-foreground' : 'text-muted-foreground'}`}
      onClick={() => toggleSort(k)}
    >
      {label}<ArrowUpDown className="w-3 h-3" />
    </button>
  );

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search members..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Single combined location filter */}
        <Select value={locationFilter} onValueChange={(v) => setLocationFilter(v || 'all')}>
          <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {locationOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {distinctAshray.length > 1 && (
          <Select value={ashrayFilter} onValueChange={(v) => setAshrayFilter(v || 'all')}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="All Ashraya" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Ashraya</SelectItem>
              {distinctAshray.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
          <Users className="w-3.5 h-3.5" />{sorted.length}/{members.length} · <strong>{guideName}</strong>
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">
          {search || locationFilter !== 'all' || ashrayFilter !== 'all'
            ? 'No members match your filters.'
            : 'No members found.'}
        </p>
      ) : (
        <div className="rounded-lg border overflow-x-auto overflow-y-auto max-h-[72vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b">
                <th className="text-left px-3 py-2.5 bg-muted"><SortBtn k="fullName" label="Name" /></th>
                <th className="text-left px-3 py-2.5 hidden sm:table-cell bg-muted"><SortBtn k="ashrayLevel" label="Level" /></th>
                <th className="text-left px-3 py-2.5 bg-muted"><SortBtn k="residencyName" label="Residency" /></th>
                <th className="text-center px-3 py-2.5 bg-muted"><SortBtn k="latestScore" label="Score" /></th>
                <th className="text-center px-3 py-2.5 font-medium text-muted-foreground hidden md:table-cell bg-muted">Last Entry</th>
                <th className="text-center px-3 py-2.5 bg-muted"><SortBtn k="currentStreak" label="Streak" /></th>
                <th className="text-left px-3 py-2.5 hidden lg:table-cell bg-muted"><SortBtn k="performanceStatus" label="Status" /></th>
                <th className="text-center px-3 py-2.5 font-medium text-muted-foreground hidden lg:table-cell bg-muted">Contact</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(m => {
                const latestDate = safeFormatDate(m.latestEntryDate);
                const color = scoreColor(m.latestScore, m.isResident);
                const residencyLabel = m.isResident
                  ? (m.residencyName ? m.residencyName.replace(/^FOLK\s+/i, '') : 'Resident')
                  : 'Non-Resident';
                return (
                  <tr
                    key={m.userId}
                    className="border-b hover:bg-muted/40 cursor-pointer transition-colors"
                    onClick={() => onNavigate(m.userId, '/mentor/dashboard')}
                  >
                    <td className="px-3 py-2.5 font-medium">{m.fullName}</td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      {m.ashrayLevel
                        ? <Badge variant="outline" className="text-xs">{m.ashrayLevel}</Badge>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {m.isResident
                        ? <span className="text-xs text-primary font-medium">{residencyLabel}</span>
                        : <span className="text-xs text-muted-foreground">{residencyLabel}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {m.latestScore != null
                        ? <span className={`font-bold ${color}`}>{m.latestScore}%</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center text-muted-foreground hidden md:table-cell">
                      {latestDate ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {m.currentStreak > 0
                        ? <span className="flex items-center justify-center gap-0.5 text-orange-600 font-medium">
                            <Flame className="w-3 h-3" />{m.currentStreak}
                          </span>
                        : <span className="text-muted-foreground">0</span>}
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      <PerformanceBadge status={m.performanceStatus} />
                    </td>
                    <td className="px-3 py-2.5 text-center hidden lg:table-cell" onClick={e => e.stopPropagation()}>
                      {m.phone ? (
                        <div className="flex items-center justify-center gap-1">
                          <Button size="sm" variant="outline" className="h-7 w-7 p-0" asChild title="Call">
                            <a href={`tel:+${normalizePhoneForLinks(m.phone)}`}><Phone className="w-3.5 h-3.5" /></a>
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 w-7 p-0 border-green-600 text-green-700 hover:bg-green-600 hover:text-white" asChild title="WhatsApp">
                            <a href={`https://wa.me/${normalizePhoneForLinks(m.phone)}`} target="_blank" rel="noopener noreferrer">
                              <MessageCircle className="w-3.5 h-3.5" />
                            </a>
                          </Button>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SadhanaMentorDashboard() {
  const { profile } = useUserProfile();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [guideName, setGuideName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.userId) loadMembers();
  }, [profile?.userId]);

  const loadMembers = async () => {
    try {
      const res = await getMentorMembers({});
      setMembers(res.members);
      setGuideName(res.guideName);
    } catch {
      toast.error('Failed to load members');
    } finally {
      setLoading(false);
    }
  };

  if (!profile) return <LoadingPage />;

  const subtitle = [
    'Sadhana Mentor',
    profile.ashrayLevel ? `Ashraya: ${profile.ashrayLevel}` : null,
    profile.guideName ? `Guide: ${profile.guideName}` : null,
    profile.residencyName ? `FOLK: ${profile.residencyName}` : null,
  ].filter(Boolean).join(' · ');

  const tabs: TabConfig[] = [
    { value: 'reports', label: 'Reports', icon: BarChart3 },
    { value: 'members', label: 'Members', icon: Users },
    ...(profile.selectedGuideId ? [{ value: 'one-to-one', label: 'One-to-One', icon: MessageSquare } as TabConfig] : []),
  ];

  return (
    <DashboardLayout
      title={`Hare Krishna, ${profile.fullName} Prabhu`}
      subtitle={subtitle}
      maxWidth="max-w-6xl"
    >
      {loading ? (
        <LoadingPage rows={2} />
      ) : (
        <TabRouter tabs={tabs} defaultTab="reports" desktopCols={2}>
          {(activeTab) => (
            <>
              {activeTab === 'reports' && profile.selectedGuideId && (
                <SadhanaSection guideId={profile.selectedGuideId} mentorMode={true} />
              )}
              {activeTab === 'reports' && !profile.selectedGuideId && (
                <p className="text-center text-muted-foreground py-8">
                  No FOLK Guide assigned. Please contact your administrator.
                </p>
              )}
              {activeTab === 'one-to-one' && profile.selectedGuideId && (
                <OneToOneTab guideId={profile.selectedGuideId} />
              )}
              {activeTab === 'members' && (
                <MembersTable
                  members={members}
                  guideName={guideName}
                  onNavigate={(uid, from) => navigate(`/guide/users/${uid}`, { state: { from } })}
                />
              )}
            </>
          )}
        </TabRouter>
      )}
    </DashboardLayout>
  );
}
