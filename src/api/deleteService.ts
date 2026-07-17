import { z } from 'zod';
import { createEndpoint, Services, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Soft delete (deactivate) a service',
  authenticated: true,
  inputSchema: z.object({
    serviceId: z.string(),
    rowId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const service = await Services.findOne({ id: input.serviceId });
    if (!service) throw new ZiteError({ code: 'NOT_FOUND', message: 'Service not found' });

    await Services.update({ id: input.serviceId, record: { isActive: false } });

    return { success: true };
  },
});
