import { z } from 'zod';
import { createEndpoint, ServiceSwaps, ServiceAllocations } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Reject a service swap request',
  authenticated: true,
  inputSchema: z.object({ swapId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    let swap = await ServiceSwaps.findOne({ filters: { swapId: input.swapId } });
    if (!swap) swap = await ServiceSwaps.findOne({ id: input.swapId });
    if (!swap) throw new Error('Swap not found');

    const allocId = Array.isArray(swap.allocation) ? swap.allocation[0] : swap.allocation;
    await Promise.all([
      ServiceSwaps.update({ id: swap.id, record: { status: 'Rejected' } }),
      allocId ? ServiceAllocations.update({ id: allocId, record: { status: 'Scheduled' } }) : Promise.resolve(),
    ]);
    return { success: true };
  },
});
