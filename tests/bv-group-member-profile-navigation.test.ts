import assert from 'node:assert/strict';
import test from 'node:test';
import { canOpenBvGroupMemberProfile, deletedGroupReturnPath, detailBackTarget, getBvGroupMemberProfileBasePath, isBvGroupProfileAdministrator, isManagedDetailPath, memberProfileNavigationState, profileBackNavigation, safeReturnPath, viewerDetailHome } from '../src/lib/bvGroupMemberProfileNavigation';

test('PW admins and super admins can open a BV group member profile', () => {
  assert.equal(canOpenBvGroupMemberProfile({ role: 'PW_ADMIN' }), true);
  assert.equal(canOpenBvGroupMemberProfile({ role: 'User', isBvAdmin: true }), true);
  assert.equal(canOpenBvGroupMemberProfile({ role: 'User', isBvSuperAdmin: true }), true);
  assert.equal(isBvGroupProfileAdministrator({ role: 'PW Admin' }), true);
});

test('regular BV members cannot open managed profiles and RGSFs retain their route', () => {
  assert.equal(canOpenBvGroupMemberProfile({ role: 'User' }), false);
  assert.equal(getBvGroupMemberProfileBasePath({ isBvSubFacilitator: true }), '/rgsf/users');
  assert.equal(getBvGroupMemberProfileBasePath({ role: 'PW_ADMIN' }), '/guide/users');
  assert.equal(canOpenBvGroupMemberProfile({ role: 'User', isBvFacilitator: true }), true);
  assert.equal(getBvGroupMemberProfileBasePath({ isBvFacilitator: true, isBvSubFacilitator: true }), '/guide/users');
});

test('back from a group never returns to the member profile that opened it', () => {
  assert.equal(isManagedDetailPath('/guide/users/USER-231'), true);
  assert.equal(isManagedDetailPath('/bvsl/groups/BV-GROUP-1'), true);
  assert.equal(safeReturnPath('/guide/users/USER-231'), undefined);
  assert.equal(
    detailBackTarget({ from: '/guide/users/USER-231', origin: '/pw-admin/dashboard' }, '/bvsl/dashboard'),
    '/pw-admin/dashboard',
  );
  assert.equal(
    detailBackTarget({ from: '/bvsl/groups/BV-GROUP-1?tab=members' }, '/mentor/dashboard'),
    '/mentor/dashboard',
  );
  assert.equal(
    detailBackTarget({ from: '/pw-admin/dashboard#bhakti-vriksha' }, '/pw-admin/dashboard'),
    '/pw-admin/dashboard#bhakti-vriksha',
  );
  assert.equal(viewerDetailHome({ role: 'SADHANA_MENTOR', isSadhanaMentor: true }), '/mentor/dashboard');
  assert.equal(viewerDetailHome({ role: 'PW_ADMIN', segment: 'PW' }), '/pw-admin/dashboard');
  assert.equal(viewerDetailHome({ role: 'User', isBvFacilitator: true }), '/bvsl/dashboard');
  assert.equal(deletedGroupReturnPath({ role: 'PW_ADMIN', segment: 'PW' }), '/pw-admin/dashboard#bhakti-vriksha');
  assert.equal(deletedGroupReturnPath({ role: 'SUPER_GUIDE', segment: 'FOLK' }), '/folk-guide/dashboard#bhakti-vriksha');
});

test('RGF back from a group member returns to the members tab, then the groups list', () => {
  const opened = memberProfileNavigationState({
    pathname: '/bvsl/groups/BV-GROUP-1',
    search: '',
    state: { from: '/bvsl/dashboard#groups' },
  }, '/bvsl/dashboard');
  assert.deepEqual(opened, {
    from: '/bvsl/groups/BV-GROUP-1?tab=members',
    origin: '/bvsl/dashboard#groups',
  });
  const back = profileBackNavigation(opened, '/bvsl/dashboard');
  assert.equal(back.to, '/bvsl/groups/BV-GROUP-1?tab=members');
  assert.equal(back.replace, true);
  assert.equal(back.state?.from, '/bvsl/dashboard#groups');
  assert.equal(detailBackTarget(back.state, '/bvsl/dashboard'), '/bvsl/dashboard#groups');
});
