import { z } from 'zod';
import { createEndpoint, Users, Guides, FolkResidencies, GuideTransferRequests, ResidencyTransferRequests, AshrayUpgradeRequests, BvGroupMembers } from '@/lib/backend-sdk';
import { normalizeRole, normalizeStatus } from './resolveUserLogin';
import { getUserDepartment } from '../lib/userDashboardRoutes';

export const profileCacheKey = (userId: string) => `user_profile:${userId}`;

const USER_FIELDS = ['id', 'userId', 'fullName', 'phone', 'email', 'role', 'status',
  'guide', 'residency', 'residencyClaimed', 'residencyApproved', 'createdAt',
  'lastLoginAt', 'ashrayLevel', 'residencyJoinDate', 'isBvsl', 'isSadhanaMentor', 'isServiceAllocator',
  'isBvMentor', 'bvMentorGuideId', 'isCleanlinessManager', 'isFolkLead', 'isTripCoordinator',
  'acknowledgedFolkLead', 'acknowledgedTripCoordinator', 'acknowledgedSadhanaMentor',
  'isBvSuperAdmin', 'isBvAdmin', 'isBvSupervisor', 'isBvFacilitator', 'isBvSubFacilitator',
  'pendingRoleNotice', 'pendingBvGroupAssignmentNotice', 'pendingBvGroupRemovalNotice', 'roleNoticeAcknowledged', 'bvRegistrationStatus', 'bvGroupId', 'bvGroupName', 'bvReportingFacilitatorName', 'isBvMember', 'isPrabhupadaWorldUser', 'pendingBvRejectionNotice', 'segment', 'pendingBvApprovalNotice',
  'pendingAshrayNoticeStatus', 'pendingAshrayNoticeLevel', 'ashrayNoticeAcknowledged', 'isFolkUser'];
const GUIDE_FIELDS = ['id', 'fullName', 'abbr'];
const RESIDENCY_FIELDS = ['id', 'residencyName', 'residencyId'];

export default createEndpoint({
  description: 'Get user profile — always reads fresh from DB and rejects incomplete authentication-sync records',
  authenticated: true,
  inputSchema: z.object({
    email: z.string().optional(),
    phone: z.string().optional(),
    _nocache: z.boolean().optional(),
    bypassCache: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    let userRecord = await Users.findOne({ id: context.user.id, fields: USER_FIELDS });

    // Fallback lookup by email if not found by ID
    if (!userRecord && context.user.email) {
      userRecord = await Users.findOne({ filters: { email: context.user.email } }) ||
                 await Users.findOne({ filters: { email: context.user.email.toLowerCase() } });
    }

    // ── EMAIL FALLBACK ────────────────────────────────────────────────────────
    if ((!userRecord?.userId || !userRecord?.status) && context.user.email) {
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
            segment: realProfile.segment || undefined,
            isPrabhupadaWorldUser: realProfile.isPrabhupadaWorldUser ?? false,
            isBvSuperAdmin: realProfile.isBvSuperAdmin ?? false,
            isBvAdmin: realProfile.isBvAdmin ?? false,
            isBvSupervisor: realProfile.isBvSupervisor ?? false,
            isBvFacilitator: realProfile.isBvFacilitator ?? false,
            isBvSubFacilitator: realProfile.isBvSubFacilitator ?? false,
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

    // Authentication-sync documents are not registrations. A real profile is
    // valid only after the registration flow has assigned both fields.
    if (!userRecord?.userId || !userRecord?.status) return { user: null };

    // A real BvGroupMembers row is the authoritative BV membership record.
    // Profile flags are derived/cache fields and may be stale immediately after
    // approval or on older records; they must never hide Attendance from a
    // member whose Reading Group page is already active.
    const userIdentities = [...new Set([
      context.user.id,
      context.user.userId,
      context.user.email,
      userRecord.id,
      userRecord.userId,
      userRecord.email,
    ].filter(Boolean).map(String))];
    const [byUser, byUserId] = await Promise.all([
      BvGroupMembers.findAll({
        filters: { user: { in: userIdentities } },
        fields: ['id', 'group', 'groupId', 'user', 'userId'],
        limit: 5,
      }).catch(() => ({ records: [] })),
      BvGroupMembers.findAll({
        filters: { userId: { in: userIdentities } },
        fields: ['id', 'group', 'groupId', 'user', 'userId'],
        limit: 5,
      }).catch(() => ({ records: [] })),
    ]);
    let rawMembership = byUser.records[0] || byUserId.records[0];
    if (!rawMembership) {
      const membershipKeys = new Set(userIdentities.map(value => value.toLowerCase()));
      const { records: allMemberships } = await BvGroupMembers.findAll({
        fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'],
        limit: 5000,
      }).catch(() => ({ records: [] }));
      rawMembership = allMemberships.find((membership: any) => [
        membership.user,
        membership.userId,
        membership.memberId,
      ].flatMap(value => Array.isArray(value) ? value : [value])
        .filter(Boolean)
        .some(value => membershipKeys.has(String(value).trim().toLowerCase())));
    }
    const membership = rawMembership;
    const hasBvMembership = !!membership;
    const groupId = membership
      ? (Array.isArray(membership.group) ? membership.group[0] : (membership.group || membership.groupId || ''))
      : '';
    const needsMembershipSync = hasBvMembership
      ? (!userRecord.isBvMember || userRecord.bvRegistrationStatus !== 'Approved' || (groupId && userRecord.bvGroupId !== groupId))
      : (!!userRecord.isBvMember || !!userRecord.bvGroupId || !!userRecord.bvGroupName);
    // A group assigned moments ago can be missing from the indexed membership
    // lookup. Keep that assignment and its one-time notice until the member
    // acknowledges it, instead of clearing the group on this read.
    const preservePendingAssignment = !hasBvMembership && !!userRecord.pendingBvGroupAssignmentNotice;

    if (!preservePendingAssignment && needsMembershipSync) {
      const membershipFields = hasBvMembership
        ? {
            isBvMember: true,
            bvRegistrationStatus: 'Approved',
            ...(groupId ? { bvGroupId: groupId } : {}),
          }
        : {
            isBvMember: false,
            bvGroupId: '',
            bvGroupName: '',
            ...(userRecord.pendingBvApprovalNotice ? { pendingBvApprovalNotice: false } : {}),
          };
      await Users.update({ id: userRecord.id, record: membershipFields });
      userRecord = { ...userRecord, ...membershipFields };
    }

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
        // Fallback: Resolve guide name from Users collection if not found in Guides
        const userGuideRecord = await Users.findOne({ id: rawGuideId }).catch(() => null) ||
                           await Users.findOne({ filters: { userId: rawGuideId } }).catch(() => null) ||
                           await Users.findOne({ filters: { email: rawGuideId } }).catch(() => null) ||
                           await Users.findOne({ filters: { email: rawGuideId.toLowerCase() } }).catch(() => null);
        if (userGuideRecord) {
          guideRecord = {
            id: userGuideRecord.id,
            fullName: userGuideRecord.fullName || userGuideRecord.email,
            email: userGuideRecord.email,
          };
        }
      }
    }

    const [residencyRecord] = await Promise.all([
      residencyId
        ? FolkResidencies.findOne({ id: residencyId, fields: RESIDENCY_FIELDS })
        : Promise.resolve(undefined),
    ]);

    const rawRole = userRecord.role || 'User';
    const normalizedRole = normalizeRole(rawRole);

    const validRoles = ['USER', 'ADMIN', 'GUIDE', 'SUPER_GUIDE', 'SUPER_ADMIN', 'BVSL', 'SADHANA_MENTOR'];
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
      hasBvMembership, preservePendingAssignment,
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
    return result;
  },
});

function buildProfileResult({
  userRecord, guideId, residencyId, guideRecord, residencyRecord,
  primaryRole, isBvsl, isSadhanaMentor, isServiceAllocator, isBvMentor,
  lastLoginAt, userEmail, hasBvMembership, preservePendingAssignment, normalizeStatus, hasPendingGuideTransfer, hasPendingResidencyTransfer,
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
      isBvMentor: !!userRecord.isBvMentor,
      isBvSuperAdmin: !!(userRecord.isBvSuperAdmin || primaryRole === 'SUPER_ADMIN'),
      isBvAdmin: !!(userRecord.isBvAdmin || userRecord.isBvSuperAdmin || primaryRole === 'ADMIN' || primaryRole === 'SUPER_ADMIN'),
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
      pendingBvGroupAssignmentNotice: !!(userRecord.pendingBvGroupAssignmentNotice),
      pendingBvGroupRemovalNotice: !!(userRecord.pendingBvGroupRemovalNotice),
      roleNoticeAcknowledged: !!(userRecord.roleNoticeAcknowledged),
      bvRegistrationStatus: userRecord.bvRegistrationStatus || null,
      bvGroupId: userRecord.bvGroupId || null,
      bvGroupName: userRecord.bvGroupName || null,
      bvReportingFacilitatorName: userRecord.bvReportingFacilitatorName || null,
      // Attendance is available only to active BV members. Keep this field in
      // the fresh profile response rather than relying on client-side state.
      // A just-assigned group can be missing from the membership lookup for a
      // moment; the pending notice means that assignment is already real.
      isBvMember: hasBvMembership || preservePendingAssignment,
      isPrabhupadaWorldUser: !!(userRecord.isPrabhupadaWorldUser),
      pendingBvRejectionNotice: !!(userRecord.pendingBvRejectionNotice),
      pendingBvApprovalNotice: !!(userRecord.pendingBvApprovalNotice),
      pendingAshrayNoticeStatus: userRecord.pendingAshrayNoticeStatus || null,
      pendingAshrayNoticeLevel: userRecord.pendingAshrayNoticeLevel || null,
      ashrayNoticeAcknowledged: !!(userRecord.ashrayNoticeAcknowledged),
      segment: getUserDepartment(userRecord),
    },
  };
}
