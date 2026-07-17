import { z } from 'zod';
import { createEndpoint, PushSubscriptions, Users, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get push subscription stats (Super Guide only)',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    totalSubscriptions: z.number(),
    subscribers: z.array(z.object({
      name: z.string(),
      email: z.string(),
    })),
  }),
  execute: async ({ context }) => {
    const role = (context.user.role || '').replace(/\s/g, '_').toUpperCase();
    if (role !== 'SUPER_GUIDE') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Super Guide only' });
    }

    // Get all subscriptions
    const { records: subs } = await PushSubscriptions.findAll({ limit: 2000 });

    // Get unique user IDs
    const userIds = [...new Set(subs.map(s => {
      const u = s.user;
      return Array.isArray(u) ? u[0] : u;
    }).filter(Boolean))] as string[];

    if (userIds.length === 0) {
      return { totalSubscriptions: 0, subscribers: [] };
    }

    // Fetch user details
    const { records: users } = await Users.findAll({
      filters: { id: { in: userIds } },
      fields: ['fullName', 'email'],
      limit: 2000,
    });

    const userMap = new Map(users.map(u => [u.id, u]));

    const subscribers = userIds.map(uid => {
      const u = userMap.get(uid);
      return { name: u?.fullName || '—', email: u?.email || '—' };
    });

    return { totalSubscriptions: subs.length, subscribers };
  },
});
