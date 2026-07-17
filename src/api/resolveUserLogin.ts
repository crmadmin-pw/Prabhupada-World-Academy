import { z } from 'zod';
import { createEndpoint, Users, Guides } from 'zite-integrations-backend-sdk';
import { generateUniqueUserId } from '../lib/userIdGen';

function roleToRoute(role: string, isBvsl?: boolean, isSadhanaMentor?: boolean): string {
  if (role === 'Super Guide') return '/super/dashboard';
  if (role === 'Guide') return '/guide/dashboard';
  if (role === 'BVSL') return '/bvsl/dashboard';
  if (role === 'Sadhana Mentor') return '/mentor/dashboard';
  if (isBvsl) return '/bvsl/dashboard';
  if (isSadhanaMentor) return '/mentor/dashboard';
  return '/user/dashboard';
}

export function normalizeRole(r: string): string {
  const m: Record<string, string> = {
    'User': 'USER', 'Guide': 'GUIDE', 'Super Guide': 'SUPER_GUIDE',
    'BVSL': 'BVSL', 'Sadhana Mentor': 'SADHANA_MENTOR', 'BVSL Mentor': 'BVSL_MENTOR',
  };
  return m[r] ?? r.toUpperCase().replace(/ /g, '_');
}

export function normalizeStatus(s: string): string {
  const m: Record<string, string> = {
    'Pending Approval': 'PENDING_APPROVAL', 'Active': 'ACTIVE', 'Rejected': 'REJECTED', 'Inactive': 'INACTIVE',
  };
  return m[s] ?? s.toUpperCase().replace(/ /g, '_');
}

/**
 * EMAIL FALLBACK: When user-sync creates a bare record (no userId/status) due to
 * email case mismatch (Google returns lowercase, registration stored mixed case),
 * find the real profile by email (case-insensitive) and merge it into the
 * user-sync record so login works correctly.
 */
async function findAndMergeRealProfile(
  syncRecordId: string,
  authEmail: string,
): Promise<any | null> {
  const emailLower = authEmail.toLowerCase();

  // Search all records by email (case-insensitive via lowercase comparison)
  const { records } = await Users.findAll({
    fields: ['id', 'userId', 'fullName', 'phone', 'email', 'role', 'status',
      'guide', 'residency', 'residencyClaimed', 'residencyApproved', 'residencyJoinDate',
      'ashrayLevel', 'isBvsl', 'isSadhanaMentor', 'createdAt', 'currentStreak',
      'lastStreakUpdatedAt', 'bvServiceAllocated'],
    limit: 100,
  });

  const realProfile = records.find(r =>
    r.id !== syncRecordId &&
    r.userId &&
    r.status &&
    (r.email || '').toLowerCase() === emailLower,
  );

  if (!realProfile) return null;

  // Merge: copy all real profile fields into the user-sync record so auth works correctly.
  // The user-sync record is permanently linked to this user's auth session.
  // Always normalize email to lowercase to prevent future case-mismatch duplicates.
  await Users.update({
    id: syncRecordId,
    record: {
      userId: realProfile.userId,
      fullName: realProfile.fullName || '',
      phone: realProfile.phone || '',
      email: (realProfile.email || authEmail).toLowerCase(),
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
      currentStreak: realProfile.currentStreak ?? 0,
      bvServiceAllocated: realProfile.bvServiceAllocated ?? false,
      lastLoginAt: new Date().toISOString(),
    },
  });

  // Delete all old duplicate records (same email, different record ID, not the sync record).
  // These are stale copies left from previous case-mismatch logins — safe to remove now
  // that the sync record has been updated with the real profile data.
  const duplicatesToDelete = records.filter(r =>
    r.id !== syncRecordId &&
    (r.email || '').toLowerCase() === emailLower,
  );
  for (const dup of duplicatesToDelete) {
    await Users.delete({ id: dup.id }).catch(() => {/* ignore individual delete errors */});
  }

  return realProfile;
}

export default createEndpoint({
  description: 'Resolve user login — O(1) direct lookup via user sync record ID, with email fallback for case-mismatch duplicates',
  authenticated: true,
  inputSchema: z.object({ email: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const now = new Date().toISOString();
    const userEmail = (context.user.email || '').toLowerCase();

    // Auto-bootstrap/seed the first user as Super Guide if the Users table in Firestore is empty
    const { records: existingUsers } = await Users.findAll({ limit: 1 });
    if (existingUsers.length === 0) {
      const generatedUserId = 'GUIDE-ADMIN';
      await Users.create({
        record: {
          id: context.user.id,
          userId: generatedUserId,
          fullName: 'Initial Administrator',
          email: context.user.email,
          role: 'Super Guide',
          status: 'Active',
          createdAt: now,
          lastLoginAt: now
        }
      });
      
      await Guides.create({
        record: {
          id: 'GUIDE-ADMIN-GUIDE',
          abbreviation: 'ADM',
          email: context.user.email,
          fullName: 'Initial Administrator',
          guideId: generatedUserId,
          isActive: true
        }
      });
    }

    // Direct lookup — no full table scan needed with Zite DB user sync
    const userRecord = await Users.findOne({ id: context.user.id });

    if (!userRecord?.status || !userRecord?.userId) {
      // ── EMAIL FALLBACK ────────────────────────────────────────────────────
      // User-sync created a bare record (no userId/status). This happens when:
      //   1. User sync is enabled after registration (old records have different email case)
      //   2. Google returns lowercase email but registration stored mixed-case
      // Try to find the real profile by email (case-insensitive) and merge it.
      const authEmail = context.user.email;
      if (authEmail) {
        const real = await findAndMergeRealProfile(context.user.id, authEmail);
        if (real) {
          // Successfully merged — continue login with the real profile data
          const status = real.status;
          let route = '/pending';
          if (status === 'Rejected') route = '/rejected';
          else if (status === 'Inactive') route = '/inactive';
          else if (status === 'Active') route = roleToRoute(real.role || 'User', real.isBvsl, real.isSadhanaMentor);

          return {
            action: 'route',
            route,
            user: {
              userId: real.userId,
              fullName: real.fullName || '',
              role: normalizeRole(real.role || 'User'),
              status: normalizeStatus(status),
              phone: real.phone || '',
              email: real.email || authEmail,
              selectedGuideId: Array.isArray(real.guide) ? real.guide[0] : (real.guide || null),
              selectedFolkResidency: Array.isArray(real.residency) ? real.residency[0] : (real.residency || null),
              residencyUserClaim: real.residencyClaimed || false,
              residencyGuideVerified: real.residencyApproved || false,
              createdAt: real.createdAt || now,
              lastLoginAt: now,
              rowId: 0,
              ashrayLevel: real.ashrayLevel || null,
              residencyName: null,
              guideName: null,
              isBvsl: real.isBvsl || false,
              isSadhanaMentor: real.isSadhanaMentor || false,
            },
          };
        }
      }

      // No matching profile found — check if this is a guide email
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
      limit: 5,
    });
    const isDuplicate = sameIdRecords.some(u => u.id !== context.user.id);

    if (isDuplicate) {
      const prefix = currentUserId.startsWith('GUIDE-') ? 'GUIDE' : 'USER';
      const fixedId = await generateUniqueUserId(prefix as 'USER' | 'GUIDE');
      await Users.update({
        id: context.user.id,
        record: { userId: fixedId },
      }).catch(() => {});
      (userRecord as any).userId = fixedId;
    }

    // Update last login (non-blocking)
    await Users.update({ id: context.user.id, record: { lastLoginAt: now } }).catch(() => {});

    const status = userRecord.status;
    let route = '/pending';
    if (status === 'Rejected') route = '/rejected';
    else if (status === 'Inactive') route = '/inactive';
    else if (status === 'Active') route = roleToRoute(userRecord.role || 'User', userRecord.isBvsl, userRecord.isSadhanaMentor);

    return {
      action: 'route',
      route,
      user: {
        userId: (userRecord as any).userId,
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
      },
    };
  },
});
