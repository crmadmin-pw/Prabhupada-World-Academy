import { z } from 'zod';
import { createEndpoint, Users, OneToOneMeetings, BvGroups, BvGroupMembers } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds } from '../lib/hierarchyUtils';
import { resolveBvGroupFacilitatorUsers, resolveBvGroupMemberUsers } from '../lib/bvGroupMemberScope';

function getWeeks(weeksBack: number): string[] {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  const weeks: string[] = [];
  for (let i = weeksBack - 1; i >= 0; i--) {
    const d = new Date(monday);
    d.setDate(monday.getDate() - i * 7);
    weeks.push(d.toISOString().split('T')[0]);
  }
  return weeks;
}

function normalizedRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(normalizedRefs);
  return value == null ? [] : [String(value).trim().toLowerCase()].filter(Boolean);
}

export default createEndpoint({
  description: 'Get 1:1 meeting data for RGSF, RGF, Supervisor, Admin, Super Admin scoped strictly to users under them with hierarchy names.',
  authenticated: true,
  // RGSF call history is read-only; RGSFs do not need meetings.manage.
  requiredCapabilities: 'bv.manage',
  inputSchema: z.object({
    weeksBack: z.number().optional(),
    department: z.enum(['FOLK', 'PW']).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const weeksBack = input.weeksBack || 8;
    const weeks = getWeeks(weeksBack);
    const startDate = weeks[0];
    const endDate = weeks[weeks.length - 1];

    const dbUserId = context.user.id;
    const customUserId = context.user.userId || dbUserId;

    // Fetch booking link for current user if set
    const bvslUser = await Users.findOne({ id: dbUserId, fields: ['oneToOneLink'] }).catch(() => null);

    // Get strict hierarchy scoped user IDs for the calling user
    const scopedUserIds = await getScopedHierarchyUserIds(context.user);

    const storedSegment = String(context.user.segment || '').trim().toUpperCase();
    const callerSegment = input.department || storedSegment || 'PW';
    if (input.department && storedSegment && input.department !== storedSegment) {
      throw new Error('You cannot view one-to-one data for another department');
    }
    const isSupervisor = !!(
      context.user.isBvSupervisor ||
      context.user.isBvMentor ||
      ['SUPERVISOR', 'BV_SUPERVISOR', 'BV_MENTOR'].includes(String(context.user.role || '').toUpperCase().replace(/[\s-]+/g, '_'))
    );

    const userFields = [
      'id', 'userId', 'email', 'fullName', 'role', 'roles', 'ashrayLevel', 'residencyApproved', 'oneToOneDelegate',
      'bvReportingAdminId', 'bvReportingAdminName',
      'bvReportingSupervisorId', 'bvReportingSupervisorName',
      'bvReportingFacilitatorId', 'bvReportingFacilitatorName', 'segment',
      'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator', 'isBvSupervisor', 'isBvMentor', 'isBvAdmin', 'isBvSuperAdmin'
    ];

    // Fetch candidate users
    const { records: allUsers } = await Users.findAll({
      // Group Members resolves users from the membership records and does not
      // exclude them by status. Keep the same behavior here so members shown
      // in that tab are also available in the RGSF 1:1 report.
      filters: { segment: callerSegment },
      fields: userFields,
      limit: 2000,
    });

    let filteredUsers: any[] = [];

    if (scopedUserIds === null) {
      // 5. Super Admin: sees every single member of Prabhupada World Bhakti Vriksha
      filteredUsers = allUsers.filter((u: any) => {
        if (u.id === dbUserId || u.id === customUserId) return false;
        const uRole = (u.role || '').toUpperCase().replace(/\s+/g, '_');
        if (uRole === 'GUIDE' || uRole === 'SUPER_GUIDE') return false;
        return true;
      });
    } else if (scopedUserIds.size > 0) {
      // Scoped role (Admin, Supervisor, RGF, RGSF): filter strictly to scoped user IDs (excluding self)
      filteredUsers = allUsers.filter((u: any) => {
        const uId = String(u.id || '').toLowerCase();
        const userIdStr = String(u.userId || '').toLowerCase();
        const emailStr = String(u.email || '').toLowerCase();
        const isSelf = uId === dbUserId.toLowerCase() || userIdStr === customUserId.toLowerCase();
        if (isSelf) return false;
        const uRole = (u.role || '').toUpperCase().replace(/\s+/g, '_');
        if (uRole === 'GUIDE' || uRole === 'SUPER_GUIDE') return false;
        return scopedUserIds.has(uId) || scopedUserIds.has(userIdStr) || scopedUserIds.has(emailStr);
      });
    }

    // Fallback: If group/hierarchy mapping is empty for an RGF/RGSF without explicit tree entries,
    // fetch group members from groups where user is assigned
    const isRgsf = !!context.user.isBvSubFacilitator ||
      String(context.user.role || '').toUpperCase().replace(/\s+/g, '_') === 'RGSF';
    if ((isRgsf || filteredUsers.length === 0) && scopedUserIds !== null) {
      const { records: allGroups } = await BvGroups.findAll({
        limit: 500,
        fields: ['id', 'groupId', 'bvslLeader', 'bvslId', 'subFacilitatorId', 'rgsfId', 'subFacilitator'],
      });
      const { records: allMemberships } = await BvGroupMembers.findAll({
        limit: 2500,
        fields: ['id', 'user', 'userId', 'memberId', 'group', 'groupId'],
      });

      const refValues = (value: unknown): string[] => {
        if (Array.isArray(value)) return value.flatMap(refValues);
        return value ? [String(value).toLowerCase()] : [];
      };
      const callerKeys = new Set([dbUserId, customUserId, context.user.email]
        .filter(Boolean).map(value => String(value).toLowerCase()));
      const callerRecord = await Users.findOne({ id: dbUserId, fields: ['id', 'userId', 'email', 'bvReportingFacilitatorId'] }).catch(() => undefined) ||
        await Users.findOne({ filters: { userId: customUserId }, fields: ['id', 'userId', 'email', 'bvReportingFacilitatorId'] }).catch(() => undefined);
      const parentKeys = new Set([context.user.bvReportingFacilitatorId, (callerRecord as any)?.bvReportingFacilitatorId]
        .filter(Boolean).map((value: any) => String(value).toLowerCase()));
      if (parentKeys.size > 0) {
        const parentQueries = await Promise.all([
          Users.findAll({ filters: { id: { in: Array.from(parentKeys) } } as any, fields: ['id', 'userId', 'email'], limit: 20 }).catch(() => ({ records: [] })),
          Users.findAll({ filters: { userId: { in: Array.from(parentKeys) } } as any, fields: ['id', 'userId', 'email'], limit: 20 }).catch(() => ({ records: [] })),
          Users.findAll({ filters: { email: { in: Array.from(parentKeys) } } as any, fields: ['id', 'userId', 'email'], limit: 20 }).catch(() => ({ records: [] })),
        ]);
        parentQueries.flatMap(result => result.records || []).forEach((parent: any) => [parent.id, parent.userId, parent.email].filter(Boolean)
          .forEach((value: any) => parentKeys.add(String(value).toLowerCase())));
      }
      const userGroupIds = allGroups.filter((g: any) => {
        const assignedToCaller = refValues([
          g.subFacilitatorId, g.rgsfId, g.subFacilitator,
          g.bvslLeader, g.bvslId,
        ]).some(value => callerKeys.has(value));
        const assignedToReportingRgf = isRgsf && refValues([g.bvslLeader, g.bvslId]).some(value => parentKeys.has(value));
        return assignedToCaller || assignedToReportingRgf;
      }).flatMap((g: any) => [g.id, g.groupId]
        .filter(Boolean)
        .map(value => String(value).toLowerCase()));
      const userGroupIdSet = new Set(userGroupIds);

      if (userGroupIds.length > 0) {
        const scopedMemberships = allMemberships.filter((m: any) =>
          refValues([m.group, m.groupId]).some(value => userGroupIdSet.has(value))
        );
        const memberIdentityValues = [...new Set(scopedMemberships
          .flatMap((m: any) => [m.user, m.userId, m.memberId])
          .flatMap((value: any) => Array.isArray(value) ? value : [value])
          .filter(Boolean)
          .map(String))];
        const memberIds = new Set(memberIdentityValues.map(value => value.toLowerCase()));

        // Membership rows are authoritative. Resolve their users directly so
        // legacy segment/status metadata cannot hide a valid RGSF group member.
        const memberUserQueries = await Promise.all([
          Users.findAll({ filters: { id: { in: memberIdentityValues } } as any, fields: userFields, limit: 500 }).catch(() => ({ records: [] })),
          Users.findAll({ filters: { userId: { in: memberIdentityValues } } as any, fields: userFields, limit: 500 }).catch(() => ({ records: [] })),
          Users.findAll({ filters: { email: { in: memberIdentityValues } } as any, fields: userFields, limit: 500 }).catch(() => ({ records: [] })),
        ]);
        const memberUsers = new Map<string, any>();
        memberUserQueries.flatMap(result => result.records || []).forEach((user: any) => {
          if (user.id) memberUsers.set(String(user.id), user);
        });

        filteredUsers = [...memberUsers.values()].filter((u: any) => {
          if (!memberIds.has(String(u.id || '').toLowerCase()) &&
              !memberIds.has(String(u.userId || '').toLowerCase()) &&
              !memberIds.has(String(u.email || '').toLowerCase())) return false;
          if (u.id === dbUserId || u.id === customUserId) return false;
          const uRole = (u.role || '').toUpperCase().replace(/\s+/g, '_');
          if (uRole === 'GUIDE' || uRole === 'SUPER_GUIDE') return false;
          return true;
        });
      }
    }

    // The Supervisor report includes the reporting hierarchy (RGFs/RGSFs) as
    // well as every authoritative group member. Resolve both from the scoped
    // groups rather than relying only on reporting fields: older records may
    // store a Firestore id in the group and a public userId in the hierarchy.
    // This remains strictly limited to groups owned by an RGF under the caller.
    if (isSupervisor) {
      const scopeOptions: { segment: 'FOLK' | 'PW' } = {
        segment: callerSegment === 'FOLK' ? 'FOLK' : 'PW',
      };
      const groupMembers = await resolveBvGroupMemberUsers(context.user, userFields, scopeOptions);
      const callerAliases = new Set([dbUserId, customUserId, context.user.email]
        .filter(Boolean)
        .map(value => String(value).toLowerCase()));
      const seenAliases = new Set<string>();
      filteredUsers = [...filteredUsers, ...groupMembers].filter((user: any) => {
        const aliases = [user.id, user.userId, user.email]
          .filter(Boolean)
          .map(value => String(value).toLowerCase());
        if (aliases.some(alias => callerAliases.has(alias))) return false;
        if (aliases.some(alias => seenAliases.has(alias))) return false;
        aliases.forEach(alias => seenAliases.add(alias));
        return aliases.length > 0;
      });
    } else if (isRgsf) {
      // RGSFs remain membership-only, using the same canonical resolver as
      // Sadhana to remove blank legacy profile records.
      filteredUsers = await resolveBvGroupMemberUsers(context.user, userFields, {
        segment: callerSegment === 'FOLK' ? 'FOLK' : 'PW',
      });
    }

    // Build hierarchy lookup maps for user cards
    const { records: allBvGroups } = await BvGroups.findAll({
      limit: 1000,
      fields: ['id', 'groupId', 'groupName', 'bvslLeader', 'bvslId', 'bvslName', 'bvReportingSupervisorId', 'bvReportingSupervisorName', 'bvReportingAdminId', 'bvReportingAdminName'],
    }).catch(() => ({ records: [] }));

    const { records: allBvMemberships } = await BvGroupMembers.findAll({
      limit: 3000,
      fields: ['id', 'user', 'userId', 'memberId', 'group', 'groupId'],
    }).catch(() => ({ records: [] }));

    const groupMap = new Map<string, any>();
    allBvGroups.forEach((g: any) => {
      normalizedRefs([g.id, g.groupId, g.groupName]).forEach(ref => groupMap.set(ref, g));
    });

    const userToGroupMap = new Map<string, any>();
    allBvMemberships.forEach((m: any) => {
      const group = normalizedRefs([m.group, m.groupId])
        .map(ref => groupMap.get(ref))
        .find(Boolean);
      if (!group) return;
      normalizedRefs([m.user, m.userId, m.memberId]).forEach(ref => userToGroupMap.set(ref, group));
    });
    // RGF/RGSF records are normally not membership rows. Associate them with
    // their group too, so supervisors can search and filter every level of
    // their hierarchy in the same table.
    allBvGroups.forEach((group: any) => {
      normalizedRefs([group.bvslLeader, group.bvslId, group.subFacilitatorId, group.rgsfId, group.subFacilitator])
        .forEach(ref => {
          if (!userToGroupMap.has(ref)) userToGroupMap.set(ref, group);
        });
    });

    const userNameMap = new Map<string, string>();
    allUsers.forEach((u: any) => {
      if (u.id) userNameMap.set(String(u.id).toLowerCase(), u.fullName || '');
      if (u.userId) userNameMap.set(String(u.userId).toLowerCase(), u.fullName || '');
    });

    const canonicalMemberIdByAlias = new Map<string, string>();
    filteredUsers.forEach((user: any) => {
      if (!user.id) return;
      normalizedRefs([user.id, user.userId, user.email])
        .forEach(alias => canonicalMemberIdByAlias.set(alias, String(user.id)));
    });

    let meetings: any[] = [];
    if (canonicalMemberIdByAlias.size > 0) {
      const { records } = await OneToOneMeetings.findAll({
        filters: { weekDate: { gte: startDate, lte: endDate } } as any,
        fields: ['id', 'guide', 'member', 'weekDate', 'meetingDate', 'durationMinutes', 'notes', 'callStatus', 'recordingLink', 'nextCallDate', 'nextCallAgenda'],
        limit: 5000,
      });
      meetings = records.flatMap((meeting: any) => {
        const canonicalMemberId = normalizedRefs(meeting.member)
          .map(alias => canonicalMemberIdByAlias.get(alias))
          .find(Boolean);
        return canonicalMemberId ? [{ ...meeting, canonicalMemberId }] : [];
      });
    }

    // Collect department-scoped unique Admins for dropdown filtering
    const isCallerPw = context.user?.segment === 'PW' || context.user?.isPwAdmin || context.user?.isPrabhupadaWorldUser === true;

    const allAdminsSet = new Set<string>();
    allUsers.forEach((u: any) => {
      if (scopedUserIds !== null && !normalizedRefs([u.id, u.userId, u.email]).some(ref => scopedUserIds.has(ref))) return;
      if (u.isBvAdmin || u.isBvSuperAdmin || u.role === 'Admin' || u.role === 'ADMIN' || u.role === 'Super Admin' || u.role === 'SUPER_ADMIN') {
        const name = u.fullName || u.name || u.email;
        const isUserFolk = u.segment === 'FOLK';
        const isUserPw = u.segment === 'PW' || u.isPrabhupadaWorldUser === true;
        if (isCallerPw) {
          if (isUserPw || (!isUserFolk && !name.toUpperCase().includes('FOLK'))) {
            if (name) allAdminsSet.add(name);
          }
        } else {
          if (isUserFolk || (!isUserPw && !name.toUpperCase().includes('PW') && !name.toLowerCase().includes('prabhupada'))) {
            if (name) allAdminsSet.add(name);
          }
        }
      }
      if (u.bvReportingAdminName) {
        if (isCallerPw && !u.bvReportingAdminName.toUpperCase().includes('FOLK')) allAdminsSet.add(u.bvReportingAdminName);
        if (!isCallerPw && !u.bvReportingAdminName.toUpperCase().includes('PW') && !u.bvReportingAdminName.toLowerCase().includes('prabhupada')) allAdminsSet.add(u.bvReportingAdminName);
      }
    });
    const allAdmins = Array.from(allAdminsSet).filter(Boolean).sort();

    return {
      bvslLink: (bvslUser as any)?.oneToOneLink || null,
      allAdmins,
      users: filteredUsers.map((u: any) => {
        const uGrp = normalizedRefs([u.id, u.userId, u.email])
          .map(ref => userToGroupMap.get(ref))
          .find(Boolean);

        const rgfId = String(u.bvReportingFacilitatorId || uGrp?.bvslLeader || uGrp?.bvslId || '').toLowerCase();
        const rgfName = u.bvReportingFacilitatorName || uGrp?.bvslName || (rgfId ? userNameMap.get(rgfId) : null) || null;

        const supId = String(u.bvReportingSupervisorId || uGrp?.bvReportingSupervisorId || '').toLowerCase();
        const supervisorName = u.bvReportingSupervisorName || uGrp?.bvReportingSupervisorName || (supId ? userNameMap.get(supId) : null) || null;

        const adminId = String(u.bvReportingAdminId || uGrp?.bvReportingAdminId || '').toLowerCase();
        const adminName = u.bvReportingAdminName || uGrp?.bvReportingAdminName || (adminId ? userNameMap.get(adminId) : null) || null;

        const rawDelegate = Array.isArray(u.oneToOneDelegate) ? u.oneToOneDelegate[0] : u.oneToOneDelegate;
        const hasDelegate = !!rawDelegate && String(rawDelegate).toLowerCase() !== String(u.id || '').toLowerCase();
        const delegateId = hasDelegate ? String(rawDelegate) : null;
        const delegateName = delegateId ? (userNameMap.get(delegateId.toLowerCase()) || null) : null;
        const roleValues = (Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role])
          .filter(Boolean)
          .map((role: unknown) => String(role).toUpperCase().replace(/[\s-]+/g, '_'));
        const hasRole = (...roles: string[]) => roleValues.some((role: string) => roles.includes(role));
        const roleLabel = u.isBvSuperAdmin || hasRole('SUPER_ADMIN', 'SUPER_GUIDE')
          ? 'Super Admin'
          : (u.isBvAdmin || hasRole('ADMIN', 'PW_ADMIN'))
            ? 'Admin'
            : (u.isBvSupervisor || u.isBvMentor || hasRole('SUPERVISOR', 'BV_SUPERVISOR', 'BV_MENTOR'))
              ? 'Supervisor'
              : (u.isBvFacilitator || u.isBvsl || hasRole('RGF', 'BVSL', 'FACILITATOR'))
                ? 'RGF'
                : (u.isBvSubFacilitator || hasRole('RGSF', 'SUB_FACILITATOR'))
                  ? 'RGSF'
                  : 'User';

        return {
          userId: u.id,
          fullName: u.fullName || u.name || u.displayName || 'Unnamed Member',
          ashrayLevel: u.ashrayLevel || null,
          isResident: u.residencyApproved || false,
          eligibility: hasDelegate ? 'Delegated' : 'Guide',
          delegateId,
          delegateName,
          roleLabel,
          groupId: uGrp?.groupId || uGrp?.id || null,
          groupName: uGrp?.groupName || null,
          rgfName,
          supervisorName,
          adminName,
        };
      }),
      meetings: meetings.map((m: any) => ({
        id: m.id,
        guideId: Array.isArray(m.guide) ? m.guide[0] : m.guide,
        memberId: m.canonicalMemberId || (Array.isArray(m.member) ? m.member[0] : m.member),
        weekDate: String(m.weekDate || '').split('T')[0],
        meetingDate: String(m.meetingDate || '').split('T')[0],
        durationMinutes: m.durationMinutes || 0,
        notes: m.notes || '',
        callStatus: m.callStatus || 'Connected',
        recordingLink: m.recordingLink || '',
        nextCallDate: m.nextCallDate ? String(m.nextCallDate).split('T')[0] : '',
        nextCallAgenda: m.nextCallAgenda || '',
      })),
      weeks,
    };
  },
});
