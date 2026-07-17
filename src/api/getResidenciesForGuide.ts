import { z } from 'zod';
import { createEndpoint, FolkResidencies, Guides, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get residencies for the current guide or service allocator — returns array directly',
  authenticated: true,
  inputSchema: z.object({ guideId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const isSuperGuide = context.user.role === 'Super Guide';
    const isServiceAllocator = !!((context.user as any).isServiceAllocator);

    // Service allocators get their own residency (looked up from their user record)
    if (!isSuperGuide && isServiceAllocator) {
      const userRecord = await Users.findOne({
        id: context.user.id,
        fields: ['id', 'residency'],
      });
      const residencyDbId = userRecord
        ? (Array.isArray(userRecord.residency) ? userRecord.residency[0] : userRecord.residency)
        : null;
      if (!residencyDbId) return [];
      const residency = await FolkResidencies.findOne({
        id: residencyDbId as string,
        fields: ['id', 'residencyName', 'residencyId', 'maxCapacity'],
      });
      if (!residency) return [];
      return [{
        id: residency.id,
        residencyId: ((residency as any).residencyId as string) || residency.id,
        residencyName: ((residency as any).residencyName as string) || '',
        maxCapacity: ((residency as any).maxCapacity as number) || 0,
      }];
    }

    let guideDbId: string | null = null;
    if (!isSuperGuide) {
      const guide = await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id'] });
      if (!guide) return [];
      guideDbId = (guide as any).id;
    }

    const filter: any = { isActive: true };
    if (guideDbId) filter.guides = guideDbId;

    const { records } = await FolkResidencies.findAll({
      filters: filter,
      fields: ['id', 'residencyName', 'residencyId', 'maxCapacity'],
      limit: 200,
    });

    return records.map((r: any) => ({
      id: r.id,
      residencyId: (r.residencyId as string) || r.id,
      residencyName: (r.residencyName as string) || '',
      maxCapacity: (r.maxCapacity as number) || 0,
    }));
  },
});
