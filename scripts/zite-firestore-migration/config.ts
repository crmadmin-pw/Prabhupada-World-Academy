export const SOURCE_SYSTEM = 'zite:pwa:1ab8f516ea1301be';
export const SOURCE_BASE_ID = '1ab8f516ea1301be';
export const FIREBASE_PROJECT_ID = 'bvpw108';
export const FIRESTORE_DATABASE_ID = '(default)';

// Operator-confirmed identity corrections. These names take precedence over
// email-shaped or blank source display names, but never alter roles or flags.
export const CANONICAL_USER_NAMES_BY_EMAIL: Readonly<Record<string, string>> = Object.freeze({
  'arap@hkmmumbai.org': 'Arjunacharya Das',
  'vbmd@hkmmumbai.org': 'Vaibhav Mohan Das',
});

export const NON_BLOCKING_MIGRATION_ASSERTIONS = new Set<string>([
  'allOperationalRelationshipsResolved',
  'tombstonesAvailable',
]);

export type MigrationDisposition = 'operational' | 'archive_only' | 'exclude';

export interface SourceTableConfig {
  source: string;
  sourceId?: string;
  destination?: string;
  disposition: MigrationDisposition;
  businessKeys?: string[][];
}

const operational = (
  source: string,
  sourceId: string,
  destination: string,
  businessKeys: string[][] = [],
): SourceTableConfig => ({ source, sourceId, destination, disposition: 'operational', businessKeys });

const excluded = (source: string, sourceId: string): SourceTableConfig => ({
  source,
  sourceId,
  disposition: 'exclude',
});

export const SOURCE_TABLES: SourceTableConfig[] = [
  operational('Users', 'tjiZELyiYY1', 'Users', [['Email']]),
  operational('Guides', 'tdsqg4NBE9s', 'Guides', [['Guide ID'], ['Email']]),
  operational('Folk Residencies', 'taqJwEU31wL', 'FolkResidencies', [['Residency ID'], ['Residency Name']]),
  operational('Sadhana Entries', 't2PWwyx1cWK', 'SadhanaEntries', [['Entry ID'], ['User', 'Entry Date']]),
  operational('Sadhana Fields', 't3rdDFkkN9m', 'SadhanaFields', [['Field Key', 'Guide', 'Residency']]),
  operational('BV Groups', 'ttouRrAvypU', 'BvGroups', [['Group ID'], ['Group Name', 'Guide']]),
  operational('BV Group Members', 't1LxRfZsx3T', 'BvGroupMembers', [['User', 'Group']]),
  operational('BV Group Requests', 't2CpktzjQkm', 'BvGroupRequests', [['Request ID']]),
  operational('BV Sessions', 't5guP7y6hfA', 'BvSessions', [['Session ID'], ['Group', 'Session Date', 'Topic']]),
  operational('BV Attendance', 'tfiUja993Wr', 'BvAttendance', [['Session', 'User']]),
  operational('BVSL Preaching Entries', 'toX7EdSLGUw', 'BvslPreachingEntries', [['Entry ID']]),
  operational('Services', 't65H65C9jfN', 'Services', [['Service ID'], ['Service Name', 'Residency']]),
  operational('Service Allocations', 'twxTe7RdLac', 'ServiceAllocations', [['Allocation ID']]),
  operational('Service Availability', 'tebYsycAF9S', 'ServiceAvailability', [['Availability ID']]),
  operational('Service Swaps', 'tgW7brYvYBa', 'ServiceSwaps', [['Swap ID']]),
  operational('Skill Catalog', 'tucDUvU39HM', 'SkillCatalog', [['Skill ID'], ['Skill Name']]),
  operational('User Skills', 'txrys9TB99j', 'UserSkills', [['User', 'Skill']]),
  operational('Ashray Checklist', 'thh3x2ts5NZ', 'AshrayChecklist', [['Checklist ID']]),
  operational('Residency Transfer Requests', 'ttfv4Cb2J9H', 'ResidencyTransferRequests', [['Request ID']]),
  operational('Guide Transfer Requests', 'tcGhr1eYqYW', 'GuideTransferRequests', [['Request ID']]),
  operational('Config', 't1CcTTTZ9cK', 'Config', [['Key']]),
  operational('AshrayLevels', 't6GfVSAVVqq', 'AshrayLevels', [['Level Name'], ['Name']]),
  operational('AshrayUpgradeRequests', 'ter3M1u847e', 'AshrayUpgradeRequests', [['Request ID']]),
  operational('ServicePreferences', 'tmiiBP1uzRp', 'ServicePreferences', [['Preference ID'], ['User', 'Service']]),
  operational('BvQuizzes', 'tv84Pg4zX84', 'BvQuizzes', [['Quiz ID']]),
  operational('BvQuizSubmissions', 't441pus1S4e', 'BvQuizSubmissions', [['Submission ID'], ['Quiz', 'User', 'Submitted At']]),
  operational('ServiceRatings', 'thJ3LpVphjj', 'ServiceRatings', [['Rating ID']]),
  excluded('LLP Guides', 't5MA6r9Luwg'),
  excluded('LLP Users', 'taUfyRaup5r'),
  excluded('LLP Sadhana Entries', 'tnSsFZ8tnf1'),
  excluded('LLP Form Config', 'ts5N84GTZGi'),
  excluded('LLP BV Groups', 'tsxYvcvEnUr'),
  excluded('LLP BV Group Members', 'tp3G2LcL9H3'),
  excluded('LLP BV Sessions', 'toJLcmUFqYK'),
  excluded('LLP BV Attendance', 't7r9te98sMF'),
  excluded('LLP Service Types', 'twz6BWsy6FC'),
  excluded('LLP Service Log', 't3DFgyg8SoT'),
  excluded('LLP Appointment Slots', 'tqwCJMcLpny'),
  excluded('LLP Bookings', 't2PyxovypSQ'),
  excluded('LLP Service Allocations', 't7imLt2aG1X'),
  operational('Unavailability Requests', 'te8psVYu4ri', 'UnavailabilityRequests', [['Request ID']]),
  operational('Sadhana Monthly Summaries', 't6uWbKBMmVK', 'SadhanaMonthlySummaries', [['Summary ID'], ['User', 'Month', 'Template']]),
  operational('One To One Meetings', 't8NVqa7neVs', 'OneToOneMeetings', [['Meeting ID']]),
  operational('Preaching Report Goals', 'ttEbqc6d3b2', 'PreachingReportGoals', [['Goal ID'], ['Center', 'Year', 'Metric']]),
  operational('Trips', 't1hovNDG3Uk', 'Trips', [['Trip ID']]),
  operational('Rent Payments', 'tkaAfu1Bf2P', 'RentPayments', [['Payment ID']]),
  { source: 'Push Subscriptions', sourceId: 'td1Q2d5udcc', destination: 'PushSubscriptions', disposition: 'archive_only' },
  operational('BVSL Weekly Plans', 'tv3y8dDEtZw', 'BvslWeeklyPlans', [['Plan ID'], ['User', 'Week Start']]),
  operational('TagMango Sync Log', 'tm61ScFTZjU', 'TagMangoSyncLog', [['Order ID']]),
  operational('Attendance Events', 't3nysRdi8bJ', 'AttendanceEvents'),
  operational('Attendance Sessions', 'twmqTBuDrjj', 'AttendanceSessions'),
  operational('Attendance Participants', 'thLWkwMdTGc', 'AttendanceParticipants'),
  operational('Attendance Records', 'tfYVjan9wyy', 'AttendanceRecords', [['Record Number']]),
  operational('Attendance Volunteers', 't59RxkF2N5r', 'AttendanceVolunteers', [['Volunteer Number']]),
  operational('Challenge Enrollments', 't8yUCnonEcJ', 'ChallengeEnrollments', [['Enrollment Number']]),
  operational('Cleanliness Rooms', 'tfDUHmYZ3WY', 'CleanlinessRooms', [['Residency', 'Room Number']]),
  operational('Cleanliness Inspections', 'tnw754RbJs5', 'CleanlinessInspections', [['Inspection ID']]),
  operational('Jigyasa Registrations', 'tbz2HriHjPs', 'JigyasaRegistrations', [['Email', 'Phone', 'Name']]),
  operational('Jigyasa Session Attendance', 't7DFFrqAgXw', 'JigyasaSessionAttendance', [['Record Key']]),
  operational('Jigyasa Processed Files', 'tghGqjDBjvm', 'JigyasaProcessedFiles', [['File Name', 'Session Date']]),
  operational('Cleanliness Review Requests', 'tg3eAHW3Azc', 'CleanlinessReviewRequests', [['Request ID']]),
  { source: 'Zite Users', disposition: 'archive_only' },
];

export const PERMISSION_FIELDS = [
  'isBvAdmin',
  'isBvSuperAdmin',
  'isBvSupervisor',
  'isBvMentor',
  'isBvFacilitator',
  'isBvSubFacilitator',
  'isBvsl',
  'isSadhanaMentor',
  'isServiceAllocator',
  'isCleanlinessManager',
  'isFolkLead',
  'isTripCoordinator',
  'isServiceVerifier',
] as const;

export const PROTECTED_USER_FIELDS = new Set<string>([
  'role',
  'status',
  'segment',
  'uid',
  'authUid',
  'firebaseUid',
  'firebaseAuthUid',
  ...PERMISSION_FIELDS,
]);

export const PRIVILEGED_ROLES = new Set([
  'admin',
  'super admin',
  'guide',
  'super guide',
]);

export const ARCHIVE_COLLECTION = '_MigrationArchive';
export const ARCHIVE_CHUNKS_COLLECTION = '_MigrationArchiveChunks';
export const LEDGER_COLLECTION = '_MigrationLedger';
export const RUN_COLLECTION = '_MigrationRuns';

export function assertStaticConfiguration(): void {
  const names = new Set<string>();
  for (const table of SOURCE_TABLES) {
    if (names.has(table.source)) throw new Error(`Duplicate source-table decision: ${table.source}`);
    names.add(table.source);
    if (/^LLP/i.test(table.source) && table.disposition !== 'exclude') {
      throw new Error(`LLP prefix firewall violation in configuration: ${table.source}`);
    }
    if (table.disposition === 'operational' && !table.destination) {
      throw new Error(`Operational table lacks a destination: ${table.source}`);
    }
  }
  if (SOURCE_TABLES.length !== 62) {
    throw new Error(`Expected exactly 62 source-table decisions, found ${SOURCE_TABLES.length}`);
  }
}
