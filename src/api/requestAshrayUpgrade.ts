import { z } from 'zod';
import { createEndpoint, AshrayUpgradeRequests, ZiteError } from 'zite-integrations-backend-sdk';
import { ASHRAY_LEVELS } from '../types/enums';

// Use canonical ASHRAY_LEVELS from enums — single source of truth for level ordering
const ASHRAY_ORDER: string[] = [...ASHRAY_LEVELS];

export default createEndpoint({
  description: 'Submit an Ashray level upgrade request',
  authenticated: true,
  inputSchema: z.object({
    requestedLevel: z.string().max(50).optional(),
    notes: z.string().max(2000).optional(),
    userId: z.string().max(100).optional(),
    currentLevel: z.string().max(50).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const currentLevel = input.currentLevel || context.user.ashrayLevel || 'Jigyasa';
    let requestedLevel = input.requestedLevel || '';

    if (!requestedLevel) {
      const currentIdx = ASHRAY_ORDER.indexOf(currentLevel);
      if (currentIdx !== -1 && currentIdx < ASHRAY_ORDER.length - 1) {
        requestedLevel = ASHRAY_ORDER[currentIdx + 1];
      } else {
        requestedLevel = 'Shraddhavan';
      }
    }

    if (requestedLevel) {
      const currentIdx = ASHRAY_ORDER.indexOf(currentLevel);
      const requestedIdx = ASHRAY_ORDER.indexOf(requestedLevel);
      if (requestedIdx <= currentIdx && currentIdx !== -1 && requestedIdx !== -1) {
        throw new ZiteError({ code: 'BAD_REQUEST', message: 'Requested level must be higher than current level' });
      }
    }

    // Check for existing pending request
    const existing = await AshrayUpgradeRequests.findOne({
      filters: { userId: context.user.userId || context.user.id, status: 'Pending' },
    });
    if (existing) throw new ZiteError({ code: 'CONFLICT', message: 'You already have a pending upgrade request' });

    const record = await AshrayUpgradeRequests.create({
      record: {
        userId: context.user.userId || context.user.id,
        currentLevel,
        requestedLevel,
        reason: input.notes || '',
        status: 'Pending',
        createdAt: new Date().toISOString(),
      },
    });

    return { success: true, requestId: record.id };
  },
});
