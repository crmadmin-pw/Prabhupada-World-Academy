import { z } from 'zod';
import { createEndpoint, FolkResidencies, GuideResidencyAssignmentRequests, Guides, Users, AppError } from '@/lib/backend-sdk';
import { isActiveFolkResidency } from '../lib/residencyCategory';

const roleName = (value: unknown) => String(value || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
const ids = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap(v => Array.isArray(v) ? v : [v]).map(v => String(v || '').trim()).filter(Boolean);
};

export default createEndpoint({
  description: 'Request a change to persistent FOLK guide residency assignments',
  authenticated: true,
  inputSchema: z.object({ residencyIds: z.array(z.string().min(1)).min(1).max(50) }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = roleName(context.user.role);
    const canGuide = ['GUIDE', 'SUPER_GUIDE', 'ADMIN', 'SUPER_ADMIN'].includes(role) || context.user.isBvAdmin === true || context.user.isBvSuperAdmin === true;
    if (!canGuide) throw new AppError({ code: 'FORBIDDEN', message: 'Guide access required' });
    if (role === 'SUPER_GUIDE' || role === 'SUPER_ADMIN' || context.user.isBvSuperAdmin === true) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'Super Guides already have department-wide residency access' });
    }

    const requestedIds = [...new Set(ids(input.residencyIds))];
    const { records } = await FolkResidencies.findAll({ limit: 500, fields: ['id', 'residencyName', 'isActive', 'category', 'segment'] });
    const validIds = new Set(records.filter(isActiveFolkResidency).map((r: any) => String(r.id)));
    if (requestedIds.some(id => !validIds.has(id))) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'One or more selected residencies are invalid or inactive' });
    }

    const guide = await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id', 'folkResidencies'] });
    const user = await Users.findOne({ id: context.user.id, fields: ['id', 'userId', 'email', 'fullName', 'folkResidencies'] }) ||
      await Users.findOne({ filters: { email: context.user.email }, fields: ['id', 'userId', 'email', 'fullName', 'folkResidencies'] });
    if (!user && !guide) throw new AppError({ code: 'NOT_FOUND', message: 'Guide profile not found' });

    const requesterIds = [user?.id, user?.userId, context.user.id, context.user.userId, context.user.email].filter(Boolean).map(String);
    for (const requesterId of requesterIds) {
      const existing = await GuideResidencyAssignmentRequests.findOne({ filters: { requesterId, status: 'Pending' } });
      if (existing) throw new AppError({ code: 'CONFLICT', message: 'A residency assignment request is already pending approval' });
    }

    const guideAssignedIds = ids((guide as any)?.folkResidencies);
    const currentAssignedIds = guideAssignedIds.length > 0 ? guideAssignedIds : ids((user as any)?.folkResidencies);
    const record = await GuideResidencyAssignmentRequests.create({ record: {
      requesterId: user?.id || context.user.id,
      requesterUserId: user?.userId || context.user.userId || '',
      requesterEmail: user?.email || context.user.email || '',
      requesterName: user?.fullName || context.user.fullName || '',
      currentResidencyIds: currentAssignedIds,
      requestedResidencyIds: requestedIds,
      status: 'Pending',
      requestedAt: new Date().toISOString(),
    } });
    return { success: true, requestId: record.id };
  },
});
