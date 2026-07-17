import { z } from 'zod';
import { createEndpoint, AshrayChecklist, Config, Users, AshrayUpgradeRequests } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get the Ashraya checklist for the current user or a specified user (guide view)',
  authenticated: true,
  inputSchema: z.object({ userId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    // Resolve both database document id and custom userId to check pending upgrades reliably
    const userRec = input.userId
      ? await Users.findOne({ filters: { userId: input.userId }, fields: ['id', 'userId'] })
      : await Users.findOne({ id: context.user!.id, fields: ['id', 'userId'] });

    let targetDbId = context.user!.id;
    let targetUserId = '';
    if (userRec) {
      targetDbId = userRec.id;
      targetUserId = userRec.userId || userRec.id;
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
