import { z } from 'zod';
import { createEndpoint, ResidencyTransferRequests, Users, FolkResidencies, Guides } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get pending residency transfer requests — only for residencies the current guide manages',
  authenticated: true,
  inputSchema: z.object({
    status: z.string().optional(),
    guideId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const isSuperGuide = context.user.role === 'Super Guide';

    // Determine which residency IDs this guide manages
    let allowedResidencyIds: string[] = [];

    if (!isSuperGuide) {
      // Find the guide record for the current user
      const guideRecord = await Guides.findOne({
        filters: { email: context.user.email, isActive: true },
        fields: ['id', 'folkResidencies'],
      });
      if (!guideRecord) return [];

      // Get residencies linked to this guide
      const guideResidencies = guideRecord.folkResidencies;
      if (guideResidencies) {
        allowedResidencyIds = Array.isArray(guideResidencies) ? guideResidencies : [guideResidencies];
      }

      // If guide has no residencies, they shouldn't see any residency transfers
      if (allowedResidencyIds.length === 0) return [];
    }

    const { records: requests } = await ResidencyTransferRequests.findAll({
      filters: { status: 'Pending' },
      fields: ['id', 'user', 'fromResidency', 'toResidency', 'status', 'requestedAt', 'notes'],
      limit: 200,
    });

    if (requests.length === 0) return [];

    // Filter: only requests where toResidency is in this guide's residencies
    const filtered = isSuperGuide
      ? requests
      : requests.filter((r: any) => {
          const toId = Array.isArray(r.toResidency) ? r.toResidency[0] : r.toResidency;
          return toId && allowedResidencyIds.includes(toId);
        });

    if (filtered.length === 0) return [];

    const userIds = [...new Set(filtered.map((r: any) => Array.isArray(r.user) ? r.user[0] : r.user).filter(Boolean))] as string[];
    const usersRes = userIds.length > 0
      ? await Users.findAll({ filters: { id: { in: userIds } }, fields: ['id', 'userId', 'fullName', 'email', 'residency', 'residencyApproved'], limit: 200 })
      : { records: [] };

    const userMap: Record<string, any> = {};
    usersRes.records.forEach((u: any) => { userMap[u.id] = u; });

    const residencyIds = [
      ...new Set(
        filtered.flatMap((r: any) => {
          const uid = Array.isArray(r.user) ? r.user[0] : r.user as string;
          const u = userMap[uid] as any;
          const fromId = (Array.isArray(r.fromResidency) ? r.fromResidency[0] : r.fromResidency) || 
                         (u?.residencyApproved ? (Array.isArray(u.residency) ? u.residency[0] : u.residency) : null);
          const toId = Array.isArray(r.toResidency) ? r.toResidency[0] : r.toResidency;
          return [fromId, toId];
        }).filter(Boolean) as string[]
      )
    ];

    const residenciesRes = residencyIds.length > 0
      ? await FolkResidencies.findAll({ filters: { id: { in: residencyIds } }, fields: ['id', 'residencyName'], limit: 200 })
      : { records: [] };

    const residencyMap: Record<string, any> = {};
    residenciesRes.records.forEach((r: any) => { residencyMap[r.id] = r; });

    return filtered.map((r: any) => {
      const uid = Array.isArray(r.user) ? r.user[0] : r.user as string;
      const u = userMap[uid] as any;
      const fromId = (Array.isArray(r.fromResidency) ? r.fromResidency[0] : r.fromResidency) || 
                     (u?.residencyApproved ? (Array.isArray(u.residency) ? u.residency[0] : u.residency) : null) as string | null;
      const toId = Array.isArray(r.toResidency) ? r.toResidency[0] : r.toResidency as string | null;
      const from = fromId ? (residencyMap[fromId] as any) : null;
      const to = toId ? (residencyMap[toId] as any) : null;
      return {
        requestId: r.id,
        rowId: r.id,
        userId: u?.userId || uid || '',
        userName: u?.fullName || '',
        userEmail: u?.email || '',
        fromResidencyName: from?.residencyName || 'Non-resident',
        toResidencyName: to?.residencyName || 'Leave Residency',
        oldResidencyName: from?.residencyName || 'Non-resident',
        newResidencyName: to?.residencyName || 'Leave Residency',
        oldResidencyId: fromId || '',
        newResidencyId: toId || '',
        status: (r.status as string) || 'Pending',
        requestedAt: (r.requestedAt as string) || '',
        notes: (r.notes as string) || '',
      };
    });
  },
});
