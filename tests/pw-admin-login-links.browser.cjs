// Mocked API responses; all external requests blocked. No account linking writes.
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:3135';

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of [
      { role: 'User', isBvAdmin: true, width: 1500 },
      { role: 'User', isBvAdmin: true, width: 390 },
      { role: 'ADMIN', isBvAdmin: true, width: 1500 },
      { role: 'User', isBvSuperAdmin: true, width: 1500 },
    ]) {
      const profile = { ...scenario, id: 'test-admin', userId: 'TEST-ADMIN', email: 'admin@example.invalid', fullName: 'Test Admin', status: 'Active', segment: 'PW' };
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: scenario.width, height: 1000 } });
      const page = await context.newPage();
      const errors = [], mutations = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.addInitScript(({ apiKey }) => {
        const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: 'test-admin', exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`;
        localStorage.setItem('folk_login_ts', String(Date.now()));
        localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({ uid: 'test-admin', email: 'admin@example.invalid', emailVerified: true,
          isAnonymous: false, providerData: [], apiKey, appName: '[DEFAULT]', stsTokenManager: { refreshToken: 'test-only', accessToken: token, expirationTime: Date.now() + 3600000 } }));
      }, { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('accounts:lookup')) {
          return route.fulfill({ json: { users: [{ localId: profile.id, email: profile.email, emailVerified: true }] } });
        }
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const name = url.pathname.split('/').pop();
        let response = {};
        if (name === 'getUserProfile') response = { user: profile };
        if (name === 'getCurrentGuide') response = { guide: { id: profile.id, guideId: profile.userId, fullName: profile.fullName, folkResidencies: [] } };
        if (/getPending|getActiveSadhanaMentors|getResidencyTransferRequests|getResidenciesForGuide|getCleanlinessReviews|getAllResidencies/.test(name)) response = [];
        if (name === 'getGuideRequests') response = { guideTransfers: [], ashrayUpgrades: [] };
        if (name === 'getGuides') response = { guides: [] };
        if (name === 'getMeetings') response = { meetings: [] };
        if (name === 'getPendingAccountLinks') response = [{ id: 'pw-request', email: 'member@example.invalid', status: 'Pending', candidates: [{ id: 'pw-member', userId: 'PW-MEMBER', fullName: 'PW Member', segment: 'PW', role: 'User', status: 'Active' }] }];
        if (name === 'reviewAccountLink') mutations.push(route.request().postDataJSON());
        return route.fulfill({ json: response });
      });
      await page.goto(`${origin}/pw-admin/dashboard#approvals`);
      const label = scenario.width < 640 ? /^Links/ : /^Login links/;
      await page.getByRole('tab', { name: label }).click({ timeout: 45000 });
      await expect(page.getByText('member@example.invalid', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Link this login', exact: true })).toBeVisible();
      await expect(page.getByRole('tab', { name: label })).toContainText('1');
      assert.deepEqual(mutations, []);
      assert.deepEqual(errors, []);
      console.log(`${scenario.role}, ${scenario.isBvSuperAdmin ? 'super admin' : 'admin'}, width ${scenario.width}: Login links tab and request list passed`);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
