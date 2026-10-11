import { z } from 'zod';
import { createEndpoint, BvGroups, Users, Guides, AppError } from '@/lib/backend-sdk';
import { facilitatorWrite, type GroupFacilitator } from '@/lib/bvGroupFacilitators';
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
    bvslUserIds: z.array(z.string().min(1)).max(20).optional(),
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

    const directGuideRec = await Guides.findOne({ id: input.guideId, fields: ['id'] });
    if (directGuideRec) {
      guideDbId = directGuideRec.id;
    } else {
      const guideUser = await Users.findOne({ id: input.guideId, fields: ['id', 'email'] });
      if (guideUser?.email) {
        const guideByEmail = await Guides.findOne({ filters: { email: guideUser.email }, fields: ['id'] });
        if (guideByEmail) guideDbId = guideByEmail.id;
      }
      if (!guideDbId) {
        const guideByCustomId = await Guides.findOne({ filters: { guideId: input.guideId }, fields: ['id'] });
        if (guideByCustomId) guideDbId = guideByCustomId.id;
      }
    }

    if (!guideDbId) throw new AppError({ code: 'NOT_FOUND', message: 'Guide not found' });

    const requestedIds = [...new Set([input.bvslUserId, ...(input.bvslUserIds || [])].map((id: string) => id.trim()).filter(Boolean))];
    const facilitators: GroupFacilitator[] = [];
    for (const userId of requestedIds) {
      const bvslUser = await Users.findOne({ id: userId, fields: ['id', 'userId', 'fullName'] });
      if (!bvslUser) throw new AppError({ code: 'NOT_FOUND', message: 'BVSL user not found' });
      facilitators.push({
        id: String(bvslUser.id),
        userId: String(bvslUser.userId || bvslUser.id),
        name: String(bvslUser.fullName || ''),
      });
    }

    const joinToken = generateToken();
    const joinUrl = `${process.env.APP_APP_URL}/join-group?token=${joinToken}`;
    const leaderName = facilitators
      .map(person => nameForWhatsAppInvite(person.name))
      .filter(Boolean)
      .join(' and ');
    const inviteText = `Hare Krishna!\n\nYou are invited to join *${input.groupName}*${leaderName ? ` led by *${leaderName}*` : ''}.\n\nClick to join: ${joinUrl}`;

    const group = await BvGroups.create({
      record: {
        groupName: input.groupName,
        ...facilitatorWrite(facilitators),
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
    await Promise.all(facilitators.map(person => Users.update({ id: person.id, record: { isBvsl: true } })));

    return { success: true, groupId: group.groupId || group.id, groupDbId: group.id, joinToken };
  },
});
