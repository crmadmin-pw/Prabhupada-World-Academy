import { z } from 'zod';
import { createEndpoint, Users, Guides, FolkResidencies, GuideTransferRequests, ResidencyTransferRequests, AshrayUpgradeRequests } from 'zite-integrations-backend-sdk';
import { normalizeRole, normalizeStatus } from './resolveUserLogin';
import { serverCacheGet, serverCacheSet } from '../lib/serverCache';

const PROFILE_TTL = 10 * 60 * 1000; // 10 minutes per user
export const profileCacheKey = (userId: string) => `user_profile:${userId}`;

const USER_FIELDS = ['id', 'userId', 'fullName', 'phone', 'email', 'role', 'status',
  'guide', 'residency', 'residencyClaimed', 'residencyApproved', 'createdAt',
  'lastLoginAt', 'ashrayLevel', 'residencyJoinDate', 'isBvsl', 'isSadhanaMentor', 'isServiceAllocator',
  'isBvMentor', 'bvMentorGuideId', 'isCleanlinessManager', 'isFolkLead', 'isTripCoordinator',
  'acknowledgedFolkLead', 'acknowledgedTripCoordinator', 'acknowledgedSadhanaMentor',
  'isBvSuperAdmin', 'isBvAdmin', 'isBvSupervisor', 'isBvFacilitator', 'isBvSubFacilitator',
  'pendingRoleNotice', 'roleNoticeAcknowledged', 'bvRegistrationStatus', 'bvGroupId', 'bvGroupName', 'isPrabhupadaWorldUser', 'pendingBvRejectionNotice'];
const GUIDE_FIELDS = ['id', 'fullName', 'abbr'];
const RESIDENCY_FIELDS = ['id', 'residencyName', 'residencyId'];

export default createEndpoint({
  description: 'Get user profile — always reads fresh from DB, with email fallback for case-mismatch bare records',
  authenticated: true,
  inputSchema: z.object({
    email: z.string().optional(),
    phone: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const cacheKey = profileCacheKey(context.user.id);
    const cached = serverCacheGet<ReturnType<typeof buildProfileResult>>(cacheKey);
    if (cached) return cached;

    let userRecord = await Users.findOne({ id: context.user.id, fields: USER_FIELDS });

    // ── EMAIL FALLBACK ────────────────────────────────────────────────────────
    if (!userRecord?.userId && context.user.email) {
      const emailLower = context.user.email.toLowerCase();
      const { records: allRecords } = await Users.findAll({
        fields: USER_FIELDS,
        limit: 200,
      });
      const realProfile = allRecords.find(r =>
        r.id !== context.user.id &&
        r.userId &&
        r.status &&
        (r.email || '').toLowerCase() === emailLower,
      );
      if (realProfile) {
        await Users.update({
          id: context.user.id,
          record: {
            userId: realProfile.userId,
            fullName: realProfile.fullName || '',
            phone: realProfile.phone || '',
            email: realProfile.email || context.user.email,
            guide: Array.isArray(realProfile.guide) ? realProfile.guide[0] : (realProfile.guide || undefined),
            residency: Array.isArray(realProfile.residency) ? realProfile.residency[0] : (realProfile.residency || undefined),
            role: realProfile.role || 'User',
            status: realProfile.status,
            residencyClaimed: realProfile.residencyClaimed ?? false,
            residencyApproved: realProfile.residencyApproved ?? false,
            residencyJoinDate: realProfile.residencyJoinDate || undefined,
            ashrayLevel: realProfile.ashrayLevel || undefined,
            isBvsl: realProfile.isBvsl ?? false,
            isSadhanaMentor: realProfile.isSadhanaMentor ?? false,
            createdAt: realProfile.createdAt || new Date().toISOString(),
          },
        }).catch(() => {});
        userRecord = { ...realProfile, id: context.user.id };
      }
    }

    if (!userRecord?.userId) return { user: null };

    const rawGuideId = Array.isArray(userRecord.guide) ? userRecord.guide[0] : userRecord.guide;
    const residencyId = Array.isArray(userRecord.residency) ? userRecord.residency[0] : userRecord.residency;

    let guideRecord: any = undefined;
    let guideId: string | null = null;

    if (rawGuideId) {
      // Try by document ID first
      guideRecord = await Guides.findOne({ id: rawGuideId, fields: GUIDE_FIELDS }).catch(() => undefined);
      if (!guideRecord) {
        // Fallback: try search by fullName
        guideRecord = await Guides.findOne({
          filters: { fullName: rawGuideId },
          fields: GUIDE_FIELDS,
        }).catch(() => undefined);
        if (!guideRecord) {
          // Fallback: try search by email
          guideRecord = await Guides.findOne({
            filters: { email: rawGuideId },
            fields: GUIDE_FIELDS,
          }).catch(() => undefined);
        }
      }
      if (guideRecord) {
        guideId = guideRecord.id;
      } else {
        guideId = rawGuideId;
      }
    }

    const [residencyRecord] = await Promise.all([
      residencyId
        ? FolkResidencies.findOne({ id: residencyId, fields: RESIDENCY_FIELDS })
        : Promise.resolve(undefined),
    ]);

    const rawRole = userRecord.role || 'User';
    const normalizedRole = normalizeRole(rawRole);

    const validRoles = ['USER', 'GUIDE', 'SUPER_GUIDE', 'BVSL', 'SADHANA_MENTOR'];
    const primaryRole = validRoles.includes(normalizedRole) ? normalizedRole : 'USER';

    const isBvsl = !!(userRecord.isBvsl || primaryRole === 'BVSL');
    const isSadhanaMentor = !!(userRecord.isSadhanaMentor || primaryRole === 'SADHANA_MENTOR');
    const isServiceAllocator = !!(userRecord.isServiceAllocator);
    const isBvMentor = !!(userRecord.isBvMentor);

    let lastLoginAt = userRecord.lastLoginAt || null;
    if (!lastLoginAt) {
      const now = new Date().toISOString();
      Users.update({ id: context.user.id, record: { lastLoginAt: now } }).catch(() => {});
      lastLoginAt = now;
    }

    const [pendingGuideTransfer, pendingResidencyTransfer, guideRequestsRes, residencyRequestsRes, ashrayRequestsRes] = await Promise.all([
      GuideTransferRequests.findOne({ filters: { user: context.user.id, status: 'Pending' } }),
      ResidencyTransferRequests.findOne({ filters: { user: context.user.id, status: 'Pending' } }),
      GuideTransferRequests.findAll({ filters: { user: context.user.id } }),
      ResidencyTransferRequests.findAll({ filters: { user: context.user.id } }),
      AshrayUpgradeRequests.findAll({ filters: { userId: { in: [context.user.id, userRecord.userId].filter(Boolean) } } }),
    ]);

    const sortedGuideRequests = (guideRequestsRes?.records || []).sort((a: any, b: any) => 
      new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime()
    );
    const sortedResidencyRequests = (residencyRequestsRes?.records || []).sort((a: any, b: any) => 
      new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime()
    );
    const sortedAshrayRequests = (ashrayRequestsRes?.records || []).sort((a: any, b: any) => 
      new Date(b.createdAt || b.requestedAt || 0).getTime() - new Date(a.createdAt || a.requestedAt || 0).getTime()
    );

    const latestGuideRequest = sortedGuideRequests[0] || null;
    const latestResidencyRequest = sortedResidencyRequests[0] || null;
    const latestAshrayRequest = sortedAshrayRequests[0] || null;

    const result = buildProfileResult({
      userRecord, guideId, residencyId, guideRecord, residencyRecord,
      primaryRole, isBvsl, isSadhanaMentor, isServiceAllocator, isBvMentor, lastLoginAt, userEmail: context.user.email,
      normalizeStatus,
      hasPendingGuideTransfer: !!pendingGuideTransfer,
      hasPendingResidencyTransfer: !!pendingResidencyTransfer,
      isPendingResidencyLeave: !!(pendingResidencyTransfer && !pendingResidencyTransfer.toResidency),
      latestGuideTransferStatus: latestGuideRequest?.status || null,
      latestResidencyTransferStatus: latestResidencyRequest?.status || null,
      latestGuideTransferId: latestGuideRequest?.id || null,
      latestResidencyTransferId: latestResidencyRequest?.id || null,
      latestAshrayStatus: latestAshrayRequest?.status || null,
      latestAshrayId: latestAshrayRequest?.id || null,
      latestAshrayRequestedLevel: latestAshrayRequest?.requestedLevel || null,
    });
    serverCacheSet(cacheKey, result, PROFILE_TTL);
    return result;
  },
});

function buildProfileResult({
  userRecord, guideId, residencyId, guideRecord, residencyRecord,
  primaryRole, isBvsl, isSadhanaMentor, isServiceAllocator, isBvMentor,
  lastLoginAt, userEmail, normalizeStatus, hasPendingGuideTransfer, hasPendingResidencyTransfer,
  isPendingResidencyLeave,
  latestGuideTransferStatus, latestResidencyTransferStatus, latestGuideTransferId, latestResidencyTransferId,
  latestAshrayStatus, latestAshrayId, latestAshrayRequestedLevel
}: any) {
  return {
    user: {
      userId: userRecord.userId,
      fullName: userRecord.fullName || '',
      phone: userRecord.phone || '',
      email: userRecord.email || userEmail,
      selectedGuideId: guideId || null,
      selectedFolkResidency: residencyId || null,
      folkResidencyCustomId: residencyRecord?.residencyId || null,
      residencyName: residencyRecord?.residencyName || null,
      guideName: guideRecord?.fullName || null,
      role: primaryRole,
      status: normalizeStatus(userRecord.status || 'Pending Approval'),
      residencyUserClaim: userRecord.residencyClaimed || false,
      residencyGuideVerified: userRecord.residencyApproved || false,
      createdAt: userRecord.createdAt || new Date().toISOString(),
      lastLoginAt,
      ashrayLevel: userRecord.ashrayLevel || null,
      isBvsl,
      isSadhanaMentor,
      isServiceAllocator,
      isBvMentor,
      isBvSuperAdmin: !!(userRecord.isBvSuperAdmin || (userEmail || '').toLowerCase() === 'srilaprabhupadaworld@gmail.com' || primaryRole === 'SUPER_GUIDE' || (userEmail || '').toLowerCase().includes('superadmin')),
      isBvAdmin: !!(userRecord.isBvAdmin || userRecord.isBvSuperAdmin || (userEmail || '').toLowerCase() === 'srilaprabhupadaworld@gmail.com' || primaryRole === 'SUPER_GUIDE'),
      isBvSupervisor: !!(userRecord.isBvSupervisor || userRecord.isBvMentor),
      isBvFacilitator: !!(userRecord.isBvFacilitator || userRecord.isBvsl),
      isBvSubFacilitator: !!(userRecord.isBvSubFacilitator),
      isCleanlinessManager: !!(userRecord.isCleanlinessManager),
      isFolkLead: !!(userRecord.isFolkLead),
      isTripCoordinator: !!(userRecord.isTripCoordinator),
      isResident: !!(userRecord.residencyApproved && residencyId),
      residencyJoinDate: userRecord.residencyJoinDate || null,
      hasPendingGuideTransfer: hasPendingGuideTransfer || false,
      hasPendingResidencyTransfer: hasPendingResidencyTransfer || false,
      isPendingResidencyLeave: isPendingResidencyLeave || false,
      latestGuideTransferStatus,
      latestResidencyTransferStatus,
      latestGuideTransferId,
      latestResidencyTransferId,
      latestAshrayStatus,
      latestAshrayId,
      latestAshrayRequestedLevel,
      acknowledgedFolkLead: !!(userRecord.acknowledgedFolkLead),
      acknowledgedTripCoordinator: !!(userRecord.acknowledgedTripCoordinator),
      acknowledgedSadhanaMentor: !!(userRecord.acknowledgedSadhanaMentor),
      pendingRoleNotice: userRecord.pendingRoleNotice || null,
      roleNoticeAcknowledged: !!(userRecord.roleNoticeAcknowledged),
      bvRegistrationStatus: userRecord.bvRegistrationStatus || null,
      bvGroupId: userRecord.bvGroupId || null,
      bvGroupName: userRecord.bvGroupName || null,
      isPrabhupadaWorldUser: !!(userRecord.isPrabhupadaWorldUser),
      pendingBvRejectionNotice: !!(userRecord.pendingBvRejectionNotice),
    },
  };
}
