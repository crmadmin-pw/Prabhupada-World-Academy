import assert from 'node:assert/strict';
import test from 'node:test';
import { BULK_USER_CSV_HEADERS, parseCsv } from '../src/config/bulkUserCsv';
import { deriveApiCapabilities } from '../src/lib/apiAuthorization';
import { createBulkUser, getBulkExportData, previewBulkUsers, requireBulkUserManager } from '../src/lib/bulkUserManagement';
import { BvMemberRegistrations, FolkResidencies, Guides, Users } from '../src/lib/app-backend-sdk';

// The preview resolves `selectedFolkResidency` against the FolkResidencies
// table; the in-memory store starts empty, so seed the center the rows use.
const residencyId = 'RES-BULK-TEST-FIXTURE';
test.before(() => FolkResidencies.create({ record: { id: residencyId, residencyId, residencyName: 'FOLK Powai', isActive: true } }));
test.after(() => FolkResidencies.delete({ id: residencyId }));

test('bulk import template is the combined FOLK registration shape without privileged fields', () => {
  for (const field of ['email', 'fullName', 'phone', 'selectedFolkResidency', 'whatsappNumber', 'address', 'ashrayLevel', 'timePreference']) {
    assert.ok(BULK_USER_CSV_HEADERS.includes(field as any), `${field} should be in the template`);
  }
  for (const forbidden of ['guide', 'guideId', 'role', 'status', 'segment', 'isBvAdmin', 'isBvSuperAdmin']) {
    assert.ok(!BULK_USER_CSV_HEADERS.includes(forbidden as any), `${forbidden} must remain server-controlled`);
  }
  assert.equal(new Set(BULK_USER_CSV_HEADERS).size, BULK_USER_CSV_HEADERS.length);
});

test('CSV parser handles BOM, quoted commas, escaped quotes and embedded newlines', () => {
  const parsed = parseCsv('\uFEFFemail,fullName,address\r\na@example.com,"A ""Devotee""","Road 1, Mumbai\nNear Temple"');
  assert.deepEqual(parsed.headers, ['email', 'fullName', 'address']);
  assert.equal(parsed.rows[0].fullName, 'A "Devotee"');
  assert.equal(parsed.rows[0].address, 'Road 1, Mumbai\nNear Temple');
});

test('CSV parser rejects malformed row widths and duplicate headers', () => {
  assert.throws(() => parseCsv('email,email\na@example.com,a@example.com'), /duplicate headers/i);
  assert.throws(() => parseCsv('email,fullName\na@example.com'), /expected 2/i);
});

test('bulk capability follows active Guide and Super Guide roles only', () => {
  const active = { status: 'Active', segment: 'FOLK' };
  assert.ok(deriveApiCapabilities({ ...active, role: 'Guide' }).includes('users.bulk.manage'));
  assert.ok(deriveApiCapabilities({ ...active, role: 'Guide' }).includes('notifications.send'));
  assert.ok(!deriveApiCapabilities({ ...active, role: 'Guide' }).includes('meetings.manage'));
  assert.ok(deriveApiCapabilities({ ...active, role: 'Super Guide' }).includes('users.bulk.manage'));
  assert.ok(!deriveApiCapabilities({ ...active, role: 'User' }).includes('users.bulk.manage'));
  assert.ok(!deriveApiCapabilities({ status: 'Inactive', segment: 'FOLK', role: 'Guide' }).includes('users.bulk.manage'));
});

test('server preview accepts a form-valid row and resolves a residency name', async () => {
  const row = Object.fromEntries(BULK_USER_CSV_HEADERS.map(header => [header, ''])) as Record<string, string>;
  Object.assign(row, {
    email: 'bulk.preview@example.com', fullName: 'Bulk Preview',
    phoneCountryCode: '+91', phone: '9876543210', selectedFolkResidency: 'FOLK Powai',
    residencyUserClaim: 'No', ashrayLevel: 'Jigyasa', whatsappCountryCode: '+91', whatsappNumber: '9876543210',
    address: 'Mumbai', occupation: 'Engineer', companyName: 'Example College', dob: '01/01/2000', gender: 'Male',
    dailyChantingRounds: '4', weeklyReadingHours: '60', weeklyHearingHours: '60', inTouchWithTemple: 'No',
    timePreference: '7:45 PM – 8:15 PM (Everyday)',
  });
  const preview = await previewBulkUsers([...BULK_USER_CSV_HEADERS], [row]);
  assert.equal(preview.totalRecords, 1);
  assert.equal(preview.newUsers, 1);
  assert.equal(preview.invalidRecords, 0);
  assert.ok(preview.rows[0].normalized?.selectedFolkResidency);
});

test('endpoint-local role guard rejects FOLK admins despite wildcard-style authority', async () => {
  await assert.rejects(
    () => requireBulkUserManager({ role: 'Admin', segment: 'FOLK', isActive: true } as any),
    /Only active FOLK Guides and FOLK Super Guides/,
  );
});

test('mock integration creates only a normal assigned Users profile and existing BV registration', async () => {
  const guideId = 'GUIDE-BULK-TEST-FIXTURE';
  const guideEmail = 'bulk-guide-fixture@example.invalid';
  await Guides.create({
    record: {
      id: guideId,
      guideId,
      email: guideEmail,
      fullName: 'Bulk Test Guide',
      role: 'Guide',
      segment: 'FOLK',
      isActive: true,
    },
  });

  const row = Object.fromEntries(BULK_USER_CSV_HEADERS.map(header => [header, ''])) as Record<string, string>;
  Object.assign(row, {
    email: 'bulk.create@example.com', fullName: 'Bulk Created',
    phoneCountryCode: '+91', phone: '9865432109', selectedFolkResidency: 'FOLK Powai',
    residencyUserClaim: 'Yes', residencyJoinDate: '2025-01-01', ashrayLevel: 'Jigyasa',
    whatsappCountryCode: '+91', whatsappNumber: '9865432109', address: 'Mumbai', occupation: 'Engineer',
    companyName: 'Example College', dob: '01/01/2000', gender: 'Male', dailyChantingRounds: '4',
    weeklyReadingHours: '60', weeklyHearingHours: '60', inTouchWithTemple: 'No',
    timePreference: '7:45 PM – 8:15 PM (Everyday)',
  });
  const preview = await previewBulkUsers([...BULK_USER_CSV_HEADERS], [row]);
  const manager = await requireBulkUserManager({
    id: guideId, email: guideEmail, role: 'Guide', segment: 'FOLK', isActive: true, fullName: 'Bulk Test Guide',
  } as any);
  const created = await createBulkUser(preview.rows[0].normalized!, manager, 0);
  assert.equal(created.status, 'created');

  const user = await Users.findOne({ filters: { email: 'bulk.create@example.com' } });
  assert.equal(user.role, 'User');
  assert.equal(user.status, 'Active');
  assert.equal(user.segment, 'FOLK');
  assert.equal(user.guide, manager.guideScope.guideId);
  assert.equal(user.isBvAdmin, false);
  assert.equal(user.isBvSuperAdmin, false);

  const registration = await BvMemberRegistrations.findOne({ id: `BVREG-${user.id}` });
  assert.equal(registration.status, 'Approved');
  assert.equal(registration.userDbId, user.id);
  assert.equal(registration.segment, 'FOLK');

  const exported = await getBulkExportData(manager, { status: 'all' });
  const emailColumn = exported.headers.indexOf('email');
  const phoneColumn = exported.headers.indexOf('phone');
  assert.ok(exported.rows.some(rowValues => rowValues[emailColumn] === 'bulk.create@example.com'));
  assert.ok(exported.rows.some(rowValues => rowValues[phoneColumn] === '+919865432109'));
  for (const removedHeader of [
    'assignedGuideId', 'bvGroupId', 'bvRegistration.assignedGroupId', 'bvRegistration.pwClassesAttending',
    'bvRegistration.isPrabhupadaWorldUser', 'bvRegistration.userDbId', 'user.bvReportingAdminId',
    'user.bvReportingFacilitatorId', 'user.bvReportingSupervisorId', 'user.guide',
  ]) {
    assert.ok(!exported.headers.includes(removedHeader), `${removedHeader} must not be exported`);
  }

  await Guides.delete({ id: guideId });
});
