import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildImageObjectPath,
  MAX_IMAGE_UPLOAD_BYTES,
  parseUploadPurpose,
  requiredUploadCapability,
  validateImageUpload,
} from '../src/lib/uploadPolicy';

test('upload purposes map to least-privilege capabilities', () => {
  assert.equal(parseUploadPurpose('service-checklist'), 'service-checklist');
  assert.equal(parseUploadPurpose('cleanliness-inspection'), 'cleanliness-inspection');
  assert.equal(parseUploadPurpose('other'), null);
  assert.equal(requiredUploadCapability('service-checklist'), 'services.manage');
  assert.equal(requiredUploadCapability('cleanliness-inspection'), 'cleanliness.manage');
});

test('image validation accepts supported types and rejects unsafe or oversized files', () => {
  assert.deepEqual(validateImageUpload('image/jpeg', 1024), { extension: 'jpg' });
  assert.deepEqual(validateImageUpload('IMAGE/WEBP', MAX_IMAGE_UPLOAD_BYTES), { extension: 'webp' });
  assert.throws(() => validateImageUpload('image/svg+xml', 1024), /Only JPEG/);
  assert.throws(() => validateImageUpload('application/pdf', 1024), /Only JPEG/);
  assert.throws(() => validateImageUpload('image/png', 0), /empty/);
  assert.throws(() => validateImageUpload('image/png', MAX_IMAGE_UPLOAD_BYTES + 1), /10 MB/);
});

test('object paths are purpose and user scoped without trusting the original filename', () => {
  const path = buildImageObjectPath(
    'cleanliness-inspection',
    '../unsafe/user',
    'png',
    new Date('2026-09-11T12:00:00Z'),
    'object-id_123',
  );
  assert.equal(path, 'uploads/cleanliness-inspection/___unsafe_user/2026/09/object-id_123.png');
  assert.equal(path.includes('..'), false);
});
