import { z } from 'zod';
import { createEndpoint, Meetings, Users, AppError } from '@/lib/backend-sdk';
import { pastMeetingTimeMessage } from '@/lib/meetingReminderSchedule';

export default createEndpoint({
  description: 'Update a meeting or trigger instant reminder notification',
  authenticated: true,
  requiredCapabilities: 'meetings.manage',
  inputSchema: z.object({
    meetingId: z.string().min(1),
    title: z.string().optional(),
    type: z.enum(['FACILITATOR', 'EXECUTIVE', 'OTHER']).optional(),
    scheduledAt: z.string().optional(),
    durationMinutes: z.number().int().positive().optional(),
    locationOrLink: z.string().optional(),
    description: z.string().optional(),
    status: z.string().optional().nullable().transform(v => {
      if (!v) return undefined;
      const s = v.toUpperCase();
      if (s === 'SCHEDULED' || s === 'IN_PROGRESS' || s === 'COMPLETED' || s === 'CANCELLED') {
        return s as 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
      }
      return undefined;
    }),
    additionalInviteeIds: z.array(z.string()).optional(),
    sendReminderNow: z.boolean().optional().default(false),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (!context.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });

    const userEmail = (context.user.email || '').toLowerCase();
    const callerRole = String(context.user.role || '').toUpperCase().replace(/[\s-]+/g, '_');

    const isSuperAdminOrAdmin = !!(
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

    const existing = await Meetings.findOne({ id: input.meetingId });
    if (!existing) {
      throw new AppError({ code: 'NOT_FOUND', message: 'Meeting not found' });
    }

    const meetingSegment = String(existing.segment || 'PW').trim().toUpperCase();
    if (normalizedSegment === 'FOLK' || meetingSegment === 'FOLK') {
      throw new AppError({ code: 'FORBIDDEN', message: 'Meetings and MoMs are available only in Prabhupada World' });
    }

    if (!isSuperAdminOrAdmin || isReadOnlySadhanaMentor) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only Admins and Super Admins can edit meeting details' });
    }

    const updateFields: any = { updatedAt: new Date().toISOString() };
    if (input.title !== undefined) updateFields.title = input.title;
    if (input.durationMinutes !== undefined) updateFields.durationMinutes = input.durationMinutes;
    if (input.scheduledAt !== undefined && input.scheduledAt !== existing.scheduledAt) {
      const pastTime = pastMeetingTimeMessage(input.scheduledAt);
      if (pastTime) throw new AppError({ code: 'BAD_REQUEST', message: pastTime });
      updateFields.scheduledAt = input.scheduledAt;
      updateFields.notification10mSent = false;
      updateFields.notification1mSent = false;
      updateFields.notificationSent = false;
    }
    if (input.locationOrLink !== undefined) updateFields.locationOrLink = input.locationOrLink;
    if (input.description !== undefined) updateFields.description = input.description;
    if (input.status !== undefined) updateFields.status = input.status;

    // Recalculate invitees if type or additionalInviteeIds are updated
    if (input.type !== undefined || input.additionalInviteeIds !== undefined) {
      const activeType = input.type !== undefined ? input.type : (existing.type || 'OTHER');
      const activeAdditionalIds = input.additionalInviteeIds !== undefined ? input.additionalInviteeIds : (existing.inviteeUserIds || []);

      const inviteeIdsArray = Array.from(new Set<string>(activeAdditionalIds));

      // Fetch details of all invitees
      let invitees: any[] = [];
      if (inviteeIdsArray.length > 0) {
        const batches = await Promise.all(Array.from({ length: Math.ceil(inviteeIdsArray.length / 30) }, (_, index) =>
          Users.findAll({ filters: { id: { in: inviteeIdsArray.slice(index * 30, index * 30 + 30) } },
            fields: ['id', 'fullName', 'email', 'role'], limit: 30 })));
        const inviteeUsers = batches.flatMap(batch => batch.records);
        invitees = inviteeUsers.map(u => ({
          userId: u.id,
          fullName: u.fullName || u.email || 'Devotee',
          email: u.email || '',
          role: u.role || 'Member',
        }));
      }

      updateFields.type = activeType;
      updateFields.inviteeUserIds = inviteeIdsArray;
      updateFields.invitees = invitees;
      if (JSON.stringify([...inviteeIdsArray].sort()) !== JSON.stringify([...(existing.inviteeUserIds || [])].sort())) {
        // Reconcile new participants; durable per-device checkpoints prevent repeat sends.
        updateFields.notification1mSent = false;
        updateFields.notification10mSent = false;
      }
    }

    if (input.sendReminderNow) {
      updateFields.notificationSent = true;
      updateFields.lastNotificationSentAt = new Date().toISOString();
    }

    await Meetings.update({ id: input.meetingId, record: updateFields });

    let message = 'Meeting updated successfully!';
    if (input.sendReminderNow) {
      message = `Instant meeting reminder sent to all ${(existing.inviteeUserIds || []).length} invitees!`;
    }

    return { success: true, message };
  },
});
