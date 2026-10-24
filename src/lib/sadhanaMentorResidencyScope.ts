import { Users } from '@/lib/backend-sdk';
import { hierarchyAliases, hierarchyRefs } from './hierarchyUtils';
import { isPwSadhanaUser } from './sadhanaDepartment';
import { getUserDepartment } from './userDashboardRoutes';
import { isActiveFolkResidency } from './residencyCategory';
import { buildFolkHostelSadhanaScope, loadFolkHostelSadhanaGraph, resolveFolkHostelGuides } from './folkHostelSadhanaScope';

/** Read-only FOLK Sadhana scope: the mentor's assigned hostel, across guides.
 * A shared parent guide must never extend access into another hostel. */
export async function getSadhanaMentorResidencyScope(caller: any) {
  if (!caller?.isSadhanaMentor && String(caller?.role).toUpperCase().replace(/[\s-]+/g, '_') !== 'SADHANA_MENTOR') return null;
  if (isPwSadhanaUser(caller)) return null;
  const fields = ['id', 'userId', 'email', 'role', 'status', 'segment', 'isFolkUser', 'isPrabhupadaWorldUser', 'isSadhanaMentor', 'sadhanaMentorResidencyIds', 'guide', 'selectedGuideId', 'residency', 'selectedFolkResidency'];
  const stored = await Users.findOne({ id: caller.id, fields }) || (caller.email
    ? await Users.findOne({ filters: { email: caller.email }, fields }) : null);
  if (!stored || getUserDepartment({ ...caller, ...stored }) !== 'FOLK') return null;
  const assigned = new Set(hierarchyRefs(stored.residency || stored.selectedFolkResidency || stored.sadhanaMentorResidencyIds));
  const { guides, users, centers: records } = await loadFolkHostelSadhanaGraph();
  const enabled = stored.isSadhanaMentor === true && String(stored.status).toLowerCase() === 'active';
  const parents = resolveFolkHostelGuides(stored.guide || stored.selectedGuideId, guides, users);
  const parentScopes = enabled ? parents.map(parent => buildFolkHostelSadhanaScope(parent, guides, users, records)) : [];
  const residencies = enabled ? records.filter((r: any) =>
    isActiveFolkResidency(r) &&
    hierarchyRefs([r.id, r.residencyId, r.residencyName, r.legacyNames]).some(ref => assigned.has(ref))) : [];
  const residencyRefs = new Set(residencies.flatMap((r: any) => hierarchyRefs([r.id, r.residencyId, r.residencyName, r.legacyNames])));
  const self = new Set([...hierarchyAliases(stored), ...hierarchyAliases(caller)]);
  const isSelf = (user: any) => hierarchyAliases(user).some(ref => self.has(ref));
  const selectedScopes = parentScopes.filter(scope => scope.residencies.some(r => residencies.some(selected => selected.id === r.id)));
  const availableGuides = [...new Map(selectedScopes.flatMap(scope => scope.availableGuides).map(guide => [guide.guideId, guide])).values()]
    .sort((a, b) => a.guideName.localeCompare(b.guideName));
  return {
    residencies,
    isSelf,
    availableGuides,
    guideNameFor: (user: any) => selectedScopes.map(scope => scope.guideNameFor(user)).find(Boolean) || '',
    matchesGuide: (user: any, selected: string) => selectedScopes.some(scope => scope.matchesGuide(user, selected)),
    includes: (user: any) => {
      const role = String(user.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      return enabled && !isPwSadhanaUser(user) && String(user.status).toLowerCase() === 'active' &&
        Boolean(user.userId && String(user.fullName || '').trim()) &&
        !user.isBvAdmin && !user.isBvSuperAdmin &&
        !['GUIDE', 'SUPER_GUIDE', 'SUPERGUIDE', 'ADMIN', 'ADMINISTRATOR', 'SUPER_ADMIN', 'SUPERADMIN', 'SUPER_ADMINISTRATOR', 'PW_ADMIN', 'PW_SUPER_ADMIN', 'PW_SUPERADMIN'].includes(role) &&
        (isSelf(user) || hierarchyRefs(user.residency || user.selectedFolkResidency).some(ref => residencyRefs.has(ref)));
    },
  };
}
