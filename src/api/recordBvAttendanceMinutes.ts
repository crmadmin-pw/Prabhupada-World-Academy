import { z } from 'zod';
import { createEndpoint, SadhanaEntries, Users, AppError } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, isUserInHierarchy } from '@/lib/hierarchyUtils';
import { isPwSadhanaUser } from '@/lib/sadhanaDepartment';
import { pwTarget, readPwTargets, scoreStoredPwDay } from '@/lib/pwSadhana';
import { isPwAdmin, isPwRgf, isPwRgsf, resolvePwTargetsForUser } from '@/lib/pwTargetResolver';
import { refreshUserPeriodSummaries } from '@/lib/sadhanaPeriodSummary';

const USER_FIELDS = ['id', 'userId', 'email', 'segment', 'isPrabhupadaWorldUser', 'role', 'status',
  'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator', 'isBvSupervisor', 'isBvMember', 'bvGroupId',
  'sadhanaMentor', 'ashrayLevel', 'pwTargets', 'pwChantingTarget', 'pwReadingTarget', 'pwPendingBvAttendance'];

function parseValues(value: unknown): Record<string, any> {
  if (typeof value === 'string') {
    try { return JSON.parse(value) || {}; } catch { return {}; }
  }
  return value && typeof value === 'object' ? { ...(value as Record<string, any>) } : {};
}

export default createEndpoint({
  description: 'Record Bhakti Vriksha attendance minutes and rescore that sadhana day',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string().min(1),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    attendedMinutes: z.number().int().min(0).max(1440).nullable(),
    sessionMinutes: z.number().int().min(0).max(1440).nullable(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!isPwRgf(context.user) && !isPwRgsf(context.user) && !isPwAdmin(context.user)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'An RGF or RGSF records Bhakti Vriksha attendance minutes' });
    }
    const member = await Users.findOne({ id: input.userId, fields: USER_FIELDS })
      || await Users.findOne({ filters: { userId: input.userId }, fields: USER_FIELDS });
    if (!member) throw new AppError({ code: 'NOT_FOUND', message: 'Member not found' });
    if (!isPwSadhanaUser(member) && String(member.segment || '').toUpperCase() === 'FOLK') {
      throw new AppError({ code: 'FORBIDDEN', message: 'Attendance minutes apply to Prabhupada World members' });
    }
    const scope = await getScopedHierarchyUserIds(context.user);
    if (!isUserInHierarchy(member, scope)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'You can only record attendance for your own members' });
    }

    const attended = input.attendedMinutes == null ? null : pwTarget(input.attendedMinutes) ?? 0;
    const session = input.sessionMinutes == null ? null : pwTarget(input.sessionMinutes);
    const entry = await SadhanaEntries.findOne({
      filters: { user: member.id, entryDate: input.entryDate },
      fields: ['id', 'entryId', 'entryDate', 'submittedAt', 'fieldValuesJson', 'user'],
    });
    if (!entry) {
      const pending = { ...(member.pwPendingBvAttendance || {}) };
      if (session == null) delete pending[input.entryDate];
      else pending[input.entryDate] = { attended: attended ?? 0, session, setBy: context.user.id };
      await Users.update({ id: member.id, record: { pwPendingBvAttendance: pending } });
      return { success: true, pending: true, scorePercent: null };
    }

    const stored = parseValues(entry.fieldValuesJson);
    if (session == null) {
      delete stored.bvAttendedMinutes;
      delete stored.bvSessionMinutes;
    } else {
      stored.bvAttendedMinutes = attended ?? 0;
      stored.bvSessionMinutes = session;
    }
    const meta = stored._meta && typeof stored._meta === 'object' ? stored._meta : {};
    const resolved = meta.pwVersion === 2 && meta.pwTargets
      ? { targets: readPwTargets(meta.pwTargets), source: String(meta.pwTargetSource || 'rgf'), deadline: String(meta.pwSubmissionDeadline || '10:00') }
      : await resolvePwTargetsForUser(member);
    const scored = scoreStoredPwDay(stored, {
      targets: resolved.targets,
      source: resolved.source,
      deadline: resolved.deadline,
      submittedAt: entry.submittedAt || null,
      entryDate: input.entryDate,
    });
    stored._meta = scored.meta;
    await SadhanaEntries.update({
      id: entry.id,
      record: {
        fieldValuesJson: JSON.stringify(stored),
        totalScore: scored.result.earned,
        maxScore: scored.result.applicableMax,
        scorePercent: scored.result.scorePercent ?? 0,
      },
    });
    await refreshUserPeriodSummaries({ userId: member.id, entryDate: input.entryDate });
    return { success: true, pending: false, scorePercent: scored.result.scorePercent, earned: scored.result.earned, applicableMax: scored.result.applicableMax };
  },
});
