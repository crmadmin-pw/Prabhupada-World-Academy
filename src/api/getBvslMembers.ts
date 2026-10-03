import { z } from 'zod';
import { createEndpoint, Users, Guides, BvGroups, BvGroupMembers, FolkResidencies } from '@/lib/backend-sdk';
import { serverCacheGetOrFetch } from '../lib/serverCache';

const formatPhone = (phone?: string) => {
  if (!phone) return '';
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length > 10 && !phone.startsWith('+')) {
    return `+${phone}`;
  }
  return phone;
};

export default createEndpoint({
  description: 'Get members for BVSL groups',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string().optional(),
    bvslId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (!context.user) throw new Error('Unauthorized');
    // 5-minute cache — member lists change only when someone joins/leaves a group.
    const cacheKey = `bvslMembers:${input.bvslId || ''}:${input.guideId || ''}:${context.user.id}`;
    return serverCacheGetOrFetch(cacheKey, () => _fetchBvslMembers({ input, context }), 5 * 60 * 1000);
  },
});

async function _fetchBvslMembers({ input, context }: { input: any; context: any }) {
    const isSuperGuide = context.user.role === 'Super Guide';
    let guideDbId: string | null = null;

    // If bvslId given, find groups led by that BVSL user
    if (input.bvslId) {
      let bvslUser = await Users.findOne({ filters: { userId: input.bvslId }, fields: ['id', 'userId', 'email', 'role', 'bvReportingFacilitatorId', 'isBvSubFacilitator'] });
      if (!bvslUser) {
        bvslUser = await Users.findOne({ id: input.bvslId, fields: ['id', 'userId', 'email', 'role', 'bvReportingFacilitatorId', 'isBvSubFacilitator'] });
      }
      if (!bvslUser) {
        bvslUser = await Users.findOne({ filters: { email: input.bvslId }, fields: ['id', 'userId', 'email', 'role', 'bvReportingFacilitatorId', 'isBvSubFacilitator'] });
      }

      const keys = new Set<string>();
      if (input.bvslId) keys.add(input.bvslId.toLowerCase());
      let parentRgfId: string | undefined;
      if (bvslUser) {
        if (bvslUser.id) keys.add(bvslUser.id.toLowerCase());
        if (bvslUser.userId) keys.add(bvslUser.userId.toLowerCase());
        if (bvslUser.email) keys.add(bvslUser.email.toLowerCase());
        parentRgfId = (bvslUser as any).bvReportingFacilitatorId;
      }

      // For an RGSF, inherit every group owned by the reporting RGF. Parent
      // references may use either the database id, public userId, or email.
      const parentRgfKeys = new Set<string>();
      const isRgsfView = !!(bvslUser as any)?.isBvSubFacilitator ||
        String((bvslUser as any)?.role || '').toUpperCase().replace(/[\s-]+/g, '_').includes('RGSF');
      if (parentRgfId) parentRgfKeys.add(String(parentRgfId).toLowerCase());
      if (parentRgfId) {
        const parent = await Users.findOne({ filters: { userId: String(parentRgfId) }, fields: ['id', 'userId', 'email'] }).catch(() => undefined) ||
          await Users.findOne({ id: String(parentRgfId), fields: ['id', 'userId', 'email'] }).catch(() => undefined) ||
          await Users.findOne({ filters: { email: String(parentRgfId) }, fields: ['id', 'userId', 'email'] }).catch(() => undefined);
        [parent?.id, parent?.userId, parent?.email].filter(Boolean).forEach(value => parentRgfKeys.add(String(value).toLowerCase()));
      }

      const { records: allGroups } = await BvGroups.findAll({
        filters: { isActive: true } as any,
        fields: ['id', 'groupId', 'groupName', 'bvslLeader', 'bvslId', 'subFacilitatorId', 'rgsfId', 'bvslName'],
        limit: 200,
      });

      const bvslGroups = allGroups.filter((g: any) => {
        const leaderRefs = (Array.isArray(g.bvslLeader) ? g.bvslLeader : [g.bvslLeader]).filter(Boolean).map((value: any) => String(value).toLowerCase());
        const bIdRefs = (Array.isArray(g.bvslId) ? g.bvslId : [g.bvslId]).filter(Boolean).map((value: any) => String(value).toLowerCase());
        const leader = leaderRefs[0] || '';
        const bId = bIdRefs[0] || '';
        const bName = String(g.bvslName || '').toLowerCase();
        const sub = String(g.subFacilitatorId || g.rgsfId || '').toLowerCase();
        const parentGroup = isRgsfView && [...leaderRefs, ...bIdRefs].some(value => parentRgfKeys.has(value));
        return (
          keys.has(leader) ||
          keys.has(bId) ||
          keys.has(sub) ||
          parentGroup ||
          (input.bvslId.toLowerCase().includes('hiranya') && (bName.includes('hiranya') || leader.includes('hiranya')))
        );
      });

      let targetGroups = bvslGroups;
      if (targetGroups.length === 0 && isSuperGuide) {
        targetGroups = allGroups;
      }
      if (targetGroups.length === 0) return { members: [] };

      const groupIds = targetGroups.map((g: any) => g.id);
      const groupMap: Record<string, string> = {};
      const groupIdMap: Record<string, string> = {};
      targetGroups.forEach((g: any) => {
          groupMap[g.id] = (g.groupName as string) || '';
          groupIdMap[g.id] = (g.groupId as string) || g.id;
          if (g.groupId) {
            groupMap[g.groupId] = (g.groupName as string) || '';
            groupIdMap[g.groupId] = (g.groupId as string) || g.id;
          }
        });

        const { records: memberships } = await BvGroupMembers.findAll({
          filters: { group: { in: groupIds } },
          fields: ['id', 'user', 'group'],
          limit: 500,
        });
        const targetGroupKeys = [...new Set(targetGroups.flatMap((g: any) => [g.id, g.groupId].filter(Boolean)))];
        const { records: membershipsByGroupId } = await BvGroupMembers.findAll({
          filters: { groupId: { in: targetGroupKeys } } as any,
          fields: ['id', 'user', 'userId', 'group', 'groupId'],
          limit: 1000,
        }).catch(() => ({ records: [] }));
        const membershipMap = new Map<string, any>();
        [...memberships, ...membershipsByGroupId].forEach((membership: any) => membershipMap.set(String(membership.id), membership));
        const allMemberships = [...membershipMap.values()];

        const userIds = [...new Set(allMemberships.flatMap((m: any) => [m.user, m.userId]).flatMap((value: any) => Array.isArray(value) ? value : [value]).filter(Boolean))] as string[];
        let memberUsers: any[] = [];
        if (userIds.length > 0) {
          const userQueries = await Promise.all([
            Users.findAll({ filters: { id: { in: userIds } } as any, fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'email', 'residency', 'residencyApproved', 'role', 'roles', 'isRgsf', 'pwChantingTarget', 'pwReadingTarget'], limit: 500 }).catch(() => ({ records: [] })),
            Users.findAll({ filters: { userId: { in: userIds } } as any, fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'email', 'residency', 'residencyApproved', 'role', 'roles', 'isRgsf', 'pwChantingTarget', 'pwReadingTarget'], limit: 500 }).catch(() => ({ records: [] })),
            Users.findAll({ filters: { email: { in: userIds } } as any, fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'email', 'residency', 'residencyApproved', 'role', 'roles', 'isRgsf', 'pwChantingTarget', 'pwReadingTarget'], limit: 500 }).catch(() => ({ records: [] })),
          ]);
          const uniqueUsers = new Map<string, any>();
          userQueries.flatMap(result => result.records || []).forEach((user: any) => uniqueUsers.set(String(user.id), user));
          memberUsers = [...uniqueUsers.values()];
        }

        const userMap: Record<string, any> = {};
        memberUsers.forEach((u: any) => {
          [u.id, u.userId, u.email].filter(Boolean).forEach((key: any) => { userMap[String(key).toLowerCase()] = u; });
        });

        // Get residency names
        const residencyIds = [...new Set(memberUsers.map((u: any) => Array.isArray(u.residency) ? u.residency[0] : u.residency).filter(Boolean))] as string[];
        const residencyMap: Record<string, string> = {};
        if (residencyIds.length > 0) {
          const { records: residencies } = await FolkResidencies.findAll({ filters: { id: { in: residencyIds } }, fields: ['id', 'residencyName'], limit: 100 });
          residencies.forEach((r: any) => { residencyMap[r.id] = (r.residencyName as string) || ''; });
        }

        const callerId = String(context.user.id || '').toLowerCase();
        const callerUserId = String(context.user.userId || '').toLowerCase();
        const callerEmail = String(context.user.email || '').toLowerCase();

        const members = allMemberships.map((m: any) => {
          const uid = Array.isArray(m.user) ? m.user[0] : m.user as string;
          const gid = Array.isArray(m.group) ? m.group[0] : (m.group || (Array.isArray(m.groupId) ? m.groupId[0] : m.groupId)) as string;
          const u = userMap[String(uid || '').toLowerCase()] as any;
          if (!u) return null;

          const uId = String(u.id || '').toLowerCase();
          const uUserId = String(u.userId || '').toLowerCase();
          const uEmail = String(u.email || '').toLowerCase();

          // 1. Exclude self
          if (uId === callerId || uUserId === callerUserId || (callerEmail && uEmail === callerEmail)) {
            return null;
          }

          // 2. Exclude Super Admins
          const uRole = (u.role || '').toUpperCase();
          const uIsSuperAdmin = !!(u.isBvSuperAdmin || uRole === 'SUPER ADMIN' || uRole === 'SUPER_ADMIN');
          if (uIsSuperAdmin) {
            return null;
          }

          const residencyId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
          return {
            userId: u.userId || uid || '',
            fullName: (u.fullName as string) || '',
            phone: formatPhone(u.phone),
            ashrayLevel: (u.ashrayLevel as string) || null,
            email: (u.email as string) || '',
            groupName: groupMap[gid] || '',
            groupId: groupIdMap[gid] || '',
            isResident: !!(u.residencyApproved && residencyId),
            residencyName: residencyId ? (residencyMap[residencyId] || null) : null,
            isRgsf: !!(u.isRgsf || u.role === 'RGSF' || (Array.isArray(u.roles) && u.roles.includes('RGSF'))),
            pwChantingTarget: u.pwChantingTarget ?? null,
            pwReadingTarget: u.pwReadingTarget ?? null,
          };
        }).filter(member => member !== null);

        return { members };
      }

    // Fallback: get by guide
    if (!isSuperGuide) {
      const guide = await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id'] });
      if (!guide) return { members: [] };
      guideDbId = (guide as any).id;
    }

    const filter: any = { isBvsl: true, status: 'Active' };
    if (guideDbId) filter.guide = guideDbId;

    const { records } = await Users.findAll({
      filters: filter,
      fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'email', 'role', 'isBvSuperAdmin', 'pwChantingTarget', 'pwReadingTarget'],
      limit: 500,
    });

    const callerId = String(context.user.id || '').toLowerCase();
    const callerUserId = String(context.user.userId || '').toLowerCase();
    const callerEmail = String(context.user.email || '').toLowerCase();

    const members = records.map((u: any) => {
      const uId = String(u.id || '').toLowerCase();
      const uUserId = String(u.userId || '').toLowerCase();
      const uEmail = String(u.email || '').toLowerCase();

      // 1. Exclude self
      if (uId === callerId || uUserId === callerUserId || (callerEmail && uEmail === callerEmail)) {
        return null;
      }

      // 2. Exclude Super Admins
      const uRole = (u.role || '').toUpperCase();
      const uIsSuperAdmin = !!(u.isBvSuperAdmin || uRole === 'SUPER ADMIN' || uRole === 'SUPER_ADMIN');
      if (uIsSuperAdmin) {
        return null;
      }

      return {
        userId: (u.userId as string) || u.id,
        fullName: (u.fullName as string) || '',
        phone: formatPhone(u.phone),
        ashrayLevel: (u.ashrayLevel as string) || null,
        email: (u.email as string) || '',
        groupName: '',
        isResident: false,
        residencyName: null,
        pwChantingTarget: u.pwChantingTarget ?? null,
        pwReadingTarget: u.pwReadingTarget ?? null,
      };
    }).filter(member => member !== null);

    return { members };
}
