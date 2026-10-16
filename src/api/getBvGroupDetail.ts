import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvSessions, BvAttendance, BvQuizzes, Users, AppError } from '@/lib/backend-sdk';
import { legacyQuizMatchesGroup, normalizeQuizDepartment } from '@/lib/bvQuizAccess';
import { bvUserAliases, resolveBvScopedGroups, resolveBvUsersByAliases } from '@/lib/bvGroupMemberScope';
import { isReadingGroupStaff } from '@/lib/bvGroupFacilitators';
import { isHierarchyAdmin } from '@/lib/hierarchyUtils';

function normalizeKey(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function getRecordUserKeys(record: any): string[] {
  const rawValues = [
    Array.isArray(record?.user) ? record.user[0] : record?.user,
    Array.isArray(record?.userId) ? record.userId[0] : record?.userId,
    // Older membership documents use memberId instead of user/userId.
    // Keep it in the canonical lookup set so card counts and detail rows
    // resolve the same membership records.
    Array.isArray(record?.memberId) ? record.memberId[0] : record?.memberId,
  ];
  return [...new Set(rawValues.filter(Boolean).map(String))];
}

function firstValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

function addUserToMap(userMap: Record<string, any>, user: any) {
  [
    user?.id,
    user?.userId,
    user?.email,
    user?.phone,
    user?.uid,
    user?.authUid,
    user?.firebaseUid,
    user?.firebaseUserId,
    user?.firebaseAuthUid,
    user?.authId,
    user?.authUserId,
    user?.firebaseId,
    user?.firebaseAuthId,
    user?.firebase_id,
  ].forEach(alias => {
    const key = normalizeKey(alias);
    if (key) userMap[key] = user;
  });
}

async function findUsersForKeys(keys: string[]): Promise<any[]> {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const fields = [
    'id', 'userId', 'fullName', 'email', 'phone', 'ashrayLevel', 'status', 'role',
    'bvGroupId', 'bvGroupName', 'bvRegistrationStatus', 'isBvMember',
    'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator',
    'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid',
    'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id',
  ];
  const lookupFields = [
    'id', 'userId', 'email', 'phone', 'uid', 'authUid', 'firebaseUid',
    'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId',
    'firebaseId', 'firebaseAuthId', 'firebase_id',
  ];
  const results = new Map<string, any>();

  for (let i = 0; i < uniqueKeys.length; i += 30) {
    const chunk = uniqueKeys.slice(i, i + 30);
    await Promise.all(lookupFields.map(async field => {
      const { records } = await Users.findAll({
        filters: { [field]: { in: chunk } } as any,
        fields,
        limit: 500,
      });
      records.forEach((u: any) => results.set(u.id || u.userId || u.email, u));
    }));
  }

  return [...results.values()];
}

function textValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(textValues);
  const text = String(value ?? '').trim();
  if (!text) return [];
  return text.split(',').map(item => item.trim()).filter(Boolean);
}

function aliasSet(values: unknown[]): Set<string> {
  return new Set(values.flatMap(textValues).map(value => value.toLowerCase()));
}

type FacilitatorBadge = 'RGF' | 'RGSF';

const GROUP_FIELDS = [
  'id', 'groupId', 'groupName', 'description', 'isActive', 'joinToken', 'whatsAppLink',
  'bvslLeader', 'bvslId', 'bvslName', 'segment', 'subFacilitatorId', 'rgsfId', 'subFacilitator',
];

/** The group's assigned facilitators, even when they have no membership row. */
async function loadGroupFacilitators(group: any): Promise<Array<{ user: any; badges: FacilitatorBadge[] }>> {
  const rgfIds = aliasSet([group?.bvslLeader, group?.bvslId]);
  const rgfNames = aliasSet([group?.bvslName]);
  const rgsfIds = aliasSet([group?.subFacilitatorId, group?.rgsfId, group?.subFacilitator]);
  const lookupAliases = [...rgfIds, ...(rgfIds.size > 0 ? [] : [...rgfNames]), ...rgsfIds];
  if (lookupAliases.length === 0) return [];

  const users = await resolveBvUsersByAliases(lookupAliases, [
    'id', 'userId', 'fullName', 'email', 'phone', 'ashrayLevel', 'status',
    'bvGroupId', 'isBvMember',
  ]);
  const rgfAliases = rgfIds.size > 0 ? rgfIds : rgfNames;
  const roster: Array<{ user: any; badges: FacilitatorBadge[] }> = [];
  for (const user of users) {
    if (user?.status && String(user.status).toLowerCase() !== 'active') continue;
    const aliases = new Set(bvUserAliases(user));
    const badges: FacilitatorBadge[] = [];
    if ([...rgfAliases].some(alias => aliases.has(alias))) badges.push('RGF');
    if ([...rgsfIds].some(alias => aliases.has(alias))) badges.push('RGSF');
    if (badges.length > 0) roster.push({ user, badges });
  }
  return roster;
}

function leaderAliases(group: any): string[] {
  return [...new Set([group?.bvslLeader, group?.bvslId]
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter(Boolean)
    .map(value => String(value).trim().toLowerCase()))];
}

/** Join tokens let someone enrol themselves. Only the group's leader and
 * department admins/guides receive one; other managers in the chain do not. */
function callerMaySeeJoinToken(caller: any, group: any): boolean {
  if (isHierarchyAdmin(caller)) return true;
  const aliases = new Set(bvUserAliases(caller));
  return leaderAliases(group).some(alias => aliases.has(alias));
}

export default createEndpoint({
  description: 'Get full BV group detail — group info, active members, recent sessions',
  authenticated: true,
  requiredCapabilities: 'bv.manage',
  inputSchema: z.object({ groupId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (!context?.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    if (!input.groupId) throw new AppError({ code: 'BAD_REQUEST', message: 'groupId is required' });
    // Reject before any member lookup. This throws when the group is outside
    // the caller's chain, including when the caller is a plain member.
    await resolveBvScopedGroups(context.user, { groupId: input.groupId });

    // Try finding by the custom groupId field first, then fall back to DB record ID
    let group = await BvGroups.findOne({
      filters: { groupId: input.groupId },
      fields: GROUP_FIELDS,
    });
    if (!group) {
      group = await BvGroups.findOne({
        id: input.groupId,
        fields: GROUP_FIELDS,
      });
    }
    if (!group) throw new AppError({ code: 'NOT_FOUND', message: 'Group not found' });

    const groupRefs = [...new Set([group.id, group.groupId].filter(Boolean))];
    const [membersRes, membersByGroupIdRes, sessionsRes, sessionsByGroupIdRes, allQuizzesRes] = await Promise.all([
      // Memberships created across migrations may store either the database
      // id or public groupId in either field. Query both aliases, matching
      // the group-card counter, so its count and the detail list agree.
      BvGroupMembers.findAll({ filters: { group: groupRefs.length > 1 ? { in: groupRefs } : group.id } as any, fields: ['id', 'user', 'userId', 'memberId', 'role', 'joinedAt', 'group', 'groupId'], limit: 200 }),
      BvGroupMembers.findAll({ filters: { groupId: groupRefs.length > 1 ? { in: groupRefs } : group.id } as any, fields: ['id', 'user', 'userId', 'memberId', 'role', 'joinedAt', 'group', 'groupId'], limit: 200 }),
      BvSessions.findAll({ filters: { group: groupRefs.length > 1 ? { in: groupRefs } : group.id } as any, fields: ['id', 'sessionId', 'sessionDate', 'topic', 'notes'], limit: 50 }),
      group.groupId
        ? BvSessions.findAll({ filters: { groupId: group.groupId } as any, fields: ['id', 'sessionId', 'sessionDate', 'topic', 'notes'], limit: 50 })
        : Promise.resolve({ records: [] }),
      String(group.segment || '').toUpperCase() === 'FOLK'
        ? BvQuizzes.findAll({ fields: ['id', 'group', 'groupId', 'department', 'isActive', 'quizTitle', 'createdAt'], limit: 500 })
        : Promise.resolve({ records: [] }),
    ]);

    const membershipMap = new Map<string, any>();
    [...membersRes.records, ...membersByGroupIdRes.records].forEach((membership: any) => membershipMap.set(String(membership.id), membership));
    const membershipRecords = [...membershipMap.values()];
    const sessionMap = new Map<string, any>();
    [...sessionsRes.records, ...sessionsByGroupIdRes.records].forEach((session: any) => sessionMap.set(String(session.id), session));
    const quizMap = new Map<string, any>();
    allQuizzesRes.records
      .filter((quiz: any) => normalizeQuizDepartment(quiz.department, 'FOLK') === 'FOLK' && legacyQuizMatchesGroup(quiz, group))
      .forEach((quiz: any) => quizMap.set(String(quiz.id), quiz));
    const sessionRecords = [...sessionMap.values()];
    const quizRecords = [...quizMap.values()];

    const memberUserIds = membershipRecords.flatMap(getRecordUserKeys);

    const [userRecords, attendanceRes] = await Promise.all([
      memberUserIds.length > 0 ? findUsersForKeys(memberUserIds) : Promise.resolve([]),
      BvAttendance.findAll({
        filters: { group: groupRefs.length > 1 ? { in: groupRefs } : group.id } as any,
        fields: ['id', 'user', 'userId', 'present', 'attendanceDate'],
        limit: 2000,
      }),
    ]);

    const userMap: Record<string, any> = {};
    userRecords.forEach((u: any) => addUserToMap(userMap, u));
    const facilitatorRoster = await loadGroupFacilitators(group);
    facilitatorRoster.forEach(entry => addUserToMap(userMap, entry.user));
    const badgesByAlias = new Map<string, FacilitatorBadge[]>();
    for (const entry of facilitatorRoster) {
      for (const alias of bvUserAliases(entry.user)) {
        const existing = badgesByAlias.get(alias) || [];
        badgesByAlias.set(alias, [...new Set([...existing, ...entry.badges])]);
      }
    }
    const badgesForUser = (user: any): FacilitatorBadge[] => {
      const found = new Set<FacilitatorBadge>();
      for (const alias of bvUserAliases(user)) {
        for (const badge of badgesByAlias.get(alias) || []) found.add(badge);
      }
      return [...found];
    };

    const resolveMember = (record: any) => {
      const rawKeys = getRecordUserKeys(record);
      const matchedKey = rawKeys.find(key => userMap[normalizeKey(key)]);
      const user = matchedKey ? userMap[normalizeKey(matchedKey)] : null;
      const canonicalId = String(user?.id || user?.userId || rawKeys[0] || '');
      return { rawKeys, user, canonicalId };
    };

    const groupAliases = new Set([group.id, group.groupId].filter(Boolean).map(value => normalizeKey(value)));
    const activeMemberships = membershipRecords
      .map((m: any) => {
        const resolved = resolveMember(m);
        const profileGroupId = normalizeKey(firstValue(resolved.user?.bvGroupId));
        // The BvGroupMembers row is authoritative. Older user profiles often
        // lack bvGroupId/isBvMember even though their membership is active.
        const isCurrentGroup = profileGroupId ? groupAliases.has(profileGroupId) : true;
        const isActiveUser = !resolved.user?.status || String(resolved.user.status).toLowerCase() === 'active';
        // An explicit false is written when a member leaves a group; do not
        // render its leftover legacy membership row. Missing values remain
        // supported for pre-migration records.
        const isBvMember = resolved.user?.isBvMember !== false;
        const facilitatorBadges = badgesForUser(resolved.user);
        // A group's current RGF/RGSF stays on this roster even when their
        // personal profile points at another group. An RGF removed from this
        // group keeps a membership row, but that row is not a member seat.
        const assignedHere = facilitatorBadges.length > 0;
        const isActiveMember = !!resolved.user && isActiveUser && (
          assignedHere || (!isReadingGroupStaff(resolved.user) && isBvMember && isCurrentGroup)
        );
        return { record: m, resolved, isActiveMember };
      })
      .filter(item => item.isActiveMember);

    const coveredAliases = new Set(
      activeMemberships.flatMap(item => bvUserAliases(item.resolved.user)),
    );
    for (const entry of facilitatorRoster) {
      if (bvUserAliases(entry.user).some(alias => coveredAliases.has(alias))) continue;
      const record = {
        id: `facilitator-${entry.user.id || entry.user.userId}`,
        user: entry.user.id,
        userId: entry.user.userId,
        role: entry.badges[0],
        joinedAt: '',
      };
      activeMemberships.push({ record, resolved: resolveMember(record), isActiveMember: true });
      bvUserAliases(entry.user).forEach(alias => coveredAliases.add(alias));
    }

    const memberKeyToCanonical = new Map<string, string>();
    for (const { resolved } of activeMemberships) {
      for (const key of [...resolved.rawKeys, ...bvUserAliases(resolved.user)]) {
        memberKeyToCanonical.set(normalizeKey(key), resolved.canonicalId);
      }
    }

    const attendanceStats = new Map<string, { presentCount: number; totalCount: number; lastPresent: string }>();
    for (const a of attendanceRes.records || []) {
      const rawKeys = getRecordUserKeys(a);
      const rawMatch = rawKeys.find(key => memberKeyToCanonical.has(normalizeKey(key)));
      if (!rawMatch) continue;
      const canonicalId = memberKeyToCanonical.get(normalizeKey(rawMatch)) || rawMatch;
      const stats = attendanceStats.get(canonicalId) || { presentCount: 0, totalCount: 0, lastPresent: '' };
      stats.totalCount += 1;
      if (a.present) {
        stats.presentCount += 1;
        const attendanceDate = String(a.attendanceDate || '').slice(0, 10);
        if (attendanceDate && attendanceDate > stats.lastPresent) stats.lastPresent = attendanceDate;
      }
      attendanceStats.set(canonicalId, stats);
    }

    const members = activeMemberships.map(({ record: m, resolved }) => {
      const { user: u, canonicalId } = resolved;
      const stats = attendanceStats.get(canonicalId) || { presentCount: 0, totalCount: 0, lastPresent: '' };
      return {
        membershipId: m.id,
        userId: u?.userId || u?.id || canonicalId,
        fullName: u?.fullName || 'Unknown member',
        phone: u?.phone || '',
        ashrayLevel: u?.ashrayLevel || null,
        presentCount: stats.presentCount,
        totalCount: stats.totalCount,
        attendanceRate: stats.totalCount > 0 ? Math.round((stats.presentCount / stats.totalCount) * 100) : 0,
        lastPresent: stats.lastPresent || null,
        role: (m.role as string) || 'Member',
        joinedAt: (m.joinedAt as string) || '',
        badges: badgesForUser(u),
      };
    });

    const listedNames = new Set(members.map(member => member.fullName.trim().toLowerCase()));
    const namedOnly = (values: unknown, badge: FacilitatorBadge) => {
      if (facilitatorRoster.some(entry => entry.badges.includes(badge))) return [];
      return textValues(values)
        .filter(name => name.includes(' ') && !listedNames.has(name.toLowerCase()))
        .map(name => ({
          membershipId: `facilitator-name-${badge}-${name.toLowerCase()}`,
          userId: '',
          fullName: name,
          phone: '',
          ashrayLevel: null,
          presentCount: 0,
          totalCount: 0,
          attendanceRate: 0,
          lastPresent: null,
          role: badge,
          joinedAt: '',
          badges: [badge],
        }));
    };
    const rgfNameOnly = aliasSet([group.bvslLeader, group.bvslId]).size === 0
      ? namedOnly(group.bvslName, 'RGF')
      : [];
    const rgsfNameOnly = aliasSet([group.subFacilitatorId, group.rgsfId]).size === 0
      ? namedOnly(group.subFacilitator, 'RGSF')
      : [];
    members.push(...rgfNameOnly, ...rgsfNameOnly);
    members.sort((left, right) => {
      const rank = (badges: FacilitatorBadge[]) => (badges.includes('RGF') ? 0 : badges.includes('RGSF') ? 1 : 2);
      return rank(left.badges) - rank(right.badges) || left.fullName.localeCompare(right.fullName);
    });

    const sessions = sessionRecords.map((s: any) => ({
      sessionId: (s.sessionId as string) || s.id,
      sessionDate: ((s.sessionDate as string) || '').slice(0, 10),
      topic: (s.topic as string) || '',
      notes: (s.notes as string) || '',
    }));

    const quizzes = quizRecords.map((q: any) => ({
      quizId: q.id,
      title: (q.quizTitle as string) || (q.title as string) || 'Untitled Quiz',
      createdAt: (q.createdAt as string) || '',
    }));

    return {
      group: {
        groupId: (group.groupId as string) || group.id,
        groupName: (group.groupName as string) || '',
        description: (group.description as string) || '',
        isActive: (group.isActive as boolean) ?? true,
        joinToken: callerMaySeeJoinToken(context.user, group) ? ((group.joinToken as string) || null) : null,
        whatsAppLink: (group.whatsAppLink as string) || null,
        segment: String(group.segment || '').toUpperCase() === 'FOLK' ? 'FOLK' : 'PW',
      },
      members,
      recentSessions: sessions.sort((a: any, b: any) => b.sessionDate.localeCompare(a.sessionDate)).slice(0, 20),
      quizzes,
      totalSessions: sessions.length,
      totalQuizzes: quizzes.length,
    };
  },
});
