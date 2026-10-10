import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvAttendance, BvGroupRequests, Guides, Users, AppError } from '@/lib/backend-sdk';
import { getTodayIST } from '../lib/streakUtils';
import { isBvSuperAdminUser, resolveBvScopedGroups } from '../lib/bvGroupMemberScope';

const groupSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  description: z.string(),
  memberCount: z.number(),
  totalSessions: z.number(),
  presentToday: z.number(),
  joinToken: z.string().nullable(),
  bvslName: z.string().nullable(),
  guideName: z.string().nullable(),
  meetingTime: z.string().nullable().optional(),
  segment: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  facilitatorIds: z.array(z.string()),
});

export default createEndpoint({
  description: 'Get BV groups led by a BVSL (with member count, session count, today attendance)',
  authenticated: true,
  inputSchema: z.object({
    bvslId: z.string(), // custom userId field value
    viewRole: z.enum(['RGF', 'RGSF']).optional(),
  }),
  outputSchema: z.object({
    groups: z.array(groupSchema),
    pendingRequestCount: z.number(),
    error: z.string().nullable(),
  }),
  execute: async ({ input, context }: any) => {
    let groupRecords: any[] = [];
    let defaultBvslName = 'RGF';
    const isRgsfRequest = input.viewRole === 'RGSF';
    let rgsfCallerKeys = new Set<string>();
    let rgsfParentKeys = new Set<string>();
    let callerKeys = new Set<string>();

    if (input.bvslId === 'ALL' || !input.bvslId) {
      if (!isBvSuperAdminUser(context?.user)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'Viewing all BV groups requires super admin access' });
      }
      const { records } = await BvGroups.findAll({ limit: 500 });
      groupRecords = records;
    } else {
      const facilitatorFields = ['id', 'userId', 'fullName', 'email', 'guide', 'bvReportingFacilitatorId', 'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator', 'bvGroupId', 'bvGroupName'];
      const userRecord = await Users.findOne({ filters: { userId: input.bvslId }, fields: facilitatorFields })
        ?? await Users.findOne({ id: input.bvslId, fields: facilitatorFields });
      
      const dbUserId = userRecord?.id || input.bvslId;
      const parentRgfId = (userRecord as any)?.bvReportingFacilitatorId;
      defaultBvslName = userRecord?.fullName || '';
      const isRgsfView = input.viewRole === 'RGSF';
 
      const { records } = await BvGroups.findAll({
        limit: 1000,
      });
      callerKeys = new Set(
        [
          input.bvslId,
          dbUserId,
          userRecord?.userId,
          userRecord?.email,
          userRecord?.fullName,
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase())
      );
      const assignedGroupRefs = new Set(
        [userRecord?.bvGroupId, userRecord?.bvGroupName]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase())
      );
      rgsfCallerKeys = callerKeys;

      // RGSFs inherit the full group scope of their reporting RGF. Resolve
      // every parent alias because groups created at different times may
      // store a Firestore id, public userId, or email.
      const parentRgfKeys = new Set<string>();
      if (parentRgfId) parentRgfKeys.add(String(parentRgfId).toLowerCase());
      if (parentRgfId) {
        const parent = await Users.findOne({ filters: { userId: String(parentRgfId) }, fields: ['id', 'userId', 'email'] }) ||
          await Users.findOne({ id: String(parentRgfId), fields: ['id', 'userId', 'email'] }) ||
          await Users.findOne({ filters: { email: String(parentRgfId) }, fields: ['id', 'userId', 'email'] });
        [parent?.id, parent?.userId, parent?.email].filter(Boolean).forEach(value => parentRgfKeys.add(String(value).toLowerCase()));
      }
      rgsfParentKeys = parentRgfKeys;

      // RGSF dashboard shows all groups facilitated by its reporting RGF,
      // while retaining direct assignments for legacy group records.
      groupRecords = records.filter((g: any) => {
        if (g.isActive === false) return false;

        const leader = String(g.bvslLeader || '').toLowerCase();
        const bId = String(g.bvslId || '').toLowerCase();
        const facilitatorName = String(g.bvslName || '').toLowerCase();
        const groupRefs = [g.id, g.groupId, g.groupName].filter(Boolean).map((value: unknown) => String(value).toLowerCase());
        const assignedToCaller = groupRefs.some((value: string) => assignedGroupRefs.has(value));
        const subFacilitatorValues = [
          g.subFacilitatorId,
          g.rgsfId,
          g.subFacilitator,
        ].flatMap((value) => Array.isArray(value) ? value : [value])
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());

        if (isRgsfView) {
          const ownerValues = [g.bvslLeader, g.bvslId]
            .flatMap((value) => Array.isArray(value) ? value : [value])
            .filter(Boolean)
            .map((value) => String(value).toLowerCase());
          const isParentGroup = ownerValues.some((value) => parentRgfKeys.has(value));
          const isCallerOwnedLegacyGroup = ownerValues.some((value) => callerKeys.has(value));
          return isParentGroup || isCallerOwnedLegacyGroup || subFacilitatorValues.some((value) => callerKeys.has(value)) || assignedToCaller || callerKeys.has(facilitatorName);
        }

        return (
          callerKeys.has(leader) ||
          callerKeys.has(bId) ||
          callerKeys.has(facilitatorName) ||
          assignedToCaller ||
          subFacilitatorValues.some((value) => callerKeys.has(value)) ||
          (parentRgfId && (
            leader === String(parentRgfId).toLowerCase() ||
            bId === String(parentRgfId).toLowerCase()
          ))
        );
      });
    }

    if (!isBvSuperAdminUser(context.user)) {
      const allowedGroups = await resolveBvScopedGroups(context.user);
      const allowed = new Set(allowedGroups.map(group => group.id));
      const selfAliases = [context.user?.id, context.user?.userId, context.user?.email, context.user?.fullName]
        .filter(Boolean)
        .map((value: unknown) => String(value).toLowerCase());
      const viewingOwnGroups = selfAliases.some((alias: string) => callerKeys.has(alias));
      if (viewingOwnGroups) {
        const seen = new Set(groupRecords.map((group: any) => String(group.id || '')));
        for (const group of allowedGroups) {
          if (!seen.has(group.id)) {
            groupRecords.push(group.record);
            seen.add(group.id);
          }
        }
      }
      groupRecords = groupRecords.filter(group => allowed.has(group.id));
    }
    const dedupedGroupRecords = new Map<string, any>();
    const rgsfGroupPriority = (group: any): number => {
      const ownerValues = [group.bvslLeader, group.bvslId]
        .flatMap((value) => Array.isArray(value) ? value : [value])
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      const subValues = [group.subFacilitatorId, group.rgsfId, group.subFacilitator]
        .flatMap((value) => Array.isArray(value) ? value : [value])
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      if (ownerValues.some(value => rgsfCallerKeys.has(value))) return 3;
      if (subValues.some(value => rgsfCallerKeys.has(value))) return 2;
      if (ownerValues.some(value => rgsfParentKeys.has(value))) return 1;
      return 0;
    };
    for (const group of groupRecords) {
      const ownerKey = String(group.bvslId || group.bvslLeader || '').toLowerCase();
      const timeKey = String(group.meetingTime || group.preferredTimeSlot || '').toLowerCase();
      const normalizedName = String(group.groupName || '').trim().toLowerCase();
      // One RGF can facilitate several groups, including groups that share a
      // name. Collapse only duplicate copies of the same group id.
      const stableId = String(group.groupId || group.id || '').toLowerCase();
      const groupKey = stableId || `${normalizedName}|${ownerKey}|${timeKey}`;
      if (!groupKey) continue;
      const existing = dedupedGroupRecords.get(groupKey);
      if (
        !existing ||
        (existing.isActive === false && group.isActive !== false) ||
        (isRgsfRequest && rgsfGroupPriority(group) > rgsfGroupPriority(existing))
      ) {
        dedupedGroupRecords.set(groupKey, group);
      }
    }
    groupRecords = Array.from(dedupedGroupRecords.values());

    if (groupRecords.length === 0) return { groups: [], pendingRequestCount: 0, error: null };

    const isAll = input.bvslId === 'ALL' || !input.bvslId;
    const todayDate = getTodayIST();

    const facilitatorPromise = (async () => {
      // 1. Batch fetch Facilitator Users
      // IMPORTANT: g.bvslId values are custom app userId strings,
      // NOT Firestore row ids. We must query by userId field, then map by BOTH
      // the row id and the userId so lookups work with either value.
      const facilitatorUserIds = [...new Set(groupRecords.map((g: any) => g.bvslId || g.bvslLeader).filter(Boolean))] as string[];
      const facilitatorMap = new Map<string, any>();
      if (facilitatorUserIds.length > 0) {
        const batches: string[][] = [];
        for (let i = 0; i < facilitatorUserIds.length; i += 30) {
          batches.push(facilitatorUserIds.slice(i, i + 30));
        }
        const results = await Promise.all(batches.map(async (batch) => {
          const [byUserId, byId] = await Promise.all([
            Users.findAll({
              filters: { userId: { in: batch } } as any,
              fields: ['id', 'userId', 'email', 'segment', 'fullName'],
              limit: 100,
            }),
            Users.findAll({
              filters: { id: { in: batch } } as any,
              fields: ['id', 'userId', 'email', 'segment', 'fullName'],
              limit: 100,
            }),
          ]);
          return [...(byUserId?.records || []), ...(byId?.records || [])];
        }));

        const seen = new Set<string>();
        for (const list of results) {
          for (const u of list) {
            if (!seen.has(u.id)) {
              seen.add(u.id);
              facilitatorMap.set(u.id, u);
              facilitatorMap.set(String(u.id).toLowerCase(), u);
              if (u.userId) {
                facilitatorMap.set(u.userId, u);
                facilitatorMap.set(String(u.userId).toLowerCase(), u);
              }
              if (u.email) facilitatorMap.set(String(u.email).toLowerCase(), u);
            }
          }
        }
      }

      // Older groups may have stored a Guides-table ID in bvslId. Resolve those
      // too so their facilitator segment is restored for the FOLK/PW filters.
      const unresolvedFacilitatorIds = facilitatorUserIds.filter(id => !facilitatorMap.has(id));
      if (unresolvedFacilitatorIds.length > 0) {
        const guideBatches: string[][] = [];
        for (let i = 0; i < unresolvedFacilitatorIds.length; i += 30) {
          guideBatches.push(unresolvedFacilitatorIds.slice(i, i + 30));
        }
        const guideLists = await Promise.all(guideBatches.map(async batch => {
          const res = await Guides.findAll({
            filters: { id: { in: batch } } as any,
            fields: ['id', 'guideId', 'fullName', 'email', 'segment'],
            limit: 100,
          });
          return res.records || [];
        }));
        const legacyGuides = guideLists.flat();
        const guideEmails = [...new Set(legacyGuides.map((g: any) => g.email).filter(Boolean))] as string[];
        const usersByGuideEmail = new Map<string, any>();
        for (let i = 0; i < guideEmails.length; i += 30) {
          const { records } = await Users.findAll({
            filters: { email: { in: guideEmails.slice(i, i + 30) } } as any,
            fields: ['id', 'userId', 'segment', 'fullName', 'email'],
            limit: 100,
          });
          for (const user of records) usersByGuideEmail.set(String(user.email || '').toLowerCase(), user);
        }
        for (const guide of legacyGuides) {
          const linkedUser = usersByGuideEmail.get(String(guide.email || '').toLowerCase());
          const resolved = linkedUser || {
            id: guide.id,
            userId: guide.guideId,
            fullName: guide.fullName,
            segment: guide.segment,
          };
          facilitatorMap.set(guide.id, resolved);
          if (guide.guideId) facilitatorMap.set(guide.guideId, resolved);
        }
      }

      return facilitatorMap;
    })();
    const guidePromise = (async () => {
      // 2. Batch fetch Guides
      const guideIds = [...new Set(groupRecords.map((g: any) => Array.isArray(g.guide) ? g.guide[0] : g.guide).filter(Boolean))] as string[];
      const guideMap = new Map<string, any>();
      if (guideIds.length > 0) {
        const batches: string[][] = [];
        for (let i = 0; i < guideIds.length; i += 30) {
          batches.push(guideIds.slice(i, i + 30));
        }
        const results = await Promise.all(batches.map(async (batch) => {
          const res = await Guides.findAll({
            filters: { id: { in: batch } } as any,
            fields: ['id', 'fullName'],
            limit: 100,
          });
          return res?.records || [];
        }));
        for (const list of results) {
          list.forEach((g: any) => guideMap.set(g.id, g));
        }
      }

      return guideMap;
    })();
    const membersPromise = (async () => {
      // 3. Batch fetch BvGroupMembers counts
      // Always scope to the groups we have — avoids fetching ALL members across entire DB
      const groupIdList = groupRecords.map((g: any) => g.id).filter(Boolean);
      const groupPublicIdList = groupRecords.map((g: any) => g.groupId).filter(Boolean);
      const [membersByGroup, membersByGroupId] = await Promise.all([
        BvGroupMembers.findAll({
          filters: { group: { in: [...new Set([...groupIdList, ...groupPublicIdList])] } } as any,
          limit: 5000,
          fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'],
        }),
        groupIdList.length + groupPublicIdList.length > 0
          ? BvGroupMembers.findAll({
              filters: { groupId: { in: [...new Set([...groupIdList, ...groupPublicIdList])] } } as any,
              limit: 5000,
              fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'],
            })
          : Promise.resolve({ records: [] }),
      ]);
      const membershipMap = new Map<string, any>();
      [...membersByGroup.records, ...membersByGroupId.records]
        .forEach((membership: any) => membershipMap.set(String(membership.id), membership));
      const allMembers = [...membershipMap.values()];

      const firstValue = (value: unknown): string => {
        if (Array.isArray(value)) return String(value[0] || '');
        return String(value || '');
      };

      const memberUserIds = [...new Set(allMembers.flatMap((m: any) => [
        firstValue(m.user),
        firstValue(m.userId),
        firstValue(m.memberId),
      ]).filter(Boolean))];

      const userMap: Record<string, any> = {};
      if (memberUserIds.length > 0) {
        const userFields = [
          'id', 'userId', 'email', 'status', 'isBvMember', 'bvGroupId',
          'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid',
          'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id',
        ];
        const lookupFields = [
          'userId', 'id', 'email', 'uid', 'authUid', 'firebaseUid',
          'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId',
          'firebaseId', 'firebaseAuthId', 'firebase_id',
        ];
        const batches: string[][] = [];
        for (let i = 0; i < memberUserIds.length; i += 30) {
          batches.push(memberUserIds.slice(i, i + 30));
        }
        const results = await Promise.all(batches.map(async (batch) => {
          const lists = await Promise.all(lookupFields.map(field => Users.findAll({
            filters: { [field]: { in: batch } } as any,
            fields: userFields,
            limit: 100,
          })));
          return lists.flatMap(result => result.records || []);
        }));

        for (const list of results) {
          for (const u of list) {
            [
              u.id, u.userId, u.email, u.uid, u.authUid, u.firebaseUid,
              u.firebaseUserId, u.firebaseAuthUid, u.authId, u.authUserId,
              u.firebaseId, u.firebaseAuthId, u.firebase_id,
            ].filter(Boolean).forEach(alias => {
              userMap[String(alias).toLowerCase()] = u;
            });
          }
        }
      }

      const memberIdsByGroup = new Map<string, Set<string>>();
      for (const m of allMembers) {
        const groupRec = [firstValue(m.group), firstValue(m.groupId)]
          .filter(Boolean)
          .map(groupRef => groupRecords.find(gr =>
            String(gr.id || '').toLowerCase() === groupRef.toLowerCase() ||
            String(gr.groupId || '').toLowerCase() === groupRef.toLowerCase()
          ))
          .find(Boolean);
        if (!groupRec) continue;

        const uid = firstValue(m.user);
        const altUid = firstValue((m as any).userId);
        const legacyMemberId = firstValue((m as any).memberId);
        const u = userMap[uid.toLowerCase()] || userMap[altUid.toLowerCase()] || userMap[legacyMemberId.toLowerCase()];
        const isActiveUser = !u?.status || String(u.status).toLowerCase() === 'active';
        const groupAliases = new Set([groupRec.id, groupRec.groupId].filter(Boolean).map(value => String(value).toLowerCase()));
        const profileGroupId = firstValue(u?.bvGroupId).toLowerCase();
        const isCurrentGroup = !profileGroupId || groupAliases.has(profileGroupId);
        const isBvMember = u?.isBvMember !== false;

        // Keep legacy records with missing profile fields, but never count an
        // inactive, explicitly removed, or reassigned user from a stale row.
        if (u && isActiveUser && isBvMember && isCurrentGroup) {
          const canonicalUserId = String(u.id || u.userId || uid || altUid || legacyMemberId);
          if (!memberIdsByGroup.has(groupRec.id)) memberIdsByGroup.set(groupRec.id, new Set());
          memberIdsByGroup.get(groupRec.id)!.add(canonicalUserId);
        }
      }

      return memberIdsByGroup;
    })();
    const [facilitatorMap, guideMap, memberIdsByGroup] = await Promise.all([
      facilitatorPromise, guidePromise, membersPromise,
    ]);

    const groups = await Promise.all(groupRecords.map(async (g) => {
      const facilitatorRefs = [g.bvslId, g.bvslLeader]
        .flatMap((value: unknown) => Array.isArray(value) ? value : [value])
        .filter(Boolean)
        .map((value: unknown) => String(value));
      const facilitatorUser = facilitatorRefs
        .flatMap(ref => [facilitatorMap.get(ref), facilitatorMap.get(ref.toLowerCase())])
        .find(user => user?.fullName)
        || facilitatorRefs.flatMap(ref => [facilitatorMap.get(ref), facilitatorMap.get(ref.toLowerCase())]).find(Boolean);
      const guideRes = guideMap.get(Array.isArray(g.guide) ? g.guide[0] : g.guide);
      
      let totalSessions = 0;
      let presentToday = 0;

      // Only fetch attendance stats if it's not the ALL view (to save API calls)
      if (!isAll) {
        const attendanceGroupRefs = [...new Set([g.id, g.groupId].filter(Boolean))];
        const [allGroupAtt, todayPresentAtt] = await Promise.all([
          BvAttendance.findAll({ filters: { group: attendanceGroupRefs.length > 1 ? { in: attendanceGroupRefs } : g.id } as any, fields: ['attendanceDate'], limit: 2000 }),
          BvAttendance.findAll({ filters: { group: attendanceGroupRefs.length > 1 ? { in: attendanceGroupRefs } : g.id, attendanceDate: todayDate, present: true } as any, fields: ['id'], limit: 200 }),
        ]);
        const distinctDates = new Set(allGroupAtt.records.map((a: any) => a.attendanceDate).filter(Boolean));
        totalSessions = distinctDates.size;
        presentToday = todayPresentAtt.records.length;
      }

      return {
        id: g.id,
        groupId: g.groupId || g.id,
        groupName: g.groupName || '',
        description: g.description || '',
        memberCount: memberIdsByGroup.get(g.id)?.size || 0,
        totalSessions,
        presentToday,
        joinToken: g.joinToken || null,
        bvslName: facilitatorUser?.fullName || g.bvslName || defaultBvslName || null,
        guideName: guideRes?.fullName || null,
        meetingTime: g.meetingTime || g.preferredTimeSlot || null,
        // Facilitator ownership is authoritative. This also repairs the
        // display of groups created before createBvGroup resolved custom IDs.
        segment: String(facilitatorUser?.segment || g.segment || 'PW').toUpperCase() === 'FOLK' ? 'FOLK' : 'PW',
        isActive: g.isActive ?? true,
        facilitatorIds: [...new Set(
          [g.bvslLeader, g.bvslId, g.bvslName, facilitatorUser?.id, facilitatorUser?.userId, facilitatorUser?.email, facilitatorUser?.fullName]
            .flatMap((value: unknown) => Array.isArray(value) ? value : [value])
            .map((value: unknown) => String(value || '').trim())
            .filter(Boolean),
        )],
      };
    }));

    // Count pending join requests (only if not ALL view)
    let pendingRequestCount = 0;
    if (!isAll) {
      for (const g of groupRecords) {
        const { records: reqs } = await BvGroupRequests.findAll({
          filters: { group: g.id, status: 'Pending' },
          limit: 100,
          fields: ['id'],
        });
        pendingRequestCount += reqs.length;
      }
    }

    return { groups, pendingRequestCount, error: null };
  },
});
