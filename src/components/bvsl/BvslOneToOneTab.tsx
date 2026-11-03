import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { getBvslOneToOneData, saveBvslOneToOneLink } from '@/lib/endpoints-sdk';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { 
  Link, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  Info, 
  Calendar, 
  Phone, 
  PhoneOff, 
  PhoneMissed, 
  Video, 
  FileText, 
  Plus, 
  Edit2, 
  ExternalLink, 
  Clock, 
  ArrowRight,
  User,
  BadgeAlert,
  Search,
  Filter,
  XCircle
} from 'lucide-react';
import OneToOneMatrix from '@/components/guide/OneToOneMatrix';
import type { Member, Meeting } from '@/components/guide/OneToOneMatrix';
import OneToOneLogDialog from '@/components/guide/OneToOneLogDialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface DialogState {
  open: boolean;
  memberId: string;
  memberName: string;
  weekDate: string;
  existing: Meeting | null;
  guideId?: string;
}

function BvslBookingLinkSettings({ initialLink }: { initialLink: string }) {
  const [link, setLink] = useState(initialLink);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setLink(initialLink); }, [initialLink]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveBvslOneToOneLink({ link: link });
      setSaved(true);
      toast.success('1:1 Booking link saved');
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error('Failed to save booking link');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-muted/40 border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Link className="w-3.5 h-3.5 text-primary" />
        <span>Your Calendly / Booking Link</span>
      </div>
      <div className="flex gap-2">
        <Input
          value={link}
          onChange={e => setLink(e.target.value)}
          placeholder="https://calendly.com/your-name/30min"
          className="h-8 text-xs bg-background"
        />
        <Button size="sm" variant="secondary" onClick={handleSave} disabled={saving} className="h-8 shrink-0 text-xs">
          {saved ? <Check className="w-3.5 h-3.5 text-green-600 mr-1" /> : null}
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

function formatCallDate(dateStr: string) {
  if (!dateStr) return 'No calls logged yet';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

import { useUserProfile } from '@/contexts/UserProfileContext';

export default function BvslOneToOneTab({ department, viewScope }: { department?: 'FOLK' | 'PW'; viewScope?: 'facilitator' | 'supervisor' } = {}) {
  const { profile } = useUserProfile();
  const isFolk = profile?.segment === 'FOLK';
  const profileRole = String(profile?.role || '');
  const isSuperAdmin = !viewScope && !!(
    profile?.isBvSuperAdmin ||
    profileRole === 'SUPER_ADMIN' ||
    profileRole === 'SUPER_GUIDE'
  );
  const isAdmin = !viewScope && !isSuperAdmin && !!(profile?.isBvAdmin || profileRole === 'ADMIN');
  const isSupervisor = viewScope === 'supervisor' || (!viewScope && !isSuperAdmin && !isAdmin && !!(profile?.isBvSupervisor || profile?.isBvMentor));

  const [members, setMembers] = useState<Member[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [weeks, setWeeks] = useState<string[]>([]);
  const [bvslLink, setBvslLink] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogState>({ open: false, memberId: '', memberName: '', weekDate: '', existing: null });
  const [expandedMembers, setExpandedMembers] = useState<Record<string, boolean>>({});

  // Filter States (Default to 'ALL' with capital A)
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('ALL');
  const [ashrayFilter, setAshrayFilter] = useState('ALL');

  const loadData = useReactiveLoader(async (read) => {
    !read.background && !read.cancelled && setLoading(true);
    try {
      const res = await read(() => getBvslOneToOneData({ department, viewScope }));
      !read.cancelled && setMembers(res.users || []);
      !read.cancelled && setMeetings(res.meetings || []);
      !read.cancelled && setWeeks(res.weeks || []);
      if (res.bvslLink !== undefined) !read.cancelled && setBvslLink(res.bvslLink || '');
    } catch {
      if (read.cancelled) return; /* silent */ }
    finally { !read.cancelled && setLoading(false); }
  }, [department, viewScope]);

  useEffect(() => { loadData(); }, [loadData]);

  const availableLevels = useMemo(() => {
    const set = new Set<string>();
    members.forEach(m => {
      if (m.ashrayLevel) set.add(m.ashrayLevel);
    });
    return Array.from(set).filter(Boolean).sort();
  }, [members]);

  const availableGroups = useMemo(() => {
    const groups = new Map<string, string>();
    members.forEach(member => {
      if (member.groupId && member.groupName) groups.set(member.groupId, member.groupName);
    });
    return [...groups.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members]);

  // Filtered members list
  const filteredMembers = useMemo(() => {
    return members.filter(m => {
      // 1. Search Query Match
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        if (!m.fullName.toLowerCase().includes(q)) return false;
      }
      // 2. Reading Group Match
      if (groupFilter !== 'ALL' && groupFilter !== 'all') {
        if (m.groupId !== groupFilter) return false;
      }
      // 3. Ashraya Level Match
      if (ashrayFilter !== 'ALL' && ashrayFilter !== 'all') {
        if (m.ashrayLevel !== ashrayFilter) return false;
      }
      return true;
    });
  }, [members, searchQuery, groupFilter, ashrayFilter]);

  const openDialog = (memberId: string, memberName: string, weekDate: string, existing: Meeting | null, guideId?: string) =>
    setDialog({ open: true, memberId, memberName, weekDate, existing, guideId });
  const closeDialog = () => setDialog(d => ({ ...d, open: false }));
  const onSaved = () => { closeDialog(); loadData(); };

  const toggleExpand = (id: string) => {
    setExpandedMembers(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getMemberCallDetails = (memberId: string) => {
    const memberMeetings = meetings
      .filter(m => m.memberId === memberId)
      .sort((a, b) => b.meetingDate.localeCompare(a.meetingDate)); // newest first

    const lastMtg = memberMeetings[0];
    const lastCallDate = lastMtg?.meetingDate || '';

    // Find the latest meeting that has a next call date
    const latestWithNextCall = memberMeetings.find(m => m.nextCallDate);
    const nextCallDate = latestWithNextCall?.nextCallDate || '';
    const nextCallAgenda = latestWithNextCall?.nextCallAgenda || '';

    return {
      memberMeetings,
      lastCallDate,
      nextCallDate,
      nextCallAgenda,
    };
  };

  if (!loading && members.length === 0) {
    return (
      <div className="space-y-4">
        <BvslBookingLinkSettings initialLink={bvslLink} />
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Info className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium">{isSupervisor ? 'No supervised members yet' : viewScope === 'facilitator' ? 'No reading group members yet' : 'No delegated members yet'}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {isSupervisor
              ? 'RGFs, RGSFs, and group members in your reporting hierarchy will appear here.'
              : viewScope === 'facilitator' ? 'Members of the reading groups you facilitate or assist will appear here.' : 'When your guide delegates members to you for 1:1 meetings, they will appear here.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">My One-to-One Tracker</h2>
          <p className="text-sm text-muted-foreground">
            {isSupervisor
              ? 'RGFs, RGSFs, and members in your supervised reading groups. Click any cell to log a meeting.'
              : viewScope === 'facilitator' ? 'Members of your own reading groups. Click any cell to log a meeting.' : 'Members delegated to you for 1:1 meetings. Click any cell to log a meeting.'}
          </p>
        </div>
        <div className="shrink-0 sm:min-w-[260px]">
          <BvslBookingLinkSettings initialLink={bvslLink} />
        </div>
      </div>

      {/* Filter Control Bar (Search by Name, Reading Group, and Ashraya Level) */}
      {!loading && (
        <div className="bg-card border border-border rounded-xl p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-primary" /> Filter 1:1 Call Reports
            </span>
            <span className="text-xs text-muted-foreground font-medium">
              Showing <strong>{filteredMembers.length}</strong> of <strong>{members.length}</strong> members
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Search Member Name */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search member by name..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>

            {/* Filter by Reading Group */}
            <div>
              <Select value={groupFilter} onValueChange={(val: string | null) => setGroupFilter(val || 'ALL')}>
                <SelectTrigger className="h-9 text-xs font-medium">
                  <SelectValue placeholder="All Groups">
                    {groupFilter === 'ALL' || groupFilter === 'all'
                      ? 'All Groups'
                      : availableGroups.find(group => group.id === groupFilter)?.name || 'All Groups'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Groups ({availableGroups.length})</SelectItem>
                  {availableGroups.map(group => (
                    <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Filter by Ashraya Level */}
            <div>
              <Select value={ashrayFilter} onValueChange={(val: string | null) => setAshrayFilter(val || 'ALL')}>
                <SelectTrigger className="h-9 text-xs font-medium">
                  <SelectValue placeholder="All Ashraya Levels">
                    {ashrayFilter === 'ALL' || ashrayFilter === 'all' ? 'All Ashraya Levels' : ashrayFilter}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Ashraya Levels ({availableLevels.length})</SelectItem>
                  {availableLevels.map(level => (
                    <SelectItem key={level} value={level}>{level}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Active Filter Clear Indicator */}
          {(searchQuery || (groupFilter !== 'ALL' && groupFilter !== 'all') || (ashrayFilter !== 'ALL' && ashrayFilter !== 'all')) && (
            <div className="flex items-center justify-between pt-1 text-xs border-t border-border/50">
              <span className="text-muted-foreground">Active filters applied</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setGroupFilter('ALL');
                  setAshrayFilter('ALL');
                }}
                className="h-6 px-2 text-[11px] text-destructive hover:bg-destructive/10"
              >
                <XCircle className="w-3 h-3 mr-1" /> Clear Filters
              </Button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center bg-muted/20 space-y-2">
          <Info className="h-8 w-8 mx-auto text-muted-foreground mb-1" />
          <p className="text-sm font-semibold">No members match your selected filters</p>
          <p className="text-xs text-muted-foreground">Try clearing your search query or dropdown filters to view all call reports.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearchQuery('');
              setGroupFilter('ALL');
              setAshrayFilter('all');
            }}
            className="mt-2 text-xs"
          >
            Clear All Filters
          </Button>
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-green-100 border border-green-300" /> Meeting logged</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded border border-dashed border-border" /> No meeting</span>
            <span>Sorted by longest gap first</span>
          </div>
          <OneToOneMatrix
            members={filteredMembers}
            meetings={meetings}
            weeks={weeks}
            groupByAshray={true}
            isSuperAdmin={isSuperAdmin}
            isAdmin={isAdmin}
            isSupervisor={isSupervisor}
            onCellClick={(memberId, memberName, weekDate, existing) => {
              const member = members.find(m => m.userId === memberId);
              openDialog(memberId, memberName, weekDate, existing, member?.delegateId || undefined);
            }}
          />

          {/* Call Details & History Breakdown Section */}
          <div className="mt-8 space-y-4">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> Member Call Details & History ({filteredMembers.length})
            </h3>
            
            <div className="grid grid-cols-1 gap-4">
              {filteredMembers.map(member => {
                const { memberMeetings, lastCallDate, nextCallDate, nextCallAgenda } = getMemberCallDetails(member.userId);
                const isExpanded = !!expandedMembers[member.userId];

                return (
                  <Card key={member.userId} className="border border-border bg-card shadow-xs hover:shadow-md transition-shadow">
                    <CardHeader className="pb-3 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" />
                          {member.fullName}
                        </CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                          {member.ashrayLevel || 'No level'}
                          {isFolk && ` · ${member.isResident ? 'Resident' : 'Non-Resident'}`}
                        </CardDescription>

                        {/* Hierarchy Badges for Supervisor, Admin, Super Admin */}
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {isSuperAdmin && (
                            <>
                              <Badge variant="outline" className="text-[10px] font-normal bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800">
                                Admin: {(member as any).adminName || 'Unassigned'}
                              </Badge>
                              <Badge variant="outline" className="text-[10px] font-normal bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
                                Supervisor: {(member as any).supervisorName || 'Unassigned'}
                              </Badge>
                              <Badge variant="outline" className="text-[10px] font-normal bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                                RGF: {(member as any).rgfName || 'Unassigned'}
                              </Badge>
                            </>
                          )}
                          {isAdmin && (
                            <>
                              <Badge variant="outline" className="text-[10px] font-normal bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
                                Supervisor: {(member as any).supervisorName || 'Unassigned'}
                              </Badge>
                              <Badge variant="outline" className="text-[10px] font-normal bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                                RGF: {(member as any).rgfName || 'Unassigned'}
                              </Badge>
                            </>
                          )}
                          {isSupervisor && (
                            <Badge variant="outline" className={`text-[10px] font-normal ${member.roleLabel === 'RGF'
                              ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                              : member.roleLabel === 'RGSF'
                                ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
                                : 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800'}`}>
                              {member.roleLabel || 'Member'}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2.5 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/5"
                          onClick={() => {
                            const latestMtg = memberMeetings[0] || null;
                            const currentWeek = weeks[weeks.length - 1] || new Date().toISOString().split('T')[0];
                            openDialog(
                              member.userId,
                              member.fullName,
                              currentWeek,
                              latestMtg,
                              member.delegateId || undefined
                            );
                          }}
                        >
                          <Plus className="w-3.5 h-3.5" /> Log Call
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => toggleExpand(member.userId)}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                      </div>
                    </CardHeader>

                    <CardContent className="pt-0 pb-4 px-4 space-y-3">
                      {/* Overview Metadata Row */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-muted/30 p-2.5 rounded-md">
                        <div>
                          <span className="text-muted-foreground block font-medium">Last Call Logged:</span>
                          <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                            <Calendar className="w-3.5 h-3.5 text-primary" />
                            {formatCallDate(lastCallDate)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block font-medium">Next Call Agenda / Plan:</span>
                          {nextCallDate ? (
                            <div className="space-y-0.5 mt-0.5">
                              <span className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                {formatCallDate(nextCallDate)}
                              </span>
                              {nextCallAgenda && (
                                <p className="text-[11px] text-muted-foreground italic line-clamp-1">
                                  "{nextCallAgenda}"
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic mt-0.5 block">No upcoming call scheduled</span>
                          )}
                        </div>
                      </div>

                      {/* Collapsible History Section */}
                      {isExpanded && (
                        <div className="pt-2 space-y-3 border-t border-border/60">
                          <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-muted-foreground" /> Call History Logs ({memberMeetings.length})
                          </h4>

                          {memberMeetings.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic py-2">No calls logged yet for this member.</p>
                          ) : (
                            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                              {memberMeetings.map(mtg => (
                                <div key={mtg.id} className="border border-border/80 rounded-md p-2.5 bg-background text-xs space-y-1.5">
                                  <div className="flex items-center justify-between flex-wrap gap-1 border-b border-border/40 pb-1.5">
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-foreground flex items-center gap-1">
                                        <Calendar className="w-3 h-3 text-muted-foreground" />
                                        {formatCallDate(mtg.meetingDate)}
                                      </span>
                                      <Badge variant="outline" className="text-[10px] py-0 font-normal">
                                        {mtg.durationMinutes || 0} mins
                                      </Badge>
                                      {mtg.callStatus && (
                                        <Badge className={`text-[10px] py-0 ${
                                          mtg.callStatus === 'Connected' ? 'bg-green-100 text-green-700 border-green-300' :
                                          mtg.callStatus === 'No Answer' ? 'bg-amber-100 text-amber-700 border-amber-300' :
                                          'bg-red-100 text-red-700 border-red-300'
                                        }`}>
                                          {mtg.callStatus}
                                        </Badge>
                                      )}
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-primary gap-1"
                                      onClick={() => openDialog(member.userId, member.fullName, mtg.weekDate, mtg, member.delegateId || undefined)}
                                    >
                                      <Edit2 className="w-3 h-3" /> Edit Log
                                    </Button>
                                  </div>

                                  {mtg.notes && (
                                    <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap">
                                      {mtg.notes}
                                    </p>
                                  )}

                                  {(mtg.nextCallDate || mtg.recordingLink) && (
                                    <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] border-t border-border/30">
                                      {mtg.nextCallDate && (
                                        <span className="text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
                                          <ArrowRight className="w-3 h-3" /> Next: {formatCallDate(mtg.nextCallDate)}
                                          {mtg.nextCallAgenda && ` (${mtg.nextCallAgenda})`}
                                        </span>
                                      )}
                                      {mtg.recordingLink && (
                                        <a
                                          href={mtg.recordingLink}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-primary hover:underline flex items-center gap-1 font-medium ml-auto"
                                        >
                                          <Video className="w-3 h-3" /> Recording <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </>
      )}

      {dialog.open && (
        <OneToOneLogDialog
          open={dialog.open}
          memberId={dialog.memberId}
          memberName={dialog.memberName}
          weekDate={dialog.weekDate}
          existing={dialog.existing}
          guideId={dialog.guideId}
          onClose={closeDialog}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
