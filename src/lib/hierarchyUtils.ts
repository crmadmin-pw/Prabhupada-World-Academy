import { Users, Guides, FolkResidencies, BvGroups, BvGroupMembers, Config, getFirestoreDb, REPORTING_CHAINS_KEY, REPORTING_CHAINS_READY, reportingChainsLocallyStaleNow, clearReportingChainsLocalStale } from '@/lib/backend-sdk';
import { invalidateRequestTable } from '@/lib/requestQueries';

export const HIERARCHY_IDENTITY_FIELDS = ['id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid',
  'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];

export function hierarchyRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(hierarchyRefs);
  return value == null ? [] : String(value).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
}

export function hierarchyAliases(user: any): string[] {
  return HIERARCHY_IDENTITY_FIELDS.flatMap(field => hierarchyRefs(user?.[field]));
}

export function isHierarchySuperAdmin(user: any): boolean {
  const role = String(user?.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return !!user && (user.isBvSuperAdmin === true || ['SUPER_ADMIN', 'SUPER_GUIDE'].includes(role));
}

export function isHierarchyAdmin(user: any): boolean {
  const role = String(user?.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return !!user && (isHierarchySuperAdmin(user) || user.isBvAdmin === true || user.isPwAdmin === true ||
    ['ADMIN', 'PW_ADMIN', 'GUIDE'].includes(role));
}

export type DirectoryDepartment = 'PW' | 'FOLK';

/** Explicit department of a member. An explicit FOLK segment stays FOLK. */
export function memberDirectoryDepartment(user: any): DirectoryDepartment | null {
  const segment = String(user?.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (segment === 'FOLK') return 'FOLK';
  if (segment === 'PW' || segment === 'PRABHUPADAWORLD') return 'PW';
  if (user?.isPrabhupadaWorldUser === true) return 'PW';
  return null;
}

/** Department used when an administrator reads the member directory. */
export function callerDirectoryDepartment(user: any): DirectoryDepartment | null {
  return memberDirectoryDepartment(user) || (isPwDepartmentAdmin(user) ? 'PW' : null);
}

/** A Prabhupada World admin reads every Prabhupada World member, the same as a super admin. */
export function isPwDepartmentAdmin(user: any): boolean {
  if (!user) return false;
  const role = String(user.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const segment = String(user.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  const explicitPwAdmin = user.isPwAdmin === true || role === 'PW_ADMIN';
  const inPwDepartment = explicitPwAdmin || (
    segment !== 'FOLK' && (
      user.isPrabhupadaWorldUser === true ||
      segment === 'PW' ||
      segment === 'PRABHUPADAWORLD'
    )
  );
  const isAdmin = explicitPwAdmin || user.isBvAdmin === true || role === 'ADMIN' || role === 'ADMINISTRATOR';
  return inPwDepartment && isAdmin;
}

export function isUserInHierarchy(user: any, scope: Set<string> | null): boolean {
  return scope === null || hierarchyAliases(user).some(alias => scope.has(alias));
}

function department(user: any): string {
  const segment = String(user?.segment || '').replace(/[\s_-]/g, '').toUpperCase();
  return user?.isPrabhupadaWorldUser || ['PW', 'PRABHUPADAWORLD'].includes(segment) ? 'PW' : segment;
}

/** Pure resolver. Only explicit reporting links and active memberships grant access.
 * Missing links never mean "all admins". Names are not user identity aliases.
 */
export function resolveHierarchyScope(caller: any, users: any[], groups: any[] = [], memberships: any[] = [], guides: any[] = [], residencies: any[] = []): Set<string> | null {
  if (!caller) return new Set();
  if (isHierarchySuperAdmin(caller)) return null;
  const callerKeys = new Set(hierarchyAliases(caller));
  const stored = users.find(user => isUserInHierarchy(user, callerKeys));
  hierarchyAliases(stored).forEach(key => callerKeys.add(key));
  const callerDepartment = department(caller) || department(stored);
  const eligible = (user: any) => !callerDepartment || !department(user) || department(user) === callerDepartment;
  const scope = new Set(callerKeys);
  const add = (user: any) => hierarchyAliases(user).forEach(key => scope.add(key));
  const expandGuideAliases = () => {
    for (const guide of guides) {
      if (isUserInHierarchy(guide, scope)) {
        hierarchyAliases(guide).forEach(key => scope.add(key));
        hierarchyRefs(guide.guideId).forEach(key => scope.add(key));
      }
    }
  };
  expandGuideAliases();
  const admin = isHierarchyAdmin(caller);
  const role = String(caller.role || '').toUpperCase().replace(/[\s-]/g, '_');
  const supervisor = caller.isBvSupervisor || caller.isBvMentor || ['SUPERVISOR', 'BV_SUPERVISOR'].includes(role);
  const rgf = caller.isBvFacilitator || caller.isBvsl || ['RGF', 'BVSL', 'FACILITATOR'].includes(role);
  const rgsf = caller.isBvSubFacilitator || role === 'RGSF';
  const mentor = caller.isSadhanaMentor || role === 'SADHANA_MENTOR';

  // Explicit admin ownership takes precedence over stale legacy guide links.
  const foreignAdmin = (user: any) => {
    const refs = hierarchyRefs(user.bvReportingAdminId || user.bvSupervisorGuideId);
    return admin && refs.length > 0 && !refs.some(ref => scope.has(ref));
  };
  if (admin || supervisor || rgf) {
    let previousSize = -1;
    while (previousSize !== scope.size) {
      previousSize = scope.size;
      expandGuideAliases();
      for (const user of users) {
        if (!eligible(user) || foreignAdmin(user)) continue;
        // An explicit immediate parent wins over legacy guide/registration fields.
        const parents = hierarchyRefs(user.bvReportingFacilitatorId || user.bvReportingSupervisorId ||
          user.bvReportingAdminId || user.bvSupervisorGuideId || user.guide || user.selectedGuideId);
        if (parents.some(ref => scope.has(ref))) add(user);
      }
    }
  }
  // Legacy FOLK residents may only have a center assignment. That is an
  // ownership link only for a guide managing the center, and never overrides
  // an explicit assignment to a different guide/admin.
  if (admin && callerDepartment === 'FOLK') {
    const centerKeys = new Set<string>();
    for (const owner of [...guides, ...users]) if (isUserInHierarchy(owner, scope)) {
      hierarchyRefs(owner.folkResidencies).forEach(ref => centerKeys.add(ref));
    }
    for (const residency of residencies) {
      const refs = hierarchyRefs([residency.id, residency.residencyId, residency.residencyName]);
      if (refs.some(ref => centerKeys.has(ref)) || hierarchyRefs([residency.guideIds, residency.guides]).some(ref => scope.has(ref))) {
        refs.forEach(ref => centerKeys.add(ref));
      }
    }
    for (const user of users) {
      if (!eligible(user) || hierarchyRefs([user.guide, user.selectedGuideId, user.bvReportingAdminId, user.bvReportingSupervisorId, user.bvReportingFacilitatorId]).length) continue;
      if (hierarchyRefs(user.residency).some(ref => centerKeys.has(ref))) add(user);
    }
  }
  const groupOwners = new Set(scope);
  if (rgsf) {
    const parentRefs = new Set(hierarchyRefs(caller.bvReportingFacilitatorId || stored?.bvReportingFacilitatorId));
    for (const user of users) if (eligible(user) && isUserInHierarchy(user, parentRefs)) {
      hierarchyAliases(user).forEach(key => groupOwners.add(key));
    }
    parentRefs.forEach(key => groupOwners.add(key));
  }
  const groupIds = new Set<string>();
  for (const group of groups) {
    if (group.isActive === false || !eligible(group)) continue;
    const owners = hierarchyRefs([group.bvslId, group.bvslLeader, group.subFacilitatorId, group.rgsfId, group.subFacilitator]);
    const guides = hierarchyRefs(group.guide);
    if (admin && guides.length && !guides.some(ref => scope.has(ref))) continue;
    if (owners.some(ref => groupOwners.has(ref)) || (!(rgsf && !admin && !supervisor && !rgf) && guides.some(ref => scope.has(ref)))) {
      hierarchyRefs([group.id, group.groupId]).forEach(key => groupIds.add(key));
    }
  }
  const memberKeys = new Set<string>();
  for (const member of memberships) {
    if (member.isActive === false || ['inactive', 'removed', 'left'].includes(String(member.status || '').toLowerCase())) continue;
    if (hierarchyRefs([member.group, member.groupId]).some(ref => groupIds.has(ref))) {
      hierarchyRefs([member.user, member.userId, member.memberId]).forEach(key => memberKeys.add(key));
    }
  }
  // Resolve aliases through Users, not membership document IDs.
  for (const user of users) if (eligible(user) && !foreignAdmin(user) && isUserInHierarchy(user, memberKeys)) add(user);
  if (mentor) {
    const folkGuide = new Set(hierarchyRefs(stored?.guide || caller.guide));
    for (const user of users) {
      if (!eligible(user)) continue;
      const assigned = hierarchyRefs(user.sadhanaMentor).some(ref => callerKeys.has(ref));
      const folkAssigned = callerDepartment !== 'PW' && hierarchyRefs(user.guide).some(ref => folkGuide.has(ref));
      if (assigned || folkAssigned) add(user);
    }
  }
  return scope;
}

const USER_CHAIN_FIELDS = [...HIERARCHY_IDENTITY_FIELDS, 'role', 'guide', 'selectedGuideId', 'segment', 'isPrabhupadaWorldUser',
  'bvReportingAdminId', 'bvReportingSupervisorId', 'bvReportingFacilitatorId', 'bvSupervisorGuideId', 'sadhanaMentor',
  'folkResidencies', 'residency', 'isBvAdmin', 'isBvSuperAdmin', 'isPwAdmin', 'isBvSupervisor', 'isBvMentor',
  'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator', 'isSadhanaMentor'];
const GROUP_CHAIN_FIELDS = ['id', 'groupId', 'guide', 'segment', 'isActive', 'isPrabhupadaWorldUser', 'bvslId', 'bvslLeader', 'subFacilitatorId', 'rgsfId', 'subFacilitator'];
const MEMBERSHIP_CHAIN_FIELDS = ['id', 'user', 'userId', 'memberId', 'group', 'groupId', 'isActive', 'status'];
const GUIDE_CHAIN_FIELDS = ['id', 'guideId', 'email', 'userId', 'folkResidencies', ...HIERARCHY_IDENTITY_FIELDS];
const RESIDENCY_CHAIN_FIELDS = ['id', 'residencyId', 'residencyName', 'guideIds', 'guides'];

async function readAll(table: any, fields: string[]): Promise<any[]> {
  const records: any[] = [];
  for (let offset = 0; ; offset += 2000) {
    const page = await table.findAll({ fields, limit: 2000, offset });
    records.push(...page.records);
    if (!page.hasMore || !page.records.length) return records;
  }
}

async function loadHierarchyGraph(includeResidencies: boolean) {
  const [users, groups, memberships, guides, residencies] = await Promise.all([
    readAll(Users, USER_CHAIN_FIELDS),
    readAll(BvGroups, GROUP_CHAIN_FIELDS),
    readAll(BvGroupMembers, MEMBERSHIP_CHAIN_FIELDS),
    readAll(Guides, GUIDE_CHAIN_FIELDS),
    includeResidencies ? readAll(FolkResidencies, RESIDENCY_CHAIN_FIELDS) : Promise.resolve([]),
  ]);
  return { users, groups, memberships, guides, residencies };
}

function scopeKeysFor(user: any, guides: any[]): string[] {
  const keys = new Set(hierarchyAliases(user));
  for (const guide of guides) {
    if (!isUserInHierarchy(guide, keys)) continue;
    hierarchyAliases(guide).forEach(key => keys.add(key));
    hierarchyRefs(guide.guideId).forEach(key => keys.add(key));
  }
  return [...keys];
}

/** Derive who can see each person from the same rules as resolveHierarchyScope.
 * reportingChain holds viewer aliases. reportingScopeKeys holds only that person's own aliases.
 */
export function buildReportingChains(users: any[], groups: any[] = [], memberships: any[] = [], guides: any[] = [], residencies: any[] = []) {
  const reportingChain = new Map<string, Set<string>>();
  const scopeKeys = new Map<string, string[]>();
  for (const user of users) {
    if (!user?.id) continue;
    const keys = scopeKeysFor(user, guides);
    scopeKeys.set(String(user.id), keys);
    reportingChain.set(String(user.id), new Set(keys));
  }
  for (const viewer of users) {
    if (!viewer?.id || isHierarchySuperAdmin(viewer)) continue;
    const scope = resolveHierarchyScope(viewer, users, groups, memberships, guides, residencies);
    if (!scope) continue;
    const viewerKeys = scopeKeys.get(String(viewer.id)) || [];
    for (const user of users) {
      if (!user?.id || !isUserInHierarchy(user, scope)) continue;
      const chain = reportingChain.get(String(user.id));
      if (!chain) continue;
      viewerKeys.forEach(key => chain.add(key));
    }
  }
  return { reportingChain, scopeKeys };
}

/** Rebuild a caller's visible aliases from stored chains. A reportee's chain lists
 * viewers, so only that reportee's own keys are added — never the viewer's ancestors.
 */
export function scopeFromReportingChains(caller: any, users: any[], reportingChain: Map<string, Set<string>>, scopeKeys: Map<string, string[]>): Set<string> | null {
  if (!caller) return new Set();
  if (isHierarchySuperAdmin(caller)) return null;
  const callerKeys = new Set(hierarchyAliases(caller));
  const stored = users.find(user => isUserInHierarchy(user, callerKeys));
  (stored ? scopeKeys.get(String(stored.id)) || hierarchyAliases(stored) : []).forEach(key => callerKeys.add(key));
  const scope = new Set(callerKeys);
  for (const user of users) {
    if (!user?.id) continue;
    const chain = reportingChain.get(String(user.id)) || new Set(hierarchyAliases(user));
    if (![...callerKeys].some(key => chain.has(key))) continue;
    (scopeKeys.get(String(user.id)) || hierarchyAliases(user)).forEach(key => scope.add(key));
  }
  return scope;
}

async function markerValue(): Promise<string> {
  const row = await Config.findOne({ filters: { configKey: REPORTING_CHAINS_KEY } });
  return String(row?.configValue || '');
}

async function reportingChainsReady(): Promise<boolean> {
  if (!getFirestoreDb() || reportingChainsLocallyStaleNow()) return false;
  return (await markerValue()) === REPORTING_CHAINS_READY;
}

let refreshInFlight: Promise<boolean> | null = null;

async function persistReportingChains(users: any[], built: ReturnType<typeof buildReportingChains>) {
  const db = getFirestoreDb();
  const list = users.filter(user => user?.id);
  for (let index = 0; index < list.length; index += 400) {
    const batch = db.batch();
    for (const user of list.slice(index, index + 400)) {
      const id = String(user.id);
      batch.set(db.collection('Users').doc(id), {
        reportingChain: [...(built.reportingChain.get(id) || [])].sort(),
        reportingScopeKeys: [...(built.scopeKeys.get(id) || [])].sort(),
      }, { merge: true });
    }
    await batch.commit();
  }
}

async function writeReadyIfUnchanged(expected: string): Promise<boolean> {
  const db = getFirestoreDb();
  const ref = db.collection('Config').doc(REPORTING_CHAINS_KEY);
  const wrote = await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const exists = typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
    const data = typeof snap.data === 'function' ? snap.data() : snap.data;
    const current = exists ? String(data?.configValue || '') : '';
    if (current !== expected) return false;
    tx.set(ref, {
      id: REPORTING_CHAINS_KEY,
      configKey: REPORTING_CHAINS_KEY,
      configValue: REPORTING_CHAINS_READY,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return true;
  });
  invalidateRequestTable('Config');
  return wrote;
}

/** One full read, then later requests query the stored chains. A role change during
 * the rebuild leaves the marker stale so the next request rebuilds again.
 */
export async function refreshReportingChains(): Promise<boolean> {
  if (!getFirestoreDb()) return false;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const locallyStale = reportingChainsLocallyStaleNow();
    clearReportingChainsLocalStale();
    const started = await markerValue();
    if (started === REPORTING_CHAINS_READY && !locallyStale && !reportingChainsLocallyStaleNow()) return true;
    const graph = await loadHierarchyGraph(true);
    if (reportingChainsLocallyStaleNow()) return false;
    await persistReportingChains(graph.users, buildReportingChains(graph.users, graph.groups, graph.memberships, graph.guides, graph.residencies));
    if (reportingChainsLocallyStaleNow() || (await markerValue()) !== started) return false;
    return writeReadyIfUnchanged(started);
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function findCallerRecord(caller: any): Promise<any | null> {
  const fields = [...USER_CHAIN_FIELDS, 'reportingScopeKeys'];
  const id = caller?.id || caller?.uid;
  if (id) {
    const byId = await Users.findOne({ id: String(id), fields });
    if (byId) return byId;
  }
  const userId = caller?.userId ? String(caller.userId) : '';
  if (userId) {
    const byUserId = await Users.findAll({ filters: { userId }, fields, limit: 5 });
    if (byUserId.records[0]) return byUserId.records[0];
  }
  const email = caller?.email ? String(caller.email) : '';
  if (email) {
    const byEmail = await Users.findAll({ filters: { email }, fields, limit: 5 });
    const match = byEmail.records.find((row: any) => hierarchyRefs(row.email).includes(email.trim().toLowerCase()));
    if (match) return match;
  }
  return null;
}

async function queryVisibleUsers(keys: string[], fields?: string[]): Promise<any[]> {
  const unique = [...new Set(keys.map(key => key.toLowerCase()).filter(Boolean))];
  const seen = new Map<string, any>();
  const projection = fields ? [...new Set([...fields, 'reportingScopeKeys'])] : undefined;
  for (let index = 0; index < unique.length; index += 10) {
    const chunk = unique.slice(index, index + 10);
    for (let offset = 0; ;) {
      const page = await Users.findAll({
        filters: { reportingChain: { arrayContainsAny: chunk } },
        fields: projection,
        limit: 500,
        offset,
      });
      for (const row of page.records) seen.set(String(row.id), row);
      if (!page.hasMore || !page.records.length) break;
      const next = offset + page.records.length;
      if (next <= offset) break;
      offset = next;
    }
  }
  return [...seen.values()];
}

async function queryScope(caller: any): Promise<Set<string>> {
  const callerKeys = new Set(hierarchyAliases(caller));
  const stored = await findCallerRecord(caller);
  if (stored) {
    const storedKeys = Array.isArray(stored.reportingScopeKeys) && stored.reportingScopeKeys.length
      ? stored.reportingScopeKeys
      : hierarchyAliases(stored);
    storedKeys.forEach((key: unknown) => callerKeys.add(String(key).toLowerCase()));
    hierarchyAliases(stored).forEach(key => callerKeys.add(key));
  }
  const scope = new Set(callerKeys);
  for (const user of await queryVisibleUsers([...callerKeys], ['reportingScopeKeys', ...HIERARCHY_IDENTITY_FIELDS])) {
    const keys = Array.isArray(user.reportingScopeKeys) && user.reportingScopeKeys.length
      ? user.reportingScopeKeys
      : hierarchyAliases(user);
    keys.forEach((key: unknown) => scope.add(String(key).toLowerCase()));
  }
  return scope;
}

function recordMatches(record: any, filters: any): boolean {
  if (!filters) return true;
  for (const key of Object.keys(filters)) {
    const expected = filters[key];
    if (expected === undefined) continue;
    if (expected === null) {
      if (record[key] !== null && record[key] !== undefined) return false;
      continue;
    }
    if (typeof expected === 'object' && !Array.isArray(expected)) {
      const actual = record[key];
      if (expected.in && ![actual].flat().some(item => expected.in.map((value: unknown) => String(value)).includes(String(item)))) return false;
      if (expected.gte !== undefined && !(actual >= expected.gte)) return false;
      if (expected.lte !== undefined && !(actual <= expected.lte)) return false;
      if (expected.gt !== undefined && !(actual > expected.gt)) return false;
      if (expected.lt !== undefined && !(actual < expected.lt)) return false;
      continue;
    }
    const actualValues = [record[key], key === 'guide' || key === 'guideId' || key === 'selectedGuideId' ? [record.guide, record.guideName, record.selectedGuideId] : []]
      .flat(Infinity).filter(value => value != null).map(value => String(value).toLowerCase());
    if (!actualValues.includes(String(expected).toLowerCase())) return false;
  }
  return true;
}

function presentUser(row: any, fields?: string[]) {
  if (!fields) {
    const copy = { ...row };
    delete copy.reportingChain;
    delete copy.reportingScopeKeys;
    return copy;
  }
  const presented: any = { id: row.id };
  for (const field of fields) presented[field] = row[field];
  return presented;
}

/** Report rows for one caller. Without a ready chain this is the existing table read.
 * A ready chain reads only people who report to the caller, then applies the caller's filters.
 */
export async function readScopedUsers(caller: any, query: any = {}): Promise<{ records: any[]; hasMore: boolean }> {
  if (!caller || isHierarchySuperAdmin(caller) || !getFirestoreDb()) return Users.findAll(query);
  if (!(await reportingChainsReady())) await refreshReportingChains();
  if (!(await reportingChainsReady())) return Users.findAll(query);
  const stored = await findCallerRecord(caller);
  const keys = new Set(hierarchyAliases(caller));
  if (stored) {
    (Array.isArray(stored.reportingScopeKeys) ? stored.reportingScopeKeys : hierarchyAliases(stored))
      .forEach((key: unknown) => keys.add(String(key).toLowerCase()));
    hierarchyAliases(stored).forEach(key => keys.add(key));
  }
  const filterFields = Object.keys(query.filters || {});
  const projection = query.fields ? [...new Set([...query.fields, ...filterFields, 'reportingScopeKeys'])] : undefined;
  const filtered = (await queryVisibleUsers([...keys], projection)).filter(row => recordMatches(row, query.filters));
  const offset = Number(query.offset || 0);
  const limit = query.limit != null ? Number(query.limit) : filtered.length;
  const records = filtered.slice(offset, offset + limit).map(row => presentUser(row, query.fields));
  return { records, hasMore: offset + records.length < filtered.length };
}

async function findDashboardGuide(guideId: string): Promise<any | null> {
  const requested = new Set(hierarchyRefs(guideId));
  const raw = String(guideId).trim();
  const userFields = [...USER_CHAIN_FIELDS, 'reportingScopeKeys'];
  const byId = await Users.findOne({ id: raw, fields: userFields });
  let user = byId && isUserInHierarchy(byId, requested) ? byId : null;
  if (!user) {
    const byUserId = await Users.findAll({ filters: { userId: raw }, fields: userFields, limit: 5 });
    user = byUserId.records.find((row: any) => isUserInHierarchy(row, requested)) || null;
  }
  if (!user && raw.includes('@')) {
    const byEmail = await Users.findAll({ filters: { email: raw }, fields: userFields, limit: 5 });
    user = byEmail.records.find((row: any) => hierarchyRefs(row.email).includes(raw.toLowerCase())) || null;
  }
  const guideById = await Guides.findOne({ id: raw, fields: GUIDE_CHAIN_FIELDS });
  let guide = guideById && hierarchyRefs([guideById.id, guideById.guideId, guideById.email]).some(ref => requested.has(ref)) ? guideById : null;
  if (!guide) {
    const byGuideId = await Guides.findAll({ filters: { guideId: raw }, fields: GUIDE_CHAIN_FIELDS, limit: 5 });
    guide = byGuideId.records.find((row: any) => hierarchyRefs([row.id, row.guideId, row.email]).some(ref => requested.has(ref))) || null;
  }
  if (!user && guide?.email) {
    const byEmail = await Users.findAll({ filters: { email: guide.email }, fields: userFields, limit: 5 });
    user = byEmail.records.find((row: any) => hierarchyRefs(row.email).includes(String(guide.email).toLowerCase())) || null;
  }
  if (user) return user;
  if (guide) return { ...guide, segment: guide.segment || 'FOLK' };
  return null;
}

/** Never fail open: a failed authorization lookup must fail the request. */
export async function getScopedHierarchyUserIds(contextUser: any): Promise<Set<string> | null> {
  if (!contextUser) return new Set();
  if (isHierarchySuperAdmin(contextUser)) return null;
  if (getFirestoreDb()) {
    if (!(await reportingChainsReady())) await refreshReportingChains();
    if (await reportingChainsReady()) return queryScope(contextUser);
  }
  const graph = await loadHierarchyGraph(department(contextUser) === 'FOLK');
  return resolveHierarchyScope(contextUser, graph.users, graph.groups, graph.memberships, graph.guides, graph.residencies);
}

/** A selected guide narrows super-admin reports using the same hierarchy,
 * including aliases and indirect members. Ordinary callers cannot widen it. */
export async function getDashboardHierarchyScope(contextUser: any, guideId?: string): Promise<Set<string> | null> {
  if (!isHierarchySuperAdmin(contextUser) || !guideId || guideId.toUpperCase() === 'ALL') {
    return getScopedHierarchyUserIds(contextUser);
  }
  if (getFirestoreDb()) {
    const target = await findDashboardGuide(guideId);
    if (!target) return new Set();
    return getScopedHierarchyUserIds({ ...target, role: 'ADMIN', isBvAdmin: true, isBvSuperAdmin: false });
  }
  const requested = new Set(hierarchyRefs(guideId));
  const [users, guides] = await Promise.all([
    readAll(Users, [...HIERARCHY_IDENTITY_FIELDS, 'segment', 'isPrabhupadaWorldUser', 'folkResidencies']),
    readAll(Guides, ['id', 'guideId', 'email', 'folkResidencies']),
  ]);
  const guide = guides.find(row => hierarchyRefs([row.id, row.guideId, row.email]).some(ref => requested.has(ref)));
  const target = users.find(row => isUserInHierarchy(row, requested) || (guide?.email && hierarchyRefs(row.email).includes(String(guide.email).toLowerCase())));
  if (!target && !guide) return new Set();
  return getScopedHierarchyUserIds({ ...(target || { ...guide, segment: 'FOLK' }), role: 'ADMIN', isBvAdmin: true, isBvSuperAdmin: false });
}
