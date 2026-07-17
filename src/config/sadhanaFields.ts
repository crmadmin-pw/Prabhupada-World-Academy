// ══════════════════════════════════════════════════════════════════════════════
// SADHANA FIELD DEFINITIONS — Static definitions from the official PDF spec
// Resident form (17 fields) and Non-Resident form (8 fields)
//
// ⚠️  DUAL SOURCE-OF-TRUTH NOTICE (Issue 3.5)
// There are TWO sources for sadhana field definitions:
//
//   1. THIS FILE (src/config/sadhanaFields.ts) — Static defaults used by:
//      - The DailySadhanaForm frontend form
//      - The scoring engine (src/lib/scoring.ts)
//      - The submitSadhana backend endpoint
//      - Score max calculations (src/lib/userUtils.ts → getNRMaxScore)
//
//   2. The `SadhanaFields` database table — Used for guide-specific custom fields
//      configured via GuideFieldSetupPage. These override or augment the static
//      defaults per guide. Managed by getSadhanaFormData.ts which merges both.
//
//   ⚠️  When you change scoring criteria here, the DB `SadhanaFields` records
//   for any guide that customized their form will diverge and produce incorrect
//   scores. Use the SetupPage.tsx admin panel to sync DB records after updates.
// ══════════════════════════════════════════════════════════════════════════════

export type ContextTag = 'today_morning' | 'today' | 'tonight' | 'last_night' | null;

export interface StaticFieldDef {
  fieldKey: string;
  fieldLabel: string;
  fieldType: 'radio' | 'toggle' | 'multiselect' | 'number' | 'time' | 'duration';
  displayOrder: number;
  isRequired: boolean;
  contributesToScore: boolean;
  isResidentForm: boolean;
  contextTag?: ContextTag;
  options?: { value: number | string; label: string }[];
  criteria?: object;
  minValue?: number;
  maxValue?: number;
}

// ─── Resident Form Fields ────────────────────────────────────────────────────

export const RESIDENT_FIELDS: StaticFieldDef[] = [
  {
    fieldKey: 'ma_na_gv',
    fieldLabel: 'MA, NA, Guru Vandana',
    fieldType: 'radio',
    displayOrder: 1,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: true,
    contextTag: 'today_morning',
    options: [
      { value: 3, label: 'Attended full 23 minutes' },
      { value: 2, label: '18 to 22 minutes' },
      { value: 1, label: '12 to 17 minutes' },
      { value: 0, label: 'Less than 12 minutes / Not attended' },
    ],
  },
  {
    fieldKey: 'quotes_tulasi',
    fieldLabel: 'Quotes + Tulasi Pranama',
    fieldType: 'radio',
    displayOrder: 2,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: true,
    contextTag: 'today_morning',
    options: [
      { value: 1, label: 'Attended fully' },
      { value: 0, label: 'Not attended/Partially attended' },
    ],
  },
  {
    fieldKey: 'bath',
    fieldLabel: 'Attending without taking a bath',
    fieldType: 'toggle',
    displayOrder: 3,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: true,
    contextTag: 'today_morning',
    options: [
      { value: 1, label: 'No' },
      { value: -1, label: 'Yes' },
    ],
  },
  {
    fieldKey: 'japa_visible',
    fieldLabel: 'Japa visibly done in MTH/Balcony during 30 min / 60 min Morning Program',
    fieldType: 'radio',
    displayOrder: 4,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: true,
    contextTag: 'today_morning',
    options: [
      { value: 2, label: '25-30 min / 50-60 min' },
      { value: 1, label: '10–25 min / 20–50 min' },
      { value: 0, label: 'Less than 10 min / Less than 20 min' },
    ],
  },
  {
    fieldKey: 'sb',
    fieldLabel: 'Srimad Bhagavatam',
    fieldType: 'radio',
    displayOrder: 5,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: true,
    contextTag: 'today_morning',
    options: [
      { value: 2, label: 'Attended 25-30 min in MT Hall' },
      { value: 1, label: 'Attended 15-24 min in MT Hall' },
      { value: 0, label: 'Less than 15 min / Not attended' },
    ],
  },
  {
    fieldKey: 'cleanliness',
    fieldLabel: 'Cleanliness',
    fieldType: 'radio',
    displayOrder: 6,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: true,
    contextTag: 'today_morning',
    options: [
      { value: 1, label: 'Cleaned before 8 AM' },
      { value: 0, label: 'Not cleaned / After 8 AM' },
    ],
  },
  // report_sending is now AUTO-COMPUTED server-side (same day = 1pt, backdated = 0pt)
  // No user-facing toggle needed
  {
    fieldKey: 'daily_service',
    fieldLabel: 'Daily Assigned Service',
    fieldType: 'radio',
    displayOrder: 8,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: true,
    contextTag: 'today',
    options: [
      { value: 2, label: 'Done fully' },
      { value: 0, label: 'Done partially or not done' },
    ],
  },
  {
    fieldKey: 'sp_reading',
    fieldLabel: 'Reading Duration of Srila Prabhupada Books',
    fieldType: 'duration',
    displayOrder: 9,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: true,
    contextTag: 'today',
    criteria: {
      'More than 6 months': [{ points: 3, note: '> 40 min' }, { points: 2, note: '31-40 min' }, { points: 1, note: '20-30 min' }],
      '3 to 6 months':      [{ points: 3, note: '> 30 min' }, { points: 2, note: '21-30 min' }, { points: 1, note: '10-20 min' }],
      '0 to 3 months':      [{ points: 3, note: '> 20 min' }, { points: 2, note: '15-20 min' }, { points: 1, note: '5-14 min' }],
    },
  },
  {
    fieldKey: 'rounds',
    fieldLabel: 'No. of rounds of Hare Krishna Mahamantra',
    fieldType: 'number',
    displayOrder: 10,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: true,
    contextTag: 'today',
    minValue: 0,
    maxValue: 192,
    criteria: {
      'More than 6 months': [{ points: 4, note: '>= 16' }, { points: 3, note: '10-15' }, { points: 2, note: '5-9' }, { points: 1, note: '4' }],
      '3 to 6 months':      [{ points: 4, note: '>= 8'  }, { points: 3, note: '6-7'  }, { points: 2, note: '3-5' }, { points: 1, note: '2' }],
      '0 to 3 months':      [{ points: 4, note: '>= 4'  }, { points: 3, note: '3'    }, { points: 2, note: '2'   }, { points: 1, note: '1' }],
    },
  },
  {
    fieldKey: 'japa_finish_time',
    fieldLabel: 'Japa Finishing Time',
    fieldType: 'time',
    displayOrder: 11,
    isRequired: true,
    contributesToScore: false,
    isResidentForm: true,
    contextTag: 'today_morning',
  },
  {
    fieldKey: 'sleep_quality',
    fieldLabel: 'Sleep',
    fieldType: 'radio',
    displayOrder: 12,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: true,
    contextTag: 'tonight',
    options: [
      { value: 1, label: 'Sleeping before 10:30 PM' },
      { value: 0, label: 'Sleeping after 10:30 PM' },
    ],
  },
  {
    fieldKey: 'sleep_minutes',
    fieldLabel: 'Sleep Duration',
    fieldType: 'duration',
    displayOrder: 13,
    isRequired: true,
    contributesToScore: false,
    isResidentForm: true,
    contextTag: 'last_night',
  },
  {
    fieldKey: 'study_minutes',
    fieldLabel: 'Study Duration (students only)',
    fieldType: 'duration',
    displayOrder: 14,
    isRequired: false,
    contributesToScore: false,
    isResidentForm: true,
    contextTag: 'today',
  },
  {
    fieldKey: 'preaching_raw',
    fieldLabel: 'Preaching Duration',
    fieldType: 'duration',
    displayOrder: 15,
    isRequired: true,
    contributesToScore: false,
    isResidentForm: true,
    contextTag: 'today',
  },
  {
    fieldKey: 'distribution_raw',
    fieldLabel: 'No. of Books Distributed',
    fieldType: 'number',
    displayOrder: 16,
    isRequired: true,
    contributesToScore: false,
    isResidentForm: true,
    contextTag: 'today',
    minValue: 0,
    maxValue: 10000,
  },
  {
    fieldKey: 'flags',
    fieldLabel: 'Mark OS (Outstation) / Sick',
    fieldType: 'multiselect',
    displayOrder: 17,
    isRequired: false,
    contributesToScore: false,
    isResidentForm: true,
    contextTag: 'today',
    options: [
      { value: 'Sick', label: 'Sick' },
      { value: 'OS', label: 'OS' },
    ],
  },
];

// ─── Non-Resident Form Fields ─────────────────────────────────────────────────

export const NON_RESIDENT_FIELDS: StaticFieldDef[] = [
  {
    fieldKey: 'wakeUptime',
    fieldLabel: 'Wake-up Time',
    fieldType: 'time',
    displayOrder: 1,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: false,
    contextTag: 'today_morning',
    criteria: {
      penalty_rule: 'reduce 1 mark for 15 min delay',
      total_points: 4,
      levels: {
        Jigyasa: '-', Shraddhavan: '-', Sevak: 'enabled', Sadhaka: 'enabled',
        Upasaka: '6:00 AM', Caranashraya: '5:00 AM', Harinam_Diksha: '4:00 AM', Gauranga_Sabha: '-',
      },
      notes: 'Deduct 1 point per 15-min delay past target. E.g. Upasaka wakes at 6:20 AM = -1 pt.',
    },
  },
  {
    fieldKey: 'sleepTime',
    fieldLabel: 'Sleep Time',
    fieldType: 'time',
    displayOrder: 2,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: false,
    contextTag: 'tonight',
    criteria: {
      penalty_rule: 'reduce 1 mark for 15 min delay',
      total_points: 4,
      levels: {
        Jigyasa: '-', Shraddhavan: '-', Sevak: 'enabled', Sadhaka: 'enabled',
        Upasaka: '11:00 PM', Caranashraya: '10:30 PM', Harinam_Diksha: '10:00 PM', Gauranga_Sabha: '-',
      },
      notes: 'Deduct 1 point per 15-min delay past target sleep time.',
    },
  },
  {
    fieldKey: 'chanting',
    fieldLabel: 'Chanting Rounds',
    fieldType: 'number',
    displayOrder: 3,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: false,
    contextTag: 'today',
    minValue: 0,
    maxValue: 192,
    criteria: {
      penalty_rule: 'reduce pro rata',
      total_points: 8,
      levels: {
        Jigyasa: '1 round', Shraddhavan: '1 round', Sevak: '4 rounds', Sadhaka: '8 rounds',
        Upasaka: '12 rounds', Caranashraya: '16 rounds', Harinam_Diksha: '16 rounds', Gauranga_Sabha: '-',
      },
      notes: 'Score = (actual / target) × total_points, capped at total_points.',
    },
  },
  {
    fieldKey: 'reading',
    fieldLabel: 'Reading Duration',
    fieldType: 'duration',
    displayOrder: 4,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: false,
    contextTag: 'today',
    criteria: {
      penalty_rule: 'reduce pro rata',
      total_points: 4,
      levels: {
        Jigyasa: '5 min', Shraddhavan: '5 min', Sevak: '10 min', Sadhaka: '15 min',
        Upasaka: '20 min', Caranashraya: '30 min', Harinam_Diksha: '60 min', Gauranga_Sabha: '-',
      },
      notes: 'Score = (actual / target) × total_points, capped at total_points.',
    },
  },
  {
    fieldKey: 'hearing',
    fieldLabel: 'Hearing Duration',
    fieldType: 'duration',
    displayOrder: 5,
    isRequired: true,
    contributesToScore: true,
    isResidentForm: false,
    contextTag: 'today',
    criteria: {
      penalty_rule: 'reduce pro rata',
      total_points: 4,
      levels: {
        Jigyasa: '5 min', Shraddhavan: '5 min', Sevak: '10 min', Sadhaka: '15 min',
        Upasaka: '20 min', Caranashraya: '30 min', Harinam_Diksha: '60 min', Gauranga_Sabha: '-',
      },
      notes: 'Bhakti Vriksha session counts as 50% hearing + 50% reading for scoring.',
    },
  },
  {
    fieldKey: 'fillingSameDay',
    fieldLabel: 'Filled Same Day',
    fieldType: 'toggle',
    displayOrder: 11,
    isRequired: false,
    contributesToScore: true,
    isResidentForm: false,
    criteria: {
      penalty_rule: "reduce 2 mark for a day's delay",
      total_points: 4,
      levels: {
        Jigyasa: '-', Shraddhavan: '-',
        Sevak: 'all levels', Sadhaka: 'all levels', Upasaka: 'all levels',
        Caranashraya: 'all levels', Harinam_Diksha: 'all levels', Gauranga_Sabha: '-',
      },
      notes: 'Deduct 2 points per day of delay. Max deduction = total_points.',
    },
  },
  {
    fieldKey: 'seva',
    fieldLabel: 'Seva / Service',
    fieldType: 'toggle',
    displayOrder: 7,
    isRequired: false,
    contributesToScore: true,
    isResidentForm: false,
    contextTag: 'today',
    criteria: {
      penalty_rule: 'reduce pro rata',
      total_points: 4,
      levels: {
        Jigyasa: '-', Shraddhavan: '-',
        Sevak: 'enabled(weekly leaderboard)', Sadhaka: 'enabled(weekly leaderboard)',
        Upasaka: '20 min', Caranashraya: '30 min', Harinam_Diksha: '60 min', Gauranga_Sabha: '-',
      },
      notes: 'Sevak/Sadhaka: presence tracked for weekly leaderboard only. Upasaka+: pro-rata scored.',
    },
  },
  {
    fieldKey: 'bhaktiVriksha',
    fieldLabel: 'Bhakti Vriksha Attended',
    fieldType: 'toggle',
    displayOrder: 8,
    isRequired: false,
    contributesToScore: true,
    isResidentForm: false,
    contextTag: 'today',
    criteria: {
      penalty_rule: 'reduce pro rata',
      total_points: 4,
      levels: {
        Jigyasa: '-', Shraddhavan: '-',
        Sevak: 'enabled(weekly leaderboard)', Sadhaka: 'enabled(weekly leaderboard)',
        Upasaka: 'enabled(weekly leaderboard)',
        Caranashraya: '30 min', Harinam_Diksha: '30 min', Gauranga_Sabha: '-',
      },
      notes: 'BV session = 50% hearing + 50% reading. Sevak/Sadhaka/Upasaka: leaderboard only. Caranashraya+: pro-rata scored.',
    },
  },
  {
    fieldKey: 'preaching_raw',
    fieldLabel: 'Preaching Duration',
    fieldType: 'duration',
    displayOrder: 9,
    isRequired: false,
    contributesToScore: false,
    isResidentForm: false,
    contextTag: 'today',
  },
  {
    fieldKey: 'distribution_raw',
    fieldLabel: 'No. of Books Distributed',
    fieldType: 'number',
    displayOrder: 10,
    isRequired: false,
    contributesToScore: false,
    isResidentForm: false,
    contextTag: 'today',
  },
];

/** Convert a StaticFieldDef to the shape expected by getSadhanaFormData output */
export function toFormField(f: StaticFieldDef, id?: string) {
  return {
    fieldId: id || `static_${f.fieldKey}`,
    fieldKey: f.fieldKey,
    fieldLabel: f.fieldLabel,
    fieldType: f.fieldType,
    displayOrder: f.displayOrder,
    isRequired: f.isRequired,
    contributesToScore: f.contributesToScore,
    maxPoints: 0,
    minValue: 0,
    maxValue: 100,
    group: 'General',
    helpText: null as string | null,
    contextTag: (f.contextTag ?? null) as ContextTag | null,
    options: (f.options || []) as { value: number | string; label: string }[],
    criteria: f.criteria ? JSON.stringify(f.criteria) : null as string | null,
  };
}
