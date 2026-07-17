import { z } from 'zod';
import { createEndpoint, GuideTransferRequests, Users, Guides, AshrayUpgradeRequests } from 'zite-integrations-backend-sdk';
import { ASHRAY_LEVELS } from '../types/enums';

export default createEndpoint({
  description: 'Get guide transfer requests — only where toGuide is the current guide, plus ashray upgrades (stub)',
  authenticated: true,
  inputSchema: z.object({ guideId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const isSuperGuide = context.user.role === 'Super Guide';

    // Find the guide DB record for the current user
    let guideDbId: string | null = null;
    if (!isSuperGuide) {
      const guideRecord = await Guides.findOne({
        filters: { email: context.user.email, isActive: true },
        fields: ['id'],
      });
      if (!guideRecord) return { guideTransfers: [], ashrayUpgrades: [] };
      guideDbId = guideRecord.id;
    }

    // Fetch pending guide transfer requests
    const { records: allRequests } = await GuideTransferRequests.findAll({
      filters: { status: 'Pending' },
      fields: ['id', 'user', 'fromGuide', 'toGuide', 'status', 'requestedAt', 'notes'],
      limit: 200,
    });

    // Filter: only show requests where toGuide is THIS guide (receiving guide)
    const filtered = isSuperGuide
      ? allRequests
      : allRequests.filter((r: any) => {
          const toId = Array.isArray(r.toGuide) ? r.toGuide[0] : r.toGuide;
          return toId && toId === guideDbId;
        });

    // Resolve user details for guide transfers
    let guideTransfers: any[] = [];
    if (filtered.length > 0) {
      const userIds = [...new Set(filtered.map((r: any) => Array.isArray(r.user) ? r.user[0] : r.user).filter(Boolean))] as string[];
      const usersRes = userIds.length > 0
        ? await Users.findAll({ filters: { id: { in: userIds } }, fields: ['id', 'userId', 'fullName', 'email', 'guide'], limit: 200 })
        : { records: [] };

      const userMap: Record<string, any> = {};
      usersRes.records.forEach((u: any) => { userMap[u.id] = u; });

      // Fetch all guides to resolve names
      const { records: guides } = await Guides.findAll({ fields: ['id', 'fullName'], limit: 500 });
      const guideNameMap = new Map<string, string>(guides.map(g => [g.id, (g as any).fullName || '']));

      guideTransfers = filtered.map((r: any) => {
        const uid = Array.isArray(r.user) ? r.user[0] : r.user as string;
        const u = userMap[uid] as any;
        const fromGuideId = (Array.isArray(r.fromGuide) ? r.fromGuide[0] : r.fromGuide) || (Array.isArray(u?.guide) ? u.guide[0] : u?.guide);
        const toGuideId = Array.isArray(r.toGuide) ? r.toGuide[0] : r.toGuide;
        return {
          logId: r.id,
          userId: u?.userId || uid || '',
          userName: u?.fullName || '',
          userEmail: u?.email || '',
          status: r.status || 'Pending',
          timestamp: r.requestedAt || '',
          fromGuideName: fromGuideId ? (guideNameMap.get(fromGuideId) || 'Unknown') : 'None',
          toGuideName: toGuideId ? (guideNameMap.get(toGuideId) || 'Unknown') : 'None',
        };
      });
    }

    // Fetch pending/approved ashray upgrades
    const { records: rawAshray } = await AshrayUpgradeRequests.findAll({
      filters: { status: { in: ['Pending', 'APPROVED', 'Approved', 'PENDING'] } },
      limit: 200,
    });

    const ashrayUpgrades: any[] = [];
    if (rawAshray.length > 0) {
      const ashrayUserIds = [...new Set(rawAshray.map((r: any) => r.userId).filter(Boolean))];
      const [usersById, usersByUserId] = ashrayUserIds.length > 0
        ? await Promise.all([
            Users.findAll({ filters: { id: { in: ashrayUserIds } }, fields: ['id', 'userId', 'fullName', 'email', 'guide'], limit: 200 }),
            Users.findAll({ filters: { userId: { in: ashrayUserIds } }, fields: ['id', 'userId', 'fullName', 'email', 'guide'], limit: 200 })
          ])
        : [{ records: [] }, { records: [] }];

      const ashrayUserMap = new Map<string, any>();
      usersById.records.forEach((u: any) => {
        ashrayUserMap.set(u.id, u);
        if (u.userId) ashrayUserMap.set(u.userId, u);
      });
      usersByUserId.records.forEach((u: any) => {
        ashrayUserMap.set(u.id, u);
        if (u.userId) ashrayUserMap.set(u.userId, u);
      });

      const filteredAshray = rawAshray.filter((r: any) => {
        const u = ashrayUserMap.get(r.userId);
        if (!u) return false;
        if (isSuperGuide) return true;
        const userGuideId = Array.isArray(u.guide) ? u.guide[0] : u.guide;
        return userGuideId && userGuideId === guideDbId;
      });

      filteredAshray.forEach((r: any) => {
        const u = ashrayUserMap.get(r.userId);
        ashrayUpgrades.push({
          logId: r.id,
          userId: u?.id || r.userId || '',
          userName: u?.fullName || '',
          userEmail: u?.email || '',
          status: (r.status || 'PENDING').toUpperCase(),
          timestamp: r.createdAt || r.requestedAt || '',
          details: {
            currentLevel: r.currentLevel || 'Jigyasa',
            requestedLevel: r.requestedLevel || (() => {
              const currentIdx = ASHRAY_LEVELS.indexOf(r.currentLevel || 'Jigyasa');
              if (currentIdx !== -1 && currentIdx < ASHRAY_LEVELS.length - 1) {
                return ASHRAY_LEVELS[currentIdx + 1];
              }
              return 'Shraddhavan';
            })(),
          },
        });
      });
    }

    return { guideTransfers, ashrayUpgrades };
  },
});
