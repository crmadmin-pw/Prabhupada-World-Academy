// ══════════════════════════════════════════════════════════════════════════════
// SINGLE SOURCE OF TRUTH — All domain model types
// Import from '@/types/models' everywhere. Never re-define inline.
// ══════════════════════════════════════════════════════════════════════════════

import type { Role, UserStatus, AshrayLevel, FieldType } from './enums';

// ─── User Domain ─────────────────────────────────────────────────────────────

/** Full user profile (from getUserProfile endpoint) */
export interface UserProfile {
  userId: string;
  fullName: string;
  /** Phone is the primary identifier — required */
  phone: string | number;
  /** Email is optional — used for OAuth sign-in linking only */
  email?: string;
  role: Role;
  status: UserStatus;
  selectedGuideId: string | null;
  ashrayLevel: AshrayLevel | string | null;
  residencyUserClaim: boolean;
  residencyGuideVerified?: boolean;
  selectedFolkResidency: string | null;
  residencyJoinDate?: string | null;
  residencyName: string | null;
  guideName: string | null;
  isBvsl?: boolean;
  isSadhanaMentor?: boolean;
  isResident?: boolean;
  createdAt?: string;
  lastLoginAt?: string;
}

/** Lightweight profile for context (avoids heavy fields) */
export interface ProfileSummary {
  userId: string;
  fullName: string;
  role: 'USER' | 'GUIDE' | 'SUPER_GUIDE' | 'BVSL' | 'SADHANA_MENTOR';
  status: UserStatus;
  /** BUG-1 FIX: BVSL is a flag not a role — any user can be BVSL */
  isBvsl: boolean;
  /** BUG-1 FIX: Sadhana Mentor is a flag not a role — any user can be a mentor */
  isSadhanaMentor: boolean;
  /** Service Allocator: resident-level user with access to FOLK Services management */
  isServiceAllocator?: boolean;
  /** BV Mentor: manages BhaktiVriksha system for a specific guide's center */
  isBvMentor?: boolean;
  /** Cleanliness Manager: can submit daily room inspections */
  isCleanlinessManager?: boolean;
  /** Custom text residency ID (e.g. "RES-001") — used by service endpoints that filter by residencyId field */
  folkResidencyCustomId?: string | null;
  selectedGuideId: string | null;
  residencyUserClaim: boolean;
  /** AUTH-016 FIX: Guide-verified residency status — was silently dropped before */
  residencyGuideVerified: boolean | null;
  selectedFolkResidency: string | null;
  ashrayLevel: string | null;
  residencyName: string | null;
  guideName: string | null;
  isResident: boolean;
  isFolkLead?: boolean;
  isTripCoordinator?: boolean;
  latestGuideTransferStatus?: string | null;
  latestResidencyTransferStatus?: string | null;
  latestGuideTransferId?: string | null;
  latestResidencyTransferId?: string | null;
  isPendingResidencyLeave?: boolean;
  latestAshrayStatus?: string | null;
  latestAshrayId?: string | null;
  latestAshrayRequestedLevel?: string | null;
  acknowledgedFolkLead?: boolean;
  acknowledgedTripCoordinator?: boolean;
  acknowledgedSadhanaMentor?: boolean;
}

// ─── Guide Domain ────────────────────────────────────────────────────────────

export interface Guide {
  guideId: string;
  name: string;
  email: string;
  role: 'GUIDE' | 'SUPER_GUIDE';
  isActive: boolean;
}

// ─── Sadhana Domain ──────────────────────────────────────────────────────────

export interface FieldOption {
  label: string;
  value: string | number;
  points?: number;
}

export interface SadhanaField {
  fieldId: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: string; // raw from backend — use normalizeFieldType() to canonical
  displayOrder: number;
  isRequired: boolean;
  contributesToScore: boolean;
  options: FieldOption[];
  criteria?: string | null;
  helpText?: string | null;
}

export interface SadhanaEntry {
  entryId: string;
  entryDate: string;
  totalScore: number;
  maxScore?: number | null;
  scorePercent?: number | null;
  submittedAt: string;
  flagSick: boolean;
  flagOs: boolean;
  fieldValues?: Record<string, any>;
}

export interface UserMetrics {
  todayScore: number | null;
  todayPercent: number | null;
  todaySubmitted: boolean;
  todayEntryId: string | null;
  currentStreak: number;
  weeklyAverage: number;
  weeklyAveragePercent: number | null;
  weeklySubmissionRate: number;
  entriesThisWeek: number;
  weekNumber: number;
  weekStartDate: string;
  weekEndDate: string;
  /** SAD-020: true when today's entry is not yet submitted but streak > 0 */
  streakAtRisk?: boolean;
}

// ─── Scoring Types ───────────────────────────────────────────────────────────

export interface ParsedOption {
  displayLabel: string;
  storedValue: any;
  pointsValue: number;
}

export interface FieldScore {
  fieldKey: string;
  points: number;
  maxPoints: number;
  target: any;
  isLeaderboard: boolean;
}

export interface ScoreResult {
  totalScore: number;
  maxScore: number;
  scorePercent: number | null;
  fieldScores: Record<string, FieldScore>;
}

// ─── BV Domain ───────────────────────────────────────────────────────────────

export interface BvGroup {
  groupId: string;
  groupName: string;
  bvslId?: string;
  bvslName?: string;
  description?: string;
  memberCount: number;
  isActive: boolean;
}

export interface BvMember {
  userId: string;
  fullName: string;
  status: 'ACTIVE' | 'REMOVED';
}

export interface BvAttendanceRecord {
  attendanceDate: string;
  status: 'P' | 'A';
  sessionType?: string;
  notes?: string;
}

// ─── Residency Domain ────────────────────────────────────────────────────────

export interface Residency {
  residencyId: string;
  residencyName: string;
  location?: string;
  guideId: string;
  isActive: boolean;
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  guideName: string;
  guideId: string;
  ashrayLevel: string;
  isResident: boolean;
  residencyName: string;
  todayScore: number | null;
  scorePercent?: number | null;
}

export interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  currentUserResidency: string;
  currentUserAshrayLevel: string;
  currentUserGuideId: string;
  currentUserIsResident: boolean;
}
