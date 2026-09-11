import { z } from 'zod';
import { scopeRealtimeDependencies } from '@/lib/requestQueries';
import { createEndpoint, Users, Guides, SadhanaEntries, FolkResidencies } from '@/lib/backend-sdk';
import { requireGuideRole } from '../lib/userUtils';
import { getDashboardHierarchyScope } from '../lib/hierarchyUtils';
import { getGuideScope } from '../lib/guideScope';
import getGuides from './getGuides';
import { getReportReferenceData } from '../lib/reportReferenceData';

const USER_FIELDS = ['id', 'userId', 'fullName', 'email', 'status', 'role', 'isBvAdmin', 'isBvSuperAdmin', 'residency', 'guide', 'isScholar', 'residencyClaimed', 'residencyApproved', 'residencyGuideVerified', 'residentSince'];

// Guides and Super Guides oversee Sadhana; they are not expected to submit a
// daily member report. Normalize legacy spacing/casing so the rule applies to
// both PW and FOLK without relying on names or email addresses.
function isSadhanaExemptLeadershipRole(role: unknown): boolean {
  const normalized = String(role || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return normalized === 'GUIDE' || normalized === 'SUPER_GUIDE' || normalized === 'SUPERGUIDE' ||
    normalized === 'ADMIN' || normalized === 'ADMINISTRATOR' || normalized === 'SUPER_ADMIN' ||
    normalized === 'SUPERADMIN' || normalized === 'SUPER_ADMINISTRATOR' ||
    normalized === 'PW_ADMIN' || normalized === 'PW_SUPER_ADMIN' || normalized === 'PW_SUPERADMIN';
}

function isSadhanaExemptUser(user: any): boolean {
  return !!(user?.isBvAdmin || user?.isBvSuperAdmin) || isSadhanaExemptLeadershipRole(user?.role);
}

export default createEndpoint({
  description: 'Get missing sadhana report — who did not submit for each date in a range, with late detection',
  authenticated: true,
  requiredCapabilities: 'sadhana.reports',
  inputSchema: z.object({
    startDate: z.string(),         // YYYY-MM-DD
    endDate: z.string(),           // YYYY-MM-DD
    guideId: z.string().optional(),
    residencyId: z.string().optional(),
    segment: z.enum(['PW', 'FOLK']).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, {
      isSadhanaMentor: context.user.isSadhanaMentor,
      isBvsl: context.user.isBvsl,
    });

    const userRole = (context.user.role || 'User').toUpperCase().replace(/\s+/g, '_');
    const userEmail = (context.user.email || '').toLowerCase();
    const isSuperGuide = userRole === 'SUPER_GUIDE' ||
      userRole === 'SUPER_ADMIN' ||
      userRole === 'PW_ADMIN' ||
      !!context.user.isBvSuperAdmin ||
      !!context.user.isBvAdmin;

    const scopePromise = isSuperGuide ? Promise.resolve(null) : getGuideScope(context.user.email || '');
    const hierarchyPromise = getDashboardHierarchyScope(context.user, input.guideId);
    const displayPromise = Promise.all([
      getGuides.execute({ input: { segment: input.segment || 'ALL' }, context }),
      getReportReferenceData(),
    ]).then(([guideOptionsResult, reference]) => ({
      reference,
      availableGuides: (guideOptionsResult.guides || []).map((guide: any) => ({ id: guide.guideId, name: guide.name })),
    }));
    void hierarchyPromise.catch(() => {});
    void displayPromise.catch(() => {});
    // Member reads depend on scope, but not on the dropdown's display labels.
    const scope = await scopePromise;
    const guideRecord = scope ? { id: scope.guideId } : null;
    const guideRids = scope?.residencyIds || [];

    // 2. Build user query filters
    const filters: any = { status: 'Active' };
    // A regular FOLK Guide is already constrained by guide/residency hierarchy.
    // Many legacy FOLK member rows have no segment field, so applying
    // `segment = FOLK` here would discard valid members before that scope runs.
    // Department-wide admins and Super Guides still need the explicit segment
    // filter because their scope can include more than one department.
    if (input.segment && isSuperGuide) {
      filters.segment = input.segment;
    }
    if (!isSuperGuide && guideRecord) {
      filters.guide = guideRecord.id;
    }
    // Only users who can see the residency selector may narrow this report by
    // residency. A regular Guide's profile carries their own residency for
    // display purposes; treating that hidden value as a member filter drops
    // directly assigned non-resident members.
    const effectiveResidencyId = isSuperGuide ? input.residencyId : undefined;
    if (effectiveResidencyId) {
      filters.residency = effectiveResidencyId;
    }

    // Direct assignments and residency membership are independent queries.
    const [{ records: baseUsers }, ...resFetches] = await Promise.all([
      Users.findAll({ filters, fields: USER_FIELDS, limit: 2000 }),
      ...(!isSuperGuide && guideRecord && !effectiveResidencyId ? guideRids : []).map(rid =>
        Users.findAll({ filters: { residency: rid, status: 'Active' }, fields: USER_FIELDS, limit: 500 })
      ),
    ]);
    const userMap = new Map(baseUsers.map(user => [user.id, user]));
    for (const result of resFetches) for (const user of result.records) userMap.set(user.id, user);
    let allUsers = Array.from(userMap.values());

    const scopedUserIds = await hierarchyPromise;
    if (scopedUserIds !== null) {
      allUsers = allUsers.filter(u => {
        const uId = String(u.id || '').toLowerCase();
        const userIdStr = String(u.userId || '').toLowerCase();
        const emailStr = String(u.email || '').toLowerCase();
        return (uId && scopedUserIds.has(uId)) || (userIdStr && scopedUserIds.has(userIdStr)) || (emailStr && scopedUserIds.has(emailStr));
      });
    }

    // Generate the requested dates even when the member result is empty so the
    // report still shows the correct range and number of days.
    const dates: string[] = [];
    const d = new Date(input.startDate + 'T00:00:00Z');
    const endD = new Date(input.endDate + 'T00:00:00Z');
    while (d <= endD) {
      dates.push(d.toISOString().split('T')[0]);
      d.setUTCDate(d.getUTCDate() + 1);
    }

    // Only registered members (have userId + fullName). Guides, admins, and
    // super admins are report administrators, not Sadhana-report participants.
    const users = allUsers.filter(u =>
      u.userId &&
      (u.fullName || '').trim().length > 0 &&
      !isSadhanaExemptUser(u)
    );

    if (users.length === 0) {
      return {
        users: [],
        dates,
        matrix: {} as Record<string, Record<string, 'filled' | 'late' | 'missed'>>,
        stats: { totalUsers: 0, totalDays: dates.length, totalMissing: 0, totalLate: 0, completionRate: 100 },
        guides: (await displayPromise).availableGuides,
      };
    }

    scopeRealtimeDependencies('SadhanaEntries', { kind: 'references', fields: ['user'], values: users.map(user => user.id), caseSensitive: true, firstArrayValue: true });

    // Load entry pages alongside parent display names, instead of delaying
    // the parent query until every page has arrived.
    const [allEntries, { records: guideUsers }, { reference, availableGuides }] = await Promise.all([
      (async () => {
        const entries: any[] = [];
        let offset = 0;
        while (true) {
          const { records, hasMore } = await SadhanaEntries.findAll({
            filters: { entryDate: { gte: input.startDate, lte: input.endDate } },
            fields: ['id', 'user', 'entryDate', 'submittedAt'], limit: 2000, offset,
          });
          entries.push(...records);
          if (!hasMore) break;
          offset += 2000;
        }
        return entries;
      })(),
      Users.findAll({ filters: { status: 'Active' }, fields: ['id', 'userId', 'fullName', 'email', 'role', 'isBvAdmin', 'isBvSuperAdmin'], limit: 2000 }),
      displayPromise,
    ]);

    // 6. Build submission lookup map: "userId|date" -> "filled" | "late"
    // Late = submittedAt date is strictly after entryDate
    const submissionMap = new Map<string, 'filled' | 'late'>();
    for (const e of allEntries) {
      const uid = Array.isArray(e.user) ? e.user[0] : e.user;
      if (!uid || !e.entryDate) continue;
      const entryDateStr = String(e.entryDate).split('T')[0];
      const key = `${uid}|${entryDateStr}`;
      let status: 'filled' | 'late' = 'filled';
      if (e.submittedAt) {
        const submittedDateStr = String(e.submittedAt).split('T')[0];
        if (submittedDateStr > entryDateStr) {
          status = 'late';
        }
      }
      // If there's already a "filled" entry for this key, keep it (on-time wins)
      if (!submissionMap.has(key) || submissionMap.get(key) === 'late') {
        submissionMap.set(key, status);
      }
    }

    // 7. Fetch residency names (batch)
    const resIds = [...new Set(
      users.map(u => (Array.isArray(u.residency) ? u.residency[0] : u.residency)).filter(Boolean)
    )] as string[];
    const residencyMap = new Map<string, string>();
    if (resIds.length > 0) {
      const residencies = reference.residencies.slice(0, 200);
      for (const r of residencies) {
        if (r.id) {
          residencyMap.set(r.id, (r as any).residencyName || '');
          if ((r as any).residencyId) residencyMap.set((r as any).residencyId, (r as any).residencyName || '');
        }
      }
    }

    // 8. Fetch all guides and build guideLookup (extremely robust, same as getGuideUsers)
    const allGuides = reference.guides;
    const guideLookup = new Map<string, string>();
    const addGuideLookup = (record: any) => {
      const name = String(record.fullName || record.name || '').trim();
      if (!name) return;
      for (const ref of [record.id, record.userId, record.guideId, record.email]) {
        if (ref) guideLookup.set(String(ref).toLowerCase(), name);
      }
    };
    for (const g of allGuides) {
      addGuideLookup(g);
      if (g.fullName) guideLookup.set(g.fullName.toLowerCase(), g.fullName);
      if (g.abbreviation && g.fullName) guideLookup.set(g.abbreviation.toLowerCase(), g.fullName);
    }
    // Some legacy user records store the guide reference as a Users id/userId
    // (for example USER-206) rather than the Guides document id. Resolve those
    // references too so the report never exposes an internal code as a name.
    for (const user of guideUsers) {
      // Legacy guide references may point to a Users record whose current
      // role flag is absent or no longer normalized. The reference itself is
      // authoritative here, so index every active user's stable identifiers.
      addGuideLookup(user);
    }

    // 9. Sort users alphabetically and build matrix
    users.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));

    const matrix: Record<string, Record<string, 'filled' | 'late' | 'missed'>> = {};
    let totalMissing = 0;
    let totalLate = 0;

    for (const u of users) {
      matrix[u.id] = {};
      for (const date of dates) {
        const key = `${u.id}|${date}`;
        const status = submissionMap.get(key);
        if (status === 'filled') {
          matrix[u.id][date] = 'filled';
        } else if (status === 'late') {
          matrix[u.id][date] = 'late';
          totalLate++;
        } else {
          matrix[u.id][date] = 'missed';
          totalMissing++;
        }
      }
    }

    const totalCells = users.length * dates.length;
    const totalFilled = totalCells - totalMissing - totalLate;
    const completionRate = totalCells > 0
      ? Math.round(((totalFilled + totalLate) / totalCells) * 100)
      : 100;

    // Only the authorized directory can add options. Legacy member references
    // are display aliases, not additional admins or authorization grants.
    const guidesInScope = [...availableGuides];
    guidesInScope.sort((a, b) => a.name.localeCompare(b.name));

    return {
      users: users.map(u => {
        const resId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
        const guideId = Array.isArray(u.guide) ? u.guide[0] : u.guide;

        let residencyType: string;
        if (u.isScholar) {
          residencyType = 'Scholar';
        } else if ((u.residencyApproved || u.residencyGuideVerified) && resId) {
          residencyType = 'Resident';
        } else {
          residencyType = 'Non-Resident';
        }

        return {
          id: u.id,
          fullName: u.fullName || '',
          userId: u.userId || '',
          residencyName: resId ? (residencyMap.get(String(resId)) || residencyMap.get(String(resId).toLowerCase()) || resId) : '',
          guideName: guideId ? (guideLookup.get(String(guideId).toLowerCase()) || guideId) : '',
          guideId: guideId || '',
          residencyType,
        };
      }),
      dates,
      matrix,
      stats: { totalUsers: users.length, totalDays: dates.length, totalMissing, totalLate, completionRate },
      guides: guidesInScope,
    };
  },
});
