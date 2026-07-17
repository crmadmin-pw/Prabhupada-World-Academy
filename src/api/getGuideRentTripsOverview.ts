import { z } from 'zod';
import { createEndpoint, Users, Guides, Trips, RentPayments, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Get aggregated rent & trips overview for all users under a guide',
  inputSchema: z.object({ guideId: z.string().optional() }),
  outputSchema: z.object({
    summary: z.object({
      totalRentOutstanding: z.number(),
      totalTripBalance: z.number(),
      totalPendingCorrections: z.number(),
      usersWithDebt: z.number(),
      totalUsers: z.number(),
    }),
    users: z.array(z.object({
      userId: z.string(),
      userPublicId: z.string(),
      fullName: z.string(),
      isResident: z.boolean(),
      rentOutstanding: z.number(),
      rentRecords: z.number(),
      rentPendingCorrections: z.number(),
      tripBalance: z.number(),
      tripRecords: z.number(),
      tripPendingCorrections: z.number(),
      totalPendingCorrections: z.number(),
      totalOutstanding: z.number(),
    })),
  }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = context.user.role || '';
    const isAuthorized =
      ['Guide', 'Super Guide', 'BVSL', 'Sadhana Mentor'].includes(role) ||
      !!(context.user.isBvsl) ||
      !!(context.user.isSadhanaMentor) ||
      !!((context.user as any).isFolkLead) ||
      !!((context.user as any).isTripCoordinator);

    if (!isAuthorized) throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide access required' });

    const isSuperGuide = role === 'Super Guide';

    let guideDbId: string | null = null;
    if (!isSuperGuide) {
      const guide = await Guides.findOne({
        filters: { email: context.user.email, isActive: true },
        fields: ['id'],
      });
      if (!guide) {
        return {
          summary: { totalRentOutstanding: 0, totalTripBalance: 0, totalPendingCorrections: 0, usersWithDebt: 0, totalUsers: 0 },
          users: [],
        };
      }
      guideDbId = guide.id;
    }

    const userFilters: any = {};
    if (guideDbId) userFilters.guide = guideDbId;
    if (isSuperGuide && input.guideId) userFilters.guide = input.guideId;

    const { records: userRecords } = await Users.findAll({
      filters: userFilters,
      fields: ['id', 'userId', 'fullName', 'residencyApproved', 'role'],
      limit: 2000,
    });

    const registeredUsers = userRecords.filter(
      u => u.userId && (u.fullName || '').trim().length > 0 && u.role !== 'Guide'
    );

    if (registeredUsers.length === 0) {
      return {
        summary: { totalRentOutstanding: 0, totalTripBalance: 0, totalPendingCorrections: 0, usersWithDebt: 0, totalUsers: 0 },
        users: [],
      };
    }

    const userDbIds = registeredUsers.map(u => u.id);

    const [{ records: allRent }, { records: allTrips }] = await Promise.all([
      RentPayments.findAll({
        filters: { user: { in: userDbIds } } as any,
        fields: ['id', 'user', 'amountDue', 'amountPaid', 'correctionStatus'],
        limit: 2000,
      }),
      Trips.findAll({
        filters: { user: { in: userDbIds } } as any,
        fields: ['id', 'user', 'totalAmount', 'amountPaid', 'correctionStatus'],
        limit: 2000,
      }),
    ]);

    // Group by user db ID
    const rentByUser = new Map<string, typeof allRent>();
    for (const r of allRent) {
      const uid = Array.isArray(r.user) ? r.user[0] : r.user;
      if (!uid) continue;
      if (!rentByUser.has(uid)) rentByUser.set(uid, []);
      rentByUser.get(uid)!.push(r);
    }

    const tripsByUser = new Map<string, typeof allTrips>();
    for (const t of allTrips) {
      const uid = Array.isArray(t.user) ? t.user[0] : t.user;
      if (!uid) continue;
      if (!tripsByUser.has(uid)) tripsByUser.set(uid, []);
      tripsByUser.get(uid)!.push(t);
    }

    const userData = registeredUsers.map(u => {
      const rents = rentByUser.get(u.id) || [];
      const trips = tripsByUser.get(u.id) || [];

      const rentOutstanding = rents.reduce(
        (s, r) => s + Math.max(0, ((r.amountDue as number) ?? 0) - ((r.amountPaid as number) ?? 0)), 0
      );
      const rentPendingCorrections = rents.filter(r => r.correctionStatus === 'Pending').length;

      const tripBalance = trips.reduce(
        (s, t) => s + Math.max(0, ((t.totalAmount as number) ?? 0) - ((t.amountPaid as number) ?? 0)), 0
      );
      const tripPendingCorrections = trips.filter(t => t.correctionStatus === 'Pending').length;

      return {
        userId: u.id,
        userPublicId: (u.userId as string) || u.id,
        fullName: u.fullName || '',
        isResident: !!(u.residencyApproved),
        rentOutstanding,
        rentRecords: rents.length,
        rentPendingCorrections,
        tripBalance,
        tripRecords: trips.length,
        tripPendingCorrections,
        totalPendingCorrections: rentPendingCorrections + tripPendingCorrections,
        totalOutstanding: rentOutstanding + tripBalance,
      };
    });

    userData.sort((a, b) =>
      b.totalOutstanding - a.totalOutstanding ||
      b.totalPendingCorrections - a.totalPendingCorrections ||
      a.fullName.localeCompare(b.fullName)
    );

    const summary = {
      totalRentOutstanding: userData.reduce((s, u) => s + u.rentOutstanding, 0),
      totalTripBalance: userData.reduce((s, u) => s + u.tripBalance, 0),
      totalPendingCorrections: userData.reduce((s, u) => s + u.totalPendingCorrections, 0),
      usersWithDebt: userData.filter(u => u.totalOutstanding > 0).length,
      totalUsers: userData.length,
    };

    return { summary, users: userData };
  },
});
