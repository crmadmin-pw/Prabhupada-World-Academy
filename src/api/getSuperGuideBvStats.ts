import { z } from 'zod';
import { resolveBvScopedGroups } from '../lib/bvGroupMemberScope';
import { createEndpoint, BvGroups, BvGroupMembers, BvAttendance, Users, Guides } from '@/lib/backend-sdk';
import { getRefId } from '../lib/userUtils';

/** ISO week number for a given Date */
function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** Convert ISO week + year to Mon–Sun date strings */
function isoWeekToDateRange(weekNum: number, year: number): { start: string; end: string } {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const weekStart = new Date(jan4);
  weekStart.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (weekNum - 1) * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { start: fmt(weekStart), end: fmt(weekEnd) };
}

import getGuides from './getGuides';

function isFolkMemberReportUser(user: any): boolean {
  const role = String(user?.role || '').toUpperCase().replace(/\s+/g, '_');
  const name = String(user?.fullName || '').toLowerCase();
  const id = String(user?.id || user?.userId || '').toLowerCase();
  return !(
    user?.isBvAdmin ||
    user?.isBvSuperAdmin ||
    role === 'GUIDE' ||
    role === 'SUPER_GUIDE' ||
    role === 'SUPER_ADMIN' ||
    role === 'PW_ADMIN' ||
    role === 'ADMIN' ||
    name.includes('system admin') ||
    name.includes('super admin') ||
    id.includes('superadmin')
  );
}

function normalizeLookupKey(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function getRecordUserKeys(record: any): string[] {
  const rawValues = [
    Array.isArray(record?.user) ? record.user[0] : record?.user,
    Array.isArray(record?.userId) ? record.userId[0] : record?.userId,
    Array.isArray(record?.member) ? record.member[0] : record?.member,
    Array.isArray(record?.memberId) ? record.memberId[0] : record?.memberId,
    Array.isArray(record?.uid) ? record.uid[0] : record?.uid,
    Array.isArray(record?.authUid) ? record.authUid[0] : record?.authUid,
    Array.isArray(record?.firebaseUid) ? record.firebaseUid[0] : record?.firebaseUid,
  ];
  return [...new Set(rawValues.filter(Boolean).map(String))];
}

function getMemberStoredName(record: any): string {
  const candidate = [
    record?.fullName,
    record?.memberName,
    record?.userName,
    record?.memberFullName,
    record?.name,
  ].find(value => typeof value === 'string' && value.trim());
  return typeof candidate === 'string' ? candidate.trim() : '';
}

function addUserAliases(map: Map<string, any>, user: any) {
  const aliases = [
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
  ];

  for (const alias of aliases) {
    const key = normalizeLookupKey(alias);
    if (key) map.set(key, user);
  }
}

async function fetchUsersByKeys(keys: string[]): Promise<any[]> {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const fields = ['id', 'userId', 'fullName', 'email', 'phone', 'ashrayLevel', 'guide', 'role', 'isBvAdmin', 'isBvSuperAdmin', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];
  const fieldNames = ['id', 'userId', 'email', 'phone', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];
  const results = new Map<string, any>();

  for (let i = 0; i < uniqueKeys.length; i += 30) {
    const chunk = uniqueKeys.slice(i, i + 30);
    await Promise.all(fieldNames.map(async field => {
      const { records } = await Users.findAll({
        filters: { [field]: { in: chunk } } as any,
        fields,
        limit: 2000,
      }).catch(() => ({ records: [] }));
      for (const u of records) results.set(u.id || u.userId || u.email || Math.random().toString(36), u);
    }));
  }

  return [...results.values()];
}

export default createEndpoint({
  description: 'Get BV stats for Super Guide — aggregate across all active groups with weekly filtering',
  authenticated: true,
  inputSchema: z.object({
    filterGuideId: z.string().optional(),
    weekNumber: z.number().optional(),
    year: z.number().optional(),
    segment: z.enum(['PW', 'FOLK']).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: { input: any; context: any }) => {
    // Fetch guides for dropdown via getGuides endpoint (segment-aware)
    const guidesListRes = await getGuides.execute({ input: { segment: input.segment }, context });
    const guidesForDropdown = (guidesListRes.guides || []).map((g: any) => ({
      guideId: g.guideId,
      name: g.name,
      segment: g.isPrabhupadaWorldMentor ? 'PW' : 'FOLK',
    }));

    const guideNameMap = new Map<string, string>();
    for (const g of guidesForDropdown) guideNameMap.set(g.guideId, g.name);

    // Fetch all active BV groups
    const { records: allGroups } = await BvGroups.findAll({
      filters: { isActive: true } as any,
      fields: ['id', 'groupId', 'groupName', 'guide', 'bvReportingAdminName', 'bvslName', 'guideName'],
      limit: 500,
    });

    // Optionally filter groups by guide (filterGuideId is the guide DB UUID)
    const permittedIds = new Set((await resolveBvScopedGroups(context.user, { segment: input.segment })).map(group => group.id));
    const permittedGroups = allGroups.filter(group => permittedIds.has(group.id));
    const groups = input.filterGuideId
      ? permittedGroups.filter((g: any) => {
          const gid = Array.isArray(g.guide) ? g.guide[0] : g.guide;
          return gid === input.filterGuideId;
        })
      : permittedGroups;

    const emptyResult = {
      summary: { totalUsers: 0, markedCount: 0, presentCount: 0, absentCount: 0, notMarkedCount: 0, serviceFullCount: 0, avgPoints: 0 },
      guideBreakdown: [],
      leaderboard: [],
      guides: guidesForDropdown,
    };

    if (groups.length === 0) return emptyResult;

    const groupIds = groups.map((g: any) => g.id);

    // Map: groupId → guide DB id
    const groupGuideMap = new Map<string, string>();
    for (const g of groups) {
      const gid = Array.isArray((g as any).guide) ? (g as any).guide[0] : (g as any).guide;
      if (gid) groupGuideMap.set(g.id, gid as string);
    }

    // Week date range
    const now = new Date();
    const weekNum = input.weekNumber ?? getISOWeek(now);
    const year = input.year ?? now.getUTCFullYear();
    const { start: weekStart, end: weekEnd } = isoWeekToDateRange(weekNum, year);

    // Parallel: members + week attendance
    const [membersRes, weekAttRes] = await Promise.all([
      BvGroupMembers.findAll({
        filters: { group: { in: groupIds } } as any,
        fields: ['id', 'group', 'user', 'userId'],
        limit: 2000,
      }),
      BvAttendance.findAll({
        filters: { group: { in: groupIds }, attendanceDate: { gte: weekStart, lte: weekEnd } } as any,
        fields: ['id', 'group', 'user', 'userId', 'present'],
        limit: 2000,
      }),
    ]);

    const memberRawUserKeys = membersRes.records.flatMap(getRecordUserKeys);
    const weekAttendanceRawUserKeys = weekAttRes.records.flatMap(getRecordUserKeys);

    // Fetch user info for members (display name, ashray, guide, role, flags)
    const [allUsersRes, keyedUserRecs] = await Promise.all([
      Users.findAll({
        fields: ['id', 'userId', 'fullName', 'email', 'phone', 'ashrayLevel', 'guide', 'role', 'isBvAdmin', 'isBvSuperAdmin', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'],
        limit: 2000,
      }),
      fetchUsersByKeys([...memberRawUserKeys, ...weekAttendanceRawUserKeys]),
    ]);

    const userRecs = [...allUsersRes.records, ...keyedUserRecs];

    const userInfoMap = new Map<string, any>();
    const adminUserIds = new Set<string>();

    const callerId = String(context.user?.id || '').toLowerCase();
    const callerUserId = String(context.user?.userId || '').toLowerCase();
    const callerEmail = String(context.user?.email || '').toLowerCase();
    const isFolkReport = input.segment === 'FOLK';
    if (callerId) adminUserIds.add(callerId);
    if (callerUserId) adminUserIds.add(callerUserId);
    if (callerEmail) adminUserIds.add(callerEmail);

    for (const u of userRecs) {
      const uId = String(u.id || u.userId || '').toLowerCase();
      const uEmail = String(u.email || '').toLowerCase();
      const isAdmin =
        (isFolkReport && !isFolkMemberReportUser(u)) ||
        (callerId && uId === callerId) ||
        (callerEmail && uEmail === callerEmail);

      if (isAdmin) {
        [
          u.id,
          u.userId,
          u.email,
          u.phone,
          u.uid,
          u.authUid,
          u.firebaseUid,
          u.firebaseUserId,
          u.firebaseAuthUid,
          u.authId,
          u.authUserId,
          u.firebaseId,
          u.firebaseAuthId,
          u.firebase_id,
        ].forEach(alias => {
          const key = normalizeLookupKey(alias);
          if (key) adminUserIds.add(key);
        });
      } else {
        addUserAliases(userInfoMap, u);
      }
    }

    const resolveUserKey = (rawKeys: string[]): string => {
      const matchedKey = rawKeys.find(key => userInfoMap.has(normalizeLookupKey(key)));
      if (matchedKey) {
        const user = userInfoMap.get(normalizeLookupKey(matchedKey));
        return String(user?.id || user?.userId || matchedKey);
      }
      return rawKeys[0] || '';
    };

    // Build unique user set per group from members (excluding admin users)
    const usersByGroup = new Map<string, Set<string>>();
    const userGroupMap = new Map<string, string>();
    const memberDisplayNameMap = new Map<string, string>();
    for (const m of membersRes.records) {
      const gid = Array.isArray(m.group) ? m.group[0] : m.group as string;
      const rawUserKeys = getRecordUserKeys(m);
      const uid = resolveUserKey(rawUserKeys);
      if (!gid || !uid) continue;
      if (rawUserKeys.some(key => adminUserIds.has(normalizeLookupKey(key))) || adminUserIds.has(normalizeLookupKey(uid))) continue;
      if (!usersByGroup.has(gid)) usersByGroup.set(gid, new Set());
      usersByGroup.get(gid)!.add(uid);
      userGroupMap.set(uid, gid);
      // Older membership rows may carry a user identifier that was later
      // renamed on the profile. Preserve any stored human name as a fallback,
      // but never render the opaque identifier in the UI.
      const storedName = getMemberStoredName(m);
      const profileName = userInfoMap.get(normalizeLookupKey(uid))?.fullName;
      const displayName = String(profileName || storedName || '').trim();
      if (displayName) memberDisplayNameMap.set(uid, displayName);
    }

    // All unique non-admin users across all groups
    const allUserIds = new Set<string>();
    for (const s of usersByGroup.values()) for (const uid of s) allUserIds.add(uid);

    // Weekly attendance: userId → { present, groupId } (excluding admin users)
    const attendanceByUser = new Map<string, { present: boolean; groupId: string }>();
    for (const a of weekAttRes.records) {
      const rawUserKeys = getRecordUserKeys(a);
      const uid = resolveUserKey(rawUserKeys);
      const gid = Array.isArray(a.group) ? a.group[0] : a.group as string;
      if (!uid || rawUserKeys.some(key => adminUserIds.has(normalizeLookupKey(key))) || adminUserIds.has(normalizeLookupKey(uid))) continue;
      attendanceByUser.set(uid, { present: !!(a.present), groupId: gid });
    }

    // All-time attendance for leaderboard (paginated, excluding admin users)
    let allTimeAttendance: any[] = [];
    {
      let offset = 0;
      while (true) {
        const { records, hasMore } = await BvAttendance.findAll({
          filters: { group: { in: groupIds } } as any,
          fields: ['id', 'user', 'userId', 'present'],
          limit: 2000,
          offset,
        });
        const nonAdminRecs = records.filter((a: any) => {
          const rawUserKeys = getRecordUserKeys(a);
          const uid = resolveUserKey(rawUserKeys);
          return uid && !rawUserKeys.some(key => adminUserIds.has(normalizeLookupKey(key))) && !adminUserIds.has(normalizeLookupKey(uid));
        });
        allTimeAttendance = allTimeAttendance.concat(nonAdminRecs);
        if (!hasMore) break;
        offset += 2000;
      }
    }

    // Aggregate all-time points per user
    const userTotalPoints = new Map<string, number>(); // attended (present)
    const userTotalSessions = new Map<string, number>(); // any attendance record
    for (const a of allTimeAttendance) {
      const rawUserKeys = getRecordUserKeys(a);
      const uid = resolveUserKey(rawUserKeys);
      if (!uid || rawUserKeys.some(key => adminUserIds.has(normalizeLookupKey(key))) || adminUserIds.has(normalizeLookupKey(uid))) continue;
      userTotalSessions.set(uid, (userTotalSessions.get(uid) || 0) + 1);
      if (a.present) userTotalPoints.set(uid, (userTotalPoints.get(uid) || 0) + 1);
    }

    // ── Summary stats ──
    const totalUsers = allUserIds.size;
    const markedCount = attendanceByUser.size;
    const presentCount = [...attendanceByUser.values()].filter(a => a.present).length;
    const absentCount = markedCount - presentCount;
    const notMarkedCount = totalUsers - markedCount;
    const serviceFullCount = presentCount; // present = completed service
    const avgPoints = markedCount > 0
      ? Math.round((presentCount / markedCount) * 3 * 10) / 10
      : 0;

    // ── Guide breakdown ──
    const guideBreakdownMap = new Map<string, {
      guideName: string;
      userIds: Set<string>;
      markedCount: number;
      presentCount: number;
    }>();

    // Map: groupId → Admin / Guide display name
    const groupAdminNameMap = new Map<string, string>();
    for (const g of groups) {
      const gAdmin = (g as any).bvReportingAdminName || (g as any).bvslName || (g as any).guideName || 'Unassigned';
      groupAdminNameMap.set(g.id, gAdmin);
    }

    for (const [gid, uids] of usersByGroup) {
      const guideDbId = groupGuideMap.get(gid) || '';
      const name = guideNameMap.get(guideDbId) || groupAdminNameMap.get(gid) || 'Unassigned';
      if (!guideBreakdownMap.has(name)) {
        guideBreakdownMap.set(name, {
          guideName: name,
          userIds: new Set(),
          markedCount: 0,
          presentCount: 0,
        });
      }
      const entry = guideBreakdownMap.get(name)!;
      for (const uid of uids) entry.userIds.add(uid);
    }

    for (const [uid, att] of attendanceByUser) {
      const guideDbId = groupGuideMap.get(att.groupId) || '';
      const name = guideNameMap.get(guideDbId) || groupAdminNameMap.get(att.groupId) || 'Unassigned';
      const entry = guideBreakdownMap.get(name);
      if (!entry) continue;
      entry.markedCount++;
      if (att.present) entry.presentCount++;
    }

    const guideBreakdown = [...guideBreakdownMap.entries()]
      .map(([, d]) => ({
        guideId: [...guideNameMap.entries()].find(([, n]) => n === d.guideName)?.[0] || '',
        guideName: d.guideName,
        totalUsers: d.userIds.size,
        presentCount: d.presentCount,
        serviceFullCount: d.presentCount,
        avgPoints: d.markedCount > 0
          ? Math.round((d.presentCount / d.markedCount) * 3 * 10) / 10
          : 0,
      }))
      .filter(d => d.totalUsers > 0);

    // ── Leaderboard (sorted by all-time points) ──
    const leaderboard = [...allUserIds]
      .map(uid => {
        const u = userInfoMap.get(normalizeLookupKey(uid));
        const totalPts = userTotalPoints.get(uid) || 0;
        const totalAtt = userTotalSessions.get(uid) || 0;
        const groupId = userGroupMap.get(uid) || '';
        const guideId = u ? (getRefId(u.guide) || groupGuideMap.get(groupId) || null) : (groupGuideMap.get(groupId) || null);
        const guideName = guideId ? (guideNameMap.get(guideId as string) || groupAdminNameMap.get(groupId) || '') : (groupAdminNameMap.get(groupId) || '');
        return {
          userId: uid,
          displayName: String(u?.fullName || memberDisplayNameMap.get(uid) || 'Unknown member'),
          guideName,
          ashrayLevel: u ? ((u.ashrayLevel as string) || '') : '',
          totalPoints: totalPts,
          attendanceRate: totalAtt > 0 ? Math.round((totalPts / totalAtt) * 100) : 0,
        };
      })
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, 50);

    return {
      summary: { totalUsers, markedCount, presentCount, absentCount, notMarkedCount, serviceFullCount, avgPoints },
      guideBreakdown,
      leaderboard,
      guides: guidesForDropdown,
    };
  },
});
