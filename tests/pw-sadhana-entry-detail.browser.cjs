// Calendar popup regression with mocked APIs. No live writes.
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });

(async () => {
  const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:3135';
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const today = new Date();
    const month = today.toISOString().slice(0, 7);
    const profile = { id: 'admin-doc', userId: 'admin-doc', email: 'admin@example.invalid', fullName: 'PW Admin', role: 'User', status: 'Active', segment: 'PW', isBvFacilitator: true, isBvsl: true, isBvSupervisor: true };
    let failEntry = true;
    const entryRequests = [];
    await context.addInitScript(({ apiKey }) => {
      const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: 'admin-doc', exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`;
      localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({
        uid: 'admin-doc', email: 'admin@example.invalid', emailVerified: true, isAnonymous: false,
        providerData: [], apiKey, appName: '[DEFAULT]',
        stsTokenManager: { refreshToken: 'test-only', accessToken: token, expirationTime: Date.now() + 3600000 },
      }));
    }, { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY });
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
      if (endpoint === 'getUserDetailForGuide') response = {
        user: { dbId: 'registered-member-doc', userId: 'USER-123', fullName: 'Calendar Test Member', email: 'member@example.invalid', segment: 'PW', status: 'Active', ashrayLevel: 'Jigyasa' },
        metrics: {}, recentEntries: [{ entryDate: `${month}-01`, scorePercent: 88, totalScore: 44, submittedAt: `${month}-01T14:00:00Z` }],
      };
      if (endpoint === 'getBvAttendance') response = { userHistory: [], userTotalPointsThisWeek: 0, leaderboard: [] };
      if (endpoint === 'getEntryDetail') {
        entryRequests.push(route.request().postDataJSON());
        if (failEntry) return route.fulfill({ status: 503, json: { message: 'Read unavailable' } });
        response = { found: true, entry: { entryId: 'ENTRY-16448', entryDate: `${month}-01`, isPw: true,
          scorePercent: 88, totalScore: 44, maxScore: 50, submittedAt: `${month}-01T14:00:00Z`,
          fields: [{ fieldKey: 'chanting', fieldLabel: 'Chanting Rounds', displayValue: '16' }] } };
      }
      if (endpoint === 'getBvPreachingEntry') response = { found: false, entry: null };
      if (endpoint === 'getAshrayUpgradePath') response = { practiceGroups: [] };
      if (endpoint === 'getAshrayChecklist') response = { checkedItems: [] };
      if (endpoint === 'getUserCrmData') response = null;
      if (endpoint === 'getUserProgressStats') response = { entries: [], fieldTrends: [] };
      if (endpoint === 'getPwNotificationConfig') response = { enabled: false, times: [] };
      return route.fulfill({ json: response });
    });
    await page.goto(`${origin}/guide/users/USER-123`);
    await expect(page.getByRole('button', { name: `${month}-01`, exact: true })).toHaveClass(/bg-green-500/);
    await page.getByRole('button', { name: `${month}-01`, exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Unable to load this Sadhana entry.' })).toBeVisible();
    await expect(page.getByText('No entry found for this date.', { exact: true })).toHaveCount(0);
    assert.equal(entryRequests[0].userId, 'registered-member-doc');
    failEntry = false;
    await page.getByRole('button', { name: 'Retry Sadhana entry', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Chanting Rounds', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByText('88%', { exact: true })).toBeVisible();
    await page.getByRole('dialog').screenshot({ path: '/tmp/pw-sadhana-entry-mobile.png' });
    const bounds = await page.getByRole('dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.getByRole('dialog').getByText('Chanting Rounds', { exact: true })).toBeVisible();
    await page.getByRole('dialog').screenshot({ path: '/tmp/pw-sadhana-entry-desktop.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: canonical member lookup, visible read failure, retry and entry detail at mobile and desktop widths');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
