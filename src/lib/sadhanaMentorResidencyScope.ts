import { FolkResidencies, Users } from '@/lib/backend-sdk';
import { hierarchyAliases, hierarchyRefs } from './hierarchyUtils';
import { isPwSadhanaUser } from './sadhanaDepartment';

/** Explicit, server-managed FOLK mentor access. Used only by Sadhana reports. */
export async function getSadhanaMentorResidencyScope(caller: any) {
  if (!caller?.isSadhanaMentor && String(caller?.role).toUpperCase().replace(/[\s-]+/g, '_') !== 'SADHANA_MENTOR') return null;
  const fields = ['id', 'userId', 'email', 'role', 'status', 'segment', 'isPrabhupadaWorldUser', 'isSadhanaMentor', 'sadhanaMentorResidencyIds'];
  const stored = await Users.findOne({ id: caller.id, fields }) || (caller.email
    ? await Users.findOne({ filters: { email: caller.email }, fields }) : null);
  if (!stored || isPwSadhanaUser(stored) || stored.sadhanaMentorResidencyIds == null) return null;
  const assigned = new Set(hierarchyRefs(stored.sadhanaMentorResidencyIds));
  const { records } = await FolkResidencies.findAll({ fields: ['id', 'residencyId', 'residencyName', 'isActive'], limit: 500 });
  const enabled = stored.isSadhanaMentor === true && String(stored.status).toLowerCase() === 'active';
  const residencies = enabled ? records.filter((r: any) =>
    r.isActive !== false && r.isActive !== 'false' && !/prabhupada world|^pw\s/i.test(r.residencyName || '') &&
    hierarchyRefs([r.id, r.residencyId, r.residencyName]).some(ref => assigned.has(ref))) : [];
  const residencyRefs = new Set(residencies.flatMap((r: any) => hierarchyRefs([r.id, r.residencyId, r.residencyName])));
  const self = new Set([...hierarchyAliases(stored), ...hierarchyAliases(caller)]);
  return {
    residencies,
    includes: (user: any) => {
      const role = String(user.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      return !isPwSadhanaUser(user) && String(user.status).toLowerCase() === 'active' &&
        Boolean(user.userId && String(user.fullName || '').trim()) &&
        !user.isBvAdmin && !user.isBvSuperAdmin &&
        !['GUIDE', 'SUPER_GUIDE', 'SUPERGUIDE', 'ADMIN', 'ADMINISTRATOR', 'SUPER_ADMIN', 'SUPERADMIN', 'SUPER_ADMINISTRATOR', 'PW_ADMIN', 'PW_SUPER_ADMIN', 'PW_SUPERADMIN'].includes(role) &&
        !hierarchyAliases(user).some(ref => self.has(ref)) &&
        hierarchyRefs(user.residency).some(ref => residencyRefs.has(ref));
    },
  };
}
