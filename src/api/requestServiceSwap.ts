import { z } from 'zod';
import { createEndpoint, ServiceSwaps, ServiceAllocations } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Request a service swap for an allocation',
  authenticated: true,
  inputSchema: z.object({ allocationId: z.string(), reason: z.string().optional(), swapType: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const uid = context.user!.id;
    let record = await ServiceAllocations.findOne({ filters: { allocationId: input.allocationId } });
    if (!record) record = await ServiceAllocations.findOne({ id: input.allocationId });
    if (!record) throw new Error('Allocation not found');

    const userId = Array.isArray(record.user) ? record.user[0] : record.user;
    if (userId !== uid) throw new Error('Not your allocation');

    // Check for existing open swap
    const existing = await ServiceSwaps.findOne({ filters: { allocation: record.id, status: 'Open' } });
    if (existing) return { success: true, alreadyRequested: true };

    await ServiceSwaps.create({ record: {
      allocation: record.id,
      fromUser: uid,
      status: 'Open',
      reason: input.reason || '',
      createdAt: new Date().toISOString(),
    }});
    await ServiceAllocations.update({ id: record.id, record: { status: 'Swapped' } });
    return { success: true, alreadyRequested: false };
  },
});
