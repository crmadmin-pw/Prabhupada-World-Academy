import { FolkResidencies, Guides, Users } from '@/lib/backend-sdk';
import { organizationalDepartment, normalizeDepartmentToken } from './directoryDepartment';
import { isActiveFolkResidency } from './residencyCategory';

export function hostelRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(hostelRefs);
  return String(value ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
}
const identities = (r: any) => hostelRefs([r?.id, r?.userId, r?.guideId, r?.email, r?.fullName]);
const intersects = (refs: string[], values: Set<string>) => refs.some(ref => values.has(ref));
export const isFolkHostelGuide = (caller: any) => organizationalDepartment(caller) === 'FOLK' && normalizeDepartmentToken(caller?.role) === 'GUIDE';

function folkHostelGuideEntries(guides: any[], users: any[]) {
  const activeGuides = guides.filter(g => g.isActive !== false && organizationalDepartment(g) !== 'PW');
  const people = users.filter(u => String(u.status).toLowerCase() === 'active' && organizationalDepartment(u) === 'FOLK' && ['GUIDE', 'SUPERGUIDE'].includes(normalizeDepartmentToken(u.role)));
  const entries = people.map(u => {
    const linked = activeGuides.filter(g => g.email && hostelRefs(g.email)[0] === hostelRefs(u.email)[0]);
    return { user: u, linked, refs: new Set(identities(u).concat(linked.flatMap(identities))), id: String(linked[0]?.id || u.id), name: String(u.fullName || linked[0]?.fullName || u.email) };
  });
  // A legacy name or public ID shared by different people is not an access grant.
  const owners = new Map<string, Set<number>>();
  entries.forEach((entry, index) => entry.refs.forEach(ref => {
    if (!owners.has(ref)) owners.set(ref, new Set());
    owners.get(ref)!.add(index);
  }));
  entries.forEach(entry => entry.refs.forEach(ref => {
    if (owners.get(ref)!.size > 1) entry.refs.delete(ref);
  }));
  return entries;
}

/** Resolve a mentor's stored parent references using the same guide identities
 * and ambiguity checks as the hostel report itself. */
export function resolveFolkHostelGuides(references: unknown, guides: any[], users: any[]) {
  const requested = new Set(hostelRefs(references));
  return folkHostelGuideEntries(guides, users)
    .filter(entry => intersects([...entry.refs], requested))
    .map(entry => entry.user);
}

/** Read-only report permission. Never reuse this scope for member management. */
export function buildFolkHostelSadhanaScope(caller: any, guides: any[], users: any[], centers: any[]) {
  const entries = folkHostelGuideEntries(guides, users);
  const own = entries.find(e => intersects(hostelRefs([caller.id, caller.email]), e.refs))
    || entries.find(e => intersects(hostelRefs(caller.userId), e.refs));
  const hostels = centers.filter(isActiveFolkResidency);
  const assigned = (entry: typeof entries[number], center: any) => {
    // Explicit hostel-side assignments are authoritative, including an empty list.
    if (Array.isArray(center.guideIds)) return intersects(hostelRefs(center.guideIds), entry.refs);
    const refs = new Set(hostelRefs([center.id, center.residencyId, center.residencyName]));
    return intersects(hostelRefs([entry.user.folkResidencies, ...entry.linked.map(g => g.folkResidencies)]), refs)
      || intersects(hostelRefs(center.guides), entry.refs);
  };
  const residencies = own ? hostels.filter(center => assigned(own, center)) : [];
  const residencyRefs = new Set(residencies.flatMap(r => hostelRefs([r.id, r.residencyId, r.residencyName, r.legacyNames])));
  const peers = entries.filter(entry => residencies.some(center => assigned(entry, center)));
  const guideRefs = new Set([...(own?.refs || []), ...peers.flatMap(e => [...e.refs])]);
  return {
    residencies,
    availableGuides: peers.map(e => ({ guideId: e.id, guideName: e.name })).sort((a, b) => a.guideName.localeCompare(b.guideName)),
    guideNameFor: (user: any) => [own, ...peers].find(entry => entry && intersects(hostelRefs(user.guide), entry.refs))?.name || '',
    includes: (user: any) => !!own && organizationalDepartment(user) !== 'PW' && String(user.status).toLowerCase() === 'active' &&
      !['GUIDE', 'SUPERGUIDE', 'ADMIN', 'SUPERADMIN', 'PWADMIN'].includes(normalizeDepartmentToken(user.role)) &&
      !user.isBvAdmin && !user.isBvSuperAdmin &&
      (intersects(hostelRefs(user.guide), guideRefs) || intersects(hostelRefs(user.residency), residencyRefs) ||
        (user.temporaryResidencyEnabled === true && intersects(hostelRefs(user.temporaryResidency), residencyRefs))),
    matchesGuide: (user: any, selected: string) => {
      const peer = peers.find(e => e.refs.has(selected.trim().toLowerCase()));
      return !!peer && intersects(hostelRefs(user.guide), peer.refs);
    },
  };
}

async function allRows(table: any, fields: string[]) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await table.findAll({ fields, limit: 1000, offset });
    rows.push(...page.records);
    if (!page.hasMore) return rows;
  }
}
export async function loadFolkHostelSadhanaGraph() {
  const fields = ['id', 'userId', 'guideId', 'email', 'fullName', 'role', 'status', 'isActive', 'segment', 'isPrabhupadaWorldUser', 'isFolkUser', 'folkResidencies'];
  const [guides, users, centers] = await Promise.all([
    allRows(Guides, fields), allRows(Users, fields),
    allRows(FolkResidencies, ['id', 'residencyId', 'residencyName', 'isActive', 'category', 'segment', 'guides', 'guideIds', 'legacyNames']),
  ]);
  return { guides, users, centers };
}

export async function getFolkHostelSadhanaScope(caller: any) {
  if (!isFolkHostelGuide(caller)) return null;
  const { guides, users, centers } = await loadFolkHostelSadhanaGraph();
  return buildFolkHostelSadhanaScope(caller, guides, users, centers);
}

export async function readFolkHostelSadhanaUsers(scope: Pick<ReturnType<typeof buildFolkHostelSadhanaScope>, 'includes' | 'matchesGuide'>, fields: string[], selectedGuide?: string) {
  const rows = await allRows(Users, [...new Set([...fields, 'userId', 'fullName', 'status', 'segment', 'role', 'isBvAdmin', 'isBvSuperAdmin', 'isPrabhupadaWorldUser', 'guide', 'residency', 'selectedFolkResidency', 'temporaryResidency', 'temporaryResidencyEnabled'])]);
  const seen = new Set<string>();
  return rows.filter(user => {
    if (!scope.includes(user) || (selectedGuide && !scope.matchesGuide(user, selectedGuide))) return false;
    const refs = hostelRefs([user.id, user.userId, user.email]);
    if (intersects(refs, seen)) return false;
    refs.forEach(ref => seen.add(ref));
    return true;
  });
}
