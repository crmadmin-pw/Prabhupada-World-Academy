import { z } from 'zod';
import { createEndpoint, Services, AppError } from '@/lib/backend-sdk';
import { invalidateServiceReferenceData } from '../lib/serviceReferenceData';
import { assertCanManageServices } from '../lib/serviceManagementAccess';

export default createEndpoint({
  description: 'Soft delete (deactivate) a service',
  authenticated: true,
  inputSchema: z.object({
    serviceId: z.string(),
    rowId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    assertCanManageServices(context.user);
    const service = await Services.findOne({ id: input.serviceId });
    if (!service) throw new AppError({ code: 'NOT_FOUND', message: 'Service not found' });

    await Services.update({ id: input.serviceId, record: { isActive: false } });
    invalidateServiceReferenceData();

    return { success: true };
  },
});
