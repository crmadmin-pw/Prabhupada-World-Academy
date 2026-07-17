import { z } from 'zod';
import { createEndpoint, ServiceAllocations } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Save checklist progress for a service allocation',
  authenticated: true,
  inputSchema: z.object({
    allocationId: z.string(),
    checkedItems: z.array(z.number()),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    let record = await ServiceAllocations.findOne({ filters: { allocationId: input.allocationId } });
    if (!record) record = await ServiceAllocations.findOne({ id: input.allocationId });
    if (!record) throw new Error('Allocation not found');

    const userId = Array.isArray(record.user) ? record.user[0] : record.user;
    if (userId !== context.user!.id) throw new Error('Not your allocation');

    await ServiceAllocations.update({
      id: record.id,
      record: { notes: JSON.stringify({ checkedItems: input.checkedItems }) },
    });

    return { success: true };
  },
});
