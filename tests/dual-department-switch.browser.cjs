// Built UI smoke test for the FOLK Super Guide / PW Super Admin switch.
// All APIs are mocked; this never writes to Firebase.
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });

const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:3137';

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1500, height: 950 } });
    const page = await context.newPage();
    const apiDepartments = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await context.addInitScript(({ apiKey }) => {
      const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: 'firebase-gmnd', exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`;
      localStorage.setItem('folk_login_ts', String(Date.now()));
      localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({
        uid: 'firebase-gmnd', email: 'gmnd@hkmmumbai.org', emailVerified: true,
        isAnonymous: false, providerData: [], apiKey, appName: '[DEFAULT]',
        stsTokenManager: { refreshToken: 'test-only', accessToken: token, expirationTime: Date.now() + 3600000 },
      }));
    }, { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY });

    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('accounts:lookup')) {
        return route.fulfill({ json: { users: [{ localId: 'firebase-gmnd', email: 'gmnd@hkmmumbai.org', emailVerified: true }] } });
      }
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();

      const name = url.pathname.split('/').pop();
      const department = route.request().headers()['x-active-department'] || 'DEFAULT';
      apiDepartments.push({ name, department });
      const pwMode = department === 'PW';
      let response = {};
      if (name === 'getUserProfile') response = { user: {
        id: 'profile-gmnd', userId: 'GUIDE-GMND', fullName: 'Gaurmandal Das', email: 'gmnd@hkmmumbai.org',
        role: pwMode ? 'SUPER_ADMIN' : 'SUPER_GUIDE', status: 'Active', segment: pwMode ? 'PW' : 'FOLK',
        isBvAdmin: pwMode, isBvSuperAdmin: pwMode, pwSuperAdminAccess: true,
        activeDepartment: pwMode ? 'PW' : 'FOLK', baseDepartment: 'FOLK', baseRole: 'Super Guide',
      } };
      if (name === 'getCurrentGuide') response = { guide: { id: 'profile-gmnd', guideId: 'GUIDE-GMND', fullName: 'Gaurmandal Das', folkResidencies: [] } };
      if (name === 'getGuideDetailedReport') response = { users: [], fieldDefs: [], availableResidencies: [], availableGuides: [], summary: {} };
      if (name === 'getAllResidencies') response = { residencies: [] };
      if (name === 'getGuides') response = { guides: [] };
      if (name === 'getGuideUsers') response = { users: [] };
      if (name === 'getBvslGroups' || name === 'getAllBvGroupsAdmin') response = { groups: [], bvsls: [], pendingRequestCount: 0, error: null };
      if (name === 'getGuideRequests') response = { guideTransfers: [], ashrayUpgrades: [] };
      if (/getPending|getCleanlinessReviews|getResidencyTransferRequests/.test(name)) response = [];
      return route.fulfill({ json: response });
    });

    await page.goto(origin + '/folk-guide/dashboard');
    await expect(page.getByText('FOLK Super Guide Dashboard', { exact: true })).toBeVisible({ timeout: 20000 });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('active_department_mode')), null);
    await expect(page.getByRole('button', { name: 'PW Super Admin', exact: true }).filter({ visible: true })).toBeVisible();

    await page.getByRole('button', { name: 'PW Super Admin', exact: true }).filter({ visible: true }).click();
    await expect(page.getByText('Prabhupada World Super Admin Dashboard', { exact: true })).toBeVisible({ timeout: 20000 });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('active_department_mode')), 'PW');
    assert.ok(apiDepartments.some(call => call.name === 'getUserProfile' && call.department === 'PW'));

    await page.reload();
    await expect(page.getByText('Prabhupada World Super Admin Dashboard', { exact: true })).toBeVisible({ timeout: 20000 });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('active_department_mode')), 'PW');

    await page.getByRole('button', { name: 'FOLK Super Guide', exact: true }).filter({ visible: true }).click();
    await expect(page.getByText('FOLK Super Guide Dashboard', { exact: true })).toBeVisible({ timeout: 20000 });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('active_department_mode')), 'FOLK');
    assert.ok(apiDepartments.some(call => call.name === 'getUserProfile' && call.department === 'FOLK'));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open account menu' }).click();
    await expect(page.getByRole('button', { name: 'PW Super Admin', exact: true }).filter({ visible: true })).toBeVisible();
    await page.getByRole('button', { name: 'PW Super Admin', exact: true }).filter({ visible: true }).click();
    await expect(page.getByText('Prabhupada World Super Admin Dashboard', { exact: true })).toBeVisible({ timeout: 20000 });

    await page.setViewportSize({ width: 1500, height: 950 });
    await page.getByRole('button', { name: 'Logout', exact: true }).filter({ visible: true }).click();
    await page.waitForFunction(() => sessionStorage.getItem('active_department_mode') === null, null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('active_department_mode')), null);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, apiDepartments }));
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
