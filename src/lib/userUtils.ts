// ══════════════════════════════════════════════════════════════════════════════
// User utility functions — single source of truth for user classification logic.
// Import from here rather than re-implementing inline in every endpoint.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize a stored phone number to a consistent E.164-style digits-only string
 * with the country code included (no leading +).
 *
 * Handles two storage formats:
 *   - Old (bare 10-digit): "9876543210"  → "919876543210"
 *   - New (with CC):       "919876543210" → "919876543210"
 *
 * Use this in wa.me and tel: links so both formats work correctly.
 */
export function normalizePhoneForLinks(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  // Exactly 10 digits starting with 6-9 → Indian mobile number without country code
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `91${digits}`;
  }
  return digits;
}

/**
 * Normalize an ashray level string to its canonical form (space-separated).
 * Handles underscore variants from DB criteria keys (e.g. 'Harinam_Diksha' → 'Harinam Diksha').
 */
export function normalizeAshrayLevel(level: string | null | undefined): string {
  if (!level) return 'Jigyasa';
  return level.trim().replace(/_/g, ' ');
}

/**
 * Returns the maximum possible NR sadhana score for a given ashray level.
 *
 * Source of truth: src/config/sadhanaFields.ts → NON_RESIDENT_FIELDS criteria.
 * Each field's total_points is included if the level is NOT '-', 'enabled',
 * or 'leaderboard' in that field's levels map.
 *
 * Breakdown:
 *   chanting (8) + reading (4) + hearing (4) = 16 base for all active levels
 *   + fillingSameDay (4)  → Sevak, Sadhaka, Upasaka, Caranashraya, Harinam Diksha
 *   + wakeUptime (4)      → Upasaka, Caranashraya, Harinam Diksha
 *   + sleepTime (4)       → Upasaka, Caranashraya, Harinam Diksha
 *   + seva (4)            → Upasaka, Caranashraya, Harinam Diksha (Sevak/Sadhaka = leaderboard only)
 *   + bhaktiVriksha (4)   → Caranashraya, Harinam Diksha only (Sevak/Sadhaka/Upasaka = leaderboard)
 */
export function getNRMaxScore(ashrayLevel: string | null | undefined): number {
  const level = normalizeAshrayLevel(ashrayLevel);
  const LEVEL_MAX: Record<string, number> = {
    'Jigyasa':        16,   // chanting(8) + reading(4) + hearing(4)
    'Shraddhavan':    16,
    'Sevak':          20,   // + fillingSameDay(4); seva/BV = leaderboard only
    'Sadhaka':        20,
    'Upasaka':        32,   // + fillingSameDay(4) + wakeUptime(4) + sleepTime(4) + seva(4); BV = leaderboard
    'Caranashraya':   36,   // + fillingSameDay(4) + wakeUptime(4) + sleepTime(4) + seva(4) + bhaktiVriksha(4)
    'Harinam Diksha': 36,
    'Gauranga Sabha': 16,   // all criteria are '-'
  };
  return LEVEL_MAX[level] ?? 20; // fallback to 20 for unknown levels
}

/**
 * Levels for which fillingSameDay contributes to the NR score.
 * Jigyasa and Shraddhavan have '-' in the fillingSameDay criteria.
 */
const FILLING_SAME_DAY_LEVELS = new Set([
  'Sevak', 'Sadhaka', 'Upasaka', 'Caranashraya', 'Harinam Diksha',
]);

/**
 * Returns true if fillingSameDay scoring applies for the given ashray level.
 */
export function fillingSameDayApplies(ashrayLevel: string | null | undefined): boolean {
  return FILLING_SAME_DAY_LEVELS.has(normalizeAshrayLevel(ashrayLevel));
}

/**
 * Returns true if the user is a "scholar" — a non-resident NR user who is
 * temporarily visiting a FOLK residency (temporaryResidencyEnabled = true AND
 * has a linked temporaryResidency record).
 *
 * IMPORTANT: Both conditions must be true. Using only `temporaryResidencyEnabled`
 * (without checking the linked residency) incorrectly classifies users whose
 * flag is set but no residency is linked.
 */
export function isScholar(user: {
  residency?: string | string[] | null;
  residencyApproved?: boolean | null;
  temporaryResidencyEnabled?: boolean | null;
  temporaryResidency?: string | string[] | null;
}): boolean {
  const rawResId = Array.isArray(user.residency) ? user.residency[0] : user.residency;
  const isOfficialResident = !!(user.residencyApproved && rawResId);
  if (isOfficialResident) return false;
  const tempResId = Array.isArray(user.temporaryResidency)
    ? user.temporaryResidency[0]
    : user.temporaryResidency;
  return !!(user.temporaryResidencyEnabled && tempResId);
}

/**
 * Returns true if the user is an officially approved resident of a FOLK residency.
 */
export function isOfficialResident(user: {
  residency?: string | string[] | null;
  residencyApproved?: boolean | null;
}): boolean {
  const rawResId = Array.isArray(user.residency) ? user.residency[0] : user.residency;
  return !!(user.residencyApproved && rawResId);
}

/**
 * Returns true if the user should use the resident sadhana template.
 */
export function usesResidentTemplate(user: {
  residency?: string | string[] | null;
  residencyApproved?: boolean | null;
  temporaryResidencyEnabled?: boolean | null;
  temporaryResidency?: string | string[] | null;
}): boolean {
  return isOfficialResident(user) || isScholar(user);
}

/**
 * Authorize a backend caller to guide-scoped endpoints.
 * Passes if the caller's role is Guide/Super Guide/BVSL/Sadhana Mentor,
 * OR if isSadhanaMentor or isBvsl flag is true (handles users tagged via
 * the flag without the role field being updated to match).
 */
export function requireGuideRole(
  userRole: string | null | undefined,
  flags?: { isSadhanaMentor?: boolean | null; isBvsl?: boolean | null; isBvMentor?: boolean | null },
): void {
  const ALLOWED_ROLES = ['Guide', 'Super Guide', 'BVSL', 'Sadhana Mentor'];
  const roleOk = !!(userRole && ALLOWED_ROLES.includes(userRole));
  const flagOk = !!(flags?.isSadhanaMentor || flags?.isBvsl || flags?.isBvMentor);
  if (!roleOk && !flagOk) {
    throw new Error('Unauthorized: Guide or higher role required');
  }
}
