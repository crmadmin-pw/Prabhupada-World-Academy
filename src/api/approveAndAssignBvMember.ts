import { z } from 'zod';
import { createEndpoint, BvMemberRegistrations, BvGroupMembers, Users, BvGroups, AppError } from '@/lib/backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';
import { publishCollectionRevision, publishUsersRevision } from '../lib/publishUsersRevision';
// Synthetic IDs are generated for registrations that exist only in the Users table
// (users whose bvRegistrationStatus is Pending Approval but never wrote a BvMemberRegistrations doc).
const isSyntheticId = (id: string) => id.startsWith('BVREG-');
import { profileCacheKey } from './getUserProfile';

function firstValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function phoneDigits(value: unknown): string {
  return firstValue(value).replace(/\D/g, '');
}

/** Resolve every legacy identity shape before approving the registration.
 * `userDbId` is not always the canonical document ID in older registrations,
 * so checking only that one value can leave Users.bvRegistrationStatus pending.
 */
async function resolveRegistrationUser(registration: any, registrationId: string) {
  const registrationIdSuffix = registrationId.replace(/^BVREG-/, '');
  const identityKeys = [...new Set([
    registration?.userDbId,
    registration?.userId,
    registration?.user,
    registration?.uid,
    registration?.authUid,
    registrationIdSuffix,
  ].flatMap(value => Array.isArray(value) ? value : [value])
    .map(firstValue)
    .filter(Boolean))];

  for (const key of identityKeys) {
    const user = await Users.findOne({ id: key }).catch(() => null) ||
      await Users.findOne({ filters: { userId: key } }).catch(() => null);
    if (user) return user;
  }

  const email = firstValue(registration?.email).toLowerCase();
  if (email) {
    const user = await Users.findOne({ filters: { email } }).catch(() => null) ||
      await Users.findOne({ filters: { email: firstValue(registration?.email) } }).catch(() => null);
    if (user) return user;
  }

  const phoneCandidates = [...new Set([
    registration?.phoneE164,
    registration?.phone,
    `${firstValue(registration?.phoneCountryCode)}${firstValue(registration?.phone)}`,
  ].map(phoneDigits).filter(Boolean))];

  // Final legacy fallback: compare normalized aliases locally. This is used
  // only when indexed ID/email lookups fail during this admin mutation.
  const { records: users } = await Users.findAll({
    fields: ['id', 'userId', 'uid', 'authUid', 'email', 'phone', 'fullName'],
    limit: 5000,
  }).catch(() => ({ records: [] }));
  const normalizedKeys = new Set(identityKeys.map(key => key.toLowerCase()));
  return users.find((user: any) => {
    const aliases = [user.id, user.userId, user.uid, user.authUid]
      .map(firstValue)
      .filter(Boolean)
      .map(alias => alias.toLowerCase());
    const matchesAlias = aliases.some(alias => normalizedKeys.has(alias));
    const matchesEmail = !!email && firstValue(user.email).toLowerCase() === email;
    const userPhone = phoneDigits(user.phone);
    const matchesPhone = !!userPhone && phoneCandidates.some(phone =>
      phone === userPhone || phone.endsWith(userPhone) || userPhone.endsWith(phone)
    );
    return matchesAlias || matchesEmail || matchesPhone;
  }) || null;
}

export default createEndpoint({
  description: 'Approve a Bhakti Vriksha registration, optionally assigning a Reading Group — Admin or Supervisor access',
  authenticated: true,
  requiredCapabilities: 'bv.manage',
  inputSchema: z.object({
    registrationId: z.string(),
    // Used by the shared realtime publisher to notify only the affected
    // department's open dashboards.
    segment: z.enum(['PW', 'FOLK']).optional(),
    // Group assignment is intentionally optional.  Approval and BV membership
    // are separate steps so the first RGF/group can be created after users are
    // approved (breaking the guide -> RGF -> group -> approval deadlock).
    groupId: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    
    // Fetch full caller record to access hierarchy flags
    const callerRecord = await Users.findOne({ id: context.user.id });
    if (!callerRecord) {
      throw new AppError({ code: 'FORBIDDEN', message: 'User profile not found' });
    }

    const callerRole = (callerRecord.role || '').toUpperCase();
    const isAuthorized =
      callerRole === 'SUPER_ADMIN' ||
      callerRole === 'ADMIN' ||
      callerRole === 'SUPER_GUIDE' ||
      callerRole === 'GUIDE' ||
      context.user.isBvSuperAdmin ||
      !!callerRecord.isBvSuperAdmin ||
      !!callerRecord.isBvAdmin ||
      !!callerRecord.isBvSupervisor;

    if (!isAuthorized) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Admin or Supervisor access required' });
    }

    // Real registration documents are also named BVREG-<userId>. Treat the id
    // as synthetic only when no BvMemberRegistrations document exists.
    let reg: any = await BvMemberRegistrations.findOne({ id: input.registrationId }).catch(() => null);
    const synthetic = !reg;
    if (synthetic) {
      if (!isSyntheticId(input.registrationId)) {
        throw new AppError({ code: 'NOT_FOUND', message: 'Registration request not found' });
      }
      const userDbId = input.registrationId.replace(/^BVREG-/, '');
      const userRec = await Users.findOne({ id: userDbId }).catch(() => null);
      if (!userRec) throw new AppError({ code: 'NOT_FOUND', message: 'User record not found for synthetic registration' });
      reg = { id: null, userId: userRec.id, userDbId: userRec.id, email: userRec.email || '' };
    }

    const group = input.groupId
      ? await BvGroups.findOne({ id: input.groupId })
      : null;
    if (input.groupId && !group) throw new AppError({ code: 'NOT_FOUND', message: 'Selected Reading Group not found' });
    if (group?.isActive === false) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'This Reading Group is inactive. Activate it before assigning a member.',
      });
    }

    const now = new Date().toISOString();

    // Resolve the applicant once. reg.userId may be either a userId or a user
    // DB id. This is also used for approval-only (unassigned) registrations.
    const targetUser = await resolveRegistrationUser(reg, input.registrationId);
    if (!targetUser) {
      // Never report a successful approval if the profile that powers the
      // fallback pending queue could not be updated.
      throw new AppError({
        code: 'NOT_FOUND',
        message: 'The user profile for this registration could not be resolved. Please refresh and try again.',
      });
    }

    {
      const relatedRegistrationIds = [
        input.registrationId,
        `BVREG-${targetUser.id}`,
        targetUser.userId ? `BVREG-${targetUser.userId}` : '',
      ].filter(Boolean);

      for (const registrationId of [...new Set(relatedRegistrationIds)]) {
        const relatedReg = await BvMemberRegistrations.findOne({ id: registrationId }).catch(() => null);
        if (!relatedReg) continue;
        await BvMemberRegistrations.update({
          id: relatedReg.id,
          record: {
            status: 'Approved',
            ...(group ? {
              assignedGroupId: group.id,
              assignedGroupName: group.groupName || '',
            } : {
              assignedGroupId: null,
              assignedGroupName: '',
            }),
            approvedBy: context.user.id,
            approvedAt: now,
          },
        });
      }
    }

    if (group) {
      const targetUserDbId = targetUser.id;
      const targetUserLegacyId = targetUser.userId || targetUser.id;

      // 2. Add member to group
      const memberRecordId = `BVMEM-${targetUserDbId}-${group.id}`;
      const existingMember = await BvGroupMembers.findOne({ id: memberRecordId }).catch(() => null);
      if (!existingMember) {
        await BvGroupMembers.create({
          record: {
            id: memberRecordId,
            group: group.id,
            user: targetUserDbId,
            groupId: group.id,
            userId: targetUserLegacyId,
            role: 'Member',
            joinedAt: now,
          },
        });
      }

      // 3. Update main User record & establish reporting parent (RGF)
      // Find Reading Group Facilitator (RGF) for the group
      const rawRgfId = Array.isArray(group.bvslLeader) ? group.bvslLeader[0] : (group.bvslLeader || group.bvslId || group.guide);
      let rgfUser: any = null;
      if (rawRgfId) {
        rgfUser = await Users.findOne({ id: rawRgfId }).catch(() => null)
               || await Users.findOne({ filters: { userId: rawRgfId } }).catch(() => null)
               || await Users.findOne({ filters: { email: rawRgfId } }).catch(() => null);
      }

      const formatEmailToName = (nameStr: string, fallback: string) => {
        const val = nameStr || fallback || '';
        if (val.includes('@')) {
          const parts = val.split('@')[0].split(/[._-]/);
          return parts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') + ' Prabhu';
        }
        return val;
      };

      const rgfUserId = rgfUser ? (rgfUser.userId || rgfUser.id) : String(rawRgfId || '');
      const rgfName = formatEmailToName(rgfUser ? (rgfUser.fullName || rgfUser.name || '') : '', String(group.bvslName || ''));

      const rgfSupId = rgfUser ? String(rgfUser.bvReportingSupervisorId || '') : '';
      const rgfSupName = formatEmailToName(rgfUser ? String(rgfUser.bvReportingSupervisorName || '') : '', '');
      const rgfAdminId = (rgfUser && rgfUser.bvReportingAdminId) ? String(rgfUser.bvReportingAdminId) : String(callerRecord.userId || callerRecord.id || '');
      const rgfAdminName = formatEmailToName((rgfUser && rgfUser.bvReportingAdminName) ? String(rgfUser.bvReportingAdminName) : String(callerRecord.fullName || callerRecord.name || ''), '');

      await Users.update({
        id: targetUser.id,
        record: {
          bvRegistrationStatus: 'Approved',
          isBvMember: true,                  // ← enables Attendance tab & removes from pending list
          bvGroupId: group.id,
          bvGroupName: group.groupName || '',
          // Default parent is RGF (Reading Group Facilitator)
          bvReportingFacilitatorId: rgfUserId,
          bvReportingFacilitatorName: rgfName,
          bvReportingSupervisorId: rgfSupId,
          bvReportingSupervisorName: rgfSupName,
          bvReportingAdminId: rgfAdminId,
          bvReportingAdminName: rgfAdminName,
          supervisorName: rgfName, // Legacy fallback
          guide: rgfAdminId || callerRecord.id, // Ensures Admin's member list includes this user
          pendingBvApprovalNotice: true,      // ← triggers popup on user's next login
          sadhanaMentor: null,                // Clear sadhana mentor upon BV approval
        },
      });
      serverCacheInvalidate(profileCacheKey(targetUser.id));
      // Open group cards watch this membership. Publish the committed row so
      // their member count refetches without a page reload.
      await publishCollectionRevision('BvGroupMembers', memberRecordId);
      await publishUsersRevision(targetUser.id);
    } else {
      // Approval without a group is still a completed approval. Attendance
      // remains unavailable until a real BvGroupMembers record is created.
      await Users.update({
        id: targetUser.id,
        record: {
          bvRegistrationStatus: 'Approved',
          isBvMember: false,
          bvGroupId: '',
          bvGroupName: '',
          // Do not show the “joined group” notice until a group is assigned.
          pendingBvApprovalNotice: false,
        },
      });
      serverCacheInvalidate(profileCacheKey(targetUser.id));
    }

    for (const identity of [targetUser.id, targetUser.userId, reg.userId, reg.userDbId]) {
      if (identity) serverCacheInvalidate(profileCacheKey(String(identity)));
    }

    return { success: true };
  },
});
