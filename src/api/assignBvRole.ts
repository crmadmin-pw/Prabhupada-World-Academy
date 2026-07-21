import { z } from 'zod';
import { createEndpoint, Users, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Assign or update Bhakti Vriksha roles for a user (Supervisor, Facilitator/RGF, Sub-Facilitator/RGSF, Admin)',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string().min(1),
    role: z.enum(['SUPERVISOR', 'FACILITATOR', 'SUB_FACILITATOR', 'ADMIN', 'MEMBER']),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const userEmail = (context.user.email || '').toLowerCase();
    const isAuthorized = context.user.role === 'SUPER_GUIDE' ||
      context.user.role === 'GUIDE' ||
      userEmail === 'srilaprabhupadaworld@gmail.com' ||
      context.user.isBvAdmin ||
      context.user.isBvSuperAdmin;

    if (!isAuthorized) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Admin access required to assign BV roles' });
    }

    const targetUser = await Users.findOne({ id: input.userId });
    if (!targetUser) {
      throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    const ROLE_LABELS: Record<string, string> = {
      SUPERVISOR: 'BV Supervisor',
      FACILITATOR: 'Reading Group Facilitator (RGF)',
      SUB_FACILITATOR: 'Reading Group Sub-Facilitator (RGSF)',
      ADMIN: 'BV Admin',
      MEMBER: 'Regular Member',
    };

    const updates: any = {
      isBvSupervisor: input.role === 'SUPERVISOR',
      isBvFacilitator: input.role === 'FACILITATOR',
      isBvSubFacilitator: input.role === 'SUB_FACILITATOR',
      isBvAdmin: input.role === 'ADMIN',
      pendingRoleNotice: ROLE_LABELS[input.role] || input.role,
      roleNoticeAcknowledged: false,
    };

    // Keep role string in sync
    if (input.role === 'FACILITATOR') {
      updates.isBvsl = true;
    } else if (input.role === 'SUB_FACILITATOR') {
      updates.isBvsl = false;
    }
    if (input.role === 'SUPERVISOR') {
      updates.isBvMentor = true;
    }

    await Users.update({ id: input.userId, record: updates });

    return {
      success: true,
      message: `Updated ${targetUser.fullName || targetUser.email} role to ${input.role}`,
    };
  },
});
