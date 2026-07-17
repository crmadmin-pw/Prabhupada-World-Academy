import { z } from 'zod';
import { createEndpoint, Users, Trips, ZiteError } from 'zite-integrations-backend-sdk';

function requireTripEditor(user: any) {
  const role = user.role || '';
  const ok = ['Guide', 'Super Guide'].includes(role) || !!user.isTripCoordinator || !!user.isBvsl || !!user.isSadhanaMentor;
  if (!ok) throw new ZiteError({ code: 'FORBIDDEN', message: 'Trip Coordinator or Guide access required' });
}

async function resolveUser(id: string) {
  const byDbId = await Users.findOne({ id, fields: ['id'] }).catch(() => undefined);
  if (byDbId) return byDbId;
  return Users.findOne({ filters: { userId: id }, fields: ['id'] });
}

export default createEndpoint({
  authenticated: true,
  description: 'Add a trip record for a user (Trip Coordinator, Guide, or Super Guide)',
  inputSchema: z.object({
    userId: z.string(),
    tripName: z.string(),
    tripDate: z.string().optional(),
    destination: z.string().optional(),
    totalAmount: z.number().optional(),
    amountPaid: z.number().optional(),
    paymentStatus: z.string().optional(),
    notes: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input, context }) => {
    requireTripEditor(context.user);
    const userRecord = await resolveUser(input.userId);
    if (!userRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });

    const record = await Trips.create({
      record: {
        tripName: input.tripName,
        user: userRecord.id,
        tripDate: input.tripDate,
        destination: input.destination,
        totalAmount: input.totalAmount,
        amountPaid: input.amountPaid ?? 0,
        paymentStatus: input.paymentStatus || 'Unpaid',
        correctionStatus: 'Approved',
        notes: input.notes,
      } as any,
    });
    return { success: true, id: record.id };
  },
});
