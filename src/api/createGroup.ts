import { z } from 'zod';
import { createEndpoint, BvGroups, Users, ZiteError } from 'zite-integrations-backend-sdk';

function generateToken(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 16; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

export default createEndpoint({
  description: 'Create a new BV group (same logic as createBvGroup)',
  authenticated: true,
  inputSchema: z.object({
    bvslId: z.string().optional(),
    groupName: z.string(),
    description: z.string().optional(),
    guideId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const isSuperGuide = context.user.role === 'Super Guide';
    const isGuide = context.user.role === 'Guide';
    // BUG 3 FIX: Check both isBvsl flag AND role === 'BVSL'
    const isBvsl = context.user.isBvsl === true || context.user.role === 'BVSL';

    if (!isGuide && !isSuperGuide && !isBvsl) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide or BVSL access required' });
    }

    let bvslDbId: string | null = null;
    let guideId: string | undefined = input.guideId;

    if (input.bvslId) {
      // BUG 3 FIX: Try UUID first, then userId field
      let bvslRecord = await Users.findOne({ id: input.bvslId, fields: ['id', 'guide', 'fullName'] }).catch(() => undefined);
      if (!bvslRecord) {
        bvslRecord = await Users.findOne({ filters: { userId: input.bvslId }, fields: ['id', 'guide', 'fullName'] });
      }
      if (bvslRecord) {
        bvslDbId = bvslRecord.id;
        if (!guideId) {
          guideId = Array.isArray(bvslRecord.guide) ? bvslRecord.guide[0] : bvslRecord.guide as string;
        }
      }
    }

    // If still no bvslDbId, use the calling user
    if (!bvslDbId && isBvsl) {
      bvslDbId = context.user.id;
    }

    const joinToken = generateToken();
    const appUrl = process.env.ZITE_APP_URL ?? 'https://pwac.app';
    const joinUrl = `${appUrl}/join-group?token=${joinToken}`;
    const whatsAppLink = `https://wa.me/?text=${encodeURIComponent(`🙏 Hare Krishna!\n\nYou are invited to join *${input.groupName}*.\n\nClick to join: ${joinUrl}`)}`;

    const group = await BvGroups.create({
      record: {
        groupName: input.groupName,
        bvslLeader: bvslDbId || undefined,
        guide: guideId || undefined,
        description: input.description || '',
        isActive: true,
        joinToken,
        whatsAppLink,
        createdAt: new Date().toISOString(),
      },
    });

    return {
      success: true,
      groupId: group.groupId || group.id,
      joinToken,
      whatsAppLink,
    };
  },
});
