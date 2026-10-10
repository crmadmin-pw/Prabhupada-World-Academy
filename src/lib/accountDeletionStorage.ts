import { getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { UPLOAD_PURPOSES } from '@/lib/uploadPolicy';

function storageBucketName(): string {
  return process.env.FIREBASE_STORAGE_BUCKET
    || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    || 'bvpw108.firebasestorage.app';
}

export function storageOwnerId(uid: string): string {
  return uid.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
}

/** Delete a departing member's uploads and any storage objects their records still reference. */
export async function deleteAccountFiles(paths: string[], uids: string[]): Promise<void> {
  if (getApps().length === 0) {
    throw new Error('File storage is not available, so account deletion cannot finish.');
  }

  const bucket = getStorage().bucket(storageBucketName());
  const doomed = new Set(paths.filter(path => path.startsWith('uploads/') && !path.includes('..')));

  for (const uid of uids) {
    const safeUid = storageOwnerId(uid);
    if (!safeUid) continue;
    for (const purpose of UPLOAD_PURPOSES) {
      const [files] = await bucket.getFiles({ prefix: `uploads/${purpose}/${safeUid}/` });
      for (const file of files) doomed.add(file.name);
    }
  }

  const pending = [...doomed];
  for (let index = 0; index < pending.length; index += 20) {
    const results = await Promise.allSettled(
      pending.slice(index, index + 20).map(path => bucket.file(path).delete({ ignoreNotFound: true })),
    );
    const rejected = results.find(result => result.status === 'rejected');
    if (rejected?.status === 'rejected') {
      throw new Error('Could not delete every file for this account.');
    }
  }
}
