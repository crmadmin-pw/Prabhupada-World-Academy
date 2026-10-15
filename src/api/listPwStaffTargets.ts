import { z } from 'zod';
import { createEndpoint, Users, AppError } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, isUserInHierarchy } from '@/lib/hierarchyUtils';
import { isPwSadhanaUser } from '@/lib/sadhanaDepartment';
import { readPwTargets, withLegacyTargets } from '@/lib/pwSadhana';
import { isPwAdmin, isPwRgf, isPwSupervisor, pwTargetSource } from '@/lib/pwTargetResolver';

const FIELDS = ['id', 'userId', 'fullName', 'email', 'segment', 'isPrabhupadaWorldUser', 'role',
  'isBvFacilitator', 'isBvsl', 'isBvSupervisor', 'ashrayLevel', 'pwTargets', 'pwChantingTarget', 'pwReadingTarget'];

export default createEndpoint({
  description: 'RGFs and supervisors whose sadhana targets are set by an admin',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!isPwAdmin(context.user)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only a Prabhupada World admin can view these targets' });
    }
    const scope = await getScopedHierarchyUserIds(context.user);
    const [facilitators, leaders, supervisors] = await Promise.all([
      Users.findAll({ filters: { isBvFacilitator: true }, fields: FIELDS, limit: 300 }),
      Users.findAll({ filters: { isBvsl: true }, fields: FIELDS, limit: 300 }),
      Users.findAll({ filters: { isBvSupervisor: true }, fields: FIELDS, limit: 300 }),
    ]);
    const people = new Map<string, any>();
    for (const row of [...facilitators.records, ...leaders.records, ...supervisors.records]) {
      if (!row?.id || !isUserInHierarchy(row, scope)) continue;
      if (!isPwSadhanaUser(row) && String(row.segment || '').toUpperCase() === 'FOLK') continue;
      if (pwTargetSource(row) !== 'admin') continue;
      people.set(String(row.id), row);
    }
    const members = [...people.values()]
      .map(member => ({
        userId: member.userId || member.id,
        fullName: member.fullName || '',
        ashrayLevel: member.ashrayLevel || null,
        roleLabel: isPwSupervisor(member) && !isPwRgf(member) ? 'Supervisor' : 'RGF',
        pwTargets: withLegacyTargets(readPwTargets(member.pwTargets), member),
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    return { members };
  },
});
