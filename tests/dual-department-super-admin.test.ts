import assert from 'node:assert/strict';
import test from 'node:test';
import getUserProfile from '../src/api/getUserProfile';
import { buildApiUserContext, hasApiCapabilities } from '../src/lib/apiAuthorization';

const identity = {
  uid: 'firebase-gmnd',
  email: 'gmnd@hkmmumbai.org',
  emailVerified: true,
};

const folkSuperGuide = {
  id: 'profile-gmnd',
  userId: 'GUIDE-GMND',
  email: identity.email,
  fullName: 'Gaurmandal Das',
  role: 'Super Guide',
  segment: 'FOLK',
  status: 'Active',
  isFolkLead: true,
  pwSuperAdminAccess: true,
};

test('dual-department account remains an unchanged FOLK Super Guide by default', () => {
  const context = buildApiUserContext(identity, folkSuperGuide);

  assert.equal(context.activeDepartment, 'FOLK');
  assert.equal(context.baseDepartment, 'FOLK');
  assert.equal(context.role, 'Super Guide');
  assert.equal(context.isFolkLead, true);
  assert.equal(context.isBvSuperAdmin, false);
  assert.equal(hasApiCapabilities(context, '*'), false);
});

test('validated PW mode grants the same effective access as a PW Super Admin', () => {
  const context = buildApiUserContext(identity, folkSuperGuide, 'PW');

  assert.equal(context.activeDepartment, 'PW');
  assert.equal(context.baseDepartment, 'FOLK');
  assert.equal(context.baseRole, 'Super Guide');
  assert.equal(context.role, 'SUPER_ADMIN');
  assert.equal(context.segment, 'PW');
  assert.equal(context.isBvAdmin, true);
  assert.equal(context.isBvSuperAdmin, true);
  assert.equal(context.isFolkLead, false);
  assert.equal(hasApiCapabilities(context, '*'), true);
});

test('a browser header cannot grant PW access without the stored entitlement', () => {
  const context = buildApiUserContext(identity, { ...folkSuperGuide, pwSuperAdminAccess: false }, 'PW');

  assert.equal(context.activeDepartment, 'FOLK');
  assert.equal(context.role, 'Super Guide');
  assert.equal(context.isBvSuperAdmin, false);
  assert.equal(hasApiCapabilities(context, '*'), false);
});

test('entitlement is ignored unless the stored account is an active FOLK Super Guide', () => {
  for (const profile of [
    { ...folkSuperGuide, role: 'Guide' },
    { ...folkSuperGuide, segment: 'PW' },
    { ...folkSuperGuide, status: 'Inactive' },
  ]) {
    const context = buildApiUserContext(identity, profile, 'PW');
    assert.equal(context.isBvSuperAdmin, false);
    assert.equal(hasApiCapabilities(context, '*'), false);
  }
});

test('PW profile response is sanitized and does not expose FOLK assignments', async () => {
  const storedProfile = {
    ...folkSuperGuide,
    guide: 'folk-guide-private',
    residency: 'folk-residency-private',
    isFolkLead: true,
    isTripCoordinator: true,
    lastLoginAt: '2026-11-24T00:00:00.000Z',
  };
  const context = {
    user: buildApiUserContext(identity, storedProfile, 'PW'),
    loadedProfile: storedProfile,
  };

  const result = await getUserProfile.execute({ input: {}, context } as never);

  assert.equal(result.user?.role, 'SUPER_ADMIN');
  assert.equal(result.user?.segment, 'PW');
  assert.equal(result.user?.isBvSuperAdmin, true);
  assert.equal(result.user?.selectedGuideId, null);
  assert.equal(result.user?.selectedFolkResidency, null);
  assert.equal(result.user?.isFolkLead, false);
  assert.equal(result.user?.isTripCoordinator, false);
  assert.equal(result.user?.baseRole, 'Super Guide');
  assert.equal(result.user?.baseDepartment, 'FOLK');
});
