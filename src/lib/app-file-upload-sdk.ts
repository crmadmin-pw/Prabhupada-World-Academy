// ══════════════════════════════════════════════════════════════════════════════
// app-file-upload-sdk.ts — Server file upload helper module.
// Uploads files through the authenticated Next.js API to Firebase Storage.
// ══════════════════════════════════════════════════════════════════════════════
import { auth } from './app-auth-sdk';
import type { UploadPurpose } from './uploadPolicy';

export async function uploadFile({
  data,
  filename,
  purpose,
}: {
  data: File | Blob;
  filename: string;
  purpose: UploadPurpose;
}): Promise<{ fileUrl: string; storagePath: string }> {
  const currentUser = auth?.currentUser;
  if (!currentUser) throw new Error('User is not authenticated');

  const formData = new FormData();
  formData.append('file', data, filename);
  formData.append('purpose', purpose);
  const idToken = await currentUser.getIdToken();

  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'File upload failed');
  }

  return res.json();
}
