/**
 * GET /api/sadhanaStatus
 *
 * Returns Sadhana submission status for all users for a given date.
 * Supports filtering by date, residency, guide, user status, ashrayLevel,
 * sadhanaStatus (submitted/missing), userId, and phone.
 *
 * Default date = today (IST / server local date).
 */
import { z } from 'zod';
import { createEndpoint, Users, SadhanaEntries, Guides, FolkResidencies, ZiteError, UsersRecordType, SadhanaEntriesRecordType } from 'zite-integrations-backend-sdk';

// ── Output schemas ────────────────────────────────────────────────────────────

const EntrySchema = z.object({
  entryId: z.string().nullable(),
  roundsChanted: z.number().nullable(),
  totalScore: z.number().nullable(),
  maxScore: z.number().nullable(),
  scorePercent: z.number().nullable(),
  templateMode: z.string().nullable(),
  flagSick: z.boolean().nullable(),
  flagOs: z.boolean().nullable(),
  sleepMinutes: z.number().nullable(),
  japaFinishTime: z.string().nullable(),
  sbPoints: z.number().nullable(),
  spReadingMinutes: z.number().nullable(),
  preachingMinutes: z.number().nullable(),
  studyMinutes: z.number().nullable(),
  nrChantingRounds: z.number().nullable(),
  nrReadingMinutes: z.number().nullable(),
  nrHearingMinutes: z.number().nullable(),
  fieldValuesJson: z.string().nullable(),
  submittedAt: z.string().nullable(),
});

const UserStatusSchema = z.object({
  id: z.string(),
  fullName: z.string().nullable(),
  userId: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  guide: z.string().nullable(),
  residency: z.string().nullable(),
  ashrayLevel: z.string().nullable(),
  status: z.string().nullable(),
  sadhanaStatus: z.enum(['submitted', 'missing']),
  date: z.string(),
  entry: EntrySchema.nullable(),
});

// ── Helper: paginated fetch all ───────────────────────────────────────────────

async function fetchAllUsers(filters: Record<string, unknown>) {
  const all: UsersRecordType[] = [];
  let offset = 0;
  while (true) {
    const { records, hasMore } = await Users.findAll({ filters, offset, limit: 500 });
    all.push(...records);
    if (!hasMore) break;
    offset += records.length;
  }
  return all;
}

async function fetchEntriesForDate(date: string) {
  const all: SadhanaEntriesRecordType[] = [];
  let offset = 0;
  while (true) {
    const { records, hasMore } = await SadhanaEntries.findAll({
      filters: { entryDate: date },
      offset,
      limit: 500,
    });
    all.push(...records);
    if (!hasMore) break;
    offset += records.length;
  }
  return all;
}

// ── Endpoint ──────────────────────────────────────────────────────────────────

export default createEndpoint({
  description: 'Fetch Sadhana submission status for all users for a given date with optional filters',
  inputSchema: z.object({
    /** Target date in yyyy-mm-dd format. Defaults to today if omitted. */
    date: z.string().optional(),
    /** Filter by residency name (partial match) */
    residency: z.string().optional(),
    /** Filter by guide full name (partial match) */
    guide: z.string().optional(),
    /** Filter by user account status: Active / Inactive / Pending Approval / Rejected */
    status: z.string().optional(),
    /** Filter by ashray level */
    ashrayLevel: z.string().optional(),
    /** Filter to only submitted or only missing entries */
    sadhanaStatus: z.enum(['submitted', 'missing']).optional(),
    /** Filter by exact userId (e.g. U123) */
    userId: z.string().optional(),
    /** Filter by exact phone number */
    phone: z.string().optional(),
  }),
  outputSchema: z.object({
    date: z.string(),
    count: z.number(),
    submittedCount: z.number(),
    missingCount: z.number(),
    data: z.array(UserStatusSchema),
  }),
  execute: async ({ input }) => {
    // ── 1. Resolve target date ────────────────────────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    const targetDate = input.date ?? today;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      throw new ZiteError({
        code: 'BAD_REQUEST',
        message: 'Invalid date format. Use yyyy-mm-dd (e.g. 2026-04-13)',
      });
    }

    // ── 2. Resolve guide/residency IDs from names ─────────────────────────────
    let guideId: string | undefined;
    let guideName: string | undefined;
    if (input.guide) {
      const g = await Guides.findOne({ filters: { fullName: { contains: input.guide } } });
      if (!g) return { date: targetDate, count: 0, submittedCount: 0, missingCount: 0, data: [] };
      guideId = g.id;
      guideName = g.fullName;
    }

    let residencyId: string | undefined;
    let residencyName: string | undefined;
    if (input.residency) {
      const r = await FolkResidencies.findOne({
        filters: { residencyName: { contains: input.residency } },
      });
      if (!r) return { date: targetDate, count: 0, submittedCount: 0, missingCount: 0, data: [] };
      residencyId = r.id;
      residencyName = r.residencyName;
    }

    // ── 3. Fetch lookup maps for guides & residencies (for annotation) ─────────
    const [guidesResult, residenciesResult] = await Promise.all([
      Guides.findAll({ limit: 500 }),
      FolkResidencies.findAll({ limit: 500 }),
    ]);

    const guideNameMap = new Map<string, string>();
    for (const g of guidesResult.records) guideNameMap.set(g.id, g.fullName ?? '');

    const residencyNameMap = new Map<string, string>();
    for (const r of residenciesResult.records) residencyNameMap.set(r.id, r.residencyName ?? '');

    // ── 4. Build user filters ─────────────────────────────────────────────────
    const userFilters: Record<string, unknown> = {};
    if (input.status) userFilters.status = input.status;
    if (input.ashrayLevel) userFilters.ashrayLevel = input.ashrayLevel;
    if (input.userId) userFilters.userId = input.userId;
    if (input.phone) userFilters.phone = input.phone;
    if (guideId) userFilters.guide = guideId;
    if (residencyId) userFilters.residency = residencyId;

    // ── 5. Fetch users & sadhana entries in parallel ──────────────────────────
    console.log('[sadhanaStatus] filters applied to Users query:', JSON.stringify(userFilters));
    console.log('[sadhanaStatus] fetching entries for date:', targetDate);

    const [allUsers, allEntries] = await Promise.all([
      fetchAllUsers(userFilters),
      fetchEntriesForDate(targetDate),
    ]);

    console.log(`[sadhanaStatus] fetched ${allUsers.length} users, ${allEntries.length} entries for ${targetDate}`);

    // ── 6. Build entry map: userRecordId → entry (first/latest per user) ──────
    const entryMap = new Map<string, typeof allEntries[0]>();
    for (const entry of allEntries) {
      if (!entry.user) continue;
      const uid = Array.isArray(entry.user) ? entry.user[0] : entry.user;
      if (uid && !entryMap.has(uid)) {
        entryMap.set(uid, entry);
      }
    }

    // ── 7. Join users with entries ────────────────────────────────────────────
    const data = allUsers
      .map(user => {
        const entry = entryMap.get(user.id);
        const sadhanaStatus: 'submitted' | 'missing' = entry ? 'submitted' : 'missing';

        // Resolve guide / residency display names
        const userGuideId = Array.isArray(user.guide) ? user.guide[0] : user.guide;
        const userResidencyId = Array.isArray(user.residency) ? user.residency[0] : user.residency;

        return {
          id: user.id,
          fullName: user.fullName ?? null,
          userId: user.userId ?? null,
          phone: user.phone ?? null,
          email: user.email ?? null,
          guide: (userGuideId ? (guideNameMap.get(userGuideId) ?? guideName ?? null) : guideName ?? null),
          residency: (userResidencyId ? (residencyNameMap.get(userResidencyId) ?? residencyName ?? null) : residencyName ?? null),
          ashrayLevel: user.ashrayLevel ?? null,
          status: user.status ?? null,
          sadhanaStatus,
          date: targetDate,
          entry: entry
            ? {
                entryId: entry.entryId ?? null,
                roundsChanted: entry.roundsCount ?? null,
                totalScore: entry.totalScore ?? null,
                maxScore: entry.maxScore ?? null,
                scorePercent: entry.scorePercent ?? null,
                templateMode: entry.templateMode ?? null,
                flagSick: entry.flagSick ?? null,
                flagOs: entry.flagOs ?? null,
                sleepMinutes: entry.sleepMinutes ?? null,
                japaFinishTime: entry.japaFinishTime ?? null,
                sbPoints: entry.sbPoints ?? null,
                spReadingMinutes: entry.spReadingMinutes ?? null,
                preachingMinutes: entry.preachingMinutes ?? null,
                studyMinutes: entry.studyMinutes ?? null,
                nrChantingRounds: entry.nrChantingRounds ?? null,
                nrReadingMinutes: entry.nrReadingMinutes ?? null,
                nrHearingMinutes: entry.nrHearingMinutes ?? null,
                fieldValuesJson: entry.fieldValuesJson ?? null,
                submittedAt: entry.submittedAt ?? null,
              }
            : null,
        };
      })
      .filter(item => {
        if (input.sadhanaStatus && item.sadhanaStatus !== input.sadhanaStatus) return false;
        return true;
      });

    const submittedCount = data.filter(d => d.sadhanaStatus === 'submitted').length;
    const missingCount = data.filter(d => d.sadhanaStatus === 'missing').length;

    console.log(`[sadhanaStatus] result: count=${data.length}, submitted=${submittedCount}, missing=${missingCount}`);

    return {
      date: targetDate,
      count: data.length,
      submittedCount,
      missingCount,
      data,
    };
  },
});
