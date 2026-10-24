import { z } from 'zod';
import { createEndpoint, AppError } from '@/lib/backend-sdk';
import { organizationalDepartment } from '@/lib/directoryDepartment';
import { readAshrayExamDate, type AshrayDepartment } from './ashrayExamDate';

function canEditAshraySchedule(user: any): boolean {
  const role = String(user?.role || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
  return ['GUIDE', 'SUPER_GUIDE', 'ADMIN', 'SUPER_ADMIN', 'PW_ADMIN', 'RGF', 'BVSL', 'FACILITATOR'].includes(role) ||
    user?.isBvAdmin === true || user?.isBvSuperAdmin === true || user?.isBvFacilitator === true || user?.isBvsl === true;
}

function assertScheduleAccess(user: any, segment: AshrayDepartment) {
  if (!canEditAshraySchedule(user)) throw new AppError({ code: 'FORBIDDEN', message: 'Admin or guide access required' });
  if (user?.isBvSuperAdmin === true || ['SUPER_ADMIN', 'SUPER_GUIDE'].includes(String(user?.role || '').trim().replace(/[\s-]+/g, '_').toUpperCase())) return;
  const callerDepartment = organizationalDepartment(user);
  if (callerDepartment && callerDepartment !== segment) {
    throw new AppError({ code: 'FORBIDDEN', message: 'You can only manage your department schedule' });
  }
}

export default createEndpoint({
  description: 'Read the department-specific next Ashraya exam date',
  authenticated: true,
  inputSchema: z.object({ segment: z.enum(['FOLK', 'PW']) }),
  outputSchema: z.object({ segment: z.enum(['FOLK', 'PW']), examDate: z.string() }),
  execute: async ({ input, context }: any) => {
    assertScheduleAccess(context.user, input.segment);
    return { segment: input.segment, examDate: await readAshrayExamDate(input.segment) };
  },
});
