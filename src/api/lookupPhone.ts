import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';
import { enforceRateLimit } from '../utils/rateLimit';

export default createEndpoint({
  description: 'Check if a phone number is registered in the system',
  inputSchema: z.object({
    phone: z.string().min(7).max(20),
    countryCode: z.string().max(5).default('+91'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    status: z.string().optional(), // 'active', 'pending', 'rejected'
  }),
  execute: async ({ input }) => {
    // Rate limit: max 10 phone lookups per minute per phone number (prevents enumeration)
    enforceRateLimit(`lookup:${input.phone.replace(/\D/g, '').slice(-7)}`, 10, 60_000);
    const digits = input.phone.replace(/\D/g, '');
    const withCode = (input.countryCode + digits).replace(/\D/g, '');

    // Search by exact E164 phone or digits only
    const { records } = await Users.findAll({
      filters: { phone: { contains: digits } },
      limit: 5,
      fields: ['id', 'phone', 'status', 'userId'],
    });

    const match = records.find(r => {
      if (!r.phone) return false;
      const rDigits = r.phone.replace(/\D/g, '');
      return rDigits === digits || rDigits === withCode || rDigits.endsWith(digits);
    });

    if (!match || !match.userId) {
      return { found: false };
    }

    const statusMap: Record<string, string> = {
      'Active': 'active',
      'Pending Approval': 'pending',
      'Rejected': 'rejected',
    };

    return {
      found: true,
      status: statusMap[match.status || ''] || 'pending',
    };
  },
});
