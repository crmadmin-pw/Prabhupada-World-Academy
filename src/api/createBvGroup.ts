import { z } from 'zod';
import { createEndpoint, BvGroups, Users, Guides, AppError } from '@/lib/backend-sdk';
import { facilitatorWrite, type GroupFacilitator } from '@/lib/bvGroupFacilitators';
import { generateBvJoinToken } from '@/lib/bvJoinToken';
import { serverCacheInvalidate } from '../lib/serverCache';
import { publishCollectionRevision } from '../lib/publishUsersRevision';

const FACILITATOR_FIELDS = ['id', 'userId', 'fullName', 'email', 'segment', 'isPrabhupadaWorldUser', 'guide', 'bvReportingAdminId', 'bvReportingSupervisorId'];

function explicitSegment(user: any, guide: any): 'PW' | 'FOLK' | null {
  const value = String(user?.segment || guide?.segment || '').trim().toUpperCase();
  if (value === 'PW' || value === 'FOLK') return value;
  if (user?.isPrabhupadaWorldUser === true) return 'PW';
  return null;
}

async function resolveCreateFacilitator(rawId: string) {
  let facilitatorUser =
    await Users.findOne({ id: rawId, fields: FACILITATOR_FIELDS }) ||
    await Users.findOne({ filters: { userId: rawId }, fields: FACILITATOR_FIELDS }) ||
    await Users.findOne({ filters: { email: rawId.toLowerCase() }, fields: FACILITATOR_FIELDS });

  // getGuides() can supply a Guides-table ID. Resolve it through its email
  // to the corresponding Users record when available.
  let facilitatorGuide: any = undefined;
  if (!facilitatorUser) {
    facilitatorGuide =
      await Guides.findOne({ id: rawId, fields: ['id', 'guideId', 'fullName', 'email', 'segment'] }) ||
      await Guides.findOne({ filters: { guideId: rawId }, fields: ['id', 'guideId', 'fullName', 'email', 'segment'] });
    if (facilitatorGuide?.email) {
      facilitatorUser = await Users.findOne({
        filters: { email: facilitatorGuide.email },
        fields: FACILITATOR_FIELDS,
      });
    }
  }

  if (!facilitatorUser && !facilitatorGuide) {
    throw new AppError({ code: 'NOT_FOUND', message: 'Selected RGF was not found' });
  }

  const stored: GroupFacilitator = {
    id: String(facilitatorUser?.id || ''),
    userId: String(facilitatorUser?.userId || facilitatorUser?.id || facilitatorGuide?.guideId || facilitatorGuide?.id || ''),
    name: String(facilitatorUser?.fullName || facilitatorGuide?.fullName || facilitatorUser?.email || facilitatorGuide?.email || rawId),
  };
  return { user: facilitatorUser, guide: facilitatorGuide, stored };
}

export default createEndpoint({
  description: 'Create a new Bhakti Vriksha Reading Group',
  authenticated: true,
  inputSchema: z.object({
    groupName: z.string().min(1).max(200).transform(s => s.trim()),
    bvslId: z.string().min(1).max(200), // Facilitator (RGF) User ID or Email
    bvslIds: z.array(z.string().min(1).max(200)).max(20).optional(),
    meetingTime: z.string().max(100).optional(),
    description: z.string().max(500).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    groupId: z.string(),
  }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const isAuthorized = context.user.role === 'SUPER_GUIDE' ||
      context.user.role === 'GUIDE' ||
      context.user.isBvAdmin ||
      context.user.isBvSuperAdmin;

    if (!isAuthorized) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Admin access required to create Reading Groups' });
    }

    // The UI supplies the app's custom userId, while Firestore relations use
    // the Users document ID. Resolve both forms before creating the group.
    // Falling back to PW here was what made newly-created FOLK groups vanish
    // from FOLK group management and from the member-assignment dropdown.
    const requestedIds = [...new Set([input.bvslId, ...(input.bvslIds || [])].map((id: string) => id.trim()).filter(Boolean))];
    const resolved = [];
    const seen = new Set<string>();
    for (const rawId of requestedIds) {
      const match = await resolveCreateFacilitator(rawId);
      const key = (match.stored.id || match.stored.userId || match.stored.name).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      resolved.push(match);
    }
    if (resolved.length === 0) {
      throw new AppError({ code: 'NOT_FOUND', message: 'Selected RGF was not found' });
    }
    const segments = [...new Set(resolved.map(match => explicitSegment(match.user, match.guide)).filter(Boolean))];
    if (segments.length > 1) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'Choose RGFs from the same department' });
    }

    const primary = resolved[0];
    const facilitatorUser = primary.user;
    const facilitatorGuide = primary.guide;
    const segment = explicitSegment(facilitatorUser, facilitatorGuide) || context.user.segment || 'PW';
    const guideOwnerId = facilitatorUser?.bvReportingSupervisorId ||
      facilitatorUser?.bvReportingAdminId ||
      facilitatorUser?.guide ||
      context.user.userId ||
      context.user.id;
    const storedFacilitators = facilitatorWrite(resolved.map(match => match.stored));

    const groupId = `BV-GROUP-${Date.now()}`;
    const newGroup = {
      id: groupId,
      groupId,
      groupName: input.groupName,
      ...storedFacilitators,
      guide: guideOwnerId || undefined,
      meetingTime: input.meetingTime || '',
      description: input.description || '',
      isActive: true,
      segment,
      joinToken: generateBvJoinToken(),
      createdAt: new Date().toISOString(),
    };

    await BvGroups.create({ record: newGroup });
    // Invalidate the admin group-list cache so the new group appears immediately.
    serverCacheInvalidate('allBvGroupsAdmin:');
    await publishCollectionRevision('BvGroups', newGroup.id);

    return {
      success: true,
      groupId,
    };
  },
});
