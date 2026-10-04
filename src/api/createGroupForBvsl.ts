import { z } from 'zod';
import { createEndpoint, BvGroups, Users, Guides, AppError } from '@/lib/backend-sdk';
import { nameForWhatsAppInvite } from '@/lib/userUtils';

function generateToken(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let t = '';
  for (let i = 0; i < 16; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}

export default createEndpoint({
  description: 'Guide creates a BV group on behalf of a BVSL user (auto-tags user as BVSL)',
  authenticated: true,
  inputSchema: z.object({
    bvslUserId: z.string(),         // DB record ID of the user who will be BVSL leader
    guideId: z.string(),            // Guide's custom ID or DB UUID
    groupName: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
    meetingTime: z.string().max(100).optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), groupId: z.string(), groupDbId: z.string(), joinToken: z.string() }),
  execute: async ({ input, context }: any) => {
    const callerRole = context.user!.role || '';
    const isBvMentor = !!(context.user as any).isBvMentor;
    if (!['Guide', 'Super Guide'].includes(callerRole) && !isBvMentor) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only guides can create groups on behalf of BVSLs' });
    }

    // Robust 3-step guide ID resolution (handles Users-table UUID, Guides-table UUID, or custom ID)
    let guideDbId: string | null = null;

    const directGuideRec = await Guides.findOne({ id: input.guideId, fields: ['id'] }).catch(() => undefined);
    if (directGuideRec) {
      guideDbId = directGuideRec.id;
    } else {
      const guideUser = await Users.findOne({ id: input.guideId, fields: ['id', 'email'] }).catch(() => undefined);
      if (guideUser?.email) {
        const guideByEmail = await Guides.findOne({ filters: { email: guideUser.email }, fields: ['id'] }).catch(() => undefined);
        if (guideByEmail) guideDbId = guideByEmail.id;
      }
      if (!guideDbId) {
        const guideByCustomId = await Guides.findOne({ filters: { guideId: input.guideId }, fields: ['id'] }).catch(() => undefined);
        if (guideByCustomId) guideDbId = guideByCustomId.id;
      }
    }

    if (!guideDbId) throw new AppError({ code: 'NOT_FOUND', message: 'Guide not found' });

    const bvslUser = await Users.findOne({ id: input.bvslUserId, fields: ['id', 'fullName'] });
    if (!bvslUser) throw new AppError({ code: 'NOT_FOUND', message: 'BVSL user not found' });

    const joinToken = generateToken();
    const joinUrl = `${process.env.APP_APP_URL}/join-group?token=${joinToken}`;
    const leaderName = nameForWhatsAppInvite(bvslUser.fullName);
    const inviteText = `Hare Krishna!\n\nYou are invited to join *${input.groupName}*${leaderName ? ` led by *${leaderName}*` : ''}.\n\nClick to join: ${joinUrl}`;

    const group = await BvGroups.create({
      record: {
        groupName: input.groupName,
        bvslLeader: input.bvslUserId,
        guide: guideDbId,
        description: input.description || '',
        meetingTime: input.meetingTime || '',
        isActive: true,
        joinToken,
        whatsAppLink: `https://wa.me/?text=${encodeURIComponent(inviteText)}`,
        createdAt: new Date().toISOString(),
      },
    });

    // Auto-tag as BVSL if not already
    await Users.update({ id: input.bvslUserId, record: { isBvsl: true } });

    return { success: true, groupId: group.groupId || group.id, groupDbId: group.id, joinToken };
  },
});
