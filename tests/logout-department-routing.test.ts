import assert from 'node:assert/strict';
import test from 'node:test';
import { getDepartmentLandingPath, getUserDepartment } from '../src/lib/userDashboardRoutes';
import { authCallbackPath, isPwRegistrationFlow, registrationPath, sameOriginRedirect } from '../src/lib/registrationDepartment';

test('the post-login redirect only ever stays on this site', () => {
  const origin = 'https://app.example';
  const fallback = `${origin}/auth-callback?flow=folk`;
  assert.equal(sameOriginRedirect(null, fallback, origin), fallback);
  assert.equal(sameOriginRedirect(`${origin}/bvsl/dashboard`, fallback, origin), `${origin}/bvsl/dashboard`);
  assert.equal(sameOriginRedirect('/guide-login', fallback, origin), `${origin}/guide-login`);
  for (const hostile of ['https://elsewhere.example/login', '//elsewhere.example/x', 'javascript:alert(1)', 'http://app.example/', 'https://app.example.evil/']) {
    assert.equal(sameOriginRedirect(hostile, fallback, origin), fallback, hostile);
  }
});

test('logout destinations follow the user department', () => {
  assert.equal(getUserDepartment({ segment: 'FOLK' }), 'FOLK');
  assert.equal(getDepartmentLandingPath({ segment: 'FOLK' }), '/');
  assert.equal(getUserDepartment({ segment: 'Prabhupada World' }), 'PW');
  assert.equal(getDepartmentLandingPath({ segment: 'Prabhupada World' }), '/pw');
  assert.equal(getDepartmentLandingPath({ isPrabhupadaWorldUser: true }), '/pw');
  assert.equal(getDepartmentLandingPath({ segment: 'FOLK', isPrabhupadaWorldUser: true }), '/');
});

test('a PW sign-in link stays on PW registration even if the stored flag was cleared', () => {
  assert.equal(isPwRegistrationFlow('?flow=pw'), true);
  assert.equal(isPwRegistrationFlow('flow=folk'), false);
  assert.equal(authCallbackPath('PW'), '/auth-callback?flow=pw');
  assert.equal(registrationPath('PW'), '/register?flow=pw');
  assert.equal(registrationPath('FOLK'), '/register?flow=folk');
});
