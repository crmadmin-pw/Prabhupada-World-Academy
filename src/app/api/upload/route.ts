import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { getDownloadURL, getStorage } from 'firebase-admin/storage';
import { Users } from '@/lib/app-backend-sdk';
import {
  buildApiUserContext,
  hasApiCapabilities,
  type ApiDatabaseUser,
} from '@/lib/apiAuthorization';
import {
  buildImageObjectPath,
  MAX_MULTIPART_UPLOAD_BYTES,
  parseUploadPurpose,
  requiredUploadCapability,
  validateImageUpload,
} from '@/lib/uploadPolicy';

export const runtime = 'nodejs';

async function resolveDatabaseUser(uid: string, email: string): Promise<ApiDatabaseUser | null> {
  const uidRecord = await Users.findOne({ id: uid }).catch(() => null);
  if (uidRecord?.userId && uidRecord?.status) return uidRecord;

  const firebaseUidRecord = await Users.findOne({ filters: { firebaseUid: uid } }).catch(() => null);
  if (firebaseUidRecord) return firebaseUidRecord;

  const emailLower = email.toLowerCase();
  const [exactMatches, lowerMatches] = await Promise.all([
    Users.findAll({ filters: { email }, limit: 10 }).catch(() => ({ records: [] })),
    Users.findAll({ filters: { email: emailLower }, limit: 10 }).catch(() => ({ records: [] })),
  ]);
  const candidates = [...exactMatches.records, ...lowerMatches.records]
    .filter((record, index, records) => records.findIndex(item => item.id === record.id) === index);
  return candidates.find(record => record.userId && record.status) || candidates[0] || uidRecord || null;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_UPLOAD_BYTES) {
      return jsonError('The image must be 10 MB or smaller', 413);
    }

    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonError('Authentication required', 401);

    const decoded = await getAuth().verifyIdToken(token);
    if (!decoded.uid || !decoded.email || decoded.email_verified !== true) {
      return jsonError('A verified Firebase account is required', 403);
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!(file instanceof File)) return jsonError('No image uploaded', 400);

    const purpose = parseUploadPurpose(formData.get('purpose'));
    if (!purpose) return jsonError('Invalid upload purpose', 400);

    const dbUser = await resolveDatabaseUser(decoded.uid, decoded.email);
    const user = buildApiUserContext({
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: true,
    }, dbUser);
    if (!hasApiCapabilities(user, requiredUploadCapability(purpose))) {
      return jsonError('You are not authorized to upload this image', 403);
    }

    const { extension } = validateImageUpload(file.type, file.size);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET
      || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
      || 'bvpw108.firebasestorage.app';
    const objectPath = buildImageObjectPath(purpose, decoded.uid, extension, new Date(), randomUUID());
    const originalName = file.name.replace(/[\r\n\0]/g, '').slice(0, 180);
    const storageFile = getStorage().bucket(bucketName).file(objectPath);

    await storageFile.save(buffer, {
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: file.type.toLowerCase(),
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: {
          firebaseStorageDownloadTokens: randomUUID(),
          originalName,
          purpose,
          uploadedBy: decoded.uid,
        },
      },
    });

    const fileUrl = await getDownloadURL(storageFile);
    return NextResponse.json({ fileUrl, storagePath: objectPath });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'File upload failed';
    if (message.includes('Firebase ID token')) return jsonError('Invalid or expired authentication', 401);
    if (message.includes('10 MB') || message.includes('supported') || message.includes('empty')) {
      return jsonError(message, 400);
    }
    console.error('[File Upload API] Firebase Storage upload failed:', error);
    return jsonError('File upload failed', 500);
  }
}
