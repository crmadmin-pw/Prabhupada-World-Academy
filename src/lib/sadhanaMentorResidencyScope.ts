import { FolkResidencies, Guides, Users } from '@/lib/backend-sdk';
import { hierarchyAliases, hierarchyRefs } from './hierarchyUtils';
import { isPwSadhanaUser } from './sadhanaDepartment';
import { getUserDepartment } from './userDashboardRoutes';

/** FOLK Sadhana scope: self, assigned residencies and the linked guide's boys. */
export async function getSadhanaMentorResidencyScope(caller: any) {
  if (!caller?.isSadhanaMentor && String(caller?.role).toUpperCase().replace(/[\s-]+/g, '_') !== 'SADHANA_MENTOR') return null;
  if (isPwSadhanaUser(caller)) return null;
  const fields = ['id', 'userId', 'email', 'role', 'status', 'segment', 'isPrabhupadaWorldUser', 'isSadhanaMentor', 'sadhanaMentorResidencyIds', 'guide', 'selectedGuideId'];
  const stored = await Users.findOne({ id: caller.id, fields }) || (caller.email
    ? await Users.findOne({ filters: { email: caller.email }, fields }) : null);
  if (!stored || getUserDepartment({ ...caller, ...stored }) !== 'FOLK') return null;
  const assigned = new Set(hierarchyRefs(stored.sadhanaMentorResidencyIds));
  const { records } = await FolkResidencies.findAll({ fields: ['id', 'residencyId', 'residencyName', 'isActive'], limit: 500 });
  const enabled = stored.isSadhanaMentor === true && String(stored.status).toLowerCase() === 'active';
  const residencies = enabled ? records.filter((r: any) =>
    r.isActive !== false && r.isActive !== 'false' && !/prabhupada world|^pw\s/i.test(r.residencyName || '') &&
    hierarchyRefs([r.id, r.residencyId, r.residencyName]).some(ref => assigned.has(ref))) : [];
  const residencyRefs = new Set(residencies.flatMap((r: any) => hierarchyRefs([r.id, r.residencyId, r.residencyName])));
  const self = new Set([...hierarchyAliases(stored), ...hierarchyAliases(caller)]);
  const guideRefs = new Set(hierarchyRefs(stored.guide || stored.selectedGuideId));
  for (const ref of [...guideRefs]) {
    const linked = await Users.findOne({ id: ref, fields: ['id', 'userId', 'email'] }) ||
      await Users.findOne({ filters: { userId: ref }, fields: ['id', 'userId', 'email'] }) ||
      await Users.findOne({ filters: { email: ref }, fields: ['id', 'userId', 'email'] });
    hierarchyAliases(linked).forEach(alias => guideRefs.add(alias));
  }
  const { records: guides } = await Guides.findAll({ fields: ['id', 'guideId', 'email', 'fullName'], limit: 500 });
  for (const guide of guides) {
    const aliases = hierarchyRefs([guide.id, guide.guideId, guide.email, guide.fullName]);
    if (!aliases.some(ref => guideRefs.has(ref))) continue;
    aliases.forEach(ref => guideRefs.add(ref));
    if (guide.email) {
      const linked = await Users.findOne({ filters: { email: guide.email }, fields: ['id', 'userId', 'email'] });
      hierarchyAliases(linked).forEach(ref => guideRefs.add(ref));
    }
  }
  const isSelf = (user: any) => hierarchyAliases(user).some(ref => self.has(ref));
  return {
    residencies,
    isSelf,
    includes: (user: any) => {
      const role = String(user.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      return enabled && !isPwSadhanaUser(user) && String(user.status).toLowerCase() === 'active' &&
        Boolean(user.userId && String(user.fullName || '').trim()) &&
        !user.isBvAdmin && !user.isBvSuperAdmin &&
        !['GUIDE', 'SUPER_GUIDE', 'SUPERGUIDE', 'ADMIN', 'ADMINISTRATOR', 'SUPER_ADMIN', 'SUPERADMIN', 'SUPER_ADMINISTRATOR', 'PW_ADMIN', 'PW_SUPER_ADMIN', 'PW_SUPERADMIN'].includes(role) &&
        (isSelf(user) || hierarchyRefs(user.residency).some(ref => residencyRefs.has(ref)) ||
          hierarchyRefs(user.guide).some(ref => guideRefs.has(ref)));
    },
  };
}
