// ══════════════════════════════════════════════════════════════════════════════
// SINGLE SOURCE OF TRUTH — All enums, constants, and literal types
// Import from '@/types/enums' everywhere. Never re-define inline.
// ══════════════════════════════════════════════════════════════════════════════

export const ROLES = {
  USER: 'USER',
  GUIDE: 'GUIDE',
  SUPER_GUIDE: 'SUPER_GUIDE',
  BVSL: 'BVSL',
  SADHANA_MENTOR: 'SADHANA_MENTOR',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// ─── Multi-role helpers ──────────────────────────────────────────────────────

/** Returns true if the user has BVSL access (role is BVSL, or isBvsl flag is set) */
export function hasBvslRole(role: string | null | undefined, isBvsl?: boolean): boolean {
  return role === 'BVSL' || !!isBvsl;
}

/** Returns true if the user has Sadhana Mentor access */
export function hasMentorRole(role: string | null | undefined, isSadhanaMentor?: boolean): boolean {
  return role === 'SADHANA_MENTOR' || !!isSadhanaMentor;
}

/** Returns true if the user has BV Admin access */
export function hasBvAdminRole(role: string | null | undefined, isBvSuperAdmin?: boolean, isBvAdmin?: boolean): boolean {
  return role === 'SUPER_GUIDE' || !!isBvSuperAdmin || !!isBvAdmin;
}

/** Returns true if the user has BV Supervisor access (formerly BV Mentor) */
export function hasBvSupervisorRole(role: string | null | undefined, isBvSupervisor?: boolean, isBvMentor?: boolean, isBvAdmin?: boolean, isBvSuperAdmin?: boolean): boolean {
  return role === 'SUPER_GUIDE' || role === 'GUIDE' || !!isBvSuperAdmin || !!isBvAdmin || !!isBvSupervisor || !!isBvMentor;
}

/** Returns true if the user has Reading Group Facilitator (RGF) or Sub-Facilitator (RGSF) access */
export function hasBvFacilitatorRole(
  role: string | null | undefined,
  isBvsl?: boolean,
  isBvFacilitator?: boolean,
  isBvSubFacilitator?: boolean,
  isBvSupervisor?: boolean,
  isBvAdmin?: boolean,
  isBvSuperAdmin?: boolean
): boolean {
  return role === 'SUPER_GUIDE' || role === 'GUIDE' || role === 'BVSL' || !!isBvSuperAdmin || !!isBvAdmin || !!isBvSupervisor || !!isBvFacilitator || !!isBvSubFacilitator || !!isBvsl;
}

/** Returns true if the user is authorized to view 1-on-1 Call Reports (RGSF is excluded unless higher role) */
export function canViewOneOnOneReports(
  role: string | null | undefined,
  isBvsl?: boolean,
  isBvFacilitator?: boolean,
  isBvSubFacilitator?: boolean,
  isBvSupervisor?: boolean,
  isBvAdmin?: boolean,
  isBvSuperAdmin?: boolean
): boolean {
  if (role === 'SUPER_GUIDE' || role === 'GUIDE' || !!isBvSuperAdmin || !!isBvAdmin || !!isBvSupervisor || !!isBvFacilitator || !!isBvsl) {
    return true;
  }
  if (isBvSubFacilitator) return false;
  return true;
}

// ─── Other enums ─────────────────────────────────────────────────────────────

export const USER_STATUS = {
  PENDING: 'PENDING_APPROVAL',
  ACTIVE: 'ACTIVE',
  REJECTED: 'REJECTED',
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export const REGISTRATION_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUS)[keyof typeof REGISTRATION_STATUS];

export const ATTENDANCE_STATUS = {
  PRESENT: 'P',
  ABSENT: 'A',
} as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUS)[keyof typeof ATTENDANCE_STATUS];

export const ASHRAY_LEVELS = [
  'Jigyasa',
  'Shraddhavan',
  'Sevak',
  'Sadhaka',
  'Upasaka',
  'Caranashraya',
  'Harinam Diksha',
  'Gauranga Sabha',
] as const;

export type AshrayLevel = (typeof ASHRAY_LEVELS)[number];

// BV session prefix — prevents silent misclassification from typos
export const BV_SESSION_PREFIX = 'bvsession:';

// ─── Score maximums ───────────────────────────────────────────────────────────
// Single source of truth for max scores — update here when scoring ranges change.
// NOTE: NR max varies by ashray level (Upasaka+ can score up to 24 with Sleep Time).
// Use SCORE_MAX.NR_BASE as the default when ashray level is unknown.
export const SCORE_MAX = {
  RESIDENT_NORMAL: 20,    // Base 9 fields (19) + report_sending (1)
  RESIDENT_SICK_OS: 8,    // Rounds (4) + SP Reading (3) + report_sending (1)
  NR_BASE: 20,            // Chanting (8) + Reading (4) + Hearing (4) + FillingDay (4)
  NR_WITH_SLEEP: 24,      // NR_BASE + Sleep Time (4) for Upasaka+
} as const;

// Performance thresholds — change here to affect all views
// Residents: 19-20pts = ≥95% green, 17-18pts = ≥85% yellow, <17pts = red
// Non-residents: ≥75% green, ≥50% yellow, <50% red
export const THRESHOLDS = {
  resident: { healthy: 0.95, moderate: 0.85 },
  nonResident: { healthy: 0.75, moderate: 0.50 },
} as const;

// Field type canonical names
export const FIELD_TYPES = {
  RADIO: 'radio',
  DROPDOWN: 'dropdown',
  MULTISELECT: 'multiselect',
  TOGGLE: 'toggle',
  NUMBER: 'number',
  TIME: 'time',
  DURATION: 'duration',
  TEXT: 'text',
} as const;

export type FieldType = (typeof FIELD_TYPES)[keyof typeof FIELD_TYPES];

// Template modes
export const TEMPLATE_MODES = {
  RESIDENT: 'RESIDENT_TEMPLATE',
  NON_RESIDENT: 'NR_TEMPLATE',
} as const;

// Residency time buckets
export const TIME_BUCKETS = {
  ZERO_TO_THREE: '0 to 3 months',
  THREE_TO_SIX: '3 to 6 months',
  MORE_THAN_SIX: 'More than 6 months',
} as const;
