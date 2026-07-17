import { z } from 'zod';
import { createEndpoint, Users, Guides } from 'zite-integrations-backend-sdk';
import { normalizeRole, normalizeStatus } from './resolveUserLogin';
import { generateUniqueUserId } from '../lib/userIdGen';

export default createEndpoint({
  description: 'Resolve guide login — find Guides record by email, update Users record',
  authenticated: true,
  inputSchema: z.object({ email: z.string().email().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    if (!context.user) throw new Error('Unauthorized');
    // Find guide by email — don't filter on isActive strictly (null means not set, treat as active)
    const guideRecord = await Guides.findOne({
      filters: { email: context.user.email },
    }) ?? await Guides.findOne({
      filters: { email: context.user.email.toLowerCase() },
    });

    if (!guideRecord) {
      return { success: false, message: 'Guide access not found for this account. Please ensure your email matches the registered guide email.' };
    }

    const userRecord = await Users.findOne({ id: context.user.id });
    const existingRole = userRecord?.role;
    // Guide with guideId "000" is always Super Guide
    const isSuperGuide = guideRecord.guideId === 'GUIDE-000' || existingRole === 'Super Guide';
    const role = isSuperGuide ? 'Super Guide' : 'Guide';

    // Resolve userId: prefer the canonical guideId from the Guides table (GUIDE-XXX).
    // Fall back to generating a new race-condition-proof unique ID.
    let resolvedUserId = userRecord?.userId ? String(userRecord.userId) : '';
    const guideIdFromRecord = guideRecord.guideId as string | undefined;

    if (guideIdFromRecord && /^GUIDE-\d+$/.test(guideIdFromRecord)) {
      // Always sync to the canonical ID from the Guides table
      resolvedUserId = guideIdFromRecord;
    } else if (!resolvedUserId || !/^(USER|GUIDE)-\d+$/.test(resolvedUserId)) {
      // No valid ID yet — generate a unique GUIDE-XXX
      resolvedUserId = await generateUniqueUserId('GUIDE');
    }

    await Users.update({
      id: context.user.id,
      record: {
        userId: resolvedUserId,
        fullName: guideRecord.fullName || userRecord?.fullName || '',
        email: context.user.email,
        role,
        status: 'Active',
        lastLoginAt: new Date().toISOString(),
      },
    });

    const route = role === 'Super Guide' ? '/super/dashboard' : '/guide/dashboard';

    return {
      success: true,
      route,
      userData: {
        userId: resolvedUserId,
        fullName: guideRecord.fullName || '',
        role: normalizeRole(role),
        status: normalizeStatus('Active'),
        phone: guideRecord.phone || '',
        email: context.user.email,
        selectedGuideId: null,
        selectedFolkResidency: null,
        residencyUserClaim: false,
        residencyGuideVerified: null,
        createdAt: userRecord?.createdAt || new Date().toISOString(),
        lastLoginAt: null,
        rowId: 0,
        ashrayLevel: null,
        residencyName: null,
        guideName: null,
        isBvsl: userRecord?.isBvsl || false,
        isSadhanaMentor: userRecord?.isSadhanaMentor || false,
      },
    };
  },
});
