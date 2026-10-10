import { z } from 'zod';
import { createEndpoint, Guides, Users, SadhanaEntries, FolkResidencies, AppError } from '@/lib/backend-sdk';
import { getTodayIST } from '../lib/streakUtils';
import { isActiveFolkResidency } from '../lib/residencyCategory';

const GUIDE_FIELDS = ['id', 'email', 'isActive', 'fullName', 'phone', 'abbreviation', 'folkResidencies', 'activeResidencyView'];
const CURRENT_USER_GUIDE_FIELDS = ['id', 'userId', 'email', 'fullName', 'phone', 'folkResidencies', 'activeResidencyView'];
const USER_FIELDS = ['id', 'status', 'residencyApproved', 'guide'];
const ENTRY_FIELDS = ['id', 'user', 'entryDate'];
const RESIDENCY_FIELDS = ['id', 'residencyName', 'isActive', 'category', 'segment'];

export default createEndpoint({
  description: 'Get guide info + metrics for the guide dashboard — counts all center users, not just direct folk',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    const userEmail = (context.user?.email || '').toLowerCase();
    const normalizedRole = String(context.user?.role || '')
      .trim()
      .replace(/[\s-]+/g, '_')
      .toUpperCase();
    const isSuperGuideContext =
      normalizedRole === 'SUPER_GUIDE' ||
      normalizedRole === 'SUPER_ADMIN' ||
      context.user?.isBvSuperAdmin === true;

    let guideRecord = await Guides.findOne({
      filters: { email: context.user?.email },
      fields: GUIDE_FIELDS,
    }) as any;

    if (!guideRecord) {
      const { records: allGuides } = await Guides.findAll({ limit: 200 });
      guideRecord = allGuides.find((g: any) => (g.email || '').toLowerCase() === userEmail);
    }

    // Some valid FOLK guides are represented only in Users (there is no
    // duplicate Guides document). Resolve their real database identity rather
    // than manufacturing a hard-coded guide ID, otherwise guide-scoped APIs
    // receive an ID that cannot match their assigned RGFs.
    if (!guideRecord) {
      const hasGuideAccess =
        normalizedRole === 'GUIDE' ||
        normalizedRole === 'SUPER_GUIDE' ||
        normalizedRole === 'ADMIN' ||
        normalizedRole === 'SUPER_ADMIN' ||
        context.user?.isBvAdmin === true ||
        context.user?.isBvSuperAdmin === true;

      if (hasGuideAccess) {
        const currentGuideUser =
          await Users.findOne({ id: context.user?.id, fields: CURRENT_USER_GUIDE_FIELDS }) ||
          await Users.findOne({ filters: { userId: context.user?.userId }, fields: CURRENT_USER_GUIDE_FIELDS }) ||
          await Users.findOne({ filters: { email: context.user?.email }, fields: CURRENT_USER_GUIDE_FIELDS });

        if (currentGuideUser) {
          guideRecord = {
            ...currentGuideUser,
            // Hierarchy fields use the app userId when present.
            id: (currentGuideUser as any).userId || currentGuideUser.id,
            isActive: true,
          };
        }
      }
    }

    if (guideRecord && (!guideRecord.folkResidencies || (Array.isArray(guideRecord.folkResidencies) && guideRecord.folkResidencies.length === 0))) {
      const linkedUser = await Users.findOne({ filters: { email: context.user?.email }, fields: CURRENT_USER_GUIDE_FIELDS });
      if (linkedUser?.folkResidencies) guideRecord = { ...guideRecord, folkResidencies: linkedUser.folkResidencies };
    }

    if (!guideRecord) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Guide access required' });
    }

    const todayStr = getTodayIST();
    const { records: allResidencies } = await FolkResidencies.findAll({ fields: RESIDENCY_FIELDS, limit: 500 });
    const residencyRefs: unknown[] = Array.isArray(guideRecord.folkResidencies)
      ? guideRecord.folkResidencies
      : guideRecord.folkResidencies ? [guideRecord.folkResidencies] : [];
    const residencyLookup = new Map<string, string>();
    for (const residency of allResidencies as any[]) {
      for (const ref of [residency.id, residency.residencyName]) {
        if (ref) residencyLookup.set(String(ref).trim().toLowerCase(), String(residency.id));
      }
    }
    const residencyIds: string[] = [...new Set(residencyRefs.flatMap((value: any) => String(value || '').split(',').map(v => residencyLookup.get(v.trim().toLowerCase()) || '').filter(Boolean)))];
    const savedActiveResidencyId = Array.isArray((guideRecord as any).activeResidencyView)
      ? (guideRecord as any).activeResidencyView[0]
      : (guideRecord as any).activeResidencyView || null;

    // Fetch guide-assigned users + center residency users + today's entries — all in parallel
    const [directUsersRes, todayEntriesRes, ...residencyUsersArr] = await Promise.all([
      Users.findAll({ filters: { guide: guideRecord.id }, fields: USER_FIELDS, limit: 2000 }),
      SadhanaEntries.findAll({ filters: { entryDate: todayStr }, fields: ENTRY_FIELDS, limit: 2000 }),
      ...residencyIds.map((rid: string) =>
        Users.findAll({ filters: { residency: rid }, fields: USER_FIELDS, limit: 500 })
      ),
    ]);

    // Deduplicate users across guide-assigned and center residency-based
    const userMap = new Map<string, any>();
    for (const u of directUsersRes.records) userMap.set(u.id, u);
    for (const res of residencyUsersArr) {
      for (const u of res.records) userMap.set(u.id, u);
    }
    const allUsers = Array.from(userMap.values());

    const activeUsers = allUsers.filter(u => u.status === 'Active');
    const pendingUsers = allUsers.filter(u => u.status === 'Pending Approval');
    const residents = activeUsers.filter(u => u.residencyApproved);

    const submittedUserIds = new Set(
      todayEntriesRes.records.map(e => Array.isArray(e.user) ? e.user[0] : e.user).filter((id): id is string => !!id)
    );
    const activeUserIds = new Set(activeUsers.map(u => u.id).filter((id): id is string => !!id));
    const todaySubmitted = [...submittedUserIds].filter(id => activeUserIds.has(id)).length;

    // Fetch residency display names
    const activeFolkResidencies = allResidencies.filter(isActiveFolkResidency);
    const residencyMap = new Map(activeFolkResidencies.map((r: any) => [r.id, r.residencyName || '']));
    // A super guide has department-wide access and therefore usually has no
    // restrictive folkResidencies array. Offer every active FOLK residency in
    // the profile selector. Regular guides remain limited to linked records.
    const filteredResidencies = isSuperGuideContext
      ? activeFolkResidencies.map((r: any) => ({ id: r.id, residencyName: r.residencyName || '' }))
      : residencyIds
          .filter((id: string) => residencyMap.has(id))
          .map((id: string) => ({ id, residencyName: residencyMap.get(id) || '' }));
    const selectableResidencyIds = filteredResidencies.map((r: any) => r.id);

    return {
      guide: {
        guideId: guideRecord.id,
        fullName: guideRecord.fullName || '',
        email: guideRecord.email || '',
        phone: guideRecord.phone || '',
        abbreviation: guideRecord.abbreviation || '',
      },
      metrics: {
        totalActive: activeUsers.length,
        totalPending: pendingUsers.length,
        totalResidents: residents.length,
        todaySubmitted,
        submissionRate: activeUsers.length > 0
          ? Math.round((todaySubmitted / activeUsers.length) * 100)
          : 0,
      },
      activeResidencyViewId: savedActiveResidencyId && selectableResidencyIds.includes(savedActiveResidencyId)
        ? savedActiveResidencyId
        : null,
      isDepartmentWideResidencyView: isSuperGuideContext,
      residencies: filteredResidencies,
    };
  },
});
