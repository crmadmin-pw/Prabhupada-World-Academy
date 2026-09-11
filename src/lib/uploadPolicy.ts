import type { ApiCapability } from './apiAuthorization';

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_MULTIPART_UPLOAD_BYTES = MAX_IMAGE_UPLOAD_BYTES + 512 * 1024;

export const UPLOAD_PURPOSES = [
  'service-checklist',
  'cleanliness-inspection',
] as const;

export type UploadPurpose = typeof UPLOAD_PURPOSES[number];

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function parseUploadPurpose(value: unknown): UploadPurpose | null {
  return typeof value === 'string' && (UPLOAD_PURPOSES as readonly string[]).includes(value)
    ? value as UploadPurpose
    : null;
}

export function requiredUploadCapability(purpose: UploadPurpose): ApiCapability {
  return purpose === 'service-checklist' ? 'services.manage' : 'cleanliness.manage';
}

export function validateImageUpload(contentType: string, size: number): { extension: string } {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error('The uploaded image is empty');
  }
  if (size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error('The image must be 10 MB or smaller');
  }

  const normalizedContentType = contentType.trim().toLowerCase();
  const extension = IMAGE_EXTENSIONS[normalizedContentType];
  if (!extension) {
    throw new Error('Only JPEG, PNG, WebP, GIF, and AVIF images are supported');
  }
  return { extension };
}

export function buildImageObjectPath(
  purpose: UploadPurpose,
  uid: string,
  extension: string,
  uploadedAt: Date,
  objectId: string,
): string {
  const safeUid = uid.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128) || 'unknown';
  const safeObjectId = objectId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
  if (!safeObjectId) throw new Error('A valid image object ID is required');

  const year = String(uploadedAt.getUTCFullYear());
  const month = String(uploadedAt.getUTCMonth() + 1).padStart(2, '0');
  return `uploads/${purpose}/${safeUid}/${year}/${month}/${safeObjectId}.${extension}`;
}
