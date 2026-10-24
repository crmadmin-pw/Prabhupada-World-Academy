import { z } from 'zod';
import { createEndpoint, Users, OneToOneMeetings, BvGroups, BvGroupMembers } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, isHierarchyAdmin, readScopedUsers } from '../lib/hierarchyUtils';
import { organizationalDepartment } from '../lib/directoryDepartment';
import { resolveBvGroupFacilitatorUsers, resolveBvGroupMemberUsers, resolveBvScopedGroups } from '../lib/bvGroupMemberScope';

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
    const bvslUser = await Users.findOne({ id: dbUserId, fields: ['oneToOneLink'] });

    // Get strict hierarchy scoped user IDs for the calling user
    const scopedUserIds = await getScopedHierarchyUserIds(context.user);

    const storedDepartment = organizationalDepartment(context.user);
    const requestedDepartment = input.department
      ? organizationalDepartment({ segment: input.department })
      : null;
    if (requestedDepartment && storedDepartment && requestedDepartment !== storedDepartment) {
      throw new Error('You cannot view one-to-one data for another department');
    }
    const callerSegment = requestedDepartment || storedDepartment || 'PW';
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
      'isPrabhupadaWorldUser', 'isFolkUser', 'isFolkLead', 'isPwAdmin',
      'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator', 'isBvSupervisor', 'isBvMentor', 'isBvAdmin', 'isBvSuperAdmin'
    ];

    // Fetch candidate users
    const { records: allUsers } = await readScopedUsers(context.user, {
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
      const scopedGroups = await resolveBvScopedGroups(context.user);
      const { records: allMemberships } = await BvGroupMembers.findAll({
        limit: 2500,
        fields: ['id', 'user', 'userId', 'memberId', 'group', 'groupId'],
      });

      const refValues = (value: unknown): string[] => {
        if (Array.isArray(value)) return value.flatMap(refValues);
        return value ? [String(value).toLowerCase()] : [];
      };
      const userGroupIds = scopedGroups.flatMap(group => [group.id, group.groupId].map(value => value.toLowerCase()));
      // An RGSF with no assigned groups must not retain hierarchy-only results.
      if (isRgsf) filteredUsers = [];
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
          Users.findAll({ filters: { id: { in: memberIdentityValues } } as any, fields: userFields, limit: 500 }),
          Users.findAll({ filters: { userId: { in: memberIdentityValues } } as any, fields: userFields, limit: 500 }),
          Users.findAll({ filters: { email: { in: memberIdentityValues } } as any, fields: userFields, limit: 500 }),
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

    // Supervisor reports include staff and members of explicitly assigned
    // groups only. Global reporting parents cannot add other groups' members.
    if (isSupervisor && !isHierarchyAdmin(context.user)) {
      const scopeOptions = {
        segment: callerSegment === 'FOLK' ? 'FOLK' : 'PW',
        supervisionOnly: true,
      } as const;
      const groupMembers = await resolveBvGroupMemberUsers(context.user, userFields, scopeOptions);
      const callerAliases = new Set([dbUserId, customUserId, context.user.email]
        .filter(Boolean)
        .map(value => String(value).toLowerCase()));
      const seenAliases = new Set<string>();
      filteredUsers = groupMembers.filter((user: any) => {
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
    } else if (isHierarchyAdmin(context.user)) {
      // An admin already sees direct reports. Also show the people those RGFs
      // see: group members, and an RGSF whose reporting parent is that RGF
      // even when an older admin id kept them out of the hierarchy walk.
      const segment = callerSegment === 'FOLK' ? 'FOLK' : 'PW' as const;
      const groupMembers = await resolveBvGroupMemberUsers(context.user, userFields, { segment });
      const facilitatorIds = [...new Set([...filteredUsers, ...groupMembers].flatMap((user: any) => {
        const role = String(user.role || '').toUpperCase().replace(/[\s-]+/g, '_');
        const isRgf = !!(user.isBvFacilitator || user.isBvsl || ['RGF', 'BVSL', 'FACILITATOR'].includes(role));
        return isRgf ? [user.id, user.userId, user.email].filter(Boolean).map(String) : [];
      }))];
      let reportingToRgf: any[] = [];
      if (facilitatorIds.length > 0) {
        const { records } = await Users.findAll({
          filters: { bvReportingFacilitatorId: { in: facilitatorIds } } as any,
          fields: userFields,
          limit: 500,
        });
        reportingToRgf = records || [];
      }
      const callerAliases = new Set([dbUserId, customUserId, context.user.email]
        .filter(Boolean)
        .map(value => String(value).toLowerCase()));
      const seenAliases = new Set<string>();
      filteredUsers = [...filteredUsers, ...groupMembers, ...reportingToRgf].filter((user: any) => {
        const aliases = [user.id, user.userId, user.email]
          .filter(Boolean)
          .map(value => String(value).toLowerCase());
        if (aliases.some(alias => callerAliases.has(alias))) return false;
        if (aliases.some(alias => seenAliases.has(alias))) return false;
        aliases.forEach(alias => seenAliases.add(alias));
        return aliases.length > 0;
      });
    }

    // Build hierarchy lookup maps for user cards
    const { records: allBvGroups } = await BvGroups.findAll({
      limit: 1000,
      fields: ['id', 'groupId', 'groupName', 'bvslLeader', 'bvslId', 'bvslName', 'supervisorId', 'supervisorUserId', 'supervisorName', 'segment', 'bvReportingAdminId', 'bvReportingAdminName'],
    });

    const { records: allBvMemberships } = await BvGroupMembers.findAll({
      limit: 3000,
      fields: ['id', 'user', 'userId', 'memberId', 'group', 'groupId'],
    });

    const groupMap = new Map<string, any>();
    const supervisedIds = isSupervisor && !isHierarchyAdmin(context.user)
      ? new Set((await resolveBvScopedGroups(context.user, { supervisionOnly: true })).map(group => group.id))
      : null;
    allBvGroups.forEach((g: any) => {
      if (supervisedIds && !supervisedIds.has(String(g.id))) return;
      normalizedRefs([g.id, g.groupId, g.groupName]).forEach(ref => groupMap.set(ref, g));
    });

    const userToGroupMap = new Map<string, any>();
    for (const group of new Set(groupMap.values())) {
      normalizedRefs([group.bvslLeader, group.bvslId]).forEach(ref => userToGroupMap.set(ref, group));
    }
    allBvMemberships.forEach((m: any) => {
      const group = normalizedRefs([m.group, m.groupId])
        .map(ref => groupMap.get(ref))
        .find(Boolean);
      if (!group) return;
      normalizedRefs([m.user, m.userId, m.memberId]).forEach(ref => userToGroupMap.set(ref, group));
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

    // Admin names come only from accounts in the caller's department. A stored
    // reporting-admin label is not a person we can classify, so it is not shown.
    const callerDepartment = organizationalDepartment(context.user)
      || (callerSegment === 'FOLK' ? 'FOLK' : (callerSegment === 'PW' || callerSegment === 'PRABHUPADAWORLD' ? 'PW' : null));

    const allAdminsSet = new Set<string>();
    allUsers.forEach((u: any) => {
      if (scopedUserIds !== null && !normalizedRefs([u.id, u.userId, u.email]).some(ref => scopedUserIds.has(ref))) return;
      const role = String(u.role || '').toUpperCase().replace(/[\s-]+/g, '_');
      const isAdmin = u.isBvAdmin || u.isBvSuperAdmin || u.isPwAdmin || ['ADMIN', 'PW_ADMIN', 'SUPER_ADMIN', 'ADMINISTRATOR'].includes(role);
      if (!isAdmin) return;
      const department = organizationalDepartment(u);
      if (callerDepartment && department && department !== callerDepartment) return;
      const name = u.fullName || u.name || u.email;
      if (name) allAdminsSet.add(name);
    });
    const allAdmins = Array.from(allAdminsSet).filter(Boolean).sort();

    return {
      bvslLink: (bvslUser as any)?.oneToOneLink || null,
      allAdmins,
      users: filteredUsers.map((u: any) => {
        const uGrp = normalizedRefs([u.id, u.userId, u.email])
          .map(ref => userToGroupMap.get(ref))
          .find(Boolean);

        const callerIsFolk = organizationalDepartment(context.user) === 'FOLK';
        const groupIsOtherDepartment = callerIsFolk && organizationalDepartment(uGrp) === 'PW';
        const rgfId = String(u.bvReportingFacilitatorId || uGrp?.bvslLeader || uGrp?.bvslId || '').toLowerCase();
        const rgfName = (rgfId ? userNameMap.get(rgfId) : null)
          || (groupIsOtherDepartment ? null : (u.bvReportingFacilitatorName || uGrp?.bvslName || null));

        const supId = String(uGrp?.supervisorId || uGrp?.supervisorUserId || '').toLowerCase();
        const supervisorName = (supId ? userNameMap.get(supId) : null)
          || (groupIsOtherDepartment || !supId ? null : (uGrp?.supervisorName || null));

        const adminId = String(u.bvReportingAdminId || uGrp?.bvReportingAdminId || '').toLowerCase();
        const adminName = (adminId ? userNameMap.get(adminId) : null)
          || (groupIsOtherDepartment ? null : (u.bvReportingAdminName || uGrp?.bvReportingAdminName || null));

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
