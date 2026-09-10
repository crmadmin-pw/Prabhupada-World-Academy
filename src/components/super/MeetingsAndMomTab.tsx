import TableScrollArea from '@/components/mobile/TableScrollArea';
import { useModalSurface } from '@/hooks/useModalSurface';
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Video, Calendar, Clock, Plus, Trash2, Edit, X, Users as UsersIcon, Check,
  ExternalLink, FileText, AlertCircle, Search, Trash, ChevronDown, ListTodo,
  User, Mail, CalendarClock, Link as LinkIcon, BadgeAlert, Sparkles, Send, CheckCircle2
} from 'lucide-react';
import {
  createMeeting, updateMeeting, saveMom
} from '@/lib/endpoints-sdk';
import { useAuth } from '@/lib/auth-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { useEndpointQuery } from '@/hooks/useEndpointQuery';

interface ProposedByDropdownProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  options: string[];
  placeholder?: string;
}

function ProposedByDropdown({ value, onChange, disabled, options, placeholder = 'Name' }: ProposedByDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [listMaxHeight, setListMaxHeight] = useState(220);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const portalRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const listboxId = React.useId();

  // Recalculate position whenever open
  const openDropdown = () => {
    if (isOpen) {
      searchInputRef.current?.focus();
      return;
    }
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 6;
    const menuWidth = Math.min(320, Math.max(280, rect.width));
    const menuLeft = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - menuWidth - viewportPadding
    );
    const estimatedHeight = Math.min(340, 88 + Math.max(options.length, 1) * 42 + 10);
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const showAbove = spaceBelow < Math.min(estimatedHeight, 210) && spaceAbove > spaceBelow;
    const availableHeight = Math.max(128, showAbove ? spaceAbove - gap : spaceBelow - gap);
    const menuMaxHeight = Math.min(340, availableHeight);

    setListMaxHeight(Math.max(84, menuMaxHeight - 88));
    setDropdownStyle({
      position: 'fixed',
      left: menuLeft,
      width: menuWidth,
      maxHeight: menuMaxHeight,
      ...(showAbove
        ? { bottom: window.innerHeight - rect.top + gap }
        : { top: rect.bottom + gap }),
      zIndex: 9999,
    });
    setFilter('');
    setActiveIndex(Math.max(0, options.findIndex(opt => opt === value)));
    setIsOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        // Also check if click is inside the portal dropdown
        if (portalRef.current?.contains(event.target as Node)) return;
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on scroll/resize to avoid misalignment — but NOT when scrolling inside the dropdown itself
  useEffect(() => {
    if (!isOpen) return;
    const close = (e: Event) => {
      if (portalRef.current && (portalRef.current === e.target || portalRef.current.contains(e.target as Node))) return;
      setIsOpen(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [isOpen]);

  const filteredOptions = options.filter(opt =>
    opt.toLowerCase().includes(filter.toLowerCase())
  );

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    listRef.current
      .querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  const chooseOption = (option: string) => {
    onChange(option);
    setFilter('');
    setIsOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handlePickerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      setIsOpen(false);
      setFilter('');
      inputRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        openDropdown();
        return;
      }
      if (filteredOptions.length === 0) return;
      setActiveIndex(current => {
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        return (current + direction + filteredOptions.length) % filteredOptions.length;
      });
      return;
    }
    if (e.key === 'Enter' && isOpen && filteredOptions[activeIndex]) {
      e.preventDefault();
      chooseOption(filteredOptions[activeIndex]);
    }
  };

  const dropdownEl = isOpen && !disabled ? (
    <div
      ref={portalRef}
      id={listboxId}
      style={dropdownStyle}
      role="listbox"
      aria-label="Proposed by"
      className="flex flex-col overflow-hidden bg-popover/98 border border-primary/20 rounded-2xl shadow-[0_18px_45px_-18px_rgba(0,0,0,0.45)] ring-1 ring-black/5 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="space-y-2 px-3 py-2.5 border-b border-border/70 bg-muted/30 shrink-0">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid place-items-center w-6 h-6 rounded-lg bg-primary/10 text-primary shrink-0">
              <UsersIcon className="w-3.5 h-3.5" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground whitespace-nowrap">
              Search participants
            </span>
          </div>
          <span className="text-[9px] font-semibold text-muted-foreground/80 bg-background/80 border border-border/60 rounded-full px-2 py-0.5 shrink-0">
            {filteredOptions.length} {filteredOptions.length === 1 ? 'person' : 'people'}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={searchInputRef}
            type="search"
            value={filter}
            onChange={e => {
              setFilter(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handlePickerKeyDown}
            placeholder="Search participants…"
            aria-label="Search participants"
            aria-controls={listboxId}
            autoComplete="off"
            className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-[11px] font-medium outline-none placeholder:text-muted-foreground/65 focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      <div
        ref={listRef}
        style={{
          maxHeight: listMaxHeight,
          scrollbarWidth: 'thin',
          scrollbarColor: 'color-mix(in srgb, var(--primary) 45%, transparent) transparent',
        }}
        className="overflow-y-auto overflow-x-hidden overscroll-contain p-1.5 scroll-py-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-primary/30 hover:[&::-webkit-scrollbar-thumb]:bg-primary/50"
      >
        {filteredOptions.length > 0 ? (
          filteredOptions.map((opt, index) => {
            const isSelected = value === opt;
            const isActive = activeIndex === index;
            const initials = opt
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map(part => part[0]?.toUpperCase())
              .join('');

            return (
              <button
                key={opt}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-option-index={index}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={e => {
                  e.preventDefault();
                  chooseOption(opt);
                }}
                className={`group w-full min-w-0 text-left px-2.5 py-2 rounded-xl text-[11px] font-semibold transition-all flex items-center gap-2.5 outline-none ${
                  isSelected
                    ? 'bg-primary/12 text-primary'
                    : isActive
                      ? 'bg-muted text-foreground'
                      : 'text-foreground hover:bg-muted/70'
                }`}
              >
                <span aria-hidden="true" className={`grid place-items-center w-7 h-7 rounded-full text-[9px] font-bold shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-primary/8 text-primary group-hover:bg-primary/15'
                }`}>
                  {initials || <User className="w-3.5 h-3.5" />}
                </span>
                <span className="truncate flex-1" title={opt}>{opt}</span>
                {isSelected && (
                  <span className="grid place-items-center w-5 h-5 rounded-full bg-primary/15 text-primary shrink-0">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </span>
                )}
              </button>
            );
          })
        ) : (
          <div className="px-3 py-6 text-center">
            <div className="mx-auto mb-2 grid place-items-center w-8 h-8 rounded-full bg-muted text-muted-foreground">
              <Search className="w-4 h-4" />
            </div>
            <p className="text-[11px] font-semibold text-foreground">No participant found</p>
            <p className="mt-0.5 text-[9px] text-muted-foreground">Try a different name</p>
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          readOnly
          placeholder={placeholder}
          aria-label={placeholder === "Assignee" ? "Assigned to" : "Proposed by"}
          value={value}
          onKeyDown={handlePickerKeyDown}
          onFocus={openDropdown}
          onClick={openDropdown}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="none"
          className="w-full p-1.5 pr-7 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary text-[11px] placeholder:text-muted-foreground/60 transition-all font-medium cursor-pointer"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => isOpen ? setIsOpen(false) : openDropdown()}
          aria-label={`${isOpen ? 'Close' : 'Open'} ${placeholder === 'Assignee' ? 'assigned to' : 'proposed by'} options`}
          className="absolute right-1.5 grid place-items-center w-5 h-5 rounded-md text-muted-foreground/70 hover:text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
        >
          <ChevronDown className="w-3.5 h-3.5 transition-transform duration-200" style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
        </button>
      </div>
      {typeof document !== 'undefined' && ReactDOM.createPortal(dropdownEl, document.body)}
    </div>
  );

}

interface ActionItem {
  id?: string;
  proposedBy: string;
  discussionPoint: string;
  actionItem: string;
  assignedToUserId?: string;
  assignedToName?: string;
  deadline?: string;
  remarks?: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface Meeting {
  id: string;
  title: string;
  description?: string;
  type: 'FACILITATOR' | 'EXECUTIVE' | 'OTHER';
  custom_category_name?: string;
  scheduled_at: string;
  duration_minutes: number;
  locationOrLink?: string;
  created_by_email: string;
  created_by_name?: string;
  inviteeUserIds?: string[];
  invitees?: {
    userId: string;
    fullName: string;
    email: string;
    role?: string;
  }[];
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
}

interface Mom {
  id: string;
  meeting_id?: string;
  title: string;
  meeting_date: string;
  created_by_email: string;
  created_by_name?: string;
  agenda?: string;
  key_discussions?: string;
  action_items?: ActionItem[];
  decisions_made?: string;
  next_meeting_date?: string;
  attachments?: string;
  created_at: string;
}

function normalizedRoles(user: any): string[] {
  // `roles` contains the assigned multi-role values while `role` is still
  // populated on older records. Keep both sources: a multi-role user may have
  // `role: USER` alongside flags/values for RGF, RGSF, Supervisor, etc.
  const values = [
    ...(Array.isArray(user?.roles) ? user.roles : user?.roles ? [user.roles] : []),
    user?.role,
  ];
  return values
    .flatMap((value: unknown) => {
      // Some older integrations persist a comma-separated or JSON-encoded
      // roles value. Expand those forms so each assigned role can match.
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [value];
          } catch {
            // Fall through to the normal string handling.
          }
        }
        return trimmed.split(',');
      }
      return [value];
    })
    .filter(Boolean)
    .map((value: unknown) => String(value).toUpperCase().replace(/[\s-]+/g, '_'));
}

/** Match a role from either assigned values or the independent BV role flags. */
export function hasMeetingRole(user: any, role: 'ADMIN' | 'SUPERVISOR' | 'MENTOR' | 'FACILITATOR' | 'RGF' | 'RGSF'): boolean {
  const roles = normalizedRoles(user);
  const accepted: Record<typeof role, string[]> = {
    ADMIN: ['ADMIN', 'ADMINISTRATOR', 'PW_ADMIN', 'BV_ADMIN', 'SUPER_ADMIN', 'SUPER_GUIDE'],
    SUPERVISOR: ['SUPERVISOR', 'BV_SUPERVISOR'],
    MENTOR: ['MENTOR', 'SADHANA_MENTOR', 'BV_MENTOR', 'BVSL_MENTOR'],
    FACILITATOR: ['FACILITATOR', 'RGF', 'BVSL'],
    // "Facilitator", BVSL, and RGF are the same invitee category in PW.
    RGF: ['RGF', 'FACILITATOR', 'BVSL'],
    RGSF: ['RGSF', 'SUB_FACILITATOR'],
  };

  if (roles.some(value => accepted[role].includes(value))) return true;

  // Role flags are independent in the BV model. They must still be checked
  // when a record also has a `roles` array, because that array may only contain
  // the user's base role (for example USER/MEMBER).
  return role === 'ADMIN' ? !!(user?.isBvAdmin || user?.isBvSuperAdmin)
    : role === 'SUPERVISOR' ? !!(user?.isBvSupervisor || user?.isBvMentor)
    : role === 'MENTOR' ? !!(user?.isSadhanaMentor || user?.isBvMentor)
    : role === 'FACILITATOR' ? !!(user?.isBvFacilitator || user?.isBvsl)
    : role === 'RGF' ? !!(user?.isBvFacilitator || user?.isBvsl)
    : !!user?.isBvSubFacilitator;
}

/** Resolve legacy name fields and reject role-only placeholder records. */
export function meetingInviteeLabel(user: any): string {
  return String(user?.fullName || user?.name || user?.displayName || user?.email || '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim();
}

export function hasMeetingInviteeIdentity(user: any): boolean {
  return meetingInviteeLabel(user).length > 0;
}

const INVITE_ROLE_TYPES = ['ADMIN', 'SUPERVISOR', 'MENTOR', 'RGF', 'RGSF'] as const;

const getRolePriority = (u: any) => {
  const isAdmin = hasMeetingRole(u, 'ADMIN');
  const isSupervisor = hasMeetingRole(u, 'SUPERVISOR');
  const isFac = hasMeetingRole(u, 'FACILITATOR');
  const isRgsf = hasMeetingRole(u, 'RGSF');
  if (isAdmin) return 1;
  if (isSupervisor) return 2;
  if (isFac) return 3;
  if (hasMeetingRole(u, 'RGF')) return 4;
  if (isRgsf) return 5;
  return 6;
};

interface MeetingsAndMomTabProps {
  allowSchedule?: boolean;
  department?: 'FOLK' | 'PW';
}

export default function MeetingsAndMomTab({ allowSchedule = false, department: requestedDepartment }: MeetingsAndMomTabProps = {}) {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const department: 'FOLK' | 'PW' = requestedDepartment ||
    (String(profile?.segment || '').toUpperCase() === 'FOLK' ? 'FOLK' : 'PW');

  const userEmailLower = (user?.email || '').toLowerCase();
  const profileRole = String(profile?.role || '').toUpperCase().replace(/[\s-]+/g, '_');
  const isSuperAdmin = !!(
    (profile as any)?.isBvSuperAdmin ||
    ['SUPER_ADMIN', 'SUPER_GUIDE'].includes(profileRole)
  );
  const isAdminUser = isSuperAdmin ||
                      !!profile?.isBvAdmin ||
                      !!(profile as any)?.isPwAdmin ||
                      ['ADMIN', 'PW_ADMIN'].includes(profileRole);

  // Mentors attend only meetings they were invited to and can read published
  // MoMs. This takes priority over any stale legacy admin flags on a profile.
  const isReadOnlySadhanaMentor = department === 'PW' && !!(
    profile?.isSadhanaMentor || profileRole === 'SADHANA_MENTOR'
  );
  const canManageMeetings = isAdminUser && !isReadOnlySadhanaMentor;

  const isSupervisor = !!profile?.isBvSupervisor ||
                       !!(profile as any)?.isBvMentor ||
                       (profile?.role as string)?.toUpperCase()?.includes('SUPERVISOR');

  const isFacilitator = !!(
    profile?.isBvFacilitator ||
    profile?.isBvsl ||
    (profile?.role as string)?.toUpperCase() === 'BVSL' ||
    (profile?.role as string)?.toUpperCase() === 'FACILITATOR' ||
    (profile?.role as string)?.toUpperCase() === 'RGF'
  );

  const getStatusLabel = (val: string) => {
    switch (val) {
      case 'all': return 'All Statuses';
      case 'scheduled': return 'Scheduled';
      case 'in_progress': return 'In Progress';
      case 'completed': return 'Completed';
      case 'cancelled': return 'Cancelled';
      default: return val;
    }
  };

  const getCategoryLabel = (val: string) => {
    switch (val) {
      case 'all': return 'All Meeting Types';
      case 'FACILITATOR': return 'RGF Meeting';
      case 'EXECUTIVE': return 'Executive Meeting';
      case 'OTHER': return 'Other Meeting';
      default: return val;
    }
  };

  const [selectedInviteeIds, setSelectedInviteeIds] = useState<string[]>([]);
  const [inviteeSearch, setInviteeSearch] = useState('');

  // Tabs & Filters
  const [viewTab, setViewTab] = useState<'meetings' | 'moms'>('meetings');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);

  const [showMomModal, setShowMomModal] = useState(false);
  const meetingModalRef = React.useRef<HTMLDivElement>(null);
  const momModalRef = React.useRef<HTMLDivElement>(null);
  useModalSurface(showMeetingModal, meetingModalRef, () => setShowMeetingModal(false));
  useModalSurface(showMomModal, momModalRef, () => setShowMomModal(false));
  const [selectedMeetingForMom, setSelectedMeetingForMom] = useState<Meeting | null>(null);
  const [editingMom, setEditingMom] = useState<Mom | null>(null);

  // Meeting Form State
  const [meetingForm, setMeetingForm] = useState({
    title: '',
    description: '',
    type: 'FACILITATOR' as 'FACILITATOR' | 'EXECUTIVE' | 'OTHER',
    custom_category_name: '',
    scheduled_at: '',
    duration_minutes: 60,
    meeting_link: '',
  });

  // MoM Form State
  const [momForm, setMomForm] = useState({
    title: '',
    meeting_date: new Date().toISOString().slice(0, 16),
    agenda: '',
    key_discussions: '',
    decisions_made: '',
    next_meeting_date: '',
    attachments: '',
    action_items: [] as ActionItem[],
  });

  // Action Item Inputs
  const [newActionTask, setNewActionTask] = useState('');
  const [newActionAssigneeName, setNewActionAssigneeName] = useState('');
  const [newActionAssigneeEmail, setNewActionAssigneeEmail] = useState('');
  const meetingsQuery = useEndpointQuery<any>('getMeetings', { department });
  const momsQuery = useEndpointQuery<any>('getMoms', { department });
  // Directory lookup runs independently; meeting cards do not wait for it.
  const inviteesQuery = useEndpointQuery<any>('getGuideUsers', {
    guideId: 'ALL', statusFilter: 'all', minimal: true, forMeetingInvitees: true,
  }, canManageMeetings);
  const loading = viewTab === 'meetings' ? meetingsQuery.loading : momsQuery.loading;
  const error = (viewTab === 'meetings' ? meetingsQuery.error : momsQuery.error)?.message || null;
  const meetings: Meeting[] = useMemo(() => {
    const mRes = meetingsQuery.data || {};
      const now = Date.now();
      const mappedMeetings = (mRes.meetings || []).map((m: any) => {
        // Compute effective display status from scheduled time, not just DB value.
        // DB 'cancelled' is authoritative; everything else is derived from the clock.
        const dbStatus = (m.status || 'SCHEDULED').toLowerCase();
        let effectiveStatus = dbStatus;
        if (dbStatus !== 'cancelled') {
          const startMs = new Date(m.scheduledAt).getTime();
          const durationMs = (m.durationMinutes || 60) * 60 * 1000;
          const endMs = startMs + durationMs;
          if (now < startMs) {
            effectiveStatus = 'scheduled';
          } else if (now >= startMs && now < endMs) {
            effectiveStatus = 'in_progress';
          } else {
            effectiveStatus = 'completed';
          }
        }
        return {
          id: m.id,
          title: m.title,
          description: m.description,
          type: m.type,
          scheduled_at: m.scheduledAt,
          duration_minutes: m.durationMinutes,
          locationOrLink: m.locationOrLink,
          created_by_email: m.createdByUserId,
          created_by_name: m.createdByName,
          inviteeUserIds: m.inviteeUserIds || [],
          invitees: m.invitees || [],
          status: effectiveStatus,
        };
      });
    return mappedMeetings;
  }, [meetingsQuery.data]);
  const moms: Mom[] = useMemo(() => {
    const momRes = momsQuery.data || {};
      const mappedMoms = (momRes.moms || []).map((mom: any) => ({
        id: mom.id,
        meeting_id: mom.meetingId,
        title: mom.meetingTitle,
        meeting_date: mom.meetingDate,
        created_by_email: mom.createdByUserId,
        created_by_name: mom.createdByName,
        agenda: '',
        key_discussions: '',
        decisions_made: '',
        next_meeting_date: mom.next_meeting_date || '',
        attachments: mom.attachments || '',
        action_items: (mom.discussionItems || []).map((item: any) => ({
          id: item.id,
          proposedBy: item.proposedBy || '',
          discussionPoint: item.discussionPoint || '',
          actionItem: item.actionItem || '',
          assignedToUserId: item.assignedToUserId || '',
          assignedToName: item.assignedToName || '',
          deadline: item.deadline || '',
          remarks: item.remarks || '',
          status: item.status || 'pending',
        })),
        created_at: mom.createdAt,
      }));
    return mappedMoms;
  }, [momsQuery.data]);
  const registeredUsers = useMemo<any[]>(() => {
    const usersRes = inviteesQuery.data || {};
      const departmentUsers = (usersRes.users || []).map((u: any) => ({
        ...u,
        fullName: meetingInviteeLabel(u),
      })).filter((u: any) => {
        const roleUpper = (u.role || '').toUpperCase();
        const isFolk = u.segment === 'FOLK';
        const hasInviteRole = INVITE_ROLE_TYPES.some(role => hasMeetingRole(u, role));
        const isPw = u.segment === 'PW' || hasInviteRole || u.isBvSupervisor || u.isBvFacilitator || u.isBvsl || roleUpper.includes('SUPERVISOR');
        return hasMeetingInviteeIdentity(u) && hasInviteRole && (department === 'FOLK' ? isFolk : (isPw && !isFolk));
      });
    return departmentUsers;
  }, [inviteesQuery.data, department]);
  const activeMeetingForMom = selectedMeetingForMom || (editingMom ? meetings.find(m => m.id === editingMom.meeting_id) : null);
  const canEditMom = canManageMeetings;
  const loadData = async () => {
    await Promise.all([meetingsQuery.refetch(), momsQuery.refetch()]);
  };

  const openNewMeetingModal = () => {
    setEditingMeeting(null);
    const now = new Date();
    now.setMinutes(0, 0, 0);
    // Format YYYY-MM-DDTHH:mm
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setMeetingForm({
      title: 'RGF Meeting',
      description: '',
      type: 'FACILITATOR',
      custom_category_name: '',
      scheduled_at: localIso,
      duration_minutes: 60,
      meeting_link: '',
    });
    // Default to selecting all facilitators for a Facilitators Meeting
    const defaultFacIds = registeredUsers
      .filter((u: any) => hasMeetingRole(u, 'FACILITATOR'))
      .map((u: any) => u.userId);
    setSelectedInviteeIds(defaultFacIds);
    setInviteeSearch('');
    setShowMeetingModal(true);
  };

  const handleTypeChange = (newType: 'FACILITATOR' | 'EXECUTIVE' | 'OTHER') => {
    setMeetingForm(prev => ({
      ...prev,
      type: newType,
      title: newType === 'FACILITATOR'
        ? 'RGF Meeting'
        : newType === 'EXECUTIVE'
        ? 'Executive Meeting'
        : prev.title === 'RGF Meeting' || prev.title === 'Facilitators Meeting' || prev.title === 'Executive Meeting'
        ? ''
        : prev.title
    }));

    if (newType === 'FACILITATOR') {
      const defaultFacIds = registeredUsers
        .filter((u: any) => hasMeetingRole(u, 'FACILITATOR'))
        .map((u: any) => u.userId);
      setSelectedInviteeIds(defaultFacIds);
    } else {
      setSelectedInviteeIds([]);
    }
  };

  const openEditMeetingModal = (m: Meeting) => {
    setEditingMeeting(m);
    setMeetingForm({
      title: m.title,
      description: m.description || '',
      type: m.type || 'OTHER',
      custom_category_name: m.custom_category_name || '',
      scheduled_at: m.scheduled_at ? m.scheduled_at.slice(0, 16) : '',
      duration_minutes: m.duration_minutes || 60,
      meeting_link: m.locationOrLink || '',
    });
    setSelectedInviteeIds(m.inviteeUserIds || []);
    setInviteeSearch('');
    setShowMeetingModal(true);
  };

  const handleSaveMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingForm.title || !meetingForm.scheduled_at) {
      alert('Please fill in title and scheduled date/time.');
      return;
    }

    try {
      if (editingMeeting) {
        await updateMeeting({
          meetingId: editingMeeting.id,
          title: meetingForm.title,
          type: meetingForm.type,
          scheduledAt: meetingForm.scheduled_at,
          durationMinutes: Number(meetingForm.duration_minutes),
          locationOrLink: meetingForm.meeting_link,
          description: meetingForm.description,
          additionalInviteeIds: selectedInviteeIds,
        });
      } else {
        await createMeeting({
          title: meetingForm.title,
          type: meetingForm.type,
          scheduledAt: meetingForm.scheduled_at,
          durationMinutes: Number(meetingForm.duration_minutes),
          locationOrLink: meetingForm.meeting_link,
          description: meetingForm.description,
          additionalInviteeIds: selectedInviteeIds,
        });
      }
      setShowMeetingModal(false);
      await loadData();
    } catch (err: any) {
      alert('Error saving meeting: ' + (err.message || 'Unknown error'));
    }
  };

  const isPresetSelected = (preset: 'RGFS' | 'RGSFS' | 'SUPERVISORS' | 'MENTORS' | 'ADMINS') => {
    const targetIds = registeredUsers
      .filter((u: any) => {
        if (preset === 'RGFS') return hasMeetingRole(u, 'RGF');
        if (preset === 'RGSFS') return hasMeetingRole(u, 'RGSF');
        if (preset === 'SUPERVISORS') return hasMeetingRole(u, 'SUPERVISOR');
        if (preset === 'MENTORS') return hasMeetingRole(u, 'MENTOR');
        if (preset === 'ADMINS') return hasMeetingRole(u, 'ADMIN');
        return false;
      })
      .map((u: any) => u.userId);
    return targetIds.length > 0 && targetIds.every(id => selectedInviteeIds.includes(id));
  };

  const selectPresetGroup = (preset: 'RGFS' | 'RGSFS' | 'SUPERVISORS' | 'MENTORS' | 'ADMINS' | 'CLEAR') => {
    if (preset === 'CLEAR') {
      setSelectedInviteeIds([]);
      return;
    }

    const targetIds = registeredUsers
      .filter((u: any) => {
        if (preset === 'RGFS') {
          return hasMeetingRole(u, 'RGF');
        }
        if (preset === 'RGSFS') {
          return hasMeetingRole(u, 'RGSF');
        }
        if (preset === 'SUPERVISORS') {
          return hasMeetingRole(u, 'SUPERVISOR');
        }
        if (preset === 'MENTORS') {
          return hasMeetingRole(u, 'MENTOR');
        }
        if (preset === 'ADMINS') {
          return hasMeetingRole(u, 'ADMIN');
        }
        return false;
      })
      .map((u: any) => u.userId);

    if (targetIds.length === 0) return;

    const allSelected = targetIds.every(id => selectedInviteeIds.includes(id));
    if (allSelected) {
      // Toggle off
      setSelectedInviteeIds(prev => prev.filter(id => !targetIds.includes(id)));
    } else {
      // Toggle on
      setSelectedInviteeIds(prev => Array.from(new Set([...prev, ...targetIds])));
    }
  };

  const handleCancelMeeting = async (mId: string) => {
    if (!confirm('Are you sure you want to cancel this meeting?')) return;
    try {
      await updateMeeting({
        meetingId: mId,
        status: 'CANCELLED',
      });
      await loadData();
    } catch (err: any) {
      alert('Failed to cancel meeting: ' + err.message);
    }
  };

  const openNewMomModal = (m?: Meeting) => {
    setEditingMom(null);
    setSelectedMeetingForMom(m || null);
    const existingMom = m ? moms.find(mom => mom.meeting_id === m.id) : null;
    if (existingMom) {
      setEditingMom(existingMom);
      setMomForm({
        title: existingMom.title,
        meeting_date: existingMom.meeting_date ? existingMom.meeting_date.slice(0, 16) : new Date().toISOString().slice(0, 16),
        agenda: '',
        key_discussions: '',
        decisions_made: '',
        next_meeting_date: existingMom.next_meeting_date ? existingMom.next_meeting_date.slice(0, 16) : '',
        attachments: existingMom.attachments || '',
        action_items: existingMom.action_items || [],
      });
    } else {
      setMomForm({
        title: m ? `${m.title} - Minutes of Meeting` : '',
        meeting_date: m?.scheduled_at ? m.scheduled_at.slice(0, 16) : new Date().toISOString().slice(0, 16),
        agenda: '',
        key_discussions: '',
        decisions_made: '',
        next_meeting_date: '',
        attachments: '',
        action_items: [{
          proposedBy: '',
          discussionPoint: '',
          actionItem: '',
          assignedToUserId: '',
          assignedToName: '',
          deadline: '',
          remarks: '',
          status: 'pending'
        }],
      });
    }
    setSelectedMeetingForMom(m || null);
    setShowMomModal(true);
  };

  const addActionItem = () => {
    setMomForm(prev => ({
      ...prev,
      action_items: [
        ...prev.action_items,
        {
          proposedBy: '',
          discussionPoint: '',
          actionItem: '',
          assignedToUserId: '',
          assignedToName: '',
          deadline: '',
          remarks: '',
          status: 'pending'
        }
      ]
    }));
  };

  const removeActionItem = (index: number) => {
    setMomForm(prev => ({
      ...prev,
      action_items: prev.action_items.filter((_, i) => i !== index),
    }));
  };

  const toggleActionItemStatus = (index: number) => {
    setMomForm(prev => {
      const updated = [...prev.action_items];
      const current = updated[index].status;
      const nextStatus = current === 'pending' ? 'in_progress' : current === 'in_progress' ? 'completed' : 'pending';
      updated[index] = { ...updated[index], status: nextStatus };
      return { ...prev, action_items: updated };
    });
  };

  const updateRowField = (index: number, field: keyof ActionItem, value: string) => {
    setMomForm(prev => {
      const updated = [...prev.action_items];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, action_items: updated };
    });
  };

  const handleSaveMom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!momForm.title || !momForm.meeting_date) {
      alert('Please fill in title and meeting date.');
      return;
    }

    // Filter out completely empty rows (Proposed by and Discussion are both empty)
    const activeItems = momForm.action_items.filter((item: any) =>
      (item.proposedBy || '').trim() !== '' || (item.discussionPoint || '').trim() !== ''
    );

    if (activeItems.length === 0) {
      toast.error('Please add at least one discussion item with Proposed By and Discussion filled.');
      return;
    }

    // Validate fields inside active rows
    for (let i = 0; i < activeItems.length; i++) {
      const row = activeItems[i];
      if (!(row.proposedBy || '').trim()) {
        toast.error(`Row ${i + 1}: "Proposed By" is required.`);
        return;
      }
      if (!(row.discussionPoint || '').trim()) {
        toast.error(`Row ${i + 1}: "Discussion" point is required.`);
        return;
      }
    }

    try {
      const discussionItems = activeItems.map((item: any) => ({
        id: item.id || undefined,
        proposedBy: item.proposedBy.trim(),
        discussionPoint: item.discussionPoint.trim(),
        actionItem: (item.actionItem || '').trim(),
        assignedToUserId: item.assignedToUserId || '',
        assignedToName: (item.assignedToName || '').trim(),
        deadline: item.deadline || '',
        remarks: (item.remarks || '').trim(),
        status: item.status || 'pending',
      }));

      const meetingId = selectedMeetingForMom?.id || editingMom?.meeting_id || (editingMom as any)?.meetingId || '';
      if (!meetingId) {
        toast.error('Error saving MoM: No associated meeting ID found.');
        return;
      }

      await saveMom({
        meetingId,
        visibleToUserIds: (editingMom as any)?.visibleToUserIds || [],
        visibleToAllInvitees: true,
        isPublished: true,
        discussionItems,
      });

      // If tied to meeting, mark meeting as completed
      if (selectedMeetingForMom && selectedMeetingForMom.status !== 'completed') {
        await updateMeeting({
          meetingId: selectedMeetingForMom.id,
          status: 'COMPLETED',
        });
      }

      setShowMomModal(false);
      await loadData();
    } catch (err: any) {
      console.error('MoM save error detail:', err);
      let details = '';
      if (err.errors && Array.isArray(err.errors)) {
        details = '\n' + err.errors.map((e: any) => `- ${e.path.join('.')}: ${e.message}`).join('\n');
      }
      alert('Error saving MoM: ' + (err.message || 'Unknown error') + details);
    }
  };

  const updateDirectActionStatus = async (mom: Mom, actionIdx: number, newStatus: 'pending' | 'in_progress' | 'completed') => {
    const updatedActions = [...(mom.action_items || [])];
    updatedActions[actionIdx] = { ...updatedActions[actionIdx], status: newStatus };
    try {
      const discussionItems = updatedActions.map((item: any) => ({
        id: item.id || undefined,
        proposedBy: item.proposedBy || '',
        discussionPoint: item.discussionPoint || '',
        actionItem: item.actionItem || '',
        assignedToUserId: item.assignedToUserId || '',
        assignedToName: item.assignedToName || '',
        deadline: item.deadline || '',
        remarks: item.remarks || '',
        status: item.status || 'pending',
      }));

      await saveMom({
        meetingId: mom.meeting_id || (mom as any).meetingId || '',
        visibleToUserIds: (mom as any).visibleToUserIds || [],
        visibleToAllInvitees: true,
        isPublished: true,
        discussionItems,
      });
      await loadData();
      toast.success('Action item status updated!');
    } catch (err: any) {
      toast.error('Error updating status: ' + (err.message || 'Unknown error'));
    }
  };

  // Filtered Meetings
  const filteredMeetings = meetings.filter(m => {
    // getMeetings already applies the authoritative invitation filter on the
    // server. Do not repeat it here with only the auth UID: meetings can carry
    // a database ID, custom user ID, UID, or email after an identity migration.

    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && m.type !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = m.title.toLowerCase().includes(q);
      const matchDesc = m.description?.toLowerCase().includes(q) || false;
      const matchCreator = m.created_by_name?.toLowerCase().includes(q) || m.created_by_email?.toLowerCase()?.includes(q);
      return matchTitle || matchDesc || matchCreator;
    }
    return true;
  });

  // Filtered MoMs
  const filteredMoms = moms.filter(m => {
    // getMoms returns only MoMs whose meeting is in the server-authorized
    // invited meeting set, so an MoM cannot leak through for another meeting.
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = m.title.toLowerCase().includes(q);
      const matchAgenda = m.agenda?.toLowerCase().includes(q) || false;
      const matchDiscussions = m.key_discussions?.toLowerCase().includes(q) || false;
      return matchTitle || matchAgenda || matchDiscussions;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5 rounded-2xl border border-primary/20">
        <div>
          <div className="flex items-center gap-2">
            <Video className="w-6 h-6 text-primary" />
            <h2 className="text-xl font-bold tracking-tight">Meetings & MoMs</h2>
          </div>
          {canManageMeetings && (
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Schedule meetings, manage participants, capture Minutes of Meeting (MoM), and track action items.
            </p>
          )}
        </div>
        {canManageMeetings && (
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={openNewMeetingModal}
              className="flex items-center gap-2 bg-primary text-primary-foreground text-sm font-semibold px-4 py-2 rounded-xl shadow hover:bg-primary/90 transition-all"
            >
              <Plus className="w-4 h-4" />
              Schedule Meeting
            </button>
            <button
              onClick={() => openNewMomModal()}
              className="flex items-center gap-2 bg-card border border-input text-foreground text-sm font-medium px-4 py-2 rounded-xl hover:bg-accent hover:text-accent-foreground transition-all"
            >
              <FileText className="w-4 h-4 text-primary" />
              Create MoM
            </button>
          </div>
        )}
      </div>

      {/* Primary Navigation / Filter Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* View Switcher Tabs */}
        <div className="inline-flex p-1 bg-muted/60 rounded-xl border border-border">
          <button
            onClick={() => setViewTab('meetings')}
            className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              viewTab === 'meetings'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            Meetings ({meetings.length})
          </button>
          <button
            onClick={() => setViewTab('moms')}
            className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              viewTab === 'moms'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            MoMs ({moms.length})
          </button>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              aria-label="Search meetings or MoMs"
              placeholder="Search meetings or MoMs..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-card border border-input rounded-xl w-full sm:w-48 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {viewTab === 'meetings' && (
            <>
              <Select value={statusFilter} onValueChange={val => setStatusFilter(val || 'all')}>
                <SelectTrigger className="w-[125px] h-8 text-xs bg-card border border-input rounded-xl focus:ring-1 focus:ring-primary shadow-sm">
                  <SelectValue placeholder="Status">{getStatusLabel(statusFilter)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>

              <Select value={categoryFilter} onValueChange={val => setCategoryFilter(val || 'all')}>
                <SelectTrigger className="w-[155px] h-8 text-xs bg-card border border-input rounded-xl focus:ring-1 focus:ring-primary shadow-sm">
                  <SelectValue placeholder="Type">{getCategoryLabel(categoryFilter)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Meeting Types</SelectItem>
                  <SelectItem value="FACILITATOR">RGF Meeting</SelectItem>
                  <SelectItem value="EXECUTIVE">Executive Meeting</SelectItem>
                  <SelectItem value="OTHER">Other Meeting</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">
          Loading meetings & MoMs...
        </div>
      ) : error ? (
        <div className="p-4 bg-destructive/10 text-destructive text-sm rounded-xl border border-destructive/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      ) : viewTab === 'meetings' ? (
        /* MEETINGS LIST VIEW */
        filteredMeetings.length === 0 ? (
          <div className="py-16 text-center border-2 border-dashed rounded-2xl p-6">
            <Video className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
            <h3 className="text-base font-semibold text-foreground">No meetings found</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              {canManageMeetings
                ? "No meetings match your selected filters. Schedule a new meeting to collaborate with team members."
                : "No meetings found."}
            </p>
            {canManageMeetings && (
              <button
                onClick={openNewMeetingModal}
                className="mt-4 inline-flex items-center gap-2 bg-primary text-primary-foreground text-xs font-semibold px-4 py-2 rounded-xl hover:bg-primary/90 hover:shadow-md active:scale-[0.98] transition-all duration-200 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Schedule Meeting Now
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredMeetings.map(m => {
              const momForMeeting = moms.find(mom => mom.meeting_id === m.id);
              return (
                <div
                  key={m.id}
                  className="bg-card border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                              m.type === 'FACILITATOR'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                : m.type === 'EXECUTIVE'
                                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                            }`}
                          >
                            {m.type === 'OTHER' && m.custom_category_name
                              ? m.custom_category_name
                              : m.type === 'FACILITATOR'
                              ? 'RGF Meeting'
                              : m.type === 'EXECUTIVE'
                              ? 'Executive Meeting'
                              : 'Other Meeting'}
                          </span>
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                              m.status === 'scheduled'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : m.status === 'in_progress'
                                ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                                : m.status === 'completed'
                                ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                            }`}
                          >
                            {m.status.replace('_', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                          </span>
                        </div>
                        <h3 className="text-base font-bold mt-1.5 text-foreground leading-snug">{m.title}</h3>
                      </div>
                      {canManageMeetings && (
                        <button
                          onClick={() => openEditMeetingModal(m)}
                          className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-accent"
                          title="Edit Meeting"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {m.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{m.description}</p>
                    )}

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-primary" />
                        <span>{new Date(m.scheduled_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-primary" />
                        <span>
                          {new Date(m.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({m.duration_minutes}m)
                        </span>
                      </div>
                      {m.locationOrLink && (
                        <div className="flex items-center gap-1.5 col-span-2">
                          <LinkIcon className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="truncate">{m.locationOrLink}</span>
                        </div>
                      )}
                      {m.created_by_name && (
                        <div className="flex items-center gap-1.5 col-span-2">
                          <User className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span>Organized by {m.created_by_name}</span>
                        </div>
                      )}
                    </div>

                    {m.invitees && m.invitees.length > 0 && (
                      <div className="pt-2">
                        <div className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground mb-1">
                          <UsersIcon className="w-3 h-3 text-primary" />
                          <span>Participants ({m.invitees.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {m.invitees.slice(0, 4).map((p: any, idx: number) => (
                            <span key={idx} className="text-[10px] bg-muted px-2 py-0.5 rounded-md truncate max-w-[140px]">
                              {p.fullName || p.email}
                            </span>
                          ))}
                          {m.invitees.length > 4 && (
                            <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-md">
                              +{m.invitees.length - 4} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Meeting Card Footer Actions */}
                  <div className="pt-4 mt-4 border-t flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {m.locationOrLink && (
                        <a
                          href={m.locationOrLink.startsWith('http') ? m.locationOrLink : `https://${m.locationOrLink}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-xl transition-all"
                        >
                          <LinkIcon className="w-3 h-3" />
                          Join Meeting
                        </a>
                      )}
                    </div>

                    {(() => {
                      const hasEditRights = canManageMeetings;
                      return hasEditRights ? (
                        <div className="flex items-center gap-2">
                          {m.status !== 'cancelled' && (
                            <button
                              onClick={() => handleCancelMeeting(m.id)}
                              className="text-xs text-destructive hover:text-destructive/80 px-2 py-1"
                            >
                              Cancel
                            </button>
                          )}
                          <button
                            onClick={() => openNewMomModal(m)}
                            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all ${
                              momForMeeting
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                                : 'bg-card border hover:bg-accent text-foreground'
                            }`}
                          >
                            <FileText className="w-3.5 h-3.5" />
                            {momForMeeting ? 'View / Edit MoM' : 'Record MoM'}
                          </button>
                        </div>
                      ) : (
                        momForMeeting && (
                          <button
                            onClick={() => openNewMomModal(m)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition-all"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            View MoM
                          </button>
                        )
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* MOM LIST VIEW */
        filteredMoms.length === 0 ? (
          <div className="py-16 text-center border-2 border-dashed rounded-2xl p-6">
            <FileText className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
            <h3 className="text-base font-semibold text-foreground">No Minutes of Meeting (MoM) saved</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              {canManageMeetings
                ? "Create an MoM for meetings to document key discussions, decisions, and action items."
                : "No MoM records are available for your meetings."}
            </p>
            {canManageMeetings && (
              <button
                onClick={() => openNewMomModal()}
                className="mt-4 inline-flex items-center gap-2 bg-primary text-primary-foreground text-xs font-semibold px-4 py-2 rounded-xl hover:bg-primary/90 hover:shadow-md active:scale-[0.98] transition-all duration-200 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Create MoM Now
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredMoms.map(mom => {
              const pendingActions = (mom.action_items || []).filter(a => a.status !== 'completed').length;
              const totalActions = (mom.action_items || []).length;
              const associatedMeeting = meetings.find(m => m.id === mom.meeting_id);
              const canEditThisMom = canManageMeetings;
              return (
                <div key={mom.id} className="bg-card border rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          MoM Record
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(mom.meeting_date).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-foreground mt-1">{mom.title}</h3>
                      {mom.created_by_name && (
                        <p className="text-xs text-muted-foreground">Recorded by {mom.created_by_name}</p>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        setEditingMom(mom);
                        setMomForm({
                          title: mom.title,
                          meeting_date: mom.meeting_date ? mom.meeting_date.slice(0, 16) : new Date().toISOString().slice(0, 16),
                          agenda: mom.agenda || '',
                          key_discussions: mom.key_discussions || '',
                          decisions_made: mom.decisions_made || '',
                          next_meeting_date: mom.next_meeting_date ? mom.next_meeting_date.slice(0, 16) : '',
                          attachments: mom.attachments || '',
                          action_items: mom.action_items || [],
                        });
                        setShowMomModal(true);
                      }}
                      className="self-start sm:self-center inline-flex items-center gap-1.5 text-xs font-semibold border bg-card hover:bg-accent px-3 py-1.5 rounded-xl transition-all"
                    >
                      {canEditThisMom ? (
                        <>
                          <Edit className="w-3.5 h-3.5 text-primary" />
                          Edit MoM
                        </>
                      ) : (
                        <>
                          <FileText className="w-3.5 h-3.5 text-primary" />
                          View MoM
                        </>
                      )}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    {mom.agenda && (
                      <div className="bg-muted/40 p-3 rounded-xl space-y-1">
                        <span className="font-bold text-foreground block">Agenda</span>
                        <p className="text-muted-foreground whitespace-pre-wrap">{mom.agenda}</p>
                      </div>
                    )}

                    {mom.decisions_made && (
                      <div className="bg-emerald-500/5 border border-emerald-500/20 p-3 rounded-xl space-y-1">
                        <span className="font-bold text-emerald-800 dark:text-emerald-300 block">Decisions Made</span>
                        <p className="text-emerald-900 dark:text-emerald-200 whitespace-pre-wrap">{mom.decisions_made}</p>
                      </div>
                    )}

                    {mom.key_discussions && (
                      <div className="bg-muted/40 p-3 rounded-xl space-y-1 md:col-span-2">
                        <span className="font-bold text-foreground block">Key Discussions</span>
                        <p className="text-muted-foreground whitespace-pre-wrap">{mom.key_discussions}</p>
                      </div>
                    )}
                  </div>

                  {/* Action Items Interactive Table / List */}
                  {mom.action_items && mom.action_items.length > 0 && (
                    <div className="pt-2">
                      <div className="flex items-center gap-2 mb-3">
                        <ListTodo className="w-4 h-4 text-primary" />
                        <span className="text-xs font-bold text-foreground">
                          Minutes of Meeting Discussion & Action Items
                        </span>
                      </div>

                      <TableScrollArea className="overflow-x-auto border border-border rounded-xl shadow-xs">
                        <table className="w-full text-left border-collapse text-[11px] leading-relaxed">
                          <thead>
                            <tr className="bg-muted/40 text-muted-foreground uppercase text-[9px] font-bold tracking-wider">
                              <th className="p-2.5 border-b min-w-[120px]">Proposed By</th>
                              <th className="p-2.5 border-b min-w-[200px]">Discussion</th>
                              <th className="p-2.5 border-b min-w-[180px]">Action Item</th>
                              <th className="p-2.5 border-b min-w-[120px]">Assigned To</th>
                              <th className="p-2.5 border-b min-w-[100px]">Deadline</th>
                              <th className="p-2.5 border-b min-w-[130px]">Remarks</th>
                              <th className="p-2.5 border-b w-[110px]">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y bg-card">
                            {mom.action_items.map((item, idx) => (
                              <tr key={idx} className="hover:bg-muted/10">
                                <td className="p-2.5 align-top font-medium text-foreground whitespace-nowrap">{item.proposedBy || '-'}</td>
                                <td className="p-2.5 align-top text-muted-foreground whitespace-pre-wrap">{item.discussionPoint || '-'}</td>
                                <td className="p-2.5 align-top text-muted-foreground whitespace-pre-wrap">{item.actionItem || '-'}</td>
                                <td className="p-2.5 align-top text-foreground whitespace-nowrap">{item.assignedToName || '-'}</td>
                                <td className="p-2.5 align-top text-muted-foreground whitespace-nowrap">
                                  {item.deadline ? new Date(item.deadline).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                                </td>
                                <td className="p-2.5 align-top text-muted-foreground whitespace-pre-wrap">{item.remarks || '-'}</td>
                                <td className="p-2.5 align-top">
                                  {canEditThisMom ? (
                                    <Select
                                      value={item.status}
                                      onValueChange={(val) => updateDirectActionStatus(mom, idx, val as any)}
                                    >
                                      <SelectTrigger
                                        className={`h-auto py-1 pl-2.5 pr-2 border rounded-lg text-[10px] font-bold w-full cursor-pointer transition-all focus:ring-1 focus:ring-primary focus:outline-none focus-visible:ring-1 focus-visible:outline-none ${
                                          item.status === 'completed'
                                            ? 'border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:bg-emerald-950/30'
                                            : item.status === 'in_progress'
                                            ? 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:bg-amber-950/30'
                                            : 'border-zinc-300 text-zinc-600 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:bg-zinc-900/40'
                                        }`}
                                      >
                                        <SelectValue>
                                          {item.status === 'completed' ? 'Completed' : item.status === 'in_progress' ? 'In Progress' : 'Pending'}
                                        </SelectValue>
                                      </SelectTrigger>
                                      <SelectContent className="text-[11px] min-w-[130px]">
                                        <SelectItem value="pending" className="text-[11px] font-semibold cursor-pointer">
                                          <span className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-zinc-400 inline-block" />
                                            Pending
                                          </span>
                                        </SelectItem>
                                        <SelectItem value="in_progress" className="text-[11px] font-semibold cursor-pointer">
                                          <span className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                                            In Progress
                                          </span>
                                        </SelectItem>
                                        <SelectItem value="completed" className="text-[11px] font-semibold cursor-pointer">
                                          <span className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                                            Completed
                                          </span>
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <span className={`inline-block px-2.5 py-1 rounded-full text-[9px] font-bold ${
                                      item.status === 'completed'
                                        ? 'bg-emerald-100 text-emerald-850 dark:bg-emerald-950 dark:text-emerald-300'
                                        : item.status === 'in_progress'
                                        ? 'bg-amber-100 text-amber-850 dark:bg-amber-950 dark:text-amber-300'
                                        : 'bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300'
                                    }`}>
                                      {item.status === 'completed' ? 'Completed' : item.status === 'in_progress' ? 'In Progress' : 'Pending'}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </TableScrollArea>
                    </div>
                  )}

                  {mom.next_meeting_date && (
                    <div className="text-xs text-muted-foreground pt-2 flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-primary" />
                      <span>Next Scheduled Meeting: <strong>{new Date(mom.next_meeting_date).toLocaleString()}</strong></span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* SCHEDULE / EDIT MEETING MODAL */}
      {typeof document !== 'undefined' && ReactDOM.createPortal(<AnimatePresence>
        {showMeetingModal && (
          <div className="meeting-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-hidden">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              ref={meetingModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Meeting details" className="bg-card border rounded-2xl w-full max-w-xl shadow-2xl h-[calc(100dvh-2rem)] max-h-[48rem] flex flex-col overflow-hidden"
            >
              {/* Local style block to override default scrollbars with premium thin grey track/thumb */}
              <style dangerouslySetInnerHTML={{__html: `
                .custom-scrollbar::-webkit-scrollbar {
                  width: 5px;
                  height: 5px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                  background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                  background: rgba(156, 163, 175, 0.35);
                  border-radius: 99px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                  background: rgba(156, 163, 175, 0.65);
                }
                .custom-scrollbar {
                  scrollbar-width: thin;
                  scrollbar-color: rgba(156, 163, 175, 0.35) transparent;
                }
              `}} />
              <div data-modal-header className="flex shrink-0 items-center justify-between gap-3 px-6 py-5 border-b">
                <div className="flex items-center gap-2">
                  <Video className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-bold">{editingMeeting ? 'Edit Meeting' : 'Schedule New Meeting'}</h3>
                </div>
                <button aria-label="Close meeting details" onClick={() => setShowMeetingModal(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveMeeting} data-modal-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 space-y-4 text-xs custom-scrollbar">
                <div>
                  <label className="font-bold text-foreground block mb-1.5">Meeting Type *</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(['FACILITATOR', 'EXECUTIVE', 'OTHER'] as const).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => handleTypeChange(t)}
                        className={`py-2 px-3 border rounded-xl font-semibold text-center transition-all ${
                          meetingForm.type === t
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background hover:bg-accent text-foreground'
                        }`}
                      >
                        {t === 'FACILITATOR' ? 'RGF' : t === 'EXECUTIVE' ? 'Executive' : 'Other'}
                      </button>
                    ))}
                  </div>
                </div>

                {meetingForm.type === 'OTHER' && (
                  <div>
                    <label className="font-bold text-foreground block mb-1">Meeting Title *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., Weekly Team Alignment"
                      value={meetingForm.title}
                      onChange={e => setMeetingForm({ ...meetingForm, title: e.target.value })}
                      className="w-full p-2.5 bg-background border rounded-xl focus:ring-1 focus:ring-primary"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-foreground block mb-1">Scheduled Date & Time *</label>
                    <DateTimePicker
                      value={meetingForm.scheduled_at}
                      onChange={val => setMeetingForm({ ...meetingForm, scheduled_at: val })}
                      type="datetime"
                      placeholder="Select scheduled date & time"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-foreground block mb-1">Duration (Minutes)</label>
                    <input
                      type="number"
                      min={15}
                      step={15}
                      value={meetingForm.duration_minutes}
                      onChange={e => setMeetingForm({ ...meetingForm, duration_minutes: Number(e.target.value) })}
                      className="w-full p-2.5 bg-background border rounded-xl focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-bold text-foreground block mb-1">Meeting Link (Google Meet/Zoom)</label>
                  <input
                    type="url"
                    placeholder="https://meet.google.com/xyz"
                    value={meetingForm.meeting_link}
                    onChange={e => setMeetingForm({ ...meetingForm, meeting_link: e.target.value })}
                    className="w-full p-2.5 bg-background border rounded-xl focus:ring-1 focus:ring-primary"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Invitees are reminded 10 minutes and 1 minute before the meeting. Add a meeting link so they can join from the notification.
                  </p>
                </div>

                <div>
                  <label className="font-bold text-foreground block mb-1">Description / Agenda Overview</label>
                  <textarea
                    rows={2}
                    placeholder="Briefly describe meeting goals..."
                    value={meetingForm.description}
                    onChange={e => setMeetingForm({ ...meetingForm, description: e.target.value })}
                    className="w-full p-2.5 bg-background border rounded-xl focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Invitee Selection Section */}
                <div className="space-y-2 border-t pt-3">
                  <div className="flex flex-col gap-2">
                    <label className="font-bold text-foreground block">Select Invitees * ({selectedInviteeIds.length} selected)</label>
                    <div className="flex flex-wrap gap-1.5 pt-0.5 pb-2 border-b border-dashed border-border/80">
                      <span className="text-[10px] font-bold text-muted-foreground self-center mr-1">Add Group:</span>
                      <button
                        type="button"
                        onClick={() => selectPresetGroup('ADMINS')}
                        className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all cursor-pointer ${
                          isPresetSelected('ADMINS')
                            ? 'bg-amber-600 text-white border border-amber-600 hover:bg-amber-650'
                            : 'bg-amber-100 hover:bg-amber-200 text-amber-700 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                        }`}
                      >
                        {isPresetSelected('ADMINS') ? '✓ Admins' : '+ Admins'}
                      </button>
                      <button
                        type="button"
                        onClick={() => selectPresetGroup('SUPERVISORS')}
                        className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all cursor-pointer ${
                          isPresetSelected('SUPERVISORS')
                            ? 'bg-teal-600 text-white border border-teal-600 hover:bg-teal-650'
                            : 'bg-teal-100 hover:bg-teal-200 text-teal-700 dark:bg-teal-900/30 dark:hover:bg-teal-900/50 dark:text-teal-300 border border-teal-200 dark:border-teal-800'
                        }`}
                      >
                        {isPresetSelected('SUPERVISORS') ? '✓ Supervisors' : '+ Supervisors'}
                      </button>
                      <button
                        type="button"
                        onClick={() => selectPresetGroup('MENTORS')}
                        className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all cursor-pointer ${
                          isPresetSelected('MENTORS')
                            ? 'bg-orange-600 text-white border border-orange-600 hover:bg-orange-655'
                            : 'bg-orange-100 hover:bg-orange-200 text-orange-700 dark:bg-orange-900/30 dark:hover:bg-orange-900/50 dark:text-orange-300 border border-orange-200 dark:border-orange-800'
                        }`}
                      >
                        {isPresetSelected('MENTORS') ? '✓ Sadhana Mentors' : '+ Sadhana Mentors'}
                      </button>
                      <button
                        type="button"
                        onClick={() => selectPresetGroup('RGFS')}
                        className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all cursor-pointer ${
                          isPresetSelected('RGFS')
                            ? 'bg-purple-600 text-white border border-purple-600 hover:bg-purple-650'
                            : 'bg-purple-100 hover:bg-purple-200 text-purple-700 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                        }`}
                      >
                        {isPresetSelected('RGFS') ? '✓ RGFs' : '+ RGFs'}
                      </button>
                      <button
                        type="button"
                        onClick={() => selectPresetGroup('RGSFS')}
                        className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all cursor-pointer ${
                          isPresetSelected('RGSFS')
                            ? 'bg-blue-600 text-white border border-blue-600 hover:bg-blue-650'
                            : 'bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                        }`}
                      >
                        {isPresetSelected('RGSFS') ? '✓ RGSFs' : '+ RGSFs'}
                      </button>
                      <button
                        type="button"
                        onClick={() => selectPresetGroup('CLEAR')}
                        className="text-[10px] font-semibold bg-muted hover:bg-muted/80 text-muted-foreground border border-border px-2.5 py-1 rounded-full transition-all cursor-pointer ml-auto"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search users..."
                      value={inviteeSearch}
                      onChange={e => setInviteeSearch(e.target.value)}
                      className="w-full pl-7 pr-3 py-1.5 bg-background border rounded-xl focus:ring-1 focus:ring-primary text-xs"
                    />
                  </div>

                  <div className="border rounded-xl max-h-40 overflow-y-auto divide-y bg-background custom-scrollbar">
                    {registeredUsers.filter((u: any) => {
                      const q = inviteeSearch.toLowerCase();
                      return (
                        (u.fullName || '').toLowerCase().includes(q) ||
                        (u.email || '').toLowerCase().includes(q) ||
                        (u.role || '').toLowerCase().includes(q) ||
                        normalizedRoles(u).some(role => role.toLowerCase().includes(q))
                      );
                    }).length === 0 ? (
                      <div className="p-3 text-center text-muted-foreground text-[10px]">
                        No registered users found
                      </div>
                    ) : (
                      registeredUsers
                        .filter((u: any) => {
                          const q = inviteeSearch.toLowerCase();
                          return (
                            (u.fullName || '').toLowerCase().includes(q) ||
                            (u.email || '').toLowerCase().includes(q) ||
                            (u.role || '').toLowerCase().includes(q) ||
                            normalizedRoles(u).some(role => role.toLowerCase().includes(q))
                          );
                        })
                        .sort((a: any, b: any) => {
                          const priorityA = getRolePriority(a);
                          const priorityB = getRolePriority(b);
                          if (priorityA !== priorityB) {
                            return priorityA - priorityB;
                          }
                          return (a.fullName || '').localeCompare(b.fullName || '');
                        })
                        .map((u: any) => {
                          const isSelected = selectedInviteeIds.includes(u.userId);
                          const isSupervisor = hasMeetingRole(u, 'SUPERVISOR');
                          const isMentor = hasMeetingRole(u, 'MENTOR');
                          const isRgf = hasMeetingRole(u, 'RGF');
                          const isRgsf = hasMeetingRole(u, 'RGSF');
                          const isAdmin = hasMeetingRole(u, 'ADMIN');

                          return (
                            <div
                              key={u.userId}
                              onClick={() => {
                                setSelectedInviteeIds(prev =>
                                  isSelected ? prev.filter(id => id !== u.userId) : [...prev, u.userId]
                                );
                              }}
                              className="p-2 flex items-center justify-between hover:bg-accent/40 cursor-pointer select-none text-[11px]"
                            >
                              <div className="flex items-center gap-2 truncate">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  readOnly
                                  className="rounded text-primary focus:ring-primary h-3 w-3"
                                />
                                <div className="truncate">
                                  <span className="font-semibold text-foreground block">{u.fullName || u.email}</span>
                                  <span className="text-[9px] text-muted-foreground block">{u.email}</span>
                                </div>
                              </div>
                              <div className="flex gap-0.5 shrink-0">
                                {isAdmin && (
                                  <span className="text-[7px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1 py-0.2 rounded shrink-0">
                                    ADM
                                  </span>
                                )}
                                {isSupervisor && (
                                  <span className="text-[7px] font-bold bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 px-1 py-0.2 rounded shrink-0">
                                    SUPERVISOR
                                  </span>
                                )}
                                {isMentor && (
                                  <span className="text-[7px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1 py-0.2 rounded shrink-0">
                                    MENTOR
                                  </span>
                                )}
                                {isRgf && (
                                  <span className="text-[7px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 px-1 py-0.2 rounded shrink-0">
                                    RGF
                                  </span>
                                )}
                                {isRgsf && (
                                  <span className="text-[7px] font-bold bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 px-1 py-0.2 rounded shrink-0">
                                    RGSF
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>

                <div className="sticky-form-actions flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMeetingModal(false)}
                    className="px-4 py-2 border rounded-xl hover:bg-accent hover:text-accent-foreground active:scale-[0.98] transition-all duration-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-primary text-primary-foreground font-semibold rounded-xl shadow hover:bg-primary/90 hover:shadow-md active:scale-[0.98] transition-all duration-200 cursor-pointer"
                  >
                    {editingMeeting ? 'Save Changes' : 'Schedule Meeting'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>, document.body)}

      {/* CREATE / EDIT MOM MODAL */}
      {typeof document !== 'undefined' && ReactDOM.createPortal(<AnimatePresence>
        {showMomModal && (
          <div className="meeting-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-hidden">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              ref={momModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Minutes of meeting" className="bg-card border rounded-2xl w-full max-w-2xl shadow-2xl h-[calc(100dvh-2rem)] max-h-[48rem] flex flex-col overflow-hidden"
            >
              <div data-modal-header className="flex shrink-0 items-center justify-between gap-3 px-6 py-5 border-b">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-bold">{canEditMom ? (editingMom ? 'Edit Minutes of Meeting' : 'Create Minutes of Meeting (MoM)') : 'View Minutes of Meeting'}</h3>
                </div>
                <button aria-label="Close minutes of meeting" onClick={() => setShowMomModal(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveMom} data-modal-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 space-y-4 text-xs custom-scrollbar">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="font-bold text-foreground block mb-1">MoM Title *</label>
                    <input
                      type="text"
                      required
                      disabled={!canEditMom}
                      placeholder="e.g. PW Dept Strategic Planning MoM"
                      value={momForm.title}
                      onChange={e => setMomForm({ ...momForm, title: e.target.value })}
                      className="w-full p-2.5 bg-background border rounded-xl focus:ring-1 focus:ring-primary disabled:opacity-75"
                    />
                  </div>

                  <div className="col-span-2 sm:col-span-1">
                    <label className="font-bold text-foreground block mb-1">Meeting Date & Time *</label>
                    <DateTimePicker
                      value={momForm.meeting_date}
                      onChange={val => setMomForm({ ...momForm, meeting_date: val })}
                      type="datetime"
                      placeholder="Select meeting date & time"
                      disabled={!canEditMom}
                    />
                  </div>
                </div>

                {/* 6-Column MoM dynamic grid table builder */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ListTodo className="w-4 h-4 text-primary" />
                      <span className="font-bold text-foreground">MoM Discussion & Action Items</span>
                    </div>
                    {canEditMom && (
                      <button
                        type="button"
                        onClick={addActionItem}
                        className="px-2.5 py-1.5 text-[10px] font-bold bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 flex items-center gap-1 transition-all"
                      >
                        <Plus className="w-3 h-3" /> Add Row
                      </button>
                    )}
                  </div>

                  {(() => {
                    const activeM = selectedMeetingForMom || meetings.find(m => m.id === editingMom?.meeting_id);
                    const participants = activeM?.invitees || [];
                    const participantNames = participants
                      .map((p: any) => p.fullName || p.name || p.email)
                      .filter(Boolean);
                    const proposedByOptions = Array.from(new Set(participantNames));
                    const assigneeOptions = Array.from(new Set(
                      registeredUsers
                        .map((u: any) => u.fullName || u.name)
                        .filter(Boolean)
                    ));

                    return (
                      <>
                        <div className="overflow-x-auto border border-border rounded-xl">
                          <table className="mobile-mom-table w-full text-left border-collapse text-[11px]">
                            <thead>
                              <tr className="bg-muted text-muted-foreground uppercase text-[9px] font-bold tracking-wider">
                                <th className="p-2 border-b min-w-[120px]">Proposed By</th>
                                <th className="p-2 border-b min-w-[180px]">Discussion *</th>
                                <th className="p-2 border-b min-w-[150px]">Action Item</th>
                                <th className="p-2 border-b min-w-[120px]">Assigned To</th>
                                <th className="p-2 border-b min-w-[110px]">Deadline</th>
                                <th className="p-2 border-b min-w-[120px]">Remarks</th>
                                {canEditMom && <th className="p-2 border-b w-[40px]"></th>}
                              </tr>
                            </thead>
                            <tbody className="divide-y bg-card">
                              {momForm.action_items.map((item, idx) => (
                                <tr key={idx} className="hover:bg-muted/5">
                                  <td data-label="Proposed by" className="p-1.5 align-top">
                                    <ProposedByDropdown
                                      value={item.proposedBy}
                                      onChange={val => updateRowField(idx, 'proposedBy', val)}
                                      disabled={!canEditMom}
                                      options={proposedByOptions}
                                      placeholder="Name"
                                    />
                                  </td>
                                  <td data-label="Discussion (required)" className="p-1.5 align-top">
                                    <textarea
                                      rows={1}
                                      required
                                      disabled={!canEditMom}
                                      placeholder="Discussion details..."
                                      value={item.discussionPoint}
                                      onChange={e => updateRowField(idx, 'discussionPoint', e.target.value)}
                                      className="w-full p-1.5 bg-background border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-[11px]"
                                    />
                                  </td>
                                  <td data-label="Action item" className="p-1.5 align-top">
                                    <input
                                      type="text"
                                      disabled={!canEditMom}
                                      placeholder="Action to take"
                                      value={item.actionItem}
                                      onChange={e => updateRowField(idx, 'actionItem', e.target.value)}
                                      className="w-full p-1.5 bg-background border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-[11px]"
                                    />
                                  </td>
                                  <td data-label="Assigned to" className="p-1.5 align-top">
                                    <ProposedByDropdown
                                      value={item.assignedToName || ''}
                                      onChange={val => updateRowField(idx, 'assignedToName', val)}
                                      disabled={!canEditMom}
                                      options={assigneeOptions}
                                      placeholder="Assignee"
                                    />
                                  </td>
                                  <td data-label="Deadline" className="p-1.5 align-top">
                                    <DateTimePicker
                                      value={item.deadline}
                                      onChange={val => updateRowField(idx, 'deadline', val)}
                                      type="datetime"
                                      placeholder="Select date & time"
                                      disabled={!canEditMom}
                                      className="h-[27px] py-1 px-2.5 text-[11px] rounded-lg shadow-none border-border"
                                    />
                                  </td>
                                  <td data-label="Remarks" className="p-1.5 align-top">
                                    <input
                                      type="text"
                                      disabled={!canEditMom}
                                      placeholder="Remarks"
                                      value={item.remarks}
                                      onChange={e => updateRowField(idx, 'remarks', e.target.value)}
                                      className="w-full p-1.5 bg-background border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-[11px]"
                                    />
                                  </td>
                                  {canEditMom && (
                                    <td data-label="Remove item" className="p-1.5 align-top text-center">
                                      <button
                                        type="button"
                                        aria-label={`Remove action item ${idx + 1}`}
                                        onClick={() => removeActionItem(idx)}
                                        className="text-destructive hover:bg-destructive/10 p-1 rounded-md mt-0.5"
                                        disabled={momForm.action_items.length <= 1}
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    );
                  })()}

                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-foreground block mb-1">Next Meeting Date (Optional)</label>
                    <DateTimePicker
                      value={momForm.next_meeting_date}
                      onChange={val => setMomForm({ ...momForm, next_meeting_date: val })}
                      type="datetime"
                      placeholder="Select next meeting date"
                      disabled={!canEditMom}
                    />
                  </div>

                  <div>
                    <label className="font-bold text-foreground block mb-1">Attachments / Links / Notes</label>
                    <input
                      type="text"
                      disabled={!canEditMom}
                      placeholder="Google Drive link or doc reference"
                      value={momForm.attachments}
                      onChange={e => setMomForm({ ...momForm, attachments: e.target.value })}
                      className="w-full p-2.5 bg-background border rounded-xl focus:ring-1 focus:ring-primary disabled:opacity-75"
                    />
                  </div>
                </div>

                <div className="sticky-form-actions flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMomModal(false)}
                    className="px-4 py-2 border rounded-xl hover:bg-accent hover:text-accent-foreground active:scale-[0.98] transition-all duration-200 cursor-pointer font-semibold"
                  >
                    {canEditMom ? 'Cancel' : 'Close'}
                  </button>
                  {canEditMom && (
                    <button
                      type="submit"
                      className="px-5 py-2 bg-primary text-primary-foreground font-semibold rounded-xl shadow hover:bg-primary/90 hover:shadow-md active:scale-[0.98] transition-all duration-200 cursor-pointer"
                    >
                      {editingMom ? 'Update MoM' : 'Save MoM Record'}
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  );
}
