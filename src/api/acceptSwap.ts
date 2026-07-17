import { z } from 'zod';
import { createEndpoint, ServiceSwaps, ServiceAllocations } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Accept a service swap request',
  authenticated: true,
  inputSchema: z.object({
    swapId: z.string().optional(),
    requestId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const uid = context.user!.id;
    const id = input.swapId || input.requestId || '';
    let swap = await ServiceSwaps.findOne({ filters: { swapId: id } });
    if (!swap) swap = await ServiceSwaps.findOne({ id });
    if (!swap) throw new Error('Swap not found');
    if (swap.status !== 'Open') throw new Error('Swap is no longer open');

    const allocId = Array.isArray(swap.allocation) ? swap.allocation[0] : swap.allocation;
    await Promise.all([
      ServiceSwaps.update({ id: swap.id, record: { status: 'Accepted', toUser: uid } }),
      allocId ? ServiceAllocations.update({ id: allocId, record: { user: uid, status: 'Scheduled' } }) : Promise.resolve(),
    ]);
    return { success: true };
  },
});
