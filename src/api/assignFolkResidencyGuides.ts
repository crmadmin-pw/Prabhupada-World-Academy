import { z } from 'zod';
import { createEndpoint, FolkResidencies, Guides, Users, AppError } from '@/lib/backend-sdk';
import { resolveGuideReference } from '../lib/guideResolution';
import { isActiveFolkResidency } from '../lib/residencyCategory';

const normalizeRole = (value: unknown) => String(value || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
const normalizeIds = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap(v => Array.isArray(v) ? v : [v]).map(v => String(v || '').trim()).filter(Boolean);
};
const key = (value: unknown) => String(value || '').trim().toLowerCase();

function isFolkGuide(record: any): boolean {
  const role = normalizeRole(record?.role);
  const segment = key(record?.segment);
  const isPw = segment === 'pw' || record?.isPrabhupadaWorldUser === true;
  const hasGuideRole = !role || ['GUIDE', 'SUPER_GUIDE', 'ADMIN', 'SUPER_ADMIN'].includes(role);
  return !isPw && hasGuideRole && record?.status !== 'Inactive' && record?.status !== 'Rejected' && record?.isActive !== false;
}

export default createEndpoint({
  description: 'Assign active FOLK guides to a FOLK residency/hostel',
  authenticated: true,
  requiredCapabilities: 'roles.assign',
  inputSchema: z.object({
    residencyId: z.string().min(1),
    guideIds: z.array(z.string()).max(100),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const callerRole = normalizeRole(context.user.role);
    const canAssign = callerRole === 'SUPER_GUIDE' || callerRole === 'SUPER_ADMIN' ||
      context.user.isBvSuperAdmin === true;
    if (!canAssign) throw new AppError({ code: 'FORBIDDEN', message: 'Only a FOLK Super Guide can assign hostel guides' });

    const residency = await FolkResidencies.findOne({ id: input.residencyId });
    if (!residency || !isActiveFolkResidency(residency)) {
      throw new AppError({ code: 'NOT_FOUND', message: 'FOLK residency not found' });
    }

    const requested = [...new Set(normalizeIds(input.guideIds))];
    const [{ records: guideRecords }, { records: userRecords }] = await Promise.all([
      Guides.findAll({ filters: { isActive: true }, limit: 500 }),
      Users.findAll({ filters: { status: 'Active' }, limit: 2000 }),
    ]);

    const resolved = (await Promise.all(requested.map(id => resolveGuideReference(id)))).filter(Boolean) as any[];
    const validGuides = resolved.filter(g => {
      const guideRecord = guideRecords.find(r => key(r.id) === key(g.id) || key(r.guideId) === key(g.id) || key(r.email) === key(g.email));
      const userRecord = userRecords.find(r => key(r.id) === key(g.id) || key(r.userId) === key(g.id) || key(r.email) === key(g.email));
      return isFolkGuide(guideRecord || userRecord || g);
    });
    if (validGuides.length !== requested.length) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'One or more selected guides are not active FOLK guides' });
    }

    const guideByKey = new Map<string, any>();
    for (const g of [...guideRecords, ...userRecords]) {
      for (const value of [g.id, g.userId, g.guideId, g.email, g.fullName]) {
        if (value) guideByKey.set(key(value), g);
      }
    }
    const canonicalGuideIds = [...new Set(validGuides.map(g => {
      const record = guideByKey.get(key(g.id)) || guideByKey.get(key(g.email));
      return String(record?.id || g.id);
    }))];

    const residencyName = String((residency as any).residencyName || '').trim();
    const allFolkGuideRecords = [...guideRecords, ...userRecords].filter(isFolkGuide);
    const selectedKeys = new Set(canonicalGuideIds.map(key));
    for (const selectedGuide of validGuides) {
      for (const value of [selectedGuide.id, selectedGuide.userId, selectedGuide.guideId, selectedGuide.email, selectedGuide.fullName]) {
        if (value) selectedKeys.add(key(value));
      }
    }
    const selectedNames = validGuides.map(g => String(g.fullName || g.name || '').trim()).filter(Boolean);

    // Keep both the new canonical ID field and the legacy display field. This
    // lets old reports continue to resolve assignments while all new writes
    // remain stable even when a guide changes their display name.
    await FolkResidencies.update({
      id: residency.id,
      record: {
        guideIds: canonicalGuideIds,
        guides: selectedNames.join(', '),
        guideAssignmentsUpdatedAt: new Date().toISOString(),
      },
    });

    // Synchronize each guide's denormalized residency list. Values are stored
    // as residency document IDs; readers also understand legacy names.
    for (const rawGuide of allFolkGuideRecords) {
      const guideRecordId = String(rawGuide.id || '').trim();
      const guideUserId = String(rawGuide.userId || '').trim();
      const guideEmail = key(rawGuide.email);
      const identityMatches = [guideRecordId, guideUserId, guideEmail, rawGuide.guideId].map(key);
      const currentlyAssigned = identityMatches.some(id => selectedKeys.has(id));
      const currentValues = normalizeIds(rawGuide.folkResidencies);
      const currentResolved = currentValues.filter(value => key(value) !== key(residency.id) && key(value) !== key((residency as any).residencyId) && key(value) !== key(residencyName));
      const nextValues = currentlyAssigned ? [...currentResolved, residency.id] : currentResolved;
      const targetId = guideRecordId || String(rawGuide.userId || '');
      if (!targetId) continue;
      const table = guideRecords.includes(rawGuide) ? Guides : Users;
      await table.update({ id: targetId, record: { folkResidencies: [...new Set(nextValues)] } });
    }

    return { success: true, residencyId: residency.id, guideIds: canonicalGuideIds };
  },
});
