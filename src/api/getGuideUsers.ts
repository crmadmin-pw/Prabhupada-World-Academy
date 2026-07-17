import { z } from 'zod';
import { createEndpoint, Users, Guides, FolkResidencies, SadhanaEntries } from 'zite-integrations-backend-sdk';
import { getTodayIST } from '../lib/streakUtils';
import { normalizeRole, normalizeStatus } from './resolveUserLogin';

// Minimal fields for guide lookup
const GUIDE_FIELDS = ['id', 'email', 'isActive', 'role', 'folkResidencies'];
// Minimal fields for user listing — avoids fetching large linked-record arrays
const USER_FIELDS = ['id', 'userId', 'fullName', 'phone', 'email', 'role', 'status',
  'ashrayLevel', 'residency', 'residencyApproved', 'residencyClaimed',
  'guide', 'isBvsl', 'isB', 'isSadhanaMentor', 'isServiceAllocator', 'isBvMentor',
  'isFolkLead', 'isTripCoordinator', 'isOtherCenter', 'isCleanlinessManager', 'createdAt',
  'temporaryResidencyEnabled', 'temporaryResidency'];
// Minimal fields for today's entries
const ENTRY_TODAY_FIELDS = ['id', 'user', 'entryDate'];
// Minimal fields for residency
const RESIDENCY_FIELDS = ['id', 'residencyName'];

export default createEndpoint({
  description: 'Get all users for a guide — optimized with parallel queries and field selection',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string().optional(),
    status: z.enum(['all', 'active', 'inactive', 'pending', 'rejected']).optional(),
    statusFilter: z.string().optional(),
    residencyId: z.string().optional(),
    residencyFilter: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const userRole = context.user.role || 'User';
    const isSuperGuide = userRole === 'Super Guide';
    const isBvMentor = !!(context.user as any).isBvMentor;
    const statusKey = input.statusFilter || input.status || 'all';

    // For BV Mentors: bvMentorGuideId may be a Users-table UUID (stored when a Guide
    // tagged them) or a Guides-table UUID (stored when a Super Guide tagged them).
    // Resolve it to a Guides-table UUID so we can filter Users.guide correctly.
    let bvMentorGuideDbId: string | null = null;
    if (isBvMentor && input.guideId) {
      // Try direct Guides table lookup first (covers Super Guide assignment)
      const directGuideRec = await Guides.findOne({ id: input.guideId, fields: ['id'] }).catch(() => undefined);
      if (directGuideRec) {
        bvMentorGuideDbId = directGuideRec.id;
      } else {
        // Must be a Users-table UUID — look up that user's email, then find their Guides record
        const guideUser = await Users.findOne({ id: input.guideId, fields: ['id', 'email'] }).catch(() => undefined);
        if (guideUser?.email) {
          const guideRec = await Guides.findOne({ filters: { email: guideUser.email }, fields: ['id'] });
          if (guideRec) bvMentorGuideDbId = guideRec.id;
        }
      }
    }

    // Run guide lookup and today's entries in parallel
    const todayStr = getTodayIST();

    const [guideRecord, { records: todayEntries }] = await Promise.all([
      (isSuperGuide || isBvMentor)
        ? Promise.resolve(null)
        : Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: GUIDE_FIELDS }),
      SadhanaEntries.findAll({
        filters: { entryDate: todayStr },
        fields: ENTRY_TODAY_FIELDS,
        limit: 2000,
      }),
    ]);

    // Build user filters
    const filters: any = {};
    if (!isSuperGuide && !isBvMentor && guideRecord) filters.guide = guideRecord.id;
    // Super Guide with explicit guideId — scope to that guide only
    if (isSuperGuide && input.guideId && input.guideId !== 'ALL' && input.guideId !== 'all') {
      filters.guide = input.guideId;
    }
    // BV Mentor — use resolved Guides-table UUID
    if (isBvMentor && bvMentorGuideDbId && bvMentorGuideDbId !== 'ALL' && bvMentorGuideDbId !== 'all') {
      filters.guide = bvMentorGuideDbId;
    }

    if (statusKey && statusKey !== 'all') {
      const statusMap: Record<string, string> = {
        active: 'Active',
        inactive: 'Inactive',
        pending: 'Pending Approval',
        rejected: 'Rejected',
      };
      filters.status = statusMap[statusKey] ?? statusKey;
    }
    const resFilter = input.residencyId || input.residencyFilter;
    if (resFilter && resFilter !== 'all' && resFilter !== 'residents' && resFilter !== 'non_residents') {
      filters.residency = resFilter;
    }
    if (resFilter === 'residents') {
      filters.residencyApproved = true;
    }

    // Phase 1 FIX: also fetch users from all residencies the guide manages (deduped)
    const baseUsersRes = await Users.findAll({ filters, fields: USER_FIELDS, limit: 2000 });
    let users: any[] = baseUsersRes.records;

    // If filtering by guide (non-super-guide, non-bv-mentor, no specific residency filter), also include residency-based users
    if (!isSuperGuide && !isBvMentor && guideRecord && (!resFilter || resFilter === 'all' || resFilter === 'residents' || resFilter === 'non_residents')) {
      const guideRids: string[] = Array.isArray(guideRecord.folkResidencies)
        ? guideRecord.folkResidencies as string[]
        : (guideRecord.folkResidencies ? [guideRecord.folkResidencies as string] : []);
      if (guideRids.length > 0) {
        const residencyFetches = await Promise.all(
          guideRids.map(rid => {
            const resFilters: any = { residency: rid };
            if (statusKey && statusKey !== 'all') {
              const statusMap: Record<string, string> = { active: 'Active', inactive: 'Inactive', pending: 'Pending Approval', rejected: 'Rejected' };
              resFilters.status = statusMap[statusKey] ?? statusKey;
            }
            return Users.findAll({ filters: resFilters, fields: USER_FIELDS, limit: 500 });
          })
        );
        const allUsersMap = new Map<string, any>();
        for (const u of users) allUsersMap.set(u.id, u);
        for (const res of residencyFetches) {
          for (const u of res.records) allUsersMap.set(u.id, u);
        }
        users = Array.from(allUsersMap.values());
      }
    }

    // Build submitted-today set
    const submittedToday = new Set(
      todayEntries.map(e => Array.isArray(e.user) ? e.user[0] : e.user).filter(Boolean)
    );

    // Batch fetch residency names — ONE query instead of N
    const residencyIds = [
      ...new Set(
        users
          .map(u => Array.isArray(u.residency) ? u.residency[0] : u.residency)
          .filter(Boolean) as string[]
      ),
    ];

    const [residenciesRes, guidesRes] = await Promise.all([
      FolkResidencies.findAll({ fields: RESIDENCY_FIELDS, limit: 500 }),
      Guides.findAll({ fields: ['id', 'fullName', 'abbreviation', 'email'], limit: 500 })
    ]);

    const residencyMap = new Map<string, string>();
    for (const r of residenciesRes.records) {
      residencyMap.set(r.id, (r as any).residencyName || '');
    }

    // Build guide lookup map to normalize raw guide names/abbreviations/emails to UUIDs
    const guideLookup = new Map<string, string>();
    for (const g of guidesRes.records) {
      if (g.id) {
        guideLookup.set(g.id.toLowerCase(), g.id);
        if (g.fullName) guideLookup.set(g.fullName.toLowerCase(), g.id);
        if (g.abbreviation) guideLookup.set(g.abbreviation.toLowerCase(), g.id);
        if (g.email) guideLookup.set(g.email.toLowerCase(), g.id);
      }
    }

    // Filter out users who haven't completed registration (no userId means they only auth'd but never registered)
    // Also exclude guides — they manage folk but don't fill sadhana themselves
    const registeredUsers = users.filter(u =>
      u.userId &&
      (u.fullName || '').trim().length > 0 &&
      u.role !== 'Guide'
    );

    return {
      users: registeredUsers.map(u => {
        const residencyId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
        const rawGuideId = Array.isArray(u.guide) ? u.guide[0] : u.guide;
        const guideId = rawGuideId ? (guideLookup.get(String(rawGuideId).toLowerCase()) || rawGuideId) : null;
        return {
          userId: u.id,
          userDbId: u.userId || u.id,
          fullName: u.fullName || '',
          phone: u.phone || '',
          email: u.email || '',
          role: normalizeRole(u.role || 'User'),
          status: normalizeStatus(u.status || 'Pending Approval'),
          ashrayLevel: u.ashrayLevel || null,
          residencyApproved: u.residencyApproved || false,
          residencyClaimed: u.residencyClaimed || false,
          residencyId: residencyId || null,
          residencyName: residencyId ? (residencyMap.get(residencyId) || '') : '',
          submittedToday: submittedToday.has(u.id),
          isBvsl: u.isBvsl || false,
          isB: u.isB || false,
          isOtherCenter: (u as any).isOtherCenter || false,
          isSadhanaMentor: u.isSadhanaMentor || false,
          isServiceAllocator: u.isServiceAllocator || false,
          isBvMentor: u.isBvMentor || false,
          isCleanlinessManager: u.isCleanlinessManager || false,
          isFolkLead: u.isFolkLead || false,
          isTripCoordinator: u.isTripCoordinator || false,
          temporaryResidencyEnabled: u.temporaryResidencyEnabled || false,
          temporaryResidency: Array.isArray(u.temporaryResidency) ? u.temporaryResidency[0] : (u.temporaryResidency || null),
          isScholar: !!(u.temporaryResidencyEnabled && (Array.isArray(u.temporaryResidency) ? u.temporaryResidency[0] : u.temporaryResidency)),
          createdAt: u.createdAt || '',
          // Fields used in UsersTab table
          selectedGuideId: guideId || null,
          selectedGuideName: null, // resolved separately if needed
          latestEntryDate: null,
          latestScore: null,
          bvLatestDate: null,
          bvLatestScore: null,
        };
      }),
    };
  },
});
