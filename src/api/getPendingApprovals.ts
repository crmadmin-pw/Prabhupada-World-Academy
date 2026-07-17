import { z } from 'zod';
import { createEndpoint, Users, FolkResidencies, Guides } from 'zite-integrations-backend-sdk';
import { getGuideScope } from '../lib/guideScope';

const USER_FIELDS = ['id', 'fullName', 'phone', 'email', 'ashrayLevel', 'residency',
  'residencyClaimed', 'residencyJoinDate', 'createdAt', 'status', 'guide'];
const RESIDENCY_FIELDS = ['id', 'residencyName'];

export default createEndpoint({
  description: 'Get users pending approval — includes all users in the guide\'s centers, not just direct folk',
  authenticated: true,
  inputSchema: z.object({ guideId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const isSuperGuide = context.user.role === 'Super Guide';
    const pendingFilter = { status: 'Pending Approval' };

    let allUsers: any[] = [];

    if (isSuperGuide) {
      // Super Guide sees all pending users across all centers
      const { records } = await Users.findAll({ filters: pendingFilter, fields: USER_FIELDS, limit: 500 });
      allUsers = records;
    } else {
      // Regular guide: see pending users directly assigned + all pending in their centers
      const scope = await getGuideScope(context.user.email);
      if (!scope) return [];

      const fetchPromises = [
        // Directly assigned to this guide
        Users.findAll({ filters: { ...pendingFilter, guide: scope.guideId }, fields: USER_FIELDS, limit: 500 }),
        // All pending users in each center residency
        ...scope.residencyIds.map(rid =>
          Users.findAll({ filters: { ...pendingFilter, residency: rid }, fields: USER_FIELDS, limit: 200 })
        ),
      ];
      const results = await Promise.all(fetchPromises);

      // Deduplicate by DB record ID
      const userMap = new Map<string, any>();
      for (const res of results) {
        for (const u of res.records) userMap.set(u.id, u);
      }
      allUsers = Array.from(userMap.values());
    }

    const [residenciesRes, guidesRes] = await Promise.all([
      FolkResidencies.findAll({ fields: RESIDENCY_FIELDS, limit: 500 }),
      Guides.findAll({ fields: ['id', 'fullName', 'abbreviation', 'email'], limit: 500 })
    ]);

    const residencyMap = new Map(residenciesRes.records.map(r => [r.id, (r as any).residencyName || '']));

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

    // Only show users who completed registration (fullName set)
    const completeUsers = allUsers.filter(u => (u.fullName || '').trim().length > 0);

    return completeUsers.map(u => {
      const residencyId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
      const rawGuideId = Array.isArray(u.guide) ? u.guide[0] : u.guide;
      const uGuideId = rawGuideId ? (guideLookup.get(String(rawGuideId).toLowerCase()) || rawGuideId) : null;

      return {
        userId: u.id,
        rowId: u.id,
        fullName: u.fullName || '',
        phone: u.phone || '',
        email: u.email || '',
        ashrayLevel: u.ashrayLevel || null,
        residencyUserClaim: u.residencyClaimed || false,
        selectedFolkResidency: residencyId || null,
        residencyName: residencyId ? (residencyMap.get(residencyId) || '') : '',
        residencyJoinDate: u.residencyJoinDate || null,
        createdAt: u.createdAt || '',
        guideId: uGuideId || null,
      };
    });
  },
});
