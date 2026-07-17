// ══════════════════════════════════════════════════════════════════════════════
// zite-file-upload-sdk.ts — Compatibility layer for Zite file upload SDK.
// Uploads files to local Next.js API endpoint /api/upload.
// ══════════════════════════════════════════════════════════════════════════════

export async function uploadFile({ data, filename }: { data: File | Blob; filename: string }): Promise<{ fileUrl: string }> {
  const formData = new FormData();
  formData.append('file', data, filename);

  const res = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'File upload failed');
  }

  return res.json();
}
