import { z } from 'zod';
import { getScopedHierarchyUserIds, isUserInHierarchy } from '../lib/hierarchyUtils';
import { createEndpoint, BvMemberRegistrations, BvGroupMembers, BvGroupRequests, BvGroups, Users, AppError } from '@/lib/backend-sdk';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';

const formatPhone = (phone?: string) => {
  if (!phone) return '';
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length > 10 && !phone.startsWith('+')) {
    return `+${phone}`;
  }
  return phone;
};

export default createEndpoint({
  description: 'Get pending Bhakti Vriksha member registrations filtered by Firestore roles and segment',
  authenticated: true,
  requiredCapabilities: 'bv.manage',
  inputSchema: z.object({
    segment: z.enum(['PW', 'FOLK']).optional(),
    guideId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = (context.user.role || '').toUpperCase();
    
    // Access is determined entirely from the authenticated Firestore profile.
    const isSuperAdminOrPwAdmin =
      role === 'SUPER_GUIDE' || 
      role === 'SUPER_ADMIN' ||
      role === 'ADMIN' ||
      context.user.isBvSuperAdmin ||
      context.user.isBvAdmin || 
      context.user.isBvSuperAdmin ||
      context.user.isPwAdmin;

    // Check if user is Guide or Supervisor or RGF
    const isGuideOrSupervisor = role === 'GUIDE' || 
      context.user.isBvSupervisor || 
      context.user.isBvsl || 
      context.user.isSadhanaMentor;

    if (!isSuperAdminOrPwAdmin && !isGuideOrSupervisor) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Admin or Supervisor access required' });
    }

    let records: any[] = [];
    try {
      // Fetch all registrations from BvMemberRegistrations collection
      const result = await BvMemberRegistrations.findAll({ limit: 500 });
      const rawRecords = result?.records || [];
      // Filter for pending status (supports 'Pending Approval', 'Pending', 'Awaiting Approval', or missing status)
      records = rawRecords.filter(r => 
        !r.status || 
        r.status === 'Pending Approval' || 
        r.status === 'Pending' || 
        r.status === 'Awaiting Approval'
      );
    } catch (err) {
      records = [];
    }

    // Enhance records with user background (PW user vs FOLK guide user)
    const rawUserIds = records.map(r => r.userId || r.userDbId).filter(Boolean);
    const rawEmails = records.map(r => (r.email || '').toLowerCase()).filter(Boolean);
    const userMap: Record<string, any> = {};

    try {
      const [{ records: list1 }, { records: list2 }, { records: list3 }] = await Promise.all([
        rawUserIds.length > 0 ? Users.findAll({ filters: { id: { in: rawUserIds } }, limit: 500 }) : { records: [] },
        rawUserIds.length > 0 ? Users.findAll({ filters: { userId: { in: rawUserIds } }, limit: 500 }) : { records: [] },
        rawEmails.length > 0 ? Users.findAll({ filters: { email: { in: rawEmails } }, limit: 500 }) : { records: [] },
      ]);
      [...(list1 || []), ...(list2 || []), ...(list3 || [])].forEach(u => {
        if (u.id) userMap[u.id] = u;
        if (u.userId) userMap[u.userId] = u;
        if (u.email) userMap[u.email.toLowerCase()] = u;
      });
    } catch (e) {}

    // Fallback: Also fetch users whose bvRegistrationStatus is Pending Approval directly from Users table
    try {
      const { records: pendingUsers } = await Users.findAll({
        filters: { bvRegistrationStatus: 'Pending Approval' },
        limit: 500,
      });

      const existingUserIds = new Set(records.map(r => r.userDbId || r.userId || r.id));
      const existingEmails = new Set(records.map(r => (r.email || '').toLowerCase()).filter(Boolean));

      for (const u of (pendingUsers || [])) {
        const uEmail = (u.email || '').toLowerCase();
        if (existingUserIds.has(u.id) || existingUserIds.has(u.userId) || (uEmail && existingEmails.has(uEmail))) {
          continue;
        }

        const isPw = !!(u.isPrabhupadaWorldUser) || u.segment === 'PW';
        records.push({
          id: `BVREG-${u.id}`,
          userId: u.userId || u.id,
          userDbId: u.id,
          email: u.email || '',
          fullName: u.fullName || u.email || 'Devotee',
          phone: formatPhone(u.phone),
          ashrayLevel: u.ashrayLevel || 'None',
          pwClassesAttending: u.pwClassesAttending || 'None',
          timePreference: u.timePreference || '7:45 PM – 8:15 PM (Everyday)',
          status: 'Pending Approval',
          submittedAt: u.statusChangedAt || u.createdAt || new Date().toISOString(),
          segment: isPw ? 'PW' : 'FOLK',
          isPrabhupadaWorldUser: isPw,
        });

        if (u.id) userMap[u.id] = u;
        if (u.userId) userMap[u.userId] = u;
        if (uEmail) userMap[uEmail] = u;
      }
    } catch (e) {}

    // "Request to Join" writes BvGroupRequests, not a registration form.
    // Role assignment sets isBvMember without placing the person in a group,
    // so a supervisor's request must still reach this admin queue.
    try {
      const { records: joinRequests } = await BvGroupRequests.findAll({
        filters: { status: 'Pending' },
        fields: ['id', 'user', 'group', 'requestedAt', 'status'],
        limit: 200,
      });
      const firstRef = (value: unknown) => Array.isArray(value) ? value[0] : value;
      const requestUserIds = [...new Set(joinRequests.map(request => firstRef(request.user)).filter(Boolean).map(String))];
      const requestGroupIds = [...new Set(joinRequests.map(request => firstRef(request.group)).filter(Boolean).map(String))];
      const missingUserIds = requestUserIds.filter(id => !userMap[id]);
      if (missingUserIds.length > 0) {
        const [{ records: byId }, { records: byUserId }] = await Promise.all([
          Users.findAll({ filters: { id: { in: missingUserIds } }, limit: 200 }),
          Users.findAll({ filters: { userId: { in: missingUserIds } }, limit: 200 }),
        ]);
        [...(byId || []), ...(byUserId || [])].forEach(u => {
          if (u.id) userMap[u.id] = u;
          if (u.userId) userMap[u.userId] = u;
          if (u.email) userMap[u.email.toLowerCase()] = u;
        });
      }
      const groupMap: Record<string, any> = {};
      if (requestGroupIds.length > 0) {
        const [{ records: groupsById }, { records: groupsByGroupId }] = await Promise.all([
          BvGroups.findAll({ filters: { id: { in: requestGroupIds } }, fields: ['id', 'groupId', 'groupName', 'segment'], limit: 200 }),
          BvGroups.findAll({ filters: { groupId: { in: requestGroupIds } }, fields: ['id', 'groupId', 'groupName', 'segment'], limit: 200 }),
        ]);
        [...(groupsById || []), ...(groupsByGroupId || [])].forEach(group => {
          if (group.id) groupMap[group.id] = group;
          if (group.groupId) groupMap[group.groupId] = group;
        });
      }
      const existingApplicants = new Set(records.flatMap(registration => [
        registration.userId, registration.userDbId, (registration.email || '').toLowerCase(),
      ]).filter(Boolean).map(String));
      for (const request of joinRequests) {
        const uid = String(firstRef(request.user) || '');
        const gid = String(firstRef(request.group) || '');
        const applicant = userMap[uid];
        const group = groupMap[gid];
        const applicantKeys = [uid, applicant?.id, applicant?.userId, (applicant?.email || '').toLowerCase()].filter(Boolean).map(String);
        if (applicantKeys.some(key => existingApplicants.has(key))) continue;
        const isPw = !!(applicant?.isPrabhupadaWorldUser) || applicant?.segment === 'PW' || group?.segment === 'PW';
        records.push({
          id: request.id,
          source: 'group-join',
          userId: applicant?.userId || uid,
          userDbId: applicant?.id || uid,
          email: applicant?.email || '',
          fullName: applicant?.fullName || applicant?.email || 'Devotee',
          phone: formatPhone(applicant?.phone),
          status: 'Pending Approval',
          submittedAt: request.requestedAt || new Date().toISOString(),
          segment: isPw ? 'PW' : (applicant?.segment || group?.segment || 'FOLK'),
          isPrabhupadaWorldUser: isPw,
          requestedGroupId: group?.id || gid,
          requestedGroupName: group?.groupName || '',
          guide: applicant?.guide,
          selectedGuideId: applicant?.selectedGuideId,
        });
        applicantKeys.forEach(key => existingApplicants.add(key));
      }
    } catch (e) {}

    // Membership is the definitive approval state. Query only identifiers in
    // the pending queue (in Firestore-safe batches) instead of reading the
    // entire group-members collection on every admin dashboard refresh.
    const memberIdentities = new Set<string>();
    const pendingIdentities = [...new Set(records.flatMap(r => {
      const u = userMap[r.userId] || userMap[r.userDbId] || (r.email ? userMap[r.email.toLowerCase()] : null);
      return [r.userId, r.userDbId, u?.id, u?.userId];
    }).filter(Boolean).map(String))];

    for (let index = 0; index < pendingIdentities.length; index += 30) {
      const batch = pendingIdentities.slice(index, index + 30);
      const [byUser, byUserId] = await Promise.all([
        BvGroupMembers.findAll({
          filters: { user: { in: batch } },
          fields: ['user', 'userId'],
          limit: 500,
        }),
        BvGroupMembers.findAll({
          filters: { userId: { in: batch } },
          fields: ['user', 'userId'],
          limit: 500,
        }),
      ]);
      [...byUser.records, ...byUserId.records].forEach((member: any) => {
        const user = Array.isArray(member.user) ? member.user[0] : member.user;
        const userId = Array.isArray(member.userId) ? member.userId[0] : member.userId;
        if (user) memberIdentities.add(String(user));
        if (userId) memberIdentities.add(String(userId));
      });
    }

    // Filter according to requested segment (PW vs FOLK)
    const targetSegment = input?.segment || (
      context.user.isBvSuperAdmin ? 'PW' : 'FOLK'
    );
    const isFolkSuper = role === 'SUPER_GUIDE' || role === 'SUPER_ADMIN' || context.user.isBvSuperAdmin || context.user.isBvAdmin;
    const guideScope = targetSegment === 'FOLK' && !isFolkSuper
      ? await getGuideScope(context.user.email || '')
      : null;

    const isPwAdminUser = String(context.user.segment || '').toUpperCase() === 'PW' && !!(
      context.user.isBvSuperAdmin ||
      context.user.isBvAdmin ||
      context.user.isPwAdmin ||
      role === 'SUPER_ADMIN' ||
      role === 'ADMIN' ||
      role === 'PW_ADMIN'
    );

    const hierarchy = await getScopedHierarchyUserIds(context.user);
    const filteredRecords = records.filter(r => {
      const u = userMap[r.userId] || userMap[r.userDbId] || userMap[r.id] || (r.email ? userMap[r.email.toLowerCase()] : null);
      const isPwUser = !!(u?.isPrabhupadaWorldUser || r.isPrabhupadaWorldUser) ||
        (u?.segment === 'PW' || r.segment === 'PW');
      const requestUser = u || { id: r.userDbId, userId: r.userId, email: r.email, segment: r.segment,
        isPrabhupadaWorldUser: r.isPrabhupadaWorldUser, guide: r.guide, selectedGuideId: r.selectedGuideId };
      // PW BV applications are also reviewed by the shared PW admin queue;
      // hierarchy still scopes FOLK and non-admin callers.
      if (!(targetSegment === 'PW' && isPwAdminUser && isPwUser) &&
        !isUserInHierarchy(requestUser, hierarchy)) return false;
      // A reading-group membership or a finished decision is definitive.
      // isBvMember is also set when a Supervisor (or another role) is assigned,
      // before that person has joined any group, so it must not hide the request.
      const registrationIdentities = [r.userId, r.userDbId, u?.id, u?.userId]
        .filter(Boolean)
        .map(String);
      if (registrationIdentities.some(identity => memberIdentities.has(identity))) return false;
      if (r.source !== 'group-join' && (
        u?.bvRegistrationStatus === 'Approved' ||
        u?.bvRegistrationStatus === 'Rejected'
      )) return false;

      if (targetSegment === 'PW') {
        return isPwUser; // PW Admin / Super Admin sees ONLY Prabhupada World registrations
      }
      
      // FOLK Admin / Super Admin sees ONLY FOLK registrations
      if (isPwUser) return false;
      if (guideScope) {
        const guideUser = u || { guide: r.guide || r.selectedGuideId };
        if (!isUserInGuideScope(guideScope, guideUser)) return false;
      }
      return true;
    });

    const mappedRecords = filteredRecords.map(r => {
      const u = userMap[r.userId] || userMap[r.userDbId] || userMap[r.id] || (r.email ? userMap[r.email.toLowerCase()] : null);
      const isPwUser = !!(u?.isPrabhupadaWorldUser || r.isPrabhupadaWorldUser) || 
        (u?.segment === 'PW' || r.segment === 'PW');
      return {
        ...r,
        segment: isPwUser ? 'PW' : 'FOLK',
        isPrabhupadaWorldUser: isPwUser,
      };
    });

    return mappedRecords.sort((a: any, b: any) => 
      new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime()
    );
  },
});
