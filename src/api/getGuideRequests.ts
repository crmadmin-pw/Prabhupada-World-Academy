import { z } from 'zod';
import { createEndpoint, GuideTransferRequests, Users, Guides, AshrayUpgradeRequests, FolkResidencies } from '@/lib/backend-sdk';
import { ASHRAY_LEVELS } from '../types/enums';
import { getScopedHierarchyUserIds, isHierarchySuperAdmin, isUserInHierarchy } from '../lib/hierarchyUtils';

export default createEndpoint({
  description: 'Get guide transfer requests involving the current guide, plus ashray upgrades',
  authenticated: true,
  requiredCapabilities: 'users.approve',
  inputSchema: z.object({ guideId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    const userRole = String(context.user.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    const scopedGuideId = isHierarchySuperAdmin(context.user) ? String(input?.guideId || '').trim() : '';
    const isSuperGuide = (!scopedGuideId || scopedGuideId === 'ALL') && (
      userRole === 'SUPER_GUIDE' ||
      userRole === 'SUPER_ADMIN' ||
      !!context.user.isBvSuperAdmin);
    const hierarchy = await getScopedHierarchyUserIds(context.user);

    // Find the guide DB record for the current user
    let guideDbId: string | null = null;
    if (!isSuperGuide) {
      const guideRecord = await Guides.findOne({
        filters: { email: context.user.email, isActive: true },
        fields: ['id'],
      });
      if (guideRecord) {
        guideDbId = (scopedGuideId && scopedGuideId !== 'ALL') ? scopedGuideId : guideRecord.id;
      } else {
        const uRec = await Users.findOne({ id: context.user.id, fields: ['id', 'userId'] }) ||
                     await Users.findOne({ filters: { email: context.user.email }, fields: ['id', 'userId'] });
      guideDbId = (scopedGuideId && scopedGuideId !== 'ALL') ? scopedGuideId : (uRec?.userId || uRec?.id || context.user.id);
      }
    }

    // Fetch pending guide transfer requests
    const { records: allRequestsRaw } = await GuideTransferRequests.findAll({
      fields: ['id', 'user', 'fromGuide', 'toGuide', 'status', 'requestedAt', 'notes'],
      limit: 200,
    });
    // Older clients wrote both `Pending` and `PENDING`; normalize at the API
    // boundary so a casing difference never hides a submitted request.
    const allRequests = allRequestsRaw.filter((r: any) =>
      String(r.status || '').trim().toUpperCase() === 'PENDING'
    );

    // A guide needs both sides of a transfer: the source guide must approve a
    // departure and the destination guide must approve the incoming transfer.
    const currentGuide = !isSuperGuide
      ? await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id', 'guideId', 'fullName', 'email'] }).catch(() => undefined)
      : undefined;
    const guideAliases = new Set([
      guideDbId, context.user.id, context.user.userId, context.user.email,
      currentGuide?.id, currentGuide?.guideId, currentGuide?.fullName, currentGuide?.email,
    ].filter(Boolean).map((value: any) => String(value).trim().toLowerCase()));

    const filtered = isSuperGuide
      ? allRequests
      : allRequests.filter((r: any) => {
          const fromId = Array.isArray(r.fromGuide) ? r.fromGuide[0] : r.fromGuide;
          const toId = Array.isArray(r.toGuide) ? r.toGuide[0] : r.toGuide;
          return [fromId, toId].filter(Boolean).some((value: any) => guideAliases.has(String(value).trim().toLowerCase()));
        });

    // Resolve user details for guide transfers
    let guideTransfers: any[] = [];
    if (filtered.length > 0) {
      const userIds = [...new Set(filtered.map((r: any) => Array.isArray(r.user) ? r.user[0] : r.user).filter(Boolean))] as string[];
      
      const [usersRes1, usersRes2, usersRes3, usersRes4] = await Promise.all([
        userIds.length > 0 ? Users.findAll({ filters: { id: { in: userIds } }, fields: ['id', 'userId', 'fullName', 'email', 'phone', 'residency', 'residencyApproved', 'residencyClaimed', 'guide'], limit: 200 }).catch(() => ({ records: [] })) : { records: [] },
        userIds.length > 0 ? Users.findAll({ filters: { userId: { in: userIds } }, fields: ['id', 'userId', 'fullName', 'email', 'phone', 'residency', 'residencyApproved', 'residencyClaimed', 'guide'], limit: 200 }).catch(() => ({ records: [] })) : { records: [] },
        userIds.length > 0 ? Users.findAll({ filters: { fullName: { in: userIds } }, fields: ['id', 'userId', 'fullName', 'email', 'phone', 'residency', 'residencyApproved', 'residencyClaimed', 'guide'], limit: 200 }).catch(() => ({ records: [] })) : { records: [] },
        userIds.length > 0 ? Users.findAll({ filters: { email: { in: userIds } }, fields: ['id', 'userId', 'fullName', 'email', 'phone', 'residency', 'residencyApproved', 'residencyClaimed', 'guide'], limit: 200 }).catch(() => ({ records: [] })) : { records: [] },
      ]);

      const userMap: Record<string, any> = {};
      const allResolvedUsers = [...usersRes1.records, ...usersRes2.records, ...usersRes3.records, ...usersRes4.records];
      allResolvedUsers.forEach((u: any) => {
        if (u.id) userMap[String(u.id).toLowerCase()] = u;
        if (u.userId) userMap[String(u.userId).toLowerCase()] = u;
        if (u.fullName) userMap[String(u.fullName).toLowerCase()] = u;
        if (u.email) userMap[String(u.email).toLowerCase()] = u;
      });

      // Fetch all guides to resolve names
      const [guidesRes, residenciesRes] = await Promise.all([
        Guides.findAll({ fields: ['id', 'guideId', 'fullName', 'email'], limit: 500 }),
        FolkResidencies.findAll({ fields: ['id', 'residencyName'], limit: 500 }).catch(() => ({ records: [] })),
      ]);
      const guideNameMap = new Map<string, string>();
      guidesRes.records.forEach((g: any) => {
        const name = g.fullName || g.email || g.id || '';
        for (const ref of [g.id, g.guideId, g.fullName, g.email]) if (ref) guideNameMap.set(String(ref).toLowerCase(), name);
      });
      // Some current-guide links point to the Users record (or its custom
      // userId) rather than a Guides record. Resolve those aliases as well so
      // the source side of a transfer never renders as "Unknown".
      const { records: guideUsers } = await Users.findAll({
        filters: { status: 'Active' },
        fields: ['id', 'userId', 'fullName', 'email', 'role', 'segment'],
        limit: 2000,
      }).catch(() => ({ records: [] }));
      guideUsers
        .filter((u: any) => ['GUIDE', 'SUPER_GUIDE'].includes(String(u.role || '').toUpperCase().replace(/[\s-]+/g, '_')))
        .forEach((u: any) => {
          const name = u.fullName || u.email || u.id || '';
          for (const ref of [u.id, u.userId, u.fullName, u.email]) if (ref) guideNameMap.set(String(ref).toLowerCase(), name);
        });
      const residencyMap = new Map<string, string>(residenciesRes.records.map(r => [r.id, (r as any).residencyName || '']));

      guideTransfers = filtered.map((r: any) => {
        const uid = Array.isArray(r.user) ? r.user[0] : r.user as string;
        const u = uid ? userMap[String(uid).toLowerCase()] : null;
        
        const fromGuideId = (Array.isArray(r.fromGuide) ? r.fromGuide[0] : r.fromGuide) || (Array.isArray(u?.guide) ? u.guide[0] : u?.guide);
        const toGuideId = Array.isArray(r.toGuide) ? r.toGuide[0] : r.toGuide;
        
        const residencyId = Array.isArray(u?.residency) ? u.residency[0] : u?.residency;
        const resName = residencyId ? (residencyMap.get(residencyId) || '') : '';
        const residencyLabel = resName || 'Non-Resident';

        let rawPhone = u?.phone || '';
        const cleanPhone = rawPhone.replace(/\D/g, '');
        if (cleanPhone.length > 10 && !rawPhone.startsWith('+')) {
          rawPhone = `+${rawPhone}`;
        }

        return {
          logId: r.id,
          userId: u?.userId || u?.id || uid || '',
          userName: u?.fullName || uid || '',
          userPhone: rawPhone,
          residencyLabel,
          status: r.status || 'Pending',
          timestamp: r.requestedAt || '',
          fromGuideName: fromGuideId ? (guideNameMap.get(String(fromGuideId).toLowerCase()) || 'Unknown') : 'None',
          toGuideName: toGuideId ? (guideNameMap.get(String(toGuideId).toLowerCase()) || 'Unknown') : 'None',
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
            Users.findAll({ filters: { id: { in: ashrayUserIds } }, fields: ['id', 'userId', 'fullName', 'email', 'guide', 'selectedGuideId', 'guideName', 'residency', 'isPrabhupadaWorldUser', 'segment'], limit: 200 }),
            Users.findAll({ filters: { userId: { in: ashrayUserIds } }, fields: ['id', 'userId', 'fullName', 'email', 'guide', 'selectedGuideId', 'guideName', 'residency', 'isPrabhupadaWorldUser', 'segment'], limit: 200 })
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

      const userSegment = context.user.segment || null;
      const isHiranyavarnaOrPwAdmin = !!(
        context.user.isBvSuperAdmin ||
        context.user.isBvAdmin ||
        context.user.isPwAdmin ||
        userRole === 'SUPER_ADMIN' ||
        userRole === 'ADMIN' ||
        userRole === 'PW_ADMIN'
      );

      const filteredAshray = rawAshray.filter((r: any) => {
        const u = ashrayUserMap.get(r.userId);
        if (!u) return false;
        if (!isUserInHierarchy(u, hierarchy)) return false;
        const isPwMember = !!(u.isPrabhupadaWorldUser) || u.segment === 'PW';

        if (userSegment === 'PW') {
          if (!isPwMember) return false;
          if (isHiranyavarnaOrPwAdmin) return true;
          const userGuideId = Array.isArray(u.guide) ? u.guide[0] : u.guide;
          const uGuideStrLower = String(userGuideId || '').toLowerCase();
          return uGuideStrLower === String(guideDbId || '').toLowerCase() || 
                 uGuideStrLower === context.user.id.toLowerCase() ||
                 uGuideStrLower === String(context.user.email || '').toLowerCase();
        } else {
          // FOLK guide view
          if (isPwMember) return false;
          if (isSuperGuide) return true;
          const userGuideId = Array.isArray(u.guide) ? u.guide[0] : u.guide;
          const uGuideStrLower = String(userGuideId || '').toLowerCase();
          return uGuideStrLower === String(guideDbId || '').toLowerCase() || 
                 uGuideStrLower === context.user.id.toLowerCase();
        }
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
