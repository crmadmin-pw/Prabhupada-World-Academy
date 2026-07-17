import { z } from 'zod';
import { createEndpoint, Users, AshrayUpgradeRequests, Trips, RentPayments, ZiteError } from 'zite-integrations-backend-sdk';

async function resolveUser(id: string) {
  const byDbId = await Users.findOne({ id, fields: ['id', 'userId', 'fullName'] }).catch(() => undefined);
  if (byDbId) return byDbId;
  return Users.findOne({ filters: { userId: id }, fields: ['id', 'userId', 'fullName'] });
}

const tripSchema = z.object({
  id: z.string(),
  tripName: z.string().nullable().optional(),
  tripDate: z.string().nullable().optional(),
  destination: z.string().nullable().optional(),
  totalAmount: z.number().nullable().optional(),
  amountPaid: z.number().nullable().optional(),
  paymentStatus: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  correctionStatus: z.string().nullable().optional(),
  correctionNotes: z.string().nullable().optional(),
  proposedTotalAmount: z.number().nullable().optional(),
  proposedAmountPaid: z.number().nullable().optional(),
});

const rentSchema = z.object({
  id: z.string(),
  month: z.string().nullable().optional(),
  amountDue: z.number().nullable().optional(),
  amountPaid: z.number().nullable().optional(),
  paymentDate: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  correctionStatus: z.string().nullable().optional(),
  correctionNotes: z.string().nullable().optional(),
  proposedAmountDue: z.number().nullable().optional(),
  proposedAmountPaid: z.number().nullable().optional(),
});

const ashrayHistorySchema = z.object({
  id: z.string(),
  requestId: z.string().nullable().optional(),
  currentLevel: z.string().nullable().optional(),
  requestedLevel: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
  reviewedAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get CRM data (trips, rent payments, ashray history) for a user profile',
  inputSchema: z.object({ userId: z.string() }),
  outputSchema: z.object({
    trips: z.array(tripSchema),
    rentPayments: z.array(rentSchema),
    ashrayHistory: z.array(ashrayHistorySchema),
    userDbId: z.string(),
    pendingTripCorrections: z.number(),
    pendingRentCorrections: z.number(),
  }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!input.userId) throw new ZiteError({ code: 'BAD_REQUEST', message: 'userId is required' });

    const userRecord = await resolveUser(input.userId);
    if (!userRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });

    const isOwnData = context.user.id === userRecord.id;
    const isGuide = ['Guide', 'Super Guide', 'BVSL', 'Sadhana Mentor'].includes(context.user.role || '')
      || !!(context.user.isBvsl || context.user.isSadhanaMentor)
      || !!((context.user as any).isFolkLead)
      || !!((context.user as any).isTripCoordinator);

    if (!isOwnData && !isGuide) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Access denied' });
    }

    const [tripsRes, rentRes, ashrayRes] = await Promise.all([
      Trips.findAll({ filters: { user: userRecord.id } as any, limit: 100 }),
      RentPayments.findAll({ filters: { user: userRecord.id } as any, limit: 100 }),
      AshrayUpgradeRequests.findAll({
        filters: { userId: (userRecord.userId as string) || userRecord.id },
        limit: 50,
      }),
    ]);

    const trips = tripsRes.records
      .map(t => ({
        id: t.id,
        tripName: ((t as any).tripName as string) || null,
        tripDate: ((t as any).tripDate as string) || null,
        destination: ((t as any).destination as string) || null,
        totalAmount: ((t as any).totalAmount as number) ?? null,
        amountPaid: ((t as any).amountPaid as number) ?? null,
        paymentStatus: ((t as any).paymentStatus as string) || null,
        notes: ((t as any).notes as string) || null,
        correctionStatus: ((t as any).correctionStatus as string) || null,
        correctionNotes: ((t as any).correctionNotes as string) || null,
        proposedTotalAmount: ((t as any).proposedTotalAmount as number) ?? null,
        proposedAmountPaid: ((t as any).proposedAmountPaid as number) ?? null,
      }))
      .sort((a, b) => (b.tripDate || '').localeCompare(a.tripDate || ''));

    const rentPayments = rentRes.records
      .map(r => ({
        id: r.id,
        month: ((r as any).month as string) || null,
        amountDue: ((r as any).amountDue as number) ?? null,
        amountPaid: ((r as any).amountPaid as number) ?? null,
        paymentDate: ((r as any).paymentDate as string) || null,
        status: ((r as any).status as string) || null,
        notes: ((r as any).notes as string) || null,
        correctionStatus: ((r as any).correctionStatus as string) || null,
        correctionNotes: ((r as any).correctionNotes as string) || null,
        proposedAmountDue: ((r as any).proposedAmountDue as number) ?? null,
        proposedAmountPaid: ((r as any).proposedAmountPaid as number) ?? null,
      }))
      .sort((a, b) => (b.month || '').localeCompare(a.month || ''));

    const ashrayHistory = ashrayRes.records
      .map(a => ({
        id: a.id,
        requestId: (a.requestId as string) || null,
        currentLevel: (a.currentLevel as string) || null,
        requestedLevel: (a.requestedLevel as string) || null,
        status: (a.status as string) || null,
        reason: (a.reason as string) || null,
        reviewedBy: (a.reviewedBy as string) || null,
        reviewedAt: (a.reviewedAt as string) || null,
        createdAt: (a.createdAt as string) || null,
      }))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    return {
      trips, rentPayments, ashrayHistory,
      userDbId: userRecord.id,
      pendingTripCorrections: trips.filter(t => t.correctionStatus === 'Pending').length,
      pendingRentCorrections: rentPayments.filter(r => r.correctionStatus === 'Pending').length,
    };
  },
});
