import { z } from 'zod';
import { createEndpoint, Users } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, isHierarchySuperAdmin, isPwDepartmentAdmin, isUserInHierarchy, readScopedUsers } from '../lib/hierarchyUtils';
import { isPwSadhanaUser } from '../lib/sadhanaDepartment';

const MENTOR_FIELDS = ['id', 'userId', 'fullName', 'email', 'isSadhanaMentor', 'role', 'segment', 'isPrabhupadaWorldUser'];

function isSadhanaMentorRecord(user: any): boolean {
  const role = String(user?.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return user?.isSadhanaMentor === true || String(user?.isSadhanaMentor).toLowerCase() === 'true' || role === 'SADHANA_MENTOR';
}

function mentorDepartment(user: any): 'PW' | 'FOLK' | '' {
  if (isPwSadhanaUser(user)) return 'PW';
  const segment = String(user?.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  return segment === 'FOLK' ? 'FOLK' : '';
}

async function readActiveUsers(load: (offset: number) => Promise<{ records?: any[]; hasMore?: boolean }>): Promise<any[]> {
  const records: any[] = [];
  for (let offset = 0; ;) {
    const page = await load(offset);
    const batch = page.records || [];
    records.push(...batch);
    if (!page.hasMore || !batch.length) return records;
    const next = offset + batch.length;
    if (next <= offset) return records;
    offset = next;
  }
}

export default createEndpoint({
  description: 'Get all active Sadhana Mentors',
  authenticated: true,
  inputSchema: z.object({
    segment: z.enum(['PW', 'FOLK', 'ALL']).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    // Assignment lists follow the member directory. A Prabhupada World admin
    // can assign any active PW mentor, including people outside their own
    // reporting chain. Other callers stay inside that chain.
    const departmentWide = isHierarchySuperAdmin(context.user) || isPwDepartmentAdmin(context.user);
    const scope = departmentWide ? null : await getScopedHierarchyUserIds(context.user);
    const query = { filters: { status: 'Active' }, fields: MENTOR_FIELDS, limit: 2000 };
    const records = await readActiveUsers(offset => departmentWide
      ? Users.findAll({ ...query, offset })
      : readScopedUsers(context.user, { ...query, offset }));

    const mentors = records
      .filter(user => isUserInHierarchy(user, scope))
      .filter(isSadhanaMentorRecord)
      .map((user: any) => ({
        userId: user.id || user.userId,
        fullName: user.fullName || '',
        email: user.email || '',
        segment: mentorDepartment(user),
      }))
      .filter((mentor: any) => mentor.segment)
      .sort((a: any, b: any) => String(a.fullName).localeCompare(String(b.fullName)));

    if (input.segment && input.segment !== 'ALL') {
      return mentors.filter((mentor: any) => mentor.segment === input.segment);
    }
    return mentors;
  },
});
