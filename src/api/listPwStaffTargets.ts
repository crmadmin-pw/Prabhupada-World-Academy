import { z } from 'zod';
import { createEndpoint, Users, AppError } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, isUserInHierarchy } from '@/lib/hierarchyUtils';
import { isPwSadhanaUser } from '@/lib/sadhanaDepartment';
import { isPwAdmin, isPwRgf, isPwSupervisor, pwTargetSource, resolvePwTargetsForUser } from '@/lib/pwTargetResolver';
import { isPwSadhanaAdmin, isPwSuperAdmin, PW_SADHANA_PRIVACY_FIELDS } from '@/lib/pwSadhanaPrivacy';
import { getUserDepartment } from '@/lib/userDashboardRoutes';

const FIELDS = [...PW_SADHANA_PRIVACY_FIELDS, 'id', 'userId', 'fullName', 'email', 'segment', 'isPrabhupadaWorldUser', 'role',
  'isBvFacilitator', 'isBvsl', 'isBvSupervisor', 'ashrayLevel', 'pwTargets', 'pwChantingTarget', 'pwReadingTarget'];

export default createEndpoint({
  description: 'Staff sadhana targets, including admin targets visible only to PW super admins',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    if (getUserDepartment(context.user) !== 'PW' || !isPwAdmin(context.user)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only a Prabhupada World admin can view these targets' });
    }
    const scope = await getScopedHierarchyUserIds(context.user);
    const records: any[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await Users.findAll({ filters: { status: 'Active' }, fields: FIELDS, limit: 500, offset });
      records.push(...page.records);
      if (!page.hasMore) break;
    }
    const people = new Map<string, any>();
    for (const row of records) {
      if (!row?.id || !isUserInHierarchy(row, scope)) continue;
      if (!isPwSadhanaUser(row) && String(row.segment || '').toUpperCase() === 'FOLK') continue;
      if (isPwSuperAdmin(row)) continue;
      if (isPwSadhanaAdmin(row)) {
        if (!isPwSuperAdmin(context.user)) continue;
      } else if (pwTargetSource(row) !== 'admin') continue;
      people.set(String(row.id), row);
    }
    const members = (await Promise.all([...people.values()]
      .map(async member => ({
        userId: member.userId || member.id,
        fullName: member.fullName || '',
        ashrayLevel: member.ashrayLevel || null,
        roleLabel: isPwSadhanaAdmin(member) ? 'Admin' : isPwSupervisor(member) && !isPwRgf(member) ? 'Supervisor' : 'RGF',
        pwTargets: (await resolvePwTargetsForUser(member)).targets,
      }))))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    return { members };
  },
});
