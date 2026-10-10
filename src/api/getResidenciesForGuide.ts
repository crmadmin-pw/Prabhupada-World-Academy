import { z } from 'zod';
import { createEndpoint, FolkResidencies, Guides, Users } from '@/lib/backend-sdk';
import { getGuideScope } from '../lib/guideScope';
import { isActiveFolkResidency } from '../lib/residencyCategory';

const normalizeRole = (value: unknown) => String(value || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
const refs = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap(v => String(v || '').split(',')).map(v => v.trim()).filter(Boolean);
};
const key = (value: unknown) => String(value || '').trim().toLowerCase();

export default createEndpoint({
  description: 'Get the FOLK residencies assigned to the current guide',
  authenticated: true,
  inputSchema: z.object({ guideId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = normalizeRole(context.user.role);
    const isSuperGuide = role === 'SUPER_GUIDE' || role === 'SUPER_ADMIN' || context.user.isBvSuperAdmin === true;

    const { records: rawResidencies } = await FolkResidencies.findAll({
      fields: ['id', 'residencyId', 'residencyName', 'isActive', 'maxCapacity', 'guides', 'guideIds', 'category', 'segment'],
      limit: 500,
    });
    const folkResidencies = rawResidencies.filter(isActiveFolkResidency);

    if (isSuperGuide) {
      return folkResidencies.map((r: any) => ({
        id: r.id,
        residencyId: r.residencyId || r.id,
        residencyName: r.residencyName || '',
        maxCapacity: r.maxCapacity || 0,
      }));
    }

    const isServiceAllocator = !!context.user.isServiceAllocator;
    const currentUser = await Users.findOne({ id: context.user.id, fields: ['id', 'userId', 'email', 'fullName', 'residency', 'folkResidencies'] }) ||
      await Users.findOne({ filters: { email: context.user.email }, fields: ['id', 'userId', 'email', 'fullName', 'residency', 'folkResidencies'] });
    if (isServiceAllocator) {
      const currentResidency = refs(currentUser?.residency)[0];
      const match = folkResidencies.find((r: any) => [r.id, r.residencyId, r.residencyName].some(v => key(v) === key(currentResidency)));
      return match ? [{ id: match.id, residencyId: match.residencyId || match.id, residencyName: match.residencyName || '', maxCapacity: match.maxCapacity || 0 }] : [];
    }

    const [guide, scope] = await Promise.all([
      Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id', 'guideId', 'email', 'fullName', 'folkResidencies'] }),
      getGuideScope(context.user.email),
    ]);
    const guideKeys = new Set([context.user.id, context.user.userId, context.user.email, guide?.id, guide?.guideId, guide?.email, guide?.fullName, currentUser?.id, currentUser?.userId, currentUser?.fullName].filter(Boolean).map(key));
    const assignedResidencyIds = new Set([...(scope?.residencyIds || []), ...refs(guide?.folkResidencies), ...refs(currentUser?.folkResidencies)].map(key));

    return folkResidencies
      .filter((r: any) => {
        const directRefs = [r.id, r.residencyId, r.residencyName].filter(Boolean).map(key);
        if (directRefs.some(id => assignedResidencyIds.has(id))) return true;
        const assignedGuides = [...refs(r.guideIds), ...refs(r.guides)].map(key);
        return assignedGuides.some(id => guideKeys.has(id));
      })
      .map((r: any) => ({
        id: r.id,
        residencyId: r.residencyId || r.id,
        residencyName: r.residencyName || '',
        maxCapacity: r.maxCapacity || 0,
      }));
  },
});
