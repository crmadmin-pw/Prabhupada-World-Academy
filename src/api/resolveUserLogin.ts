import { z } from 'zod';
import { createEndpoint, Users, Guides } from '@/lib/backend-sdk';
import { ensureAccountLinkReview, isCompleteProfile, isLoginLinkedToProfile } from '@/lib/accountLinkReview';
import { getUserDashboardPath, getUserDepartment } from '../lib/userDashboardRoutes';

function roleToRoute(role: string, isBvsl?: boolean, isSadhanaMentor?: boolean, isBvSupervisor?: boolean, isBvFacilitator?: boolean, isBvSubFacilitator?: boolean, email?: string, segment?: string): string {
  const isFolk = segment === 'FOLK';
  if (role === 'Super Admin' || role === 'SUPER_ADMIN' || role === 'Admin' || role === 'ADMIN') {
    return isFolk ? '/folk-guide/dashboard' : '/pw-admin/dashboard';
  }
  if (role === 'Super Guide' || role === 'SUPER_GUIDE') return '/folk-guide/dashboard';
  // BV role flags take priority over base role for Guide-level users
  if (isBvSupervisor) return '/bv-supervisor/dashboard';
  if (isBvSubFacilitator) return '/rgsf/dashboard';
  if (role === 'Guide' || role === 'GUIDE') return '/folk-guide/dashboard';
  if (role === 'BVSL') return '/bvsl/dashboard';
  if (role === 'Sadhana Mentor') return '/mentor/dashboard';
  if (isBvsl || isBvFacilitator) return '/bvsl/dashboard';
  if (isSadhanaMentor) return '/mentor/dashboard';
  return getUserDashboardPath({ segment });
}

export function normalizeRole(r: string): string {
  const m: Record<string, string> = {
    'User': 'USER', 'Guide': 'GUIDE', 'Super Guide': 'SUPER_GUIDE', 'Super Admin': 'SUPER_ADMIN',
    'BVSL': 'BVSL', 'Sadhana Mentor': 'SADHANA_MENTOR', 'BVSL Mentor': 'BVSL_MENTOR',
  };
  return m[r] ?? r.toUpperCase().replace(/ /g, '_');
}

export function normalizeStatus(s: string): string {
  const m: Record<string, string> = {
    'Pending Approval': 'PENDING_APPROVAL', 'Active': 'ACTIVE', 'Rejected': 'REJECTED', 'Inactive': 'INACTIVE',
    'Pending Deletion': 'PENDING_DELETION',
  };
  return m[s] ?? s.toUpperCase().replace(/ /g, '_');
}

export default createEndpoint({
  description: 'Resolve user login from an already linked profile. Email matches wait for an administrator to confirm the link.',
  authenticated: true,
  inputSchema: z.object({ email: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const now = new Date().toISOString();
    const userEmail = (context.user.email || '').toLowerCase();
    const authUid = String(context.user.uid || context.user.id || '');

    let userRecord = await Users.findOne({ id: context.user.id });
    if (!isCompleteProfile(userRecord) && authUid && authUid !== String(context.user.id || '')) {
      userRecord = await Users.findOne({ id: authUid }) || userRecord;
    }
    if (!isCompleteProfile(userRecord) && authUid) {
      const linked = await Users.findOne({ filters: { firebaseUid: authUid } });
      if (isCompleteProfile(linked) && isLoginLinkedToProfile(linked, authUid)) userRecord = linked;
    }

    if (!isCompleteProfile(userRecord)) {
      const hold = authUid
        ? await ensureAccountLinkReview({ authUid, email: userEmail, bareRecordId: authUid })
        : null;
      if (hold) return { action: hold };

      const guide = await Guides.findOne({
        filters: { email: context.user.email },
      });
      if (guide && guide.isActive !== false) return { action: 'guide_email_detected' };
      return { action: 'register' };
    }

    // ── Self-healing: detect and fix duplicate userId ─────────────────────────
    const currentUserId = String(userRecord.userId);
    const { records: sameIdRecords } = await Users.findAll({
      filters: { userId: currentUserId } as any,
      fields: ['id', 'userId'],
    });

    if (sameIdRecords.length > 1) {
      const isEarliestDoc = sameIdRecords
        .map(r => r.id)
        .sort()[0] === userRecord.id;

      if (!isEarliestDoc) {
        const timestamp = Date.now().toString(36);
        const uniqueId = `USER-${timestamp.toUpperCase()}`;
        await Users.update({
          id: userRecord.id,
          record: { userId: uniqueId },
        });
        userRecord.userId = uniqueId;
      }
    }

    await Users.update({ id: userRecord.id, record: { lastLoginAt: now } }).catch(() => {});

    // Determine route based on status and role
    const status = userRecord.status;
    let route = '/pending';
    if (status === 'Rejected') {
      route = '/rejected';
    } else if (status === 'Inactive') {
      route = '/inactive';
    } else if (status === 'Active') {
      route = roleToRoute(userRecord.role || 'User', userRecord.isBvsl, userRecord.isSadhanaMentor, userRecord.isBvSupervisor || userRecord.isBvMentor, userRecord.isBvFacilitator || userRecord.isBvsl, userRecord.isBvSubFacilitator, userRecord.email, getUserDepartment(userRecord));
    }

    return {
      action: 'route',
      route,
      user: {
        userId: userRecord.userId,
        fullName: userRecord.fullName || '',
        role: normalizeRole(userRecord.role || 'User'),
        status: normalizeStatus(status),
        phone: userRecord.phone || '',
        email: userRecord.email || context.user.email,
        selectedGuideId: Array.isArray(userRecord.guide) ? userRecord.guide[0] : (userRecord.guide || null),
        selectedFolkResidency: Array.isArray(userRecord.residency) ? userRecord.residency[0] : (userRecord.residency || null),
        residencyUserClaim: userRecord.residencyClaimed || false,
        residencyGuideVerified: userRecord.residencyApproved || false,
        createdAt: userRecord.createdAt || now,
        lastLoginAt: now,
        rowId: 0,
        ashrayLevel: userRecord.ashrayLevel || null,
        residencyName: null,
        guideName: null,
        isBvsl: userRecord.isBvsl || false,
        isSadhanaMentor: userRecord.isSadhanaMentor || false,
        isBvMentor: userRecord.isBvMentor || false,
        isBvSuperAdmin: !!(userRecord.isBvSuperAdmin || userRecord.role === 'Super Admin' || userRecord.role === 'SUPER_ADMIN'),
        isBvAdmin: !!(userRecord.isBvAdmin || userRecord.isBvSuperAdmin || userRecord.role === 'Admin' || userRecord.role === 'ADMIN' || userRecord.role === 'Super Admin' || userRecord.role === 'SUPER_ADMIN'),
        isBvSupervisor: !!(userRecord.isBvSupervisor || userRecord.isBvMentor),
        isBvFacilitator: !!(userRecord.isBvFacilitator || userRecord.isBvsl),
        isBvSubFacilitator: !!(userRecord.isBvSubFacilitator),
        isBvMember: userRecord.isBvMember || false,
        segment: getUserDepartment(userRecord),
      },
    };
  },
});
