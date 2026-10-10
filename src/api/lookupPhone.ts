import { z } from 'zod';
import { createEndpoint, Users, AppError } from '@/lib/backend-sdk';
import { enforceRateLimit } from '../utils/rateLimit';

const LOOKUP_LIMIT = 5;
const LOOKUP_WINDOW_MS = 60 * 60 * 1000;

function digitsOf(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function samePhone(stored: unknown, digits: string, withCode: string): boolean {
  const storedDigits = digitsOf(stored);
  if (storedDigits.length < 10 || digits.length < 10) return false;
  return storedDigits === digits || storedDigits === withCode;
}

function canSeeStatus(user: { capabilities?: string[] }, ownPhone: boolean): boolean {
  if (ownPhone) return true;
  const capabilities = user.capabilities || [];
  return capabilities.includes('*') || capabilities.includes('users.approve');
}

export default createEndpoint({
  description: 'Check if a phone number is registered in the system',
  authenticated: true,
  inputSchema: z.object({
    phone: z.string().min(7).max(20),
    countryCode: z.string().max(5).default('+91'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    status: z.string().optional(), // 'active', 'pending', 'rejected'
  }),
  execute: async ({ input, context }: any) => {
    const caller = context.user;
    if (!caller?.emailVerified || !caller.isRegistered || !caller.isActive) {
      throw new AppError({
        code: 'FORBIDDEN',
        message: 'A verified active account is required before a phone number can be checked.',
      });
    }

    // One person, not one target number. A shared allowance stops a member
    // from walking through a list of phones.
    await enforceRateLimit(`lookup-user:${caller.id}`, LOOKUP_LIMIT, LOOKUP_WINDOW_MS);

    const digits = digitsOf(input.phone);
    const withCode = digitsOf(`${input.countryCode || ''}${digits}`);
    if (digits.length < 10) return { found: false };

    const callerRecord = await Users.findOne({
      id: caller.id,
      fields: ['id', 'phone', 'userId'],
    });
    const ownPhone = samePhone(callerRecord?.phone, digits, withCode);

    const storedForms = [...new Set([digits, withCode, withCode ? `+${withCode}` : ''].filter(Boolean))];
    const pages = await Promise.all(storedForms.map(phone =>
      Users.findAll({
        filters: { phone },
        limit: 5,
        fields: ['id', 'phone', 'status', 'userId'],
      }),
    ));
    const match = pages.flatMap(page => page.records || []).find(record =>
      record?.userId && samePhone(record.phone, digits, withCode),
    );

    if (!match) return { found: false };
    if (!canSeeStatus(caller, ownPhone || match.id === caller.id)) return { found: true };

    const statusMap: Record<string, string> = {
      Active: 'active',
      'Pending Approval': 'pending',
      Rejected: 'rejected',
    };
    return {
      found: true,
      status: statusMap[match.status || ''] || 'pending',
    };
  },
});
