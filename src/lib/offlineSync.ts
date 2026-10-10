import { assignBvRole, registerBvMember, submitSadhana } from '@/lib/endpoints-sdk';
import { installOfflineSync, type PendingQueueItem } from '@/lib/offlineQueue';
import { invalidateMemberHomeQueries } from '@/lib/app-endpoints-sdk';
import { publishSadhanaEntrySaved } from '@/utils/sadhanaDashboardRefresh';
import { markSubmittedToday, scheduleSadhanaReminder } from '@/utils/sadhanaNotification';

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function todayIst(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function roleUpdateInput(payload: any) {
  if (payload?.endpoint === 'assignBvRole' && payload.input) return payload.input;
  if (payload?.userId && payload?.role) return payload;
  throw Object.assign(new Error('This saved role change cannot be synced.'), { status: 400 });
}

async function replayOfflineItem(item: PendingQueueItem): Promise<void> {
  if (item.type === 'sadhana_entry') {
    const saved = await submitSadhana(item.payload);
    const entryDate = String(item.payload?.entryDate || '').slice(0, 10);
    const userId = String(item.payload?.userId || '');
    publishSadhanaEntrySaved({
      userId,
      entryId: saved.entryId,
      entryDate,
      totalScore: saved.totalScore,
      maxScore: saved.maxScore,
      scorePercent: saved.scorePercent,
      flagSick: !!item.payload?.flagSick,
      flagOs: !!item.payload?.flagOs,
      submittedAt: new Date().toISOString(),
    });
    if (userId) invalidateMemberHomeQueries();
    if (entryDate && entryDate === todayIst()) {
      markSubmittedToday();
      const department = typeof window !== 'undefined' && localStorage.getItem('auth_department') === 'FOLK' ? 'FOLK' : 'PW';
      void scheduleSadhanaReminder(true, department);
    }
    return;
  }

  if (item.type === 'bv_registration') {
    try {
      await registerBvMember(item.payload);
    } catch (error) {
      if (errorStatus(error) === 409) return;
      throw error;
    }
    return;
  }

  if (item.type === 'role_update') {
    await assignBvRole(roleUpdateInput(item.payload));
    return;
  }

  throw Object.assign(new Error('Unknown saved record.'), { status: 400 });
}

export function startOfflineSync(): () => void {
  return installOfflineSync(replayOfflineItem);
}
