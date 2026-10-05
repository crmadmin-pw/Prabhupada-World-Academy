import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvAttendance, Users, FolkResidencies } from '@/lib/backend-sdk';
import { readBvProfileAttendance } from '../lib/bvProfileAttendance';

const USER_IDENTITY_FIELDS = ['id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];
const USER_FIELDS = ['id', 'userId', 'email', 'fullName', 'displayName', 'name', 'residencyApproved', 'residencyGuideVerified', 'residency', 'selectedFolkResidency', 'residencyName', 'ashrayLevel', 'bvGroupId', 'bvGroupName', 'isBvMember', 'pendingBvGroupAssignmentNotice', ...USER_IDENTITY_FIELDS.filter(field => !['id', 'userId', 'email'].includes(field))];

function firstValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

function referenceValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(referenceValues);
  if (value == null) return [];
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function userIdentityAliases(user: any): string[] {
  return [...new Set(USER_IDENTITY_FIELDS
    .map(field => user?.[field])
    .filter(Boolean)
    .map(value => String(value).trim())
    .filter(Boolean))];
}

function formatDisplayName(str: string): string {
  if (!str) return 'Member';
  const trimmed = str.trim();
  if (!trimmed.includes('@')) return trimmed;
  const username = trimmed.split('@')[0].replace(/[._-]+/g, ' ').trim();
  if (!username) return trimmed;
  return username.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function findUsersForAliases(aliases: string[]): Promise<any[]> {
  const uniqueAliases = [...new Set(aliases.filter(Boolean))];
  const users = new Map<string, any>();

  for (let i = 0; i < uniqueAliases.length; i += 30) {
    const chunk = uniqueAliases.slice(i, i + 30);
    const lookups = await Promise.all(USER_IDENTITY_FIELDS.map(field =>
      Users.findAll({ filters: { [field]: { in: chunk } }, fields: USER_FIELDS, limit: 30 }).catch(() => ({ records: [] }))
    ));
    for (const user of lookups.flatMap(result => result.records)) {
      users.set(user.id, user);
    }
  }

  return [...users.values()];
}

export default createEndpoint({
  description: 'Get BV attendance history and leaderboard for the current user',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string().optional(),
    localDate: z.string().optional(),
    sinceDate: z.string().optional(),
    untilDate: z.string().optional(),
    historyOnly: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const lookupId = input.userId || context.user.id;
    const sinceDate = input.sinceDate || new Date(Date.now() - 90 * 86400_000).toISOString().split('T')[0];

    // Resolve the member once, then query only their group. Previously this
    // endpoint fetched 90 days of attendance for the entire application and
    // discarded almost all of those documents in memory.
    const [byId, byUserId] = await Promise.all([
      Users.findOne({ id: lookupId, fields: USER_FIELDS }).catch(() => null),
      Users.findOne({ filters: { userId: lookupId }, fields: USER_FIELDS }).catch(() => null),
    ]);
    let requestedUser = byId || byUserId;
    if (!requestedUser) {
      const matches = await Promise.all(USER_IDENTITY_FIELDS
        .filter(field => !['id', 'userId'].includes(field))
        .map(field => Users.findOne({ filters: { [field]: lookupId }, fields: USER_FIELDS }).catch(() => null)));
      requestedUser = matches.find(Boolean) || null;
    }
    // When a guide opens a member's profile, only the target member's aliases
    // belong in this lookup. Mixing in the guide's aliases can accidentally
    // select the guide's group and hide the member's attendance.
    const lookupAliases = [...new Set([
      lookupId,
      ...userIdentityAliases(requestedUser),
    ].filter(Boolean).map(String))];

    if (input.historyOnly) {
      const userHistory = await readBvProfileAttendance(lookupAliases, sinceDate, input.untilDate);
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekStartStr = weekStart.toISOString().slice(0, 10);
      return {
        userHistory,
        leaderboard: [],
        userTotalPointsThisWeek: userHistory.filter(entry => entry.present && entry.attendanceDate >= weekStartStr).length,
      };
    }

    const [membershipByUser, membershipByUserId] = await Promise.all([
      BvGroupMembers.findAll({
        filters: { user: { in: lookupAliases } },
        fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'],
        limit: 10,
      }),
      BvGroupMembers.findAll({
        filters: { userId: { in: lookupAliases } },
        fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'],
        limit: 10,
      }),
    ]);
    let membership = membershipByUser.records[0] || membershipByUserId.records[0];
    if (!membership) {
      // Older membership rows may use memberId, email, or a custom user ID.
      // The indexed reads above handle current records; this bounded fallback
      // keeps historic approved members visible until their records are saved.
      const lookupKeys = new Set(lookupAliases.map(value => value.toLowerCase()));
      const { records: memberships } = await BvGroupMembers.findAll({
        fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'],
        limit: 5000,
      }).catch(() => ({ records: [] }));
      membership = memberships.find((member: any) =>
        referenceValues([member.id, member.user, member.userId, member.memberId])
          .some(value => lookupKeys.has(value.toLowerCase()))
      );
    }
    if (!membership && requestedUser && (requestedUser.isBvMember === true || requestedUser.pendingBvGroupAssignmentNotice === true)) {
      const profileGroup = firstValue(requestedUser.bvGroupId || requestedUser.bvGroupName);
      if (profileGroup) {
        membership = {
          id: `profile-${requestedUser.id}`,
          user: requestedUser.id,
          userId: requestedUser.userId,
          group: requestedUser.bvGroupId || profileGroup,
          groupId: requestedUser.bvGroupId || profileGroup,
        };
      }
    }
    const storedGroupId = firstValue(membership?.group || membership?.groupId);
    if (!storedGroupId) {
      return { userHistory: [], leaderboard: [], userTotalPointsThisWeek: 0 };
    }

    const groupFields = ['id', 'groupId', 'groupName'];
    const group = await BvGroups.findOne({ id: storedGroupId, fields: groupFields })
      .catch(() => null)
      || await BvGroups.findOne({ filters: { groupId: storedGroupId }, fields: groupFields })
        .catch(() => null)
      || await BvGroups.findOne({ filters: { groupName: storedGroupId }, fields: groupFields })
        .catch(() => null);
    const groupReferences = [...new Set([
      storedGroupId,
      group?.id,
      group?.groupId,
      group?.groupName,
    ].flatMap(referenceValues))];
    // Membership references are valid aliases for attendance rows but are not
    // user identities themselves. Keep them separate so a membership document
    // never appears as a phantom member on the leaderboard.
    const identityAliases = lookupAliases;
    const attendanceIdentityAliases = [...new Set([
      ...lookupAliases,
      ...referenceValues([membership?.id, membership?.user, membership?.userId, membership?.memberId]),
    ])];

    const [attendanceByGroup, membersByGroup, attendanceByGroupId, membersByGroupId] = await Promise.all([
      BvAttendance.findAll({
        filters: { group: { in: groupReferences } },
        fields: ['id', 'group', 'groupId', 'user', 'present', 'attendanceDate'],
        limit: 5000,
      }),
      BvGroupMembers.findAll({
        filters: { group: { in: groupReferences } },
        fields: ['id', 'user', 'userId', 'memberId'],
        limit: 1000,
      }),
      BvAttendance.findAll({
        filters: { groupId: { in: groupReferences } },
        fields: ['id', 'group', 'groupId', 'user', 'present', 'attendanceDate'],
        limit: 5000,
      }).catch(() => ({ records: [], hasMore: false })),
      BvGroupMembers.findAll({
        filters: { groupId: { in: groupReferences } },
        fields: ['id', 'user', 'userId', 'memberId'],
        limit: 1000,
      }).catch(() => ({ records: [], hasMore: false })),
    ]);

    let attendanceRecords = [...attendanceByGroup.records, ...attendanceByGroupId.records]
      .filter((record: any, index: number, records: any[]) => records.findIndex(item => item.id === record.id) === index);
    if (attendanceRecords.length === 0 && groupReferences.length > 0) {
      const groupKeys = new Set(groupReferences.map(value => value.toLowerCase()));
      const { records } = await BvAttendance.findAll({
        fields: ['id', 'group', 'groupId', 'user', 'present', 'attendanceDate'],
        limit: 5000,
      }).catch(() => ({ records: [] as any[] }));
      attendanceRecords = records.filter((record: any) =>
        referenceValues([record.group, record.groupId]).some(value => groupKeys.has(value.toLowerCase()))
      );
    }
    const attendanceResult = {
      records: attendanceRecords,
    };
    const groupMembersResult = {
      records: [...membersByGroup.records, ...membersByGroupId.records]
        .filter((member: any, index: number, members: any[]) => members.findIndex(item => item.id === member.id) === index),
    };

    const allAtt = attendanceResult.records.filter((record: any) =>
      !!record.attendanceDate && String(record.attendanceDate) >= sinceDate
    );
    const memberAliases = [...new Set([
      ...identityAliases,
      ...groupMembersResult.records.flatMap((member: any) => [firstValue(member.user), firstValue(member.userId)]),
      ...allAtt.map((record: any) => firstValue(record.user)),
    ].filter(Boolean))];
    const userRecords = await findUsersForAliases(memberAliases);
    if (requestedUser && !userRecords.some(user => user.id === requestedUser.id)) {
      userRecords.push(requestedUser);
    }

    const residencyIds = [...new Set(userRecords.flatMap(user => [
      firstValue(user.residency),
      firstValue(user.selectedFolkResidency),
    ]).filter(Boolean))];
    const residencyMap = new Map<string, string>();
    for (let i = 0; i < residencyIds.length; i += 30) {
      const chunk = residencyIds.slice(i, i + 30);
      const [byDbId, byCustomId] = await Promise.all([
        FolkResidencies.findAll({ filters: { id: { in: chunk } }, fields: ['id', 'residencyId', 'residencyName'], limit: 30 }),
        FolkResidencies.findAll({ filters: { residencyId: { in: chunk } }, fields: ['id', 'residencyId', 'residencyName'], limit: 30 }),
      ]);
      for (const residency of [...byDbId.records, ...byCustomId.records]) {
        if (residency.id) residencyMap.set(String(residency.id).toLowerCase(), residency.residencyName || '');
        if (residency.residencyId) residencyMap.set(String(residency.residencyId).toLowerCase(), residency.residencyName || '');
      }
    }

    type UserInfo = {
      canonicalId: string;
      userId: string;
      name: string;
      isResident: boolean;
      residencyName: string;
      ashrayLevel: string;
      aliases: string[];
    };
    const infoByAlias = new Map<string, UserInfo>();
    for (const user of userRecords) {
      const aliases = userIdentityAliases(user);
      const rawResidency = user.residencyName || firstValue(user.residency) || firstValue(user.selectedFolkResidency);
      const rawName = String(user.fullName || user.displayName || user.name || '').trim();
      const resolvedName = (rawName && !rawName.includes('@'))
        ? rawName
        : (user.email ? formatDisplayName(user.email) : formatDisplayName(user.userId || user.id));

      const info: UserInfo = {
        canonicalId: user.id,
        userId: user.userId || user.id,
        name: resolvedName,
        isResident: !!((user.residencyApproved || user.residencyGuideVerified) && rawResidency),
        residencyName: residencyMap.get(String(rawResidency).toLowerCase()) || rawResidency || '',
        ashrayLevel: user.ashrayLevel || 'Jigyasa',
        aliases,
      };
      for (const alias of aliases) infoByAlias.set(alias.toLowerCase(), info);
    }

    // Facilitator records can reference a membership document instead of a
    // Users document. Resolve those references before aggregating attendance,
    // so they count for the member rather than creating a separate person.
    for (const member of [membership, ...groupMembersResult.records]) {
      const aliases = referenceValues([member.user, member.userId, member.memberId]);
      const info = aliases.map(alias => infoByAlias.get(alias.toLowerCase())).find(Boolean)
        || (member.id === membership.id
          ? lookupAliases.map(alias => infoByAlias.get(alias.toLowerCase())).find(Boolean)
          : undefined);
      if (!info) continue;
      for (const alias of referenceValues([member.id, ...aliases])) {
        if (!infoByAlias.has(alias.toLowerCase())) infoByAlias.set(alias.toLowerCase(), info);
      }
    }

    const currentAliasSet = new Set(attendanceIdentityAliases.map(alias => alias.toLowerCase()));
    for (const alias of [...currentAliasSet]) {
      const info = infoByAlias.get(alias);
      info?.aliases.forEach(value => currentAliasSet.add(value.toLowerCase()));
    }

    // De-duplicate repeated legacy rows by canonical user/date. If duplicate
    // rows disagree, a present mark wins for that session.
    const attendanceByUser = new Map<string, Map<string, boolean>>();
    for (const record of allAtt) {
      const rawAlias = firstValue(record.user);
      if (!rawAlias) continue;
      const info = infoByAlias.get(rawAlias.toLowerCase());
      const canonicalId = info?.canonicalId || rawAlias.toLowerCase();
      if (!attendanceByUser.has(canonicalId)) attendanceByUser.set(canonicalId, new Map());
      const date = String(record.attendanceDate || '');
      const previous = attendanceByUser.get(canonicalId)!.get(date) || false;
      attendanceByUser.get(canonicalId)!.set(date, previous || !!record.present);
    }

    const sessionDates = [...new Set(allAtt.map((record: any) => String(record.attendanceDate || '')).filter(Boolean))];
    const canonicalMembers = new Map<string, UserInfo | null>();
    for (const alias of memberAliases) {
      const info = infoByAlias.get(alias.toLowerCase());
      canonicalMembers.set(info?.canonicalId || alias.toLowerCase(), info || null);
    }
    const currentInfo = [...currentAliasSet].map(alias => infoByAlias.get(alias)).find(Boolean);
    const currentCanonicalId = currentInfo?.canonicalId || lookupId.toLowerCase();
    canonicalMembers.set(currentCanonicalId, currentInfo || null);

    const leaderboard = [...canonicalMembers.entries()].map(([canonicalId, info]) => {
      const memberAttendance = attendanceByUser.get(canonicalId) || new Map<string, boolean>();
      const presentCount = [...memberAttendance.values()].filter(Boolean).length;
      const nameCandidate = info?.name || canonicalId;
      const displayName = nameCandidate.includes('@') ? formatDisplayName(nameCandidate) : nameCandidate;
      return {
        userId: info?.userId || canonicalId,
        displayName,
        presentCount,
        totalCount: sessionDates.length,
        attendanceRate: sessionDates.length > 0 ? Math.round((presentCount / sessionDates.length) * 100) : 0,
        isResident: info?.isResident ?? false,
        residencyName: info?.residencyName ?? '',
        ashrayLevel: info?.ashrayLevel ?? '',
      };
    }).sort((a, b) => b.presentCount - a.presentCount || a.displayName.localeCompare(b.displayName));

    const myAttendance = attendanceByUser.get(currentCanonicalId) || new Map<string, boolean>();
    const userHistory = [...myAttendance.entries()].map(([attendanceDate, present]) => ({
      attendanceDate,
      present,
      status: present ? 'P' : 'A',
      sessionTopic: '',
    })).sort((a, b) => b.attendanceDate.localeCompare(a.attendanceDate));

    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const userTotalPointsThisWeek = userHistory.filter(entry => entry.present && entry.attendanceDate >= weekStartStr).length;

    return { userHistory, leaderboard, userTotalPointsThisWeek };
  },
});
