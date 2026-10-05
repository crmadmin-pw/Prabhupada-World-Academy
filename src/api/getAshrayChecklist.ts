import { z } from 'zod';
import { createEndpoint, AshrayChecklist, Config, Users, AshrayUpgradeRequests, AppError } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, HIERARCHY_IDENTITY_FIELDS, isUserInHierarchy } from '@/lib/hierarchyUtils';

export default createEndpoint({
  description: 'Get the Ashraya checklist for the current user or a specified user (guide view)',
  authenticated: true,
  inputSchema: z.object({ userId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    // Resolve both database document id and custom userId to check pending upgrades reliably
    let userRec = null;
    if (input.userId) {
      if (/^USER-\d+$/i.test(input.userId)) {
        const { records } = await Users.findAll({ filters: { userId: input.userId }, fields: HIERARCHY_IDENTITY_FIELDS });
        userRec = records.find(r => r.id !== r.userId) || records[0];
      }
      if (!userRec) {
        userRec = await Users.findOne({ id: input.userId, fields: HIERARCHY_IDENTITY_FIELDS })
          || await Users.findOne({ filters: { userId: input.userId }, fields: HIERARCHY_IDENTITY_FIELDS });
      }
      if (!userRec) throw new AppError({ code: 'NOT_FOUND', message: 'User not found' });
    } else {
      userRec = await Users.findOne({ id: context.user!.id, fields: ['id', 'userId'] });
    }

    let targetDbId = context.user!.id;
    let targetUserId = '';
    if (userRec) {
      targetDbId = userRec.id;
      targetUserId = userRec.userId || userRec.id;
    }

    if (targetDbId !== context.user.id && !isUserInHierarchy(userRec, await getScopedHierarchyUserIds(context.user))) {
      throw new AppError({ code: 'FORBIDDEN', message: 'This user is not assigned to your hierarchy' });
    }

    const record = await AshrayChecklist.findOne({ filters: { user: targetDbId } });

    let checkedItems: string[] = [];
    if (record) {
      try {
        const parsed = JSON.parse(record.checklistDataJson || '[]');
        checkedItems = Array.isArray(parsed) ? parsed : [];
      } catch { checkedItems = []; }
    }

    // Fetch next ashray exam date from Config table
    const cfg = await Config.findOne({ filters: { configKey: 'Next Ashray Exam' } });
    const nextExamDate = cfg?.configValue || '';

    // Check if there is any pending or approved upgrade request awaiting resolution
    const [pendingByDbId, pendingByUserId] = await Promise.all([
      AshrayUpgradeRequests.findOne({ filters: { userId: targetDbId, status: { in: ['Pending', 'APPROVED', 'Approved', 'PENDING'] } } }),
      targetUserId ? AshrayUpgradeRequests.findOne({ filters: { userId: targetUserId, status: { in: ['Pending', 'APPROVED', 'Approved', 'PENDING'] } } }) : Promise.resolve(null)
    ]);
    const hasPendingUpgrade = !!(pendingByDbId || pendingByUserId);

    return {
      ashrayLevel: record?.level || null,
      checkedItems,
      nextExamDate,
      hasPendingUpgrade,
    };
  },
});
