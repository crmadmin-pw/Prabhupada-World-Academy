import { z } from 'zod';
import { createEndpoint, AppError, AttendanceSessions } from '@/lib/backend-sdk';

function generateToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 24; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

export default createEndpoint({
  authenticated: true,
  description: 'Create an attendance session for an event',
  inputSchema: z.object({
    eventId: z.string(),
    name: z.string(),
    challengeEnabled: z.boolean().optional(),
    challengeTitle: z.string().optional(),
    challengeDescription: z.string().optional(),
    challengeInstructions: z.string().optional(),
    challengeDays: z.number().optional(),
  }),
  outputSchema: z.object({ id: z.string(), shareToken: z.string() }),
  execute: async ({ input, context }) => {
    const userRole = (context.user?.role || '').toUpperCase();
    const user = context.user as any;
    const isAuthorized = [
      'GUIDE', 'SUPER_GUIDE', 'SUPER GUIDE', 'ADMIN', 'SUPER_ADMIN', 'BVSL', 'PW_ADMIN',
    ].includes(userRole) || !!user?.isBvsl || !!user?.isBvAdmin || !!user?.isBvSuperAdmin || !!user?.isPwAdmin;
    if (!isAuthorized) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Not authorized' });
    }
    const shareToken = generateToken();
    const session = await AttendanceSessions.create({
      record: {
        name: input.name,
        event: input.eventId,
        shareToken,
        challengeEnabled: input.challengeEnabled || false,
        challengeTitle: input.challengeTitle,
        challengeDescription: input.challengeDescription,
        challengeInstructions: input.challengeInstructions,
        challengeDays: input.challengeDays || 7,
      },
    });
    return { id: session.id, shareToken };
  },
});
