import { z } from 'zod';
import { createEndpoint, Config, AppError } from '@/lib/backend-sdk';
import { serverCacheInvalidate } from '@/lib/serverCache';
import { organizationalDepartment } from '@/lib/directoryDepartment';
import { examConfigKey, normalizeAshrayExamDate } from './ashrayExamDate';

function canEditAshraySchedule(user: any): boolean {
  const role = String(user?.role || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
  return ['GUIDE', 'SUPER_GUIDE', 'ADMIN', 'SUPER_ADMIN', 'PW_ADMIN', 'RGF', 'BVSL', 'FACILITATOR'].includes(role) ||
    user?.isBvAdmin === true || user?.isBvSuperAdmin === true || user?.isBvFacilitator === true || user?.isBvsl === true;
}

export default createEndpoint({
  description: 'Set the department-specific next Ashraya exam date',
  authenticated: true,
  inputSchema: z.object({ segment: z.enum(['FOLK', 'PW']), examDate: z.string().max(30) }),
  outputSchema: z.object({ success: z.boolean(), segment: z.enum(['FOLK', 'PW']), examDate: z.string() }),
  execute: async ({ input, context }: any) => {
    if (!canEditAshraySchedule(context.user)) throw new AppError({ code: 'FORBIDDEN', message: 'Admin or guide access required' });
    const role = String(context.user?.role || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
    const elevated = context.user?.isBvSuperAdmin === true || ['SUPER_ADMIN', 'SUPER_GUIDE'].includes(role);
    if (!elevated && organizationalDepartment(context.user) !== input.segment) {
      throw new AppError({ code: 'FORBIDDEN', message: 'You can only manage your department schedule' });
    }
    const examDate = normalizeAshrayExamDate(input.examDate);
    const configKey = examConfigKey(input.segment);
    const existing = await Config.findOne({ filters: { configKey }, fields: ['id'] });
    if (existing?.id) await Config.update({ id: existing.id, record: { configKey, configValue: examDate } });
    else await Config.create({ record: { configKey, configValue: examDate } });
    serverCacheInvalidate();
    return { success: true, segment: input.segment, examDate };
  },
});
