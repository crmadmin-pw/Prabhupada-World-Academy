import { z } from 'zod';
import { getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createEndpoint, AppError, AccountDeletionHolds, Users } from '@/lib/backend-sdk';
import * as backend from '@/lib/backend-sdk';
import {
  cancelAccountDeletion,
  deleteAccountImmediately,
  loadOwnedAccountTables,
  type DeletionTable,
} from '@/lib/accountDeletion';
import { deleteAccountFiles } from '@/lib/accountDeletionStorage';
import { serverCacheInvalidate } from '../lib/serverCache';
import { publishUsersRevision } from '../lib/publishUsersRevision';
import { profileCacheKey } from './getUserProfile';

async function deleteAuthUser(uid: string) {
  if (!uid) return;
  if (getApps().length === 0) {
    throw new AppError({ code: 'BAD_REQUEST', message: 'Sign-in could not be removed, so account deletion did not finish.' });
  }
  try {
    await getAuth().deleteUser(uid);
  } catch (error) {
    const code = String((error as { code?: string })?.code || '');
    const message = error instanceof Error ? error.message : '';
    if (code === 'auth/user-not-found' || message.includes('no user record')) return;
    throw error;
  }
}

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
  description: 'Permanently delete the signed-in account immediately',
  authenticated: true,
  inputSchema: z.object({
    action: z.enum(['delete', 'cancel']).optional(),
    email: z.string().max(320).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    status: z.enum(['deleted', 'cancelled']),
    purgeAt: z.string().nullable(),
  }),
  execute: async ({ input, context }) => {
    if (!context.user?.uid || !context.user.email) {
      throw new AppError({ code: 'UNAUTHORIZED', message: 'You can only delete the account you are using.' });
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

    const result = await deleteAccountImmediately({
      ...target,
      nowMs: Date.now(),
      deleteFiles: deleteAccountFiles,
      deleteAuthUser,
    });
    await publishProfiles(result.profileIds);
    return { success: true, status: result.status, purgeAt: result.purgeAt };
  },
});
