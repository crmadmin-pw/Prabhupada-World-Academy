export const REALTIME_CHANNELS = [
  'users',
  'groups',
  'attendance',
  'quizzes',
  'sadhana',
  'meetings',
  'services',
  'notifications',
  'config',
  'general',
] as const;

export type RealtimeChannel = (typeof REALTIME_CHANNELS)[number];
export type RealtimeDepartment = 'FOLK' | 'PW' | 'ALL';

const READ_ONLY_ENDPOINTS = new Set([
  'checkAllocationPublished',
  'checkGuideEmail',
  'checkEmailStatus',
  'openApiSpec',
  'sadhanaStatus',
  'testTagMangoConnection',
]);

const MUTATION_ENDPOINTS = new Set([
  'checkAndMarkOverdue',
  'courseCompleted10',
  'courseCompleted50',
  'courseCompleted100',
]);

const MUTATION_PREFIXES = [
  'accept', 'acknowledge', 'add', 'approve', 'archive', 'assign', 'auto',
  'backfill', 'bulk', 'conduct', 'copy', 'create', 'delete', 'fix', 'harddelete',
  'import', 'invalidate', 'join', 'leave', 'log', 'manage', 'mark', 'process',
  'publish', 'recalculate', 'register', 'reject', 'release', 'remove', 'request',
  'resolve', 'retry', 'revoke', 'save', 'seed', 'selfallocate', 'send', 'set',
  'submit', 'subscribe', 'tag', 'toggle', 'trigger', 'unsubscribe', 'update',
];

const READ_ONLY_PREFIXES = ['get', 'load', 'list', 'check', 'export', 'download', 'lookup', 'preview', 'validate'];

export function isReadOnlyEndpoint(name: string): boolean {
  const lower = name.toLowerCase();
  if (MUTATION_ENDPOINTS.has(name) || MUTATION_PREFIXES.some(prefix => lower.startsWith(prefix))) return false;
  if (READ_ONLY_ENDPOINTS.has(name)) return true;
  return READ_ONLY_PREFIXES.some(prefix => lower.startsWith(prefix)) ||
    lower.includes('stats') || lower.includes('report') || lower.includes('analytics');
}

/** Infer the smallest practical invalidation domains from an endpoint name.
 * The API remains the authorization boundary; these channels contain no data.
 */
export function realtimeChannelsForEndpoint(name: string): RealtimeChannel[] {
  const reportDependencies: Record<string, RealtimeChannel[]> = {
    getGuideDetailedReport: ['sadhana', 'users', 'groups', 'config'],
    getGuideUsers: ['users', 'sadhana', 'groups', 'config'],
    getMissingSadhanaReport: ['sadhana', 'users', 'groups', 'config'],
    getBvSessionMatrix: ['attendance', 'quizzes', 'users', 'groups'],
    getAllBvGroupsAdmin: ['attendance', 'users', 'groups'],
    getBvslGroups: ['attendance', 'users', 'groups'],
    getSuperGuideBvStats: ['attendance', 'sadhana', 'users', 'groups'],
    getGuides: ['users', 'groups', 'config'],
    getAllResidencies: ['users', 'config'],
    logDevoteeInteraction: ['meetings'],
    getMeetings: ['meetings', 'users'],
    getMoms: ['meetings', 'users'],
  };
  if (reportDependencies[name]) return reportDependencies[name];
  const lower = name.toLowerCase();
  const channels = new Set<RealtimeChannel>();

  // This aggregate is the data source for the PW user's Sadhana homepage.
  // Its endpoint name alone does not mention Sadhana, so classify it
  // explicitly. Otherwise a submitted entry can leave its cached dashboard
  // response intact until the cache expires.
  if (lower === 'getuserdashboarddata') {
    channels.add('sadhana');
    channels.add('attendance');
    channels.add('groups');
    channels.add('quizzes');
  }

  if (/sadhana|ashray|preach/.test(lower)) channels.add('sadhana');
  if (/quiz/.test(lower)) channels.add('quizzes');
  if (/attendance|session|availability/.test(lower)) channels.add('attendance');
  if (/meeting|mom|onetoone|one_to_one|callreport/.test(lower)) channels.add('meetings');
  if (/group|bvsl|facilitator|supervisor|registration|bhaktivriksha|\bbv/.test(lower)) channels.add('groups');
  if (/user|member|role|guide|approval|mentor|residency|profile|account/.test(lower)) channels.add('users');
  if (/service|allocation|cleanliness|rent|trip|skill|swap/.test(lower)) channels.add('services');
  if (/notification|push|reminder|subscription/.test(lower)) channels.add('notifications');
  if (/config|field|setting|tagmango/.test(lower)) channels.add('config');

  if (channels.size === 0) channels.add('general');
  return [...channels];
}

const MEMBERSHIP_MUTATIONS = new Set([
  'addGroupMember',
  'approveAndAssignBvMember',
  'approveBvJoinRequest',
  'assignBvRole',
  'bulkAddGroupMembers',
  'deleteBvGroup',
  'hardDeleteBvGroups',
  'joinBvGroupByToken',
  'joinGroupByToken',
  'leaveBvGroup',
  'removeBvGroupMember',
  'removeGroupMember',
  'transferBvGroupMember',
  'updateBvGroup',
]);

/** Reads that render a reading-group member count. Membership writes refresh
 * only these cached results, once, instead of polling or clearing every query. */
const MEMBERSHIP_COUNT_READS = [
  'getAllBvGroups',
  'getAllBvGroupsAdmin',
  'getBvGroupSadhanaMonitor',
  'getBvSupervisorOverview',
  'getBvslGroups',
  'getGroupMembers',
  'getGuideGroupStats',
  'getGuideGroups',
  'getSuperGuideBvStats',
  'getSystemBvGroups',
  'getUserBvStatus',
] as const;

/** Approval and Reading Group assignment change the member directory.
 * Invalidate that exact cached read when the mutation commits. Firestore
 * revisions still reconcile it; this does not poll. */
const DIRECTORY_MUTATIONS = new Set(['approveUser', 'transferBvGroupMember', 'updateBvGroup']);
const DIRECTORY_READS = ['getGuideUsers'] as const;

export function directoryReads(endpoint: string): readonly string[] {
  return DIRECTORY_MUTATIONS.has(endpoint) ? DIRECTORY_READS : [];
}

export function membershipCountReads(endpoint: string, input?: unknown): readonly string[] {
  if (!MEMBERSHIP_MUTATIONS.has(endpoint)) return [];
  const record = input && typeof input === 'object' ? input as { groupId?: unknown; action?: unknown } : undefined;
  // Approving without a group, or rejecting a request, does not change a count.
  if (endpoint === 'approveAndAssignBvMember' && !record?.groupId) return [];
  if (endpoint === 'approveBvJoinRequest' && record?.action === 'reject') return [];
  return MEMBERSHIP_COUNT_READS;
}

/** Immediate badge adjustment for the group named by the mutation.
 * The following refetch replaces it with the server count. */
export function membershipCountAdjustment(endpoint: string, input: unknown): { groupId: string; delta: number } | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as { groupId?: unknown; groupDbId?: unknown; action?: unknown; userIds?: unknown };
  const groupId = String(record.groupId || record.groupDbId || '').trim();
  if (!groupId || !MEMBERSHIP_MUTATIONS.has(endpoint)) return undefined;
  if (endpoint === 'approveBvJoinRequest') return record.action === 'approve' ? { groupId, delta: 1 } : undefined;
  if (endpoint === 'approveAndAssignBvMember') return record.groupId ? { groupId, delta: 1 } : undefined;
  if (endpoint === 'bulkAddGroupMembers') return { groupId, delta: Array.isArray(record.userIds) ? record.userIds.length : 0 };
  if (['addGroupMember', 'joinBvGroupByToken', 'joinGroupByToken'].includes(endpoint)) return { groupId, delta: 1 };
  if (['removeGroupMember', 'removeBvGroupMember', 'leaveBvGroup'].includes(endpoint)) return { groupId, delta: -1 };
  return undefined;
}

export function normalizeRealtimeDepartment(value: unknown): RealtimeDepartment | null {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (normalized === 'FOLK') return 'FOLK';
  if (normalized === 'PW' || normalized === 'PRABHUPADAWORLD') return 'PW';
  if (normalized === 'ALL' || normalized === 'GLOBAL') return 'ALL';
  return null;
}

export const REALTIME_INVALIDATION_EVENT = 'pwa:realtime-invalidation';
