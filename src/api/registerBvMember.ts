import { z } from 'zod';
import { createEndpoint, Users, BvMemberRegistrations, ZiteError } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';

export default createEndpoint({
  description: 'Register user for Bhakti Vriksha Reading Group — submits detailed profile, spiritual habits & preferences for Admin approval',
  authenticated: true,
  inputSchema: z.object({
    fullName: z.string().min(1).max(200),
    phoneCountryCode: z.string().max(10),
    phone: z.string().min(7).max(25),
    address: z.string().max(500).optional(),
    occupation: z.string().max(200).optional(),
    companyName: z.string().max(200).optional(),
    dob: z.string().max(20).optional(),
    gender: z.enum(['Male', 'Female', 'Other']).optional(),
    dailyChantingRounds: z.union([z.string(), z.number()]).optional(),
    weeklyReadingHours: z.string().max(100).optional(),
    weeklyHearingHours: z.string().max(100).optional(),
    ashrayLevel: z.string().max(100),
    pwClassesAttending: z.enum(['5.30 a.m.', '9.30 a.m.', 'Tuesday weekly special', 'none']),
    inTouchWithTemple: z.boolean(),
    templeName: z.string().max(200).optional(),
    devoteeName: z.string().max(200).optional(),
    timePreference: z.string().max(200),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    registrationId: z.string(),
    status: z.string(),
  }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');

    const userId = context.user.id;
    const userEmail = (context.user.email || '').toLowerCase();
    const phoneE164 = `${input.phoneCountryCode}${input.phone.replace(/\D/g, '')}`;

    const registrationRecord = {
      id: `BVREG-${userId}`,
      userId,
      email: userEmail,
      fullName: input.fullName,
      phoneCountryCode: input.phoneCountryCode,
      phone: input.phone,
      phoneE164,
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
    await Users.update({
      id: userId,
      record: {
        fullName: input.fullName,
        phone: input.phone,
        ashrayLevel: input.ashrayLevel === 'none' ? null : input.ashrayLevel,
        bvRegistrationStatus: 'Pending Approval',
      },
    }).catch(() => {});

    serverCacheInvalidate(profileCacheKey(userId));

    return {
      success: true,
      registrationId: registrationRecord.id,
      status: 'Pending Approval',
    };
  },
});
