import { z } from 'zod';
import { createEndpoint, BvGroups, Users, Guides, ZiteError } from 'zite-integrations-backend-sdk';

function generateToken(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 16; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

export default createEndpoint({
  description: 'Create a new BV group with auto-generated join token and WhatsApp invite link',
  authenticated: true,
  inputSchema: z.object({
    bvslId: z.string().max(100),
    groupName: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    groupId: z.string().nullable(),
    joinToken: z.string().nullable(),
    whatsAppLink: z.string().nullable(),
  }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const isSuperGuide = context.user.role === 'Super Guide';
    const isGuide = context.user.role === 'Guide';
    // BUG 3 FIX: Check both isBvsl flag AND role === 'BVSL'
    const isBvsl = context.user.isBvsl === true || context.user.role === 'BVSL';

    if (!isGuide && !isSuperGuide && !isBvsl) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide or BVSL access required' });
    }

    // BUG 3 FIX: Try to resolve bvslId as UUID first, then fall back to userId field
    let bvslRecord = await Users.findOne({ id: input.bvslId, fields: ['id', 'guide', 'fullName'] }).catch(() => undefined);
    if (!bvslRecord) {
      bvslRecord = await Users.findOne({ filters: { userId: input.bvslId }, fields: ['id', 'guide', 'fullName'] });
    }
    // Also try as context.user.id (BVSL creating their own group)
    if (!bvslRecord) {
      bvslRecord = await Users.findOne({ id: context.user.id, fields: ['id', 'guide', 'fullName'] });
    }
    if (!bvslRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'BVSL user not found' });

    const guideId = Array.isArray(bvslRecord.guide) ? bvslRecord.guide[0] : bvslRecord.guide;

    const joinToken = generateToken();
    const appUrl = process.env.ZITE_APP_URL ?? 'https://pwac.app';
    const joinUrl = `${appUrl}/join-group?token=${joinToken}`;
    const inviteText = [
      '🙏 Hare Krishna!',
      '',
      `You are invited to join *${input.groupName}* — a Bhakti Vriksha group`,
      bvslRecord.fullName ? `led by *${bvslRecord.fullName}*.` : '',
      '',
      `Click to join: ${joinUrl}`,
    ].filter(Boolean).join('\n');
    const whatsAppLink = `https://wa.me/?text=${encodeURIComponent(inviteText)}`;

    const group = await BvGroups.create({
      record: {
        groupName: input.groupName,
        bvslLeader: bvslRecord.id,
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
