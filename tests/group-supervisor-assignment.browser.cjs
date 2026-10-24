// Local UI acceptance. All API calls are mocked; external traffic is blocked.
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });

(async () => {
  const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:3109';
  const browser = await chromium.launch({ headless: true });
  try {
    for (const segment of ['PW', 'FOLK']) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      const profile = { id: 'admin', userId: 'admin', fullName: 'Test Admin', email: 'admin@example.invalid', role: 'ADMIN', status: 'Active', segment, isBvAdmin: true };
      const group = { id: 'group', groupDbId: 'group', groupId: 'group', groupName: 'Shared RGF Group', segment, isActive: true, memberCount: 2, totalSessions: 0, supervisorIds: [], supervisorName: '' };
      const writes = [];
      await context.addInitScript(({ apiKey }) => {
        const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`;
        localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({ uid: 'admin', email: 'admin@example.invalid', emailVerified: true, isAnonymous: false, providerData: [], apiKey, appName: '[DEFAULT]', stsTokenManager: { refreshToken: 'test-only', accessToken: token, expirationTime: Date.now() + 3600000 } }));
      }, { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('accounts:lookup')) return route.fulfill({ json: { users: [{ localId: 'admin', email: profile.email, emailVerified: true }] } });
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const endpoint = url.pathname.split('/').pop();
        let response = {};
        if (endpoint === 'getUserProfile') response = { user: profile };
        if (endpoint === 'getCurrentGuide') response = { guide: { guideId: 'admin', fullName: 'Test Admin' } };
        if (endpoint === 'getGuideUsers') response = { users: [] };
        if (endpoint === 'getPendingApprovals' || endpoint === 'getPendingBvRegistrations') response = [];
        if (endpoint === 'getAllBvGroupsAdmin') response = { groups: [group], bvsls: [], supervisors: [{ userId: 'sup', fullName: 'Assigned Supervisor', email: 'sup@example.invalid' }] };
        if (endpoint === 'updateBvGroup') {
          const input = route.request().postDataJSON();
          writes.push(input);
          group.supervisorIds = input.supervisorId ? [input.supervisorId] : [];
          group.supervisorName = input.supervisorId ? 'Assigned Supervisor' : '';
          response = { success: true };
        }
        if (endpoint === 'getBvGroupDetail') response = { group, members: [], recentSessions: [], quizzes: [], totalSessions: 0, totalQuizzes: 0 };
        if (endpoint === 'getBvAttendanceMatrix') response = { rows: [], dates: [] };
        return route.fulfill({ json: response });
      });
      const dashboard = segment === 'PW' ? '/pw-admin/dashboard' : '/folk-guide/dashboard';
      await page.goto(`${origin}${dashboard}#bhakti-vriksha`, { timeout: 120000 });
      await page.getByRole('button', { name: 'Assign Supervisor', exact: true }).click({ timeout: 60000 });
      await page.locator('#group-supervisor').selectOption('sup');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Supervisor: Assigned Supervisor', { exact: true })).toBeVisible();
      assert.equal(writes[0].groupId, 'group');
      assert.equal(writes[0].supervisorId, 'sup');
      await page.getByText('Shared RGF Group', { exact: true }).click();
      await expect(page.getByText('Supervisor: Assigned Supervisor', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page).toHaveURL(`${origin}${dashboard}#bhakti-vriksha`);
      await page.getByRole('button', { name: 'Assign Supervisor', exact: true }).click();
      await page.locator('#group-supervisor').selectOption('');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Supervisor: Unassigned', { exact: true })).toBeVisible();
      assert.equal(writes.at(-1).supervisorId, '');
      console.log(`${segment}: assign, display, group detail, Back, and unassign passed`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
