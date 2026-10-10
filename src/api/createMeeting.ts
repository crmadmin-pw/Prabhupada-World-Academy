import { z } from 'zod';
import { createEndpoint, Meetings, Users, AppError } from '@/lib/backend-sdk';
import { pastMeetingTimeMessage } from '@/lib/meetingReminderSchedule';

export default createEndpoint({
  description: 'Create a new Prabhupada World meeting (Facilitators, Executive, or Other)',
  authenticated: true,
  requiredCapabilities: 'meetings.manage',
  inputSchema: z.object({
    title: z.string().min(1, 'Meeting title is required'),
    type: z.enum(['FACILITATOR', 'EXECUTIVE', 'OTHER']),
    scheduledAt: z.string(),
    durationMinutes: z.number().default(60),
    locationOrLink: z.string().optional().default(''),
    description: z.string().optional().default(''),
    notificationLeadMinutes: z.number().default(10),
    additionalInviteeIds: z.array(z.string()).optional().default([]),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    meetingId: z.string(),
    message: z.string(),
  }),
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (!context.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });

    const userEmail = (context.user.email || '').toLowerCase();
    const callerRole = String(context.user.role || '').toUpperCase().replace(/[\s-]+/g, '_');

    const isAuthorized = !!(
      context.user.isBvSuperAdmin ||
      context.user.isBvAdmin ||
      context.user.isPwAdmin ||
      ['ADMIN', 'PW_ADMIN', 'SUPER_ADMIN', 'SUPER_GUIDE'].includes(callerRole)
    );

    const normalizedSegment = String(context.user.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    const isPwUser = normalizedSegment === 'PW' || normalizedSegment === 'PRABHUPADAWORLD';
    const isReadOnlySadhanaMentor = isPwUser && !!(
      context.user.isSadhanaMentor || callerRole === 'SADHANA_MENTOR'
    );

    if (!isAuthorized || isReadOnlySadhanaMentor || normalizedSegment === 'FOLK') {
      throw new AppError({ code: 'FORBIDDEN', message: 'Meetings and MoMs are available only in Prabhupada World' });
    }

    const pastTime = pastMeetingTimeMessage(input.scheduledAt);
    if (pastTime) throw new AppError({ code: 'BAD_REQUEST', message: pastTime });

    const inviteeIdsArray = Array.from(new Set<string>(input.additionalInviteeIds || []));

    // Fetch details of all invitees
    let invitees: any[] = [];
    if (inviteeIdsArray.length > 0) {
      const inviteeChunks = Array.from({ length: Math.ceil(inviteeIdsArray.length / 30) }, (_, index) =>
        inviteeIdsArray.slice(index * 30, index * 30 + 30)
      );
      const inviteeBatches = await Promise.all(inviteeChunks.map(ids => Users.findAll({
        filters: { id: { in: ids } }, fields: ['id', 'fullName', 'email', 'role'], limit: ids.length,
      })));
      const inviteeUsers = inviteeBatches.flatMap(batch => batch.records || []);
      invitees = inviteeUsers.map(u => ({
        userId: u.id,
        fullName: u.fullName || u.email || 'Devotee',
        email: u.email || '',
        role: u.role || 'Member',
      }));
    }

    const creatorName = context.user.fullName || context.user.email || 'Admin';

    const meetingDoc = {
      title: input.title.trim(),
      type: input.type,
      segment: 'PW',
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      locationOrLink: input.locationOrLink.trim(),
      description: input.description.trim(),
      createdByUserId: context.user.id || '',
      createdByName: creatorName,
      createdByRole: callerRole,
      inviteeUserIds: inviteeIdsArray,
      invitees,
      notificationLeadMinutes: input.notificationLeadMinutes,
      notificationSent: false,
      notification10mSent: false,
      notification1mSent: false,
      status: 'SCHEDULED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const res = await Meetings.create({ record: meetingDoc });

    return {
      success: true,
      meetingId: res.id,
      message: `Meeting "${input.title}" scheduled successfully!`,
    };
  },
});
