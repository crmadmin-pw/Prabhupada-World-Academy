import { z } from 'zod';
import { createEndpoint, Users, BvMemberRegistrations, AppError } from '@/lib/backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';
import { publishCollectionRevision, publishUsersRevision } from '../lib/publishUsersRevision';

function isAtLeastFourteen(value: string): boolean {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return false;

  const [, day, month, year] = match;
  const birthDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    birthDate.getUTCFullYear() !== Number(year) ||
    birthDate.getUTCMonth() !== Number(month) - 1 ||
    birthDate.getUTCDate() !== Number(day)
  ) return false;

  const latestAllowedBirthDate = new Date();
  latestAllowedBirthDate.setUTCHours(0, 0, 0, 0);
  latestAllowedBirthDate.setUTCFullYear(latestAllowedBirthDate.getUTCFullYear() - 14);
  return birthDate <= latestAllowedBirthDate;
}

export default createEndpoint({
  description: 'Register user for Bhakti Vriksha Reading Group — submits detailed profile, spiritual habits & preferences for Admin approval',
  authenticated: true,
  inputSchema: z.object({
    fullName: z.string().min(1).max(200),
    phoneCountryCode: z.string().max(10),
    phone: z.string().min(7).max(25),
    whatsappCountryCode: z.string().max(10),
    whatsappNumber: z.string().min(7).max(25),
    address: z.string().max(500).optional(),
    occupation: z.string().max(200).optional(),
    companyName: z.string().max(200).optional(),
    dob: z.string().min(10).max(20),
    gender: z.enum(['Male', 'Female', 'Other']).optional(),
    dailyChantingRounds: z.union([z.string(), z.number()]).optional(),
    weeklyReadingHours: z.string().max(100).optional(),
    weeklyHearingHours: z.string().max(100).optional(),
    ashrayLevel: z.string().max(100),
    pwClassesAttending: z.string().max(100),
    inTouchWithTemple: z.boolean(),
    templeName: z.string().max(200).optional(),
    devoteeName: z.string().max(200).optional(),
    timePreference: z.string().max(200),
    segment: z.enum(['PW', 'FOLK']).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    registrationId: z.string(),
    status: z.string(),
  }),
  execute: async ({ input, context }: any) => {
    if (!isAtLeastFourteen(input.dob)) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'Participants must be at least 14 years old.' });
    }

    const userId = context.user.id;
    const userEmail = (context.user.email || '').toLowerCase();
    const phoneE164 = `${input.phoneCountryCode}${input.phone.replace(/\D/g, '')}`;
    const whatsappE164 = `${input.whatsappCountryCode}${input.whatsappNumber.replace(/\D/g, '')}`;

    let userRecord = await Users.findOne({
      id: userId,
      fields: ['id', 'userId', 'isPrabhupadaWorldUser', 'segment', 'guide', 'selectedGuideId', 'guideName'],
    }).catch(() => null);

    if (!userRecord && userEmail) {
      userRecord = await Users.findOne({ filters: { email: userEmail } }).catch(() => null);
    }

    const isPwByGuide = !!(userRecord?.isPrabhupadaWorldUser) || userRecord?.segment === 'PW';
    const segment = input.segment || userRecord?.segment || (isPwByGuide ? 'PW' : 'FOLK');
    const isPw = segment === 'PW';

    const registrationRecord = {
      id: `BVREG-${userId}`,
      userId: userRecord?.userId || userId,
      userDbId: userRecord?.id || userId,
      email: userEmail,
      fullName: input.fullName,
      phoneCountryCode: input.phoneCountryCode,
      phone: input.phone,
      phoneE164,
      whatsappCountryCode: input.whatsappCountryCode,
      whatsappNumber: input.whatsappNumber,
      whatsappE164,
      address: input.address || '',
      occupation: input.occupation || '',
      companyName: input.companyName || '',
      dob: input.dob || '',
      gender: input.gender || 'Male',
      dailyChantingRounds: String(input.dailyChantingRounds || '0'),
      weeklyReadingHours: input.weeklyReadingHours || '',
      weeklyHearingHours: input.weeklyHearingHours || '',
      ashrayLevel: input.ashrayLevel,
      pwClassesAttending: input.pwClassesAttending,
      inTouchWithTemple: input.inTouchWithTemple,
      templeName: input.templeName || '',
      devoteeName: input.devoteeName || '',
      timePreference: input.timePreference,
      isPrabhupadaWorldUser: isPw,
      segment: segment,
      status: 'Pending Approval',
      submittedAt: new Date().toISOString(),
    };

    // Upsert registration in database
    const existing = await BvMemberRegistrations.findOne({ id: registrationRecord.id }).catch(() => null);
    if (existing) {
      await BvMemberRegistrations.update({ id: registrationRecord.id, record: registrationRecord });
    } else {
      await BvMemberRegistrations.create({ record: registrationRecord });
    }

    // Update main User record with spiritual & profile fields
    const targetId = userRecord?.id || userId;
    await Users.update({
      id: targetId,
      record: {
        fullName: input.fullName,
        phone: input.phone,
        ashrayLevel: input.ashrayLevel === 'none' ? null : input.ashrayLevel,
        bvRegistrationStatus: 'Pending Approval',
        segment: segment,
        isPrabhupadaWorldUser: isPw,
      },
    }).catch(() => {});

    serverCacheInvalidate(profileCacheKey(userId));
    await publishCollectionRevision('BvMemberRegistrations', registrationRecord.id);
    await publishUsersRevision(targetId);

    return {
      success: true,
      registrationId: registrationRecord.id,
      status: 'Pending Approval',
    };
  },
});
