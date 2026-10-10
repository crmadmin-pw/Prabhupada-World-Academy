import { z } from 'zod';
import { getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createEndpoint, AppError, AccountDeletionHolds, Users } from '@/lib/backend-sdk';
import * as backend from '@/lib/backend-sdk';
import { loadOwnedAccountTables, purgeDueAccountDeletions, type DeletionTable } from '@/lib/accountDeletion';
import { deleteAccountFiles } from '@/lib/accountDeletionStorage';

const ownedTables = loadOwnedAccountTables(backend as unknown as Record<string, DeletionTable | undefined>);

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

export default createEndpoint({
  description: 'Permanently delete accounts whose recovery period has ended. Called by Cloud Scheduler daily.',
  public: true,
  inputSchema: z.object({ cronSecret: z.string().min(16).max(256) }),
  outputSchema: z.object({ purged: z.number(), skipped: z.number() }),
  execute: async ({ input }) => {
    const secrets = [process.env.APP_CRON_SECRET, process.env.ZITE_CRON_SECRET].filter((value): value is string => !!value);
    if (!secrets.includes(input.cronSecret)) {
      throw new AppError({ code: 'UNAUTHORIZED', message: 'Unauthorized scheduler request' });
    }
    return purgeDueAccountDeletions({
      nowMs: Date.now(),
      users: Users as DeletionTable,
      holds: AccountDeletionHolds as DeletionTable,
      ownedTables,
      deleteFiles: deleteAccountFiles,
      deleteAuthUser,
    });
  },
});
