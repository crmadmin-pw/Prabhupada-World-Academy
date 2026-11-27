import { BvGroups, BvGroupMembers } from '@/lib/backend-sdk';
import { organizationalDepartment } from './directoryDepartment';
import { hierarchyAliases, hierarchyRefs } from './hierarchyUtils';
import { isPwSadhanaAdmin } from './pwSadhanaPrivacy';
import { normalizeProfileRole } from './userDashboardRoutes';

/** A PW Admin can share read access with another Admin in their group. An
 * assigned RGF can also read the Sadhana of an Admin assigned there as RGSF. */
export function pwSadhanaGroupAccess(actor: any, groupId?: string) {
  const actorIds = new Set(hierarchyAliases(actor));
  const isAdmin = isPwSadhanaAdmin(actor);
  const isRgf = actor?.isBvFacilitator === true || actor?.isBvsl === true ||
    ['RGF', 'BVSL', 'FACILITATOR', 'BV_FACILITATOR'].includes(normalizeProfileRole(actor?.role));
  let scope: ReturnType<typeof loadScope> | undefined;

  async function loadScope() {
    const requestedGroup = String(groupId || '').trim().toLowerCase();
    const { records } = await BvGroups.findAll({
      fields: ['id', 'groupId', 'segment', 'isActive', 'bvslLeader', 'bvslId', 'subFacilitatorId', 'rgsfId'],
      limit: 1000,
    });
    const groups = records.filter(group => group.isActive !== false &&
      organizationalDepartment(group) === 'PW' &&
      (!requestedGroup || hierarchyRefs([group.id, group.groupId]).includes(requestedGroup)));
    const permitted = new Set<string>();
    for (const group of groups) {
      if (isRgf && hierarchyRefs([group.bvslLeader, group.bvslId]).some(id => actorIds.has(id))) {
        hierarchyRefs([group.subFacilitatorId, group.rgsfId]).forEach(id => permitted.add(id));
      }
    }
    if (!isAdmin || groups.length === 0) return permitted;

    // Match real roster rows and group staff IDs. Display names and the
    // profile's cached group pointer are not evidence of shared membership.
    const membersByGroup = new Map<string, Set<string>>();
    const groupIdByAlias = new Map<string, string>();
    for (const group of groups) {
      const ids = hierarchyRefs([group.bvslLeader, group.bvslId, group.subFacilitatorId, group.rgsfId]);
      membersByGroup.set(group.id, new Set(ids));
      hierarchyRefs([group.id, group.groupId]).forEach(alias => groupIdByAlias.set(alias, group.id));
    }
    for (let offset = 0; ; offset += 500) {
      const page = await BvGroupMembers.findAll({
        fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId', 'isActive', 'status'],
        limit: 500,
        offset,
      });
      for (const row of page.records) {
        if (row.isActive === false || ['INACTIVE', 'REMOVED', 'LEFT'].includes(normalizeProfileRole(row.status))) continue;
        const groupIds = hierarchyRefs([row.group, row.groupId]).map(alias => groupIdByAlias.get(alias));
        // A row with conflicting group references cannot establish access.
        const groupId = groupIds[0];
        if (!groupId || groupIds.some(id => id !== groupId)) continue;
        const members = membersByGroup.get(groupId);
        hierarchyRefs([row.user, row.userId, row.memberId]).forEach(id => members?.add(id));
      }
      if (!page.hasMore || !page.records.length) break;
    }
    for (const members of membersByGroup.values()) {
      if ([...actorIds].some(id => members.has(id))) members.forEach(id => permitted.add(id));
    }
    return permitted;
  }

  return async (subject: any): Promise<boolean> => {
    if (!isPwSadhanaAdmin(subject) || organizationalDepartment(actor) !== 'PW' ||
      normalizeProfileRole(actor?.status) !== 'ACTIVE' ||
      normalizeProfileRole(subject?.status) !== 'ACTIVE' ||
      actorIds.size === 0 || (!isAdmin && !isRgf)) return false;
    const subjectIds = hierarchyAliases(subject);
    if (subjectIds.some(id => actorIds.has(id))) return false;
    const allowedIds = await (scope ??= loadScope());
    return subjectIds.some(id => allowedIds.has(id));
  };
}
