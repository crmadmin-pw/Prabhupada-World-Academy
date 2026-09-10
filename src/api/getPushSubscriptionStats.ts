import { z } from 'zod';
import { createEndpoint, PushSubscriptions, Users, AppError } from '@/lib/backend-sdk';
import { getNotificationDepartment, isSadhanaReminderEligibleUser } from '@/lib/notificationDepartment';
import { getScopedHierarchyUserIds, isUserInHierarchy } from '../lib/hierarchyUtils';

export default createEndpoint({
  description: 'Get push subscription stats (Super Guide / Admin only)',
  authenticated: true,
  requiredCapabilities: 'notifications.send',
  inputSchema: z.object({
    segment: z.enum(['PW', 'FOLK']).optional(),
  }),
  outputSchema: z.object({
    totalSubscriptions: z.number(),
    subscribers: z.array(z.object({
      name: z.string(),
      email: z.string(),
    })),
  }),
  execute: async ({ input, context }: { input: any; context: any }) => {
    const role = (context.user.role || '').replace(/\s/g, '_').toUpperCase();
    const isAllowed = ['SUPER_GUIDE', 'SUPER_ADMIN', 'PW_ADMIN', 'ADMIN', 'GUIDE'].includes(role) ||
                      !!context.user.isBvSuperAdmin ||
                      !!context.user.isBvAdmin ||
                      !!context.user.isPwAdmin;
    if (!isAllowed) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Super Guide or Admin only' });
    }

    const callerIds = new Set([
      context?.user?.id,
      context?.user?.userId,
      context?.user?.uid,
    ].filter(Boolean).map(String));
    const callerEmail = (context?.user?.email || '').toLowerCase();

    // Determine target segment: explicit input > caller context.
    let targetSegment = input?.segment || context.user?.segment;
    if (!targetSegment) targetSegment = 'PW';
    const callerSegment = String(context.user?.segment || '').trim().toUpperCase();
    const canManageAnyDepartment = context.user?.capabilities?.includes('*');
    if (!canManageAnyDepartment && callerSegment && callerSegment !== targetSegment) {
      throw new AppError({ code: 'FORBIDDEN', message: 'You cannot view another department notification subscriptions' });
    }

    // Get all subscriptions
    const { records: subs } = await PushSubscriptions.findAll({ limit: 2000 });

    // Helper to extract string ID from different formats of s.user (Reference, Array, String)
    const getUserIdStr = (userField: any): string | null => {
      if (!userField) return null;
      if (typeof userField === 'string') return userField;
      if (Array.isArray(userField)) {
        return getUserIdStr(userField[0]);
      }
      if (userField.id) return String(userField.id);
      if (userField.path) {
        const segments = userField.path.split('/');
        return segments[segments.length - 1];
      }
      if (userField._path && userField._path.segments) {
        const segments = userField._path.segments;
        return segments[segments.length - 1];
      }
      return String(userField);
    };

    // Get unique user IDs
    const userIds = Array.from(new Set(subs.map(s => getUserIdStr(s.user)).filter(Boolean))) as string[];

    if (userIds.length === 0) {
      return { totalSubscriptions: 0, subscribers: [] };
    }

    // Firestore `in` supports bounded batches. This replaces one database read
    // request per subscription owner with a small number of parallel queries.
    const idChunks = Array.from({ length: Math.ceil(userIds.length / 30) }, (_, index) =>
      userIds.slice(index * 30, index * 30 + 30)
    );
    const userBatches = await Promise.all(idChunks.map(ids =>
      Users.findAll({ filters: { id: { in: ids } }, limit: ids.length }).catch(() => ({ records: [] }))
    ));
    const users = userBatches.flatMap(batch => batch.records || []);

    const scope = await getScopedHierarchyUserIds(context.user);
    const targetUsers = users.filter((u: any) => {
      if (!isUserInHierarchy(u, scope)) return false;
      if (u.status !== 'Active') return false;

      const isCaller = callerIds.has(String(u.id || '')) ||
                       callerIds.has(String(u.userId || '')) ||
                       (callerEmail && (u.email || '').toLowerCase() === callerEmail);
      if (isCaller) return false;

      if (!isSadhanaReminderEligibleUser(u)) return false;

      return getNotificationDepartment(u) === targetSegment;
    });

    const targetUserIds = new Set(targetUsers.map(u => u.id));
    const userMap = new Map(targetUsers.map(u => [u.id, u]));

    const subscribers = subs
      .map((s: any) => {
        const uid = getUserIdStr(s.user);
        const u = uid ? userMap.get(uid) as any : null;
        return u ? { name: u.fullName || '—', email: u.email || '—' } : null;
      })
      .filter(Boolean) as { name: string; email: string }[];

    const totalFilteredSubs = subs.filter((s: any) => {
      const uid = getUserIdStr(s.user);
      return uid && targetUserIds.has(uid);
    }).length;

    return { totalSubscriptions: totalFilteredSubs, subscribers };
  },
});
