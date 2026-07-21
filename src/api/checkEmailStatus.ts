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

    // Check Users table
    const { records: userRecords } = await Users.findAll({
      fields: ['id', 'email', 'userId', 'role', 'status'],
      limit: 100,
    });
    const userMatch = userRecords.find(u => (u.email || '').toLowerCase() === emailLower);

    if (userMatch) {
      return { exists: true, role: userMatch.role || 'User' };
    }

    // Check Guides table
    const { records: guideRecords } = await Guides.findAll({
      fields: ['id', 'email', 'fullName', 'guideId'],
      limit: 100,
    });
    const guideMatch = guideRecords.find(g => (g.email || '').toLowerCase() === emailLower);

    if (guideMatch) {
      return { exists: true, role: 'Guide' };
    }

    return { exists: false };
  },
});
