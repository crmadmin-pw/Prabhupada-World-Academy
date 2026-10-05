import { z } from 'zod';
import { createEndpoint, BvGroupMembers, BvGroupRequests, BvGroups, BvAttendance, Users, Guides } from '@/lib/backend-sdk';
import { getTodayIST } from '../lib/streakUtils';

function firstValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

function referenceValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(referenceValues);
  if (value == null) return [];
  return String(value).split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

/** Firestore equality is case-sensitive. Query with the stored id, and compare
 * a lowercased copy only after the rows are in memory. */
function exactValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(exactValues);
  if (value == null) return [];
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

export default createEndpoint({
  description: 'Get current user BV group status, attendance streak, and available groups',
  authenticated: true,
  inputSchema: z.object({ userId: z.string().optional(), localDate: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    const uid = context.user!.id;
    const today = getTodayIST();

    const userRecord = await Users.findOne({ id: uid, fields: ['id', 'userId', 'fullName', 'email', 'bvGroupId', 'bvGroupName', 'bvRegistrationStatus', 'isBvMember', 'pendingBvGroupAssignmentNotice', 'segment', 'isPrabhupadaWorldUser'] }).catch(() => null);
    const altUid = userRecord?.userId || uid;
    const userIdentityKeys = new Set([
      uid,
      userRecord?.id,
      userRecord?.userId,
      userRecord?.email,
    ].flatMap(referenceValues));

    // A member exists only when a real BvGroupMembers document exists. Query
    // both identifier fields to support legacy custom user IDs without using a
    // stale bvGroupId profile field as a synthetic membership.
    const identityKeys = new Set([
      uid,
      context.user?.uid,
      userRecord?.id,
      altUid,
      userRecord?.fullName,
      userRecord?.email,
      context.user?.email,
    ].flatMap(referenceValues));
    const identityQueryKeys = [...new Set([
      uid,
      context.user?.uid,
      userRecord?.id,
      altUid,
      userRecord?.fullName,
      userRecord?.email,
      context.user?.email,
    ].flatMap(exactValues))].slice(0, 30);
    const [membershipByUser, membershipByUserId, pendingRes] = await Promise.all([
      BvGroupMembers.findAll({ filters: { user: { in: identityQueryKeys } }, limit: 5, fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId', 'role', 'joinedAt'] }),
      BvGroupMembers.findAll({ filters: { userId: { in: identityQueryKeys } }, limit: 5, fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId', 'role', 'joinedAt'] }),
      BvGroupRequests.findAll({ filters: { user: uid, status: 'Pending' }, limit: 5, fields: ['id', 'group', 'requestedAt'] }),
    ]);
    // The fast indexed lookups cover current records. Fall back to the small
    // membership table only for legacy rows that saved a custom ID, email, or
    // display name. Without this, an active member can have a real membership
    // but never receive `myGroup`, which also hid their quiz section.
    let rawMembership = membershipByUser.records[0] || membershipByUserId.records[0];
    if (!rawMembership) {
      const { records: memberships } = await BvGroupMembers.findAll({
        limit: 5000,
        fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId', 'role', 'joinedAt'],
      });
      rawMembership = memberships.find(member =>
        referenceValues([member.user, member.userId, (member as any).memberId])
          .some(reference => identityKeys.has(reference))
      );
    }
    if (!rawMembership && userRecord && (userRecord.isBvMember === true || userRecord.pendingBvGroupAssignmentNotice === true)) {
      const profileGroup = String(userRecord.bvGroupId || userRecord.bvGroupName || '').trim();
      if (profileGroup) {
        rawMembership = {
          id: `profile-${userRecord.id}`,
          user: userRecord.id,
          userId: userRecord.userId,
          group: userRecord.bvGroupId || profileGroup,
          groupId: userRecord.bvGroupId || profileGroup,
        } as any;
      }
    }
    // A BvGroupMembers document is the authoritative membership record. A
    // profile flag can be stale after an approval or group assignment.
    const membership = rawMembership;
    for (const alias of referenceValues([
      membership?.id,
      membership?.user,
      membership?.userId,
      (membership as any)?.memberId,
    ])) {
      userIdentityKeys.add(alias.toLowerCase());
    }

    const pending = pendingRes.records[0];
    const isUserRegPending = userRecord?.bvRegistrationStatus === 'Pending Approval' || userRecord?.bvRegistrationStatus === 'Pending';

    // Not in any group — return available groups or pending status
    if (!membership) {
      const pendingGroupId = pending
        ? (Array.isArray(pending.group) ? pending.group[0] : pending.group)
        : null;

      const [availGroupsRes, pendingGroup] = await Promise.all([
        (pending || isUserRegPending) ? Promise.resolve({ records: [] }) : BvGroups.findAll({
          filters: { isActive: true }, limit: 50,
          fields: ['id', 'groupId', 'groupName', 'description', 'bvslLeader', 'bvslId', 'bvslName', 'segment'],
        }),
        pendingGroupId ? BvGroups.findOne({ id: pendingGroupId, fields: ['id', 'groupName', 'groupId'] }) : Promise.resolve(null),
      ]);

      if (pendingGroup || isUserRegPending) {
        return {
          myGroup: null,
          pendingRequest: {
            groupId: (pendingGroup as any)?.groupId || (pendingGroup as any)?.id || 'pending',
            groupName: (pendingGroup as any)?.groupName || 'Bhakti Vriksha Registration',
            status: 'Pending Approval',
          },
          availableGroups: [],
          todayStatus: null, streak: 0, presentCount: 0, totalSessions: 0,
        };
      }

      const groups = availGroupsRes.records;
      const memberCountMap: Record<string, number> = {};
      if (groups.length > 0) {
        await Promise.all(groups.map(async (g: any) => {
          const { records: mems } = await BvGroupMembers.findAll({
            filters: { group: g.id }, fields: ['id'], limit: 1000,
          });
          memberCountMap[g.id] = mems.length;
        }));
      }

      const leaderIds = [...new Set(groups.map((g: any) => Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : (g.bvslLeader || g.bvslId)).filter(Boolean))] as string[];
      const leaderMap: Record<string, { fullName: string; segment?: string }> = {};
      if (leaderIds.length > 0) {
        const leaderRecords = await Users.findAll({ filters: { id: { in: leaderIds } }, fields: ['id', 'fullName', 'segment'] });
        leaderRecords.records.forEach((u: any) => {
          leaderMap[u.id] = {
            fullName: u.fullName || '',
            segment: u.segment || 'PW'
          };
        });
      }

      const userSegment = userRecord?.segment || (userRecord?.isPrabhupadaWorldUser ? 'PW' : 'FOLK') || 'PW';

      const availableGroupsMapped = groups
        .filter((g: any) => {
          const leaderId = Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : (g.bvslLeader || g.bvslId);
          const groupSegment = g.segment || leaderMap[leaderId || '']?.segment || 'PW';
          return groupSegment === userSegment;
        })
        .map((g: any) => {
          const leaderId = Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : (g.bvslLeader || g.bvslId);
          return {
            groupId: g.groupId || g.id,
            groupName: g.groupName || '',
            description: g.description || '',
            bvslName: leaderMap[leaderId || '']?.fullName || g.bvslName || 'Unassigned',
            memberCount: memberCountMap[g.id] ?? 0,
          };
        });

      return {
        myGroup: null,
        pendingRequest: null,
        availableGroups: availableGroupsMapped,
        todayStatus: null, streak: 0, presentCount: 0, totalSessions: 0,
      };
    }

    // In a group — get group details + attendance
    const storedGroupId = Array.isArray(membership.group) ? membership.group[0] : (membership.group || (membership as any).groupId);
    if (!storedGroupId) return { myGroup: null, pendingRequest: null, availableGroups: [], todayStatus: null, streak: 0, presentCount: 0, totalSessions: 0 };

    const groupFields = ['id', 'groupId', 'groupName', 'bvslLeader', 'bvslId', 'bvslName'];
    const groupRecord = await BvGroups.findOne({ id: storedGroupId, fields: groupFields })
      .catch(() => null)
      || await BvGroups.findOne({ filters: { groupId: storedGroupId }, fields: groupFields })
        .catch(() => null)
      || await BvGroups.findOne({ filters: { groupName: storedGroupId }, fields: groupFields })
        .catch(() => null);
    const groupQueryRefs = [...new Set([storedGroupId, groupRecord?.id, groupRecord?.groupId, groupRecord?.groupName].flatMap(exactValues))];
    const groupMatchKeys = new Set(groupQueryRefs.flatMap(referenceValues));
    const [membersByGroup, membersByGroupId, attendanceByGroup, attendanceByGroupId] = await Promise.all([
      BvGroupMembers.findAll({ filters: { group: { in: groupQueryRefs } }, fields: ['id', 'user', 'userId', 'memberId'], limit: 1000 }),
      BvGroupMembers.findAll({ filters: { groupId: { in: groupQueryRefs } }, fields: ['id', 'user', 'userId', 'memberId'], limit: 1000 }).catch(() => ({ records: [] })),
      BvAttendance.findAll({ filters: { group: { in: groupQueryRefs } }, fields: ['id', 'user', 'group', 'groupId', 'present', 'attendanceDate'], limit: 1000 }),
      BvAttendance.findAll({ filters: { groupId: { in: groupQueryRefs } }, fields: ['id', 'user', 'group', 'groupId', 'present', 'attendanceDate'], limit: 1000 }).catch(() => ({ records: [] })),
    ]);

    const group = groupRecord as any;
    let groupMemberRecords = [...membersByGroup.records, ...membersByGroupId.records]
      .filter((member: any, index: number, records: any[]) => records.findIndex(item => item.id === member.id) === index);
    // Some legacy rows store the group's custom groupId in `group` while the
    // indexed query above uses the document ID. Recover those rows from the
    // bounded membership collection so the dashboard count reflects reality.
    if (groupMemberRecords.length === 0) {
      const { records: allMemberships } = await BvGroupMembers.findAll({
        fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'], limit: 5000,
      }).catch(() => ({ records: [] }));
      groupMemberRecords = allMemberships.filter((member: any) =>
        referenceValues([member.group, member.groupId]).some(value => groupMatchKeys.has(value))
      );
    }
    const groupMembersRes = {
      records: groupMemberRecords,
    };
    const memberCount = groupMembersRes.records.length;
    let allGroupAtt = [...attendanceByGroup.records, ...attendanceByGroupId.records]
      .filter((attendance: any, index: number, records: any[]) => records.findIndex(item => item.id === attendance.id) === index);
    // Group ids such as BV-GROUP-* are case-sensitive in Firestore. Recover
    // marks in memory when the indexed read was stored under another alias.
    if (allGroupAtt.length === 0 && groupMatchKeys.size > 0) {
      const { records: attendanceRows } = await BvAttendance.findAll({
        fields: ['id', 'user', 'group', 'groupId', 'present', 'attendanceDate'],
        limit: 5000,
      }).catch(() => ({ records: [] }));
      allGroupAtt = attendanceRows.filter((attendance: any) =>
        referenceValues([attendance.group, attendance.groupId]).some(value => groupMatchKeys.has(value))
      );
    }

    // Get this user's attendance
    const myAtt = allGroupAtt.filter((a: any) => {
      const u = Array.isArray(a.user) ? a.user[0] : a.user;
      return userIdentityKeys.has(String(u || '').trim().toLowerCase());
    });

    // Build maps
    const myAttByDate = new Map<string, boolean>();
    for (const a of myAtt) {
      const date = a.attendanceDate as string;
      if (date) myAttByDate.set(date, !!a.present);
    }

    // All distinct session dates for this group (sorted desc)
    const sessionDates = [...new Set(
      allGroupAtt.map((a: any) => a.attendanceDate).filter(Boolean)
    )].sort((a: any, b: any) => b.localeCompare(a)) as string[];

    // Today status
    const todayStatus = myAttByDate.has(today) ? (myAttByDate.get(today) ? 'P' : 'A') : null;

    // Streak: consecutive sessions (most recent first) where user was present
    let streak = 0;
    for (const date of sessionDates) {
      const wasPresent = myAttByDate.get(date);
      if (wasPresent) streak++;
      else break;
    }

    const presentCount = myAtt.filter((a: any) => a.present).length;

    const leaderId = Array.isArray(group?.bvslLeader) ? group.bvslLeader[0] : (group?.bvslLeader || group?.bvslId);
    let bvslName = '';
    if (leaderId) {
      let leaderRec = await Users.findOne({ id: leaderId, fields: ['id', 'fullName'] });
      if (!leaderRec) {
        leaderRec = await Users.findOne({ filters: { userId: leaderId }, fields: ['id', 'fullName'] });
      }
      if (leaderRec) {
        bvslName = leaderRec.fullName || '';
      } else {
        const gRec = await Guides.findOne({ id: leaderId, fields: ['id', 'fullName'] }).catch(() => null) ||
                     await Guides.findOne({ filters: { guideId: leaderId }, fields: ['id', 'fullName'] }).catch(() => null);
        if (gRec) {
          bvslName = gRec.fullName || '';
        }
      }
      if (!bvslName) {
        bvslName = (typeof leaderId === 'string' && !leaderId.startsWith('USER-') && !leaderId.startsWith('REC') ? leaderId : '');
      }
    }

    const groupName = group?.groupName || userRecord?.bvGroupName || '';
    const finalFacilitator = bvslName || group?.bvslName || groupName || '';

    let rgsfName = 'None';
    const memberUserIds = groupMembersRes.records.map((m: any) => Array.isArray(m.user) ? m.user[0] : (m.user || m.userId)).filter(Boolean);
    if (memberUserIds.length > 0) {
      const subFacilitatorUsers = await Users.findAll({
        filters: { id: { in: memberUserIds }, isBvSubFacilitator: true },
        fields: ['id', 'fullName'],
        limit: 10,
      });
      let subNames = subFacilitatorUsers.records.map((u: any) => u.fullName).filter(Boolean);
      if (subNames.length === 0) {
        const altSubs = await Users.findAll({
          filters: { userId: { in: memberUserIds }, isBvSubFacilitator: true },
          fields: ['id', 'fullName'],
          limit: 10,
        });
        subNames = altSubs.records.map((u: any) => u.fullName).filter(Boolean);
      }
      if (subNames.length > 0) {
        rgsfName = subNames.join(', ');
      }
    }

    return {
      myGroup: {
        groupId: group?.groupId || group?.id || storedGroupId,
        groupName,
        bvslName: finalFacilitator,
        rgsfName,
        memberCount,
      },
      pendingRequest: null,
      availableGroups: [],
      todayStatus,
      streak,
      presentCount,
      totalSessions: sessionDates.length,
    };
  },
});
