// ══════════════════════════════════════════════════════════════════════════════
// Config Table Keys — Single source of truth for all Config DB entries.
//
// The `Config` table stores app-wide key/value configuration pairs that can be
// updated via the App Database tab without code changes.
//
// Format: configKey (string) → configValue (string, may be JSON or plain text)
// ══════════════════════════════════════════════════════════════════════════════

export const CONFIG_KEYS = {
  /**
   * Date of the next Ashray exam.
   * Format: 'M/D/YYYY' (e.g. '4/10/2026')
   * Used by: Profile page → AshrayApplySection to show countdown
   */
  NEXT_ASHRAY_EXAM: 'Next Ashray Exam',

  /** Department-specific Ashraya exam dates. */
  NEXT_ASHRAY_EXAM_FOLK: 'Next Ashray Exam FOLK',
  NEXT_ASHRAY_EXAM_PW: 'Next Ashray Exam PW',

  /**
   * Ashraya-level Prabhupada World sadhana targets and the submission deadline.
   * Value: JSON `{ submissionDeadline, levels }`. Written only by the admin endpoint.
   */
  PW_ASHRAYA_TARGETS: 'pw_ashraya_targets',

} as const;

/**
 * Per-center cleanliness tracking toggle.
 * Key format: 'cleanliness_enabled_{residencyId}'
 * Value: 'true' or 'false'
 * Used by: Cleanliness Manager Dashboard, Sadhana Form auto-fill
 */
export const CLEANLINESS_ENABLED_PREFIX = 'cleanliness_enabled_';

export type ConfigKey = (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS];

/** Default values for each config key — used when the DB row is missing */
export const CONFIG_DEFAULTS: Record<ConfigKey, string> = {
  [CONFIG_KEYS.NEXT_ASHRAY_EXAM]: '',
  [CONFIG_KEYS.NEXT_ASHRAY_EXAM_FOLK]: '',
  [CONFIG_KEYS.NEXT_ASHRAY_EXAM_PW]: '',
  [CONFIG_KEYS.PW_ASHRAYA_TARGETS]: '',
};
