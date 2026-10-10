import { z } from 'zod';
import { createEndpoint, Users, Guides, BvGroups, BvGroupMembers } from '@/lib/backend-sdk';
import { requireGuideRole } from '../lib/userUtils';

export default createEndpoint({
  description: 'Get eligible members (active non-folk-residents) for adding to BV groups under this guide',
  authenticated: true,
  inputSchema: z.object({ guideId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, {
      isSadhanaMentor: context.user.isSadhanaMentor,
      isBvsl: context.user.isBvsl,
      isBvMentor: (context.user as any).isBvMentor,
      isBvAdmin: (context.user as any).isBvAdmin,
      isBvSupervisor: (context.user as any).isBvSupervisor,
      isBvSuperAdmin: (context.user as any).isBvSuperAdmin,
    });

    // Robust 3-step guide ID resolution (handles Users-table UUID, Guides-table UUID, or custom ID)
    let guideDbId: string | null = null;

    // Step 1: Try direct Guides-table lookup by UUID
    const directGuideRec = await Guides.findOne({ id: input.guideId, fields: ['id'] });
    if (directGuideRec) {
      guideDbId = directGuideRec.id;
    } else {
      // Step 2: Try as a Users-table UUID — look up email, then find Guides record
      const guideUser = await Users.findOne({ id: input.guideId, fields: ['id', 'email'] });
      if (guideUser?.email) {
        const guideByEmail = await Guides.findOne({ filters: { email: guideUser.email }, fields: ['id'] });
        if (guideByEmail) guideDbId = guideByEmail.id;
      }
      // Step 3: Fallback — legacy custom guideId string field
      if (!guideDbId) {
        const guideByCustomId = await Guides.findOne({ filters: { guideId: input.guideId }, fields: ['id'] });
        if (guideByCustomId) guideDbId = guideByCustomId.id;
      }
    }

    if (!guideDbId) return { members: [] };

    const guideRec = await Guides.findOne({ id: guideDbId, fields: ['id', 'guideId', 'email', 'userId', 'segment'] });
    const guideSegment = guideRec?.segment || context.user.segment || 'PW';
    const guideUser = guideRec?.email
      ? await Users.findOne({ filters: { email: guideRec.email }, fields: ['id', 'userId', 'email'] })
      : await Users.findOne({ id: input.guideId, fields: ['id', 'userId', 'email'] });
    // Approved members may be linked by a user id rather than the Guides-table
    // UUID. Match every identity the approving admin can be stored under.
    const ownerIds = [...new Set(
      [guideDbId, input.guideId, guideRec?.guideId, guideRec?.email, guideRec?.userId, guideUser?.id, guideUser?.userId, guideUser?.email]
        .map(value => String(value || '').trim())
        .filter(Boolean),
    )];
    const ownerKeys = new Set(ownerIds.map(value => value.toLowerCase()));

    // Fetch all BV groups under this guide to know who's already in a group
    const { records: groups } = await BvGroups.findAll({
      filters: { guide: guideDbId },
      fields: ['id', 'groupId', 'groupName'],
      limit: 200,
    });
    const groupDbIds = groups.map(g => g.id);

    // Build map: userDbId -> { groupId, groupName }
    const memberGroupMap: Record<string, { groupId: string; groupName: string }> = {};
    if (groupDbIds.length > 0) {
      const { records: allMembers } = await BvGroupMembers.findAll({
        filters: { group: { in: groupDbIds } as any },
        fields: ['user', 'group'],
        limit: 2000,
      });
      for (const m of allMembers) {
        const uid = (Array.isArray(m.user) ? m.user[0] : m.user) as string;
        const gid = (Array.isArray(m.group) ? m.group[0] : m.group) as string;
        if (uid && gid) {
          const grp = groups.find(g => g.id === gid);
          if (grp) memberGroupMap[uid] = { groupId: grp.groupId || grp.id, groupName: grp.groupName || '' };
        }
      }
    }

    const memberFields = ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'isBvsl', 'guide', 'selectedGuideId', 'bvReportingAdminId'];
    const linkedPages = await Promise.all(ownerIds.flatMap(ownerId => (
      ['guide', 'selectedGuideId', 'bvReportingAdminId'] as const
    ).map(field => Users.findAll({
      filters: { [field]: ownerId, status: 'Active', segment: guideSegment },
      fields: memberFields,
      limit: 1000,
    }))));
    const usersById = new Map<string, any>();
    for (const page of linkedPages) {
      for (const user of page.records || []) if (user?.id) usersById.set(user.id, user);
    }
    const users = [...usersById.values()];

    const reportsToGuide = (user: any) => [user.guide, user.selectedGuideId, user.bvReportingAdminId]
      .flatMap(value => Array.isArray(value) ? value : [value])
      .map(value => String(value || '').trim().toLowerCase())
      .some(value => ownerKeys.has(value));

    // Include every active member of this admin, including people approved
    // before a Reading Group was chosen.
    const eligible = users.filter(u => !!u.userId && reportsToGuide(u));

    return {
      members: eligible.map(u => ({
        userId: u.id,
        displayId: u.userId || u.id,
        fullName: u.fullName || '',
        phone: u.phone || '',
        ashrayLevel: u.ashrayLevel || null,
        isBvsl: u.isBvsl || false,
        existingGroup: memberGroupMap[u.id] || null,
      })),
    };
  },
});
