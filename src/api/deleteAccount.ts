import { z } from 'zod';
import { createEndpoint, AppError, AccountDeletionHolds, Users } from '@/lib/backend-sdk';
import * as backend from '@/lib/backend-sdk';
import { deletionAuthorizationFailure } from '@/lib/accountDeletionPolicy';
import {
  cancelAccountDeletion,
  loadOwnedAccountTables,
  scheduleAccountDeletion,
  type DeletionTable,
} from '@/lib/accountDeletion';
import { serverCacheInvalidate } from '../lib/serverCache';
import { publishUsersRevision } from '../lib/publishUsersRevision';
import { profileCacheKey } from './getUserProfile';

const registry = backend as unknown as Record<string, DeletionTable | undefined>;
const ownedTables = loadOwnedAccountTables(registry);

async function publishProfiles(ids: string[]) {
  for (const id of ids) {
    try {
      serverCacheInvalidate(profileCacheKey(id));
      await publishUsersRevision(id);
    } catch (error) {
      console.error('[deleteAccount] profile refresh failed', error);
    }
  }
}

export default createEndpoint({
  description: 'Schedule reversible account deletion after typed confirmation and a fresh sign-in',
  authenticated: true,
  inputSchema: z.object({
    action: z.enum(['schedule', 'cancel']).optional(),
    confirmText: z.string().max(32).optional(),
    email: z.string().max(320).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    status: z.enum(['scheduled', 'cancelled']),
    purgeAt: z.string().nullable(),
  }),
  execute: async ({ input, context }) => {
    if (!context.user?.uid || !context.user.email) {
      throw new AppError({ code: 'UNAUTHORIZED', message: 'Sign in again before deleting your account.' });
    }
    if (input.email && input.email.toLowerCase() !== context.user.email.toLowerCase()) {
      throw new AppError({ code: 'FORBIDDEN', message: 'You can only delete your own account.' });
    }

    const target = {
      authId: context.user.uid,
      profileId: context.user.id,
      email: context.user.email,
      users: Users as DeletionTable,
      holds: AccountDeletionHolds as DeletionTable,
      ownedTables,
    };

    if (input.action === 'cancel') {
      const result = await cancelAccountDeletion(target);
      await publishProfiles(result.profileIds);
      return { success: true, status: result.status, purgeAt: result.purgeAt };
    }

    // `confirm: true` is intentionally ignored. Deletion requires the word DELETE
    // and a sign-in from the last few minutes.
    const failure = deletionAuthorizationFailure({
      confirmText: input.confirmText,
      authTimeSeconds: context.user.authTime,
      nowMs: Date.now(),
    });
    if (failure) throw new AppError(failure);

    const result = await scheduleAccountDeletion({ ...target, nowMs: Date.now() });
    await publishProfiles(result.profileIds);
    return { success: true, status: result.status, purgeAt: result.purgeAt };
  },
});
