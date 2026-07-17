import { z } from 'zod';
import { createEndpoint, Trips, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'User requests a correction on a trip record (stores proposed values as pending)',
  inputSchema: z.object({
    tripId: z.string(),
    proposedTotalAmount: z.number(),
    proposedAmountPaid: z.number(),
    correctionNotes: z.string(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const trip = await Trips.findOne({ id: input.tripId, fields: ['id', 'user'] });
    if (!trip) throw new ZiteError({ code: 'NOT_FOUND', message: 'Trip not found' });

    // Verify this trip belongs to the requesting user
    const tripUserId = Array.isArray(trip.user) ? trip.user[0] : trip.user;
    if (tripUserId !== context.user!.id) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only request corrections for your own trips' });
    }

    await Trips.update({
      id: input.tripId,
      record: {
        proposedTotalAmount: input.proposedTotalAmount,
        proposedAmountPaid: input.proposedAmountPaid,
        correctionStatus: 'Pending',
        correctionNotes: input.correctionNotes,
      } as any,
    });
    return { success: true };
  },
});
