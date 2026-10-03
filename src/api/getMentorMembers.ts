import { getSadhanaMentorResidencyScope } from '@/lib/sadhanaMentorResidencyScope';
import { z } from 'zod';
import { getScopedHierarchyUserIds, isUserInHierarchy } from '../lib/hierarchyUtils';
import { createEndpoint, Users, SadhanaEntries, Guides, FolkResidencies } from '@/lib/backend-sdk';
import { computeStreak, getTodayIST, daysAgo } from '../lib/streakUtils';

const memberSchema = z.object({
  userId: z.string(),
  fullName: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  ashrayLevel: z.string().nullable(),
  isResident: z.boolean(),
  residencyName: z.string().nullable(),
  latestEntryDate: z.string().nullable(),
  latestScore: z.number().nullable(),
  currentStreak: z.number(),
  performanceStatus: z.enum(['stable', 'improving', 'declining', 'needs_attention']),
});

/** Performance status based on last ~10 entries vs threshold */
function getPerformanceStatus(
  entries: { entryDate: string; scorePercent: number | null }[],
  isResident: boolean
): 'stable' | 'improving' | 'declining' | 'needs_attention' {
  const threshold = isResident ? 95 : 75;
  // Sort most-recent first
  const sorted = [...entries].sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  const recent = sorted.slice(0, 10);
  if (recent.length < 2) return 'stable';

  // Count consecutive days below threshold from most recent day
  let belowStreak = 0;
  for (const e of recent) {
    if ((e.scorePercent ?? 0) < threshold) belowStreak++;
    else break;
  }

  if (belowStreak >= 7) return 'needs_attention';
  if (belowStreak >= 3) return 'declining';

  // Improving: last 2 entries above threshold, but some of the previous entries were below
  if (belowStreak === 0 && recent.length >= 4) {
    const recentAbove = recent.slice(0, 2).every(e => (e.scorePercent ?? 0) >= threshold);
    const olderBelow = recent.slice(2, 7).some(e => (e.scorePercent ?? 0) < threshold);
    if (recentAbove && olderBelow) return 'improving';
  }

  return 'stable';
}

export default createEndpoint({
  description: 'Get all members under the same guide as this Sadhana Mentor',
  authenticated: true,
  requiredCapabilities: 'users.assigned.read',
  inputSchema: z.object({}),
  outputSchema: z.object({
    members: z.array(memberSchema),
    guideName: z.string(),
  }),
  execute: async ({ context }: any) => {
    const currentUser = await Users.findOne({
      id: context.user!.id,
      fields: ['id', 'userId', 'fullName', 'guide', 'bvReportingAdminId', 'bvReportingAdminName', 'role', 'isBvAdmin', 'isBvSuperAdmin', 'segment', 'isPrabhupadaWorldUser'],
    }) || (context.user?.email
      ? await Users.findOne({
          filters: { email: context.user.email },
          fields: ['id', 'userId', 'fullName', 'guide', 'bvReportingAdminId', 'bvReportingAdminName', 'role', 'isBvAdmin', 'isBvSuperAdmin', 'segment', 'isPrabhupadaWorldUser'],
        })
      : null);

    const guideId = Array.isArray(currentUser?.guide)
      ? currentUser!.guide[0]
      : currentUser?.guide;

    const adminId = (currentUser as any)?.bvReportingAdminId || guideId || (currentUser as any)?.id;

    const guideRecord = guideId
      ? await Guides.findOne({ id: guideId, fields: ['id', 'fullName'] })
      : null;
    const isPw = currentUser?.segment === 'PW' || !!(currentUser as any)?.isPrabhupadaWorldUser;
    const guideName = isPw ? 'Prabhupada World' : ((guideRecord as any)?.fullName || (currentUser as any)?.bvReportingAdminName || 'FOLK Guide');

    // Fetch all active users
    const { records: allUsers } = await Users.findAll({
      filters: { status: 'Active' },
      fields: ['status', 'role', 'isBvAdmin', 'isBvSuperAdmin', 'segment', 'isPrabhupadaWorldUser', 'id', 'userId', 'fullName', 'email', 'phone', 'ashrayLevel', 'residency', 'residencyApproved', 'residencyJoinDate', 'scholarSince', 'residentSince', 'currentStreak', 'lastStreakUpdatedAt', 'guide', 'bvReportingAdminId', 'sadhanaMentor'],
      limit: 1000,
    });

    // Filter users under this Admin (or all users if Super Admin / Admin)
    const isSuperOrAdmin = !!(currentUser?.isBvSuperAdmin || currentUser?.isBvAdmin || (currentUser?.role || '').toUpperCase().includes('ADMIN'));

    const currentDbId = String(currentUser?.id || '').toLowerCase();
    const currentUid = String(currentUser?.userId || '').toLowerCase();
    const currentEmail = String(context.user?.email || '').toLowerCase();

    const residencyMentorScope = await getSadhanaMentorResidencyScope(context.user);
    const hierarchy = residencyMentorScope ? null : await getScopedHierarchyUserIds(context.user);
    const users = allUsers.filter((u: any) => {
      if (residencyMentorScope) return residencyMentorScope.includes(u);
      if (!isUserInHierarchy(u, hierarchy)) return false;
      // Never expose incomplete profile records as blank member rows. A mentor
      // can only act on a real, identifiable member.
      if (!String(u.fullName || '').trim()) return false;

      // Exclude the Sadhana Mentor themselves from the list
      const uId = String(u.id || '').toLowerCase();
      const uUserId = String(u.userId || '').toLowerCase();
      const uEmail = String(u.email || '').toLowerCase();
      if (uId === currentDbId || uUserId === currentUid || (currentEmail && uEmail === currentEmail)) {
        return false;
      }

      // Exclude Super Admins (no one should see any Super Admin in the list)
      const uRole = (u.role || '').toUpperCase();
      const uIsSuperAdmin = !!(u.isBvSuperAdmin || uRole === 'SUPER ADMIN' || uRole === 'SUPER_ADMIN');
      if (uIsSuperAdmin) {
        return false;
      }

      if (isSuperOrAdmin) {
        // Super Admin sees all (excluding other Super Admins / themselves, which are already filtered above)
        const callerRole = (context.user?.role || '').toUpperCase();
        const callerIsSuperAdmin = !!(context.user?.isBvSuperAdmin || callerRole === 'SUPER_ADMIN' || callerRole === 'SUPER ADMIN');
        
        // If caller is Admin, do not let them see other Admins
        if (!callerIsSuperAdmin) {
          const uIsAdmin = !!(u.isBvAdmin || uRole === 'ADMIN' || uRole === 'ADMINISTRATOR');
          if (uIsAdmin) return false;
        }
        return true;
      }

      if (isPw) {
        const uSadhanaMentor = String(u.sadhanaMentor || '').toLowerCase();
        return uSadhanaMentor === currentDbId || uSadhanaMentor === currentUid;
      }

      const uGuide = Array.isArray(u.guide) ? u.guide[0] : u.guide;
      const uAdmin = u.bvReportingAdminId;
      return (
        (adminId && (uGuide === adminId || uAdmin === adminId || u.id === adminId)) ||
        (guideId && (uGuide === guideId || uAdmin === guideId)) ||
        (!adminId && !guideId)
      );
    });

    if (users.length === 0) return { members: [], guideName };

    // Fetch residency names for all unique residency IDs
    const residencyIds = [...new Set(
      users.map(u => Array.isArray(u.residency) ? u.residency[0] : u.residency).filter(Boolean) as string[]
    )];
    const residencyNameMap: Record<string, string> = {};
    if (residencyIds.length > 0) {
      const recs = await Promise.all(
        residencyIds.map(id => FolkResidencies.findOne({ id, fields: ['id', 'residencyName'] }).catch(() => null))
      );
      recs.forEach(r => { if (r && r.id) residencyNameMap[r.id] = (r as any).residencyName || ''; });
    }

    // 100 days: enough for streak calculation (consecutive days) + performanceStatus (last 10 entries)
    const todayStr = getTodayIST();
    const cutoffStr = daysAgo(todayStr, 100);

    // Paginate — guides with many members easily exceed 2000 entries over 100 days
    const entries: any[] = [];
    let entryOffset = 0;
    while (true) {
      const { records, hasMore } = await SadhanaEntries.findAll({
        filters: { entryDate: { gte: cutoffStr } } as any,
        fields: ['id', 'user', 'entryDate', 'scorePercent', 'submittedAt'],
        limit: 2000,
        offset: entryOffset,
      });
      entries.push(...records);
      if (!hasMore) break;
      entryOffset += 2000;
    }

    const entriesByUser = new Map<string, { entryDate: string; scorePercent: number | null; submittedAt: string }[]>();
    for (const e of entries) {
      const uid = Array.isArray(e.user) ? e.user[0] : e.user;
      if (!uid) continue;
      if (!entriesByUser.has(uid)) entriesByUser.set(uid, []);
      entriesByUser.get(uid)!.push({
        entryDate: e.entryDate || '',
        scorePercent: e.scorePercent ?? null,
        submittedAt: e.submittedAt || '',
      });
    }

    const members = users.map(u => {
      const residencyId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
      const isResident = !!(u.residencyApproved && residencyId);
      const residencyName = isResident && residencyId ? (residencyNameMap[residencyId] || null) : null;

      // STATUS-CHANGE FIX: only count entries from after the user's relevant status change
      const entryCutoff = (() => {
        const rawResId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
        const isRes = !!(u.residencyApproved && rawResId);
        if (isRes && ((u as any).residentSince || u.residencyJoinDate)) {
          const d = (u as any).residentSince || u.residencyJoinDate;
          return String(d).slice(0, 10);
        }
        return null;
      })();
      const userEntries = (entriesByUser.get(u.id) || [])
        .filter(e => !entryCutoff || e.entryDate >= entryCutoff)
        .sort((a, b) => b.entryDate.localeCompare(a.entryDate));

      const latestEntry = userEntries[0] || null;

      // Compute streak from ALL entries for this user (not filtered by entryCutoff — streak spans full history)
      const streak = computeStreak(entriesByUser.get(u.id) || [], todayStr);

      const performanceStatus = getPerformanceStatus(userEntries, isResident);

      return {
        userId: u.userId || u.id,
        fullName: String(u.fullName || '').trim(),
        email: u.email || '',
        phone: u.phone || null,
        ashrayLevel: u.ashrayLevel || null,
        isResident,
        residencyName,
        latestEntryDate: latestEntry?.entryDate || null,
        latestScore: latestEntry?.scorePercent ?? null,
        currentStreak: streak,
        performanceStatus,
      };
    });

    return { members, guideName };
  },
});
