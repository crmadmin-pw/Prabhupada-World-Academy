import { z } from 'zod';
import { createEndpoint, AppError, BvGroupMembers, BvGroups, Users } from '@/lib/backend-sdk';
import { serverCacheInvalidate } from '@/lib/serverCache';
import { publishCollectionRevision, publishUsersRevision } from '@/lib/publishUsersRevision';

function referenceValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(referenceValues);
  return value == null ? [] : [String(value).trim().toLowerCase()].filter(Boolean);
}

async function findUser(userId: string) {
  return await Users.findOne({ id: userId }).catch(() => null)
    || await Users.findOne({ filters: { userId } }).catch(() => null)
    || await Users.findOne({ filters: { email: userId } }).catch(() => null);
}

export default createEndpoint({
  description: 'Move a Bhakti Vriksha member to a specific Reading Group and synchronize their reporting hierarchy.',
  authenticated: true,
  requiredCapabilities: 'bv.manage',
  inputSchema: z.object({
    userId: z.string().min(1),
    groupId: z.string().min(1).nullable(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    groupId: z.string(),
    groupName: z.string(),
  }),
  execute: async ({ input }: any) => {
    const user = await findUser(input.userId);
    if (!user) throw new AppError({ code: 'NOT_FOUND', message: 'Member not found' });

    const memberKeys = new Set([
      user.id, user.userId, user.email, user.uid, user.authUid, user.firebaseUid,
      user.firebaseUserId, user.firebaseAuthUid, user.authId, user.authUserId,
      user.firebaseId, user.firebaseAuthId, user.firebase_id,
    ].flatMap(referenceValues));
    // Exact Firestore `in` queries miss mixed-case and array-valued legacy
    // references. Visit every page so no surviving row can restore membership
    // when getUserProfile next derives the user's attendance access.
    const memberships: any[] = [];
    let offset = 0;
    while (true) {
      const page = await BvGroupMembers.findAll({
        fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId', 'role'],
        limit: 500,
        offset,
      });
      memberships.push(...page.records.filter(membership =>
        referenceValues([membership.user, membership.userId, membership.memberId])
          .some(ref => memberKeys.has(ref))));
      if (!page.hasMore) break;
      offset += page.records.length;
    }

    if (input.groupId === null) {
      await Promise.all(memberships.map((membership: any) => BvGroupMembers.delete({ id: membership.id })));
      await Users.update({
        id: user.id,
        record: {
          bvGroupId: null,
          bvGroupName: null,
          isBvMember: false,
          bvRegistrationStatus: 'Approved',
          pendingBvGroupAssignmentNotice: false,
          pendingBvGroupRemovalNotice: true,
          pendingBvApprovalNotice: false,
          roleNoticeAcknowledged: false,
          bvReportingFacilitatorId: '',
          bvReportingFacilitatorName: '',
          supervisorName: '',
        },
      });
      serverCacheInvalidate();
      // The member's browser is already open. Publish the profile revision here
      // so their one-time notice appears without waiting for a page reload.
      await publishUsersRevision(user.id, user);
      return { success: true, groupId: '', groupName: '' };
    }

    const group = await BvGroups.findOne({ id: input.groupId }).catch(() => null)
      || await BvGroups.findOne({ filters: { groupId: input.groupId } }).catch(() => null);
    if (!group) throw new AppError({ code: 'NOT_FOUND', message: 'Reading Group not found' });
    if (group.isActive === false) throw new AppError({ code: 'BAD_REQUEST', message: 'Members can only be assigned to an active Reading Group' });

    const userSegment = String(user.segment || '').trim().toUpperCase();
    const groupSegment = String(group.segment || '').trim().toUpperCase();
    if (userSegment && groupSegment && userSegment !== groupSegment) {
      throw new AppError({ code: 'FORBIDDEN', message: 'A member can only be assigned to a Reading Group in the same department' });
    }

    const rawFacilitatorId = Array.isArray(group.bvslLeader)
      ? group.bvslLeader[0]
      : (group.bvslLeader || group.bvslId || '');
    const facilitator = rawFacilitatorId ? await findUser(String(rawFacilitatorId)) : null;
    const groupKeys = new Set([group.id, group.groupId].flatMap(referenceValues));
    const targetMemberships = memberships.filter((membership: any) =>
      [membership.group, membership.groupId].flatMap(referenceValues).some(value => groupKeys.has(value))
    );

    // Create the new membership before removing any old one. This prevents a
    // failed write from ever leaving the member with no group at all.
    if (targetMemberships.length === 0) {
      await BvGroupMembers.create({
        record: {
          id: `BVMEM-${user.id}-${group.id}`,
          group: group.id,
          groupId: group.groupId || group.id,
          user: user.id,
          userId: user.userId || user.id,
          memberId: user.userId || user.id,
          role: 'Member',
          joinedAt: new Date().toISOString(),
        },
      });
    }

    // A user has exactly one current Reading Group. Retain a single target
    // membership if legacy duplicates exist and remove every old-group row.
    const retainedId = String(targetMemberships[0]?.id || `BVMEM-${user.id}-${group.id}`);
    await Promise.all(memberships
      .filter((membership: any) => String(membership.id) !== retainedId)
      .map((membership: any) => BvGroupMembers.delete({ id: membership.id })));

    const facilitatorId = facilitator?.userId || facilitator?.id || String(rawFacilitatorId || '');
    const facilitatorName = facilitator?.fullName || group.bvslName || '';
    await Users.update({
      id: user.id,
      record: {
        bvGroupId: group.id,
        bvGroupName: group.groupName || '',
        bvRegistrationStatus: 'Approved',
        isBvMember: true,
        bvReportingFacilitatorId: facilitatorId,
        bvReportingFacilitatorName: facilitatorName,
        bvReportingSupervisorId: facilitator?.bvReportingSupervisorId || '',
        bvReportingSupervisorName: facilitator?.bvReportingSupervisorName || '',
        bvReportingAdminId: facilitator?.bvReportingAdminId || '',
        bvReportingAdminName: facilitator?.bvReportingAdminName || '',
        supervisorName: facilitatorName,
        sadhanaMentor: null,
        ...(facilitator?.bvReportingAdminId ? { guide: facilitator.bvReportingAdminId } : {}),
        pendingRoleNotice: null,
        pendingBvGroupAssignmentNotice: true,
        roleNoticeAcknowledged: false,
      },
    });

    // Group cards, detail pages, and dashboard caches all depend on this.
    serverCacheInvalidate();
    await publishCollectionRevision('BvGroupMembers', retainedId);
    await publishUsersRevision(user.id, user);
    return { success: true, groupId: group.id, groupName: group.groupName || 'Reading Group' };
  },
});
