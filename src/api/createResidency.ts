import { organizationalDepartment, normalizeDepartmentToken } from '../lib/directoryDepartment';
import { z } from 'zod';
import { createEndpoint, FolkResidencies, AppError } from '@/lib/backend-sdk';
import { invalidateServiceReferenceData } from '../lib/serviceReferenceData';

export default createEndpoint({
  description: 'Create a FOLK hostel (Super Guide access required)',
  authenticated: true,
  requiredCapabilities: 'roles.assign',
  inputSchema: z.object({
    residencyName: z.string().trim().min(1).max(100),
    capacity: z.number().int().min(0).optional(),
    guideId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    if (organizationalDepartment(context.user) !== 'FOLK' || normalizeDepartmentToken(context.user.role) !== 'SUPERGUIDE') {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only a FOLK Super Guide can create a hostel' });
    }
    const { records: existing } = await FolkResidencies.findAll({ fields: ['residencyName'], limit: 1000 });
    if (existing.some(r => String(r.residencyName || '').trim().toLowerCase() === input.residencyName.trim().toLowerCase())) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'A hostel with this name already exists' });
    }

    const record = await FolkResidencies.create({
      record: {
        residencyName: input.residencyName.trim(),
        category: 'FOLK',
        segment: 'FOLK',
        guideIds: [],
        maxCapacity: input.capacity || 0,
        isActive: true,
      },
    });
    invalidateServiceReferenceData();

    return { success: true, residencyId: record.id };
  },
});
