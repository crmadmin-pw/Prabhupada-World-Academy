// Local browser regression: all APIs mocked, external traffic blocked.
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:3135';

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const { width, segment } of [{ width: 1440, segment: 'PW' }, { width: 390, segment: 'PW' }, { width: 390, segment: 'FOLK' }]) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 1000 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const profile = { id: 'duration-admin', userId: 'duration-admin', email: 'admin@example.invalid', fullName: 'PW Admin',
        role: 'SUPER_ADMIN', status: 'Active', segment: 'PW', isBvSuperAdmin: true };
      await context.addInitScript(({ profile, apiKey }) => {
        const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`;
        localStorage.setItem('folk_login_ts', String(Date.now()));
        sessionStorage.setItem('folk_error_reload_ts', String(Date.now()));
        localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({ uid: profile.id, email: profile.email, emailVerified: true,
          isAnonymous: false, providerData: [], apiKey, appName: '[DEFAULT]', stsTokenManager: { refreshToken: 'test-only', accessToken: token, expirationTime: Date.now() + 3600000 } }));
      }, { profile, apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('accounts:lookup')) {
          return route.fulfill({ json: { users: [{ localId: profile.id, email: profile.email, emailVerified: true }] } });
        }
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const endpoint = url.pathname.split('/').pop();
        let response = {};
        if (endpoint === 'getUserProfile') response = { user: profile };
        if (endpoint === 'getUserDetailForGuide') response = { user: { dbId: 'duration-member', userId: 'DURATION-MEMBER',
          fullName: 'Duration Member', email: 'member@example.invalid', segment, status: 'Active', ashrayLevel: 'Jigyasa' }, metrics: {}, recentEntries: [] };
        if (endpoint === 'getBvAttendance') response = { userHistory: [], leaderboard: [] };
        if (endpoint === 'getAshrayUpgradePath') response = { practiceGroups: [] };
        if (endpoint === 'getAshrayChecklist') response = { checkedItems: [] };
        if (endpoint === 'getUserCrmData') response = null;
        if (endpoint === 'getPwNotificationConfig') response = { enabled: false, times: [] };
        if (endpoint === 'getUserProgressStats') {
          const missing = route.request().postDataJSON().period === 'monthly';
          response = { isPw: segment === 'PW', isResident: false, submittedCount: 2, entries: [
            { label: 'Nov 1', date: '2026-11-01', pwHearingMinutes: missing ? null : 75.5, pwSevaMinutes: missing ? null : 90, hearing: 60, seva: 1, scorePercent: 73 },
          ], fieldTrends: segment === 'PW' ? [
            { field: 'pwHearingMinutes', label: 'Hearing', unit: 'min', avg: missing ? null : 75.5, trend: 'flat' },
            { field: 'pwSevaMinutes', label: 'Seva', unit: 'min', avg: missing ? null : 90, trend: 'flat' },
            { field: 'pwHearingPts', label: 'Hearing points', unit: 'pts', avg: 4, trend: 'flat' },
            { field: 'pwSevaPts', label: 'Seva points', unit: 'pts', avg: 2, trend: 'flat' },
          ] : [{ field: 'seva', label: 'Seva', unit: 'Yes/No', avg: 1, trend: 'flat' }], insightFields: [] };
        }
        return route.fulfill({ json: response });
      });
      await page.goto(`${origin}/guide/users/DURATION-MEMBER`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (segment === 'PW') {
        const hearing = page.getByRole('button', { name: /^Hearing\s*min$/ });
        await expect(hearing).toBeVisible({ timeout: 30000 });
        await expect(page.getByRole('button', { name: /^Seva\s*min$/ })).toBeVisible();
        await expect(page.getByText('75.5min', { exact: false }).first()).toBeVisible();
        await expect(page.getByText('90min', { exact: false }).first()).toBeVisible();
        await expect(page.getByText('Hearing points', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^Seva\s*pts$/ })).toHaveCount(0);
        await hearing.click();
        await expect(page.locator('.recharts-cartesian-axis-tick-value').filter({ hasText: 'm' }).first()).toBeVisible();
        await page.getByRole('button', { name: 'Monthly', exact: true }).click();
        await expect(page.getByText('Not recorded', { exact: true })).toHaveCount(2);
        await expect(page.getByText('75.5min', { exact: false })).toHaveCount(0);
        await expect(page.getByText(/Hearing and seva show reported minutes/)).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: /^Seva\s*Yes\/No$/ })).toBeVisible({ timeout: 30000 });
        await expect(page.getByRole('button', { name: /^Seva\s*min$/ })).toHaveCount(0);
        await expect(page.getByText(/Hearing and seva show reported minutes/)).toHaveCount(0);
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${segment} duration labels and missing-data display (${width}px)`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
