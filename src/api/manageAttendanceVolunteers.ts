import { z } from 'zod';
import {
  createEndpoint, ZiteError, AttendanceVolunteers, Users,
} from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Add or remove volunteer access for a session',
  inputSchema: z.object({
    action: z.enum(['add', 'remove', 'list']),
    sessionId: z.string(),
    userEmail: z.string().optional(),
    volunteerId: z.string().optional(),
  }),
  outputSchema: z.object({
    volunteers: z.array(z.object({
      id: z.string(),
      userName: z.string(),
      userEmail: z.string(),
    })),
  }),
  execute: async ({ input, context }) => {
    const role = context.user.role || '';
    if (!['Guide', 'Super Guide', 'BVSL'].includes(role) && !context.user.isBvsl) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Not authorized' });
    }

    if (input.action === 'add' && input.userEmail) {
      const user = await Users.findOne({ filters: { email: input.userEmail } });
      if (!user) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found with that email' });
      // Check existing
      const existing = await AttendanceVolunteers.findOne({ filters: { user: user.id, session: input.sessionId } });
      if (!existing) {
        await AttendanceVolunteers.create({ record: { user: user.id, session: input.sessionId, grantedBy: context.user.id } });
      }
    }

    if (input.action === 'remove' && input.volunteerId) {
      await AttendanceVolunteers.delete({ id: input.volunteerId });
    }

    // List
    const { records: vols } = await AttendanceVolunteers.findAll({ filters: { session: input.sessionId }, limit: 100 });
    const userIds = vols.map(v => (Array.isArray(v.user) ? v.user[0] : v.user) as string).filter(Boolean);
    const userMap = new Map<string, { name: string; email: string }>();
    if (userIds.length) {
      const { records: users } = await Users.findAll({ filters: { id: { in: userIds } }, limit: 100, fields: ['fullName', 'email'] });
      for (const u of users) userMap.set(u.id, { name: u.fullName || '', email: u.email || '' });
    }

    return {
      volunteers: vols.map(v => {
        const uid = (Array.isArray(v.user) ? v.user[0] : v.user) as string;
        const info = userMap.get(uid);
        return { id: v.id, userName: info?.name || '', userEmail: info?.email || '' };
      }),
    };
  },
});
