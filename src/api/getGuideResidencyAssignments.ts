import { z } from 'zod';
import { createEndpoint, FolkResidencies, Guides, GuideResidencyAssignmentRequests, Users } from '@/lib/backend-sdk';
import { isActiveFolkResidency } from '../lib/residencyCategory';

const normalizeRole = (value: unknown) => String(value || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
const normalizeIds = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap(v => Array.isArray(v) ? v : [v]).map(v => String(v || '').trim()).filter(Boolean);
};
const normalizeRefs = (value: unknown): string[] => normalizeIds(value).flatMap(v => v.split(',').map(part => part.trim()).filter(Boolean));
const key = (value: unknown) => String(value || '').trim().toLowerCase();

export default createEndpoint({
  description: 'Get persistent FOLK residency assignments for the authenticated guide',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = normalizeRole(context.user.role);
    const guideCapable = ['GUIDE', 'SUPER_GUIDE', 'ADMIN', 'SUPER_ADMIN'].includes(role) ||
      context.user.isBvAdmin === true || context.user.isBvSuperAdmin === true;
    if (!guideCapable) throw new Error('Guide access required');

    const email = String(context.user.email || '').toLowerCase();
    const user = await Users.findOne({ id: context.user.id, fields: ['id', 'userId', 'email', 'fullName', 'folkResidencies'] }) ||
      await Users.findOne({ filters: { email: context.user.email }, fields: ['id', 'userId', 'email', 'fullName', 'folkResidencies'] });
    const guide = await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id', 'email', 'fullName', 'folkResidencies'] });
    const guideAssignedIds = normalizeIds((guide as any)?.folkResidencies);
    const assignedIds = guideAssignedIds.length > 0 ? guideAssignedIds : normalizeIds((user as any)?.folkResidencies);
    const { records: rawResidencies } = await FolkResidencies.findAll({ limit: 500, fields: ['id', 'residencyId', 'residencyName', 'isActive', 'guides', 'guideIds', 'category', 'segment'] });
    const residencies = rawResidencies.filter(isActiveFolkResidency).map((r: any) => ({ id: r.id, residencyName: r.residencyName || '' }));
    const residencyByRef = new Map<string, string>();
    for (const r of rawResidencies.filter(isActiveFolkResidency) as any[]) {
      for (const ref of [r.id, r.residencyId, r.residencyName]) if (ref) residencyByRef.set(key(ref), String(r.id));
    }
    const canonicalAssignedIds = assignedIds.map(id => residencyByRef.get(key(id)) || '').filter(Boolean);
    const guideRefs = [guide, user].filter(Boolean).flatMap((record: any) => [record.id, record.userId, record.email, record.fullName]);
    const guideRefKeys = new Set(guideRefs.filter(Boolean).map(key));
    const guideName = key((guide as any)?.fullName || (user as any)?.fullName);
    const assignedFromResidencyRecords = (rawResidencies as any[])
      .filter(isFolk)
      .filter(r => {
        const refs = [
          ...normalizeRefs(r.guideIds),
          ...normalizeRefs(r.guides),
        ];
        return refs.some(ref => guideRefKeys.has(key(ref)) || key(ref) === guideName);
      })
      .map(r => String(r.id));
    const allIds = new Set(residencies.map(r => r.id));
    // A person can have both Super Guide and Guide access. This profile card
    // must always represent only the residencies assigned to them as a guide;
    // Super Guide permissions elsewhere in the dashboard must not broaden it
    // to every active FOLK residency.
    // Residency records are the authoritative source for which hostels this
    // person manages as a guide. This matters when the same account also has
    // Super Guide access and its profile contains a department-wide list.
    const effectiveIds = [...new Set(
      assignedFromResidencyRecords.length > 0 ? assignedFromResidencyRecords : canonicalAssignedIds
    )]
      .filter(id => allIds.has(id));

    const requesterIds = [user?.id, user?.userId, context.user.id, context.user.userId, email].filter(Boolean).map(String);
    let pendingRequest: any = null;
    for (const requesterId of requesterIds) {
      pendingRequest = await GuideResidencyAssignmentRequests.findOne({ filters: { requesterId, status: 'Pending' } });
      if (pendingRequest) break;
    }

    const names = new Map(residencies.map(r => [r.id, r.residencyName]));
    const formatRequest = pendingRequest ? {
      id: pendingRequest.id,
      status: pendingRequest.status,
      requestedResidencyIds: normalizeIds(pendingRequest.requestedResidencyIds),
      requestedResidencyNames: normalizeIds(pendingRequest.requestedResidencyIds).map(id => names.get(id) || id),
      requestedAt: pendingRequest.requestedAt || pendingRequest.createdAt || null,
    } : null;

    return {
      assignedResidencies: effectiveIds.map(id => ({ id, residencyName: names.get(id) || id })),
      allResidencies: residencies,
      pendingRequest: formatRequest,
      departmentWide: false,
    };
  },
});
