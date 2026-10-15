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

/** True when the file's leading bytes match the declared image type. The
 * browser-supplied MIME type alone does not prove the content is an image. */
export function imageBytesMatchType(contentType: string, bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  switch (contentType.trim().toLowerCase()) {
    case 'image/jpeg':
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/png':
      return ascii(1, 4) === 'PNG' && bytes[0] === 0x89;
    case 'image/gif':
      return ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a';
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'image/avif':
      return ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12));
    default:
      return false;
  }
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
