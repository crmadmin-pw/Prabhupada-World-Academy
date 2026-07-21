import { z } from 'zod';
import { createEndpoint, Users, Guides } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Check if an email address exists in Users or Guides collection for Sign In vs Registration routing',
  inputSchema: z.object({
    email: z.string().min(1).max(320),
  }),
  outputSchema: z.object({
    exists: z.boolean(),
    role: z.string().optional(),
  }),
  execute: async ({ input }: any) => {
    const emailLower = input.email.trim().toLowerCase();

    // Built-in system emails (Super Guide, Guide, Devotee accounts)
    const systemEmails = [
      'superguide@gmail.com',
      'superguide@prabhupadaworld.org',
      'admin@prabhupadaworld.org',
      'guide@gmail.com',
      'guide@prabhupadaworld.org',
      'devotee@gmail.com',
      'user@gmail.com',
      'user@prabhupadaworld.org'
    ];

    if (systemEmails.includes(emailLower) || emailLower.includes('superguide') || emailLower.includes('admin@prabhupada')) {
      return { exists: true, role: emailLower.includes('guide') ? 'Guide' : 'Super Guide' };
    }

    // Direct query in Users table
    const userMatch = await Users.findOne({ filters: { email: emailLower } });
    if (userMatch) {
      return { exists: true, role: userMatch.role || 'User' };
    }

    // Direct query in Guides table
    const guideMatch = await Guides.findOne({ filters: { email: emailLower } });
    if (guideMatch) {
      return { exists: true, role: 'Guide' };
    }

    // Full table scan fallback (up to 1000 records)
    const { records: userRecords } = await Users.findAll({ limit: 1000 });
    const userScan = userRecords.find(u => (u.email || '').toLowerCase() === emailLower);
    if (userScan) {
      return { exists: true, role: userScan.role || 'User' };
    }

    const { records: guideRecords } = await Guides.findAll({ limit: 1000 });
    const guideScan = guideRecords.find(g => (g.email || '').toLowerCase() === emailLower);
    if (guideScan) {
      return { exists: true, role: 'Guide' };
    }

    return { exists: false };
  },
});
