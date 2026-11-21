// Run against a locally built app: npm run start -- --port 3107
// All API traffic is mocked and external requests are blocked.
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });

async function main() {
  const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:3107';
  const browser = await chromium.launch({ headless: true });
  try {
    for (const segment of ['PW', 'FOLK']) {
      const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Asia/Kolkata' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const profile = { id: 'test-member', userId: 'test-member', fullName: `${segment} Test Member`,
        email: 'dashboard@example.invalid', role: 'User', status: 'Active', segment, ashrayLevel: 'Sevak',
        residencyApproved: true, residencyGuideVerified: true, selectedFolkResidency: 'test-residency', residencyName: 'Test Residency' };
      const canonical = segment === 'PW' ? '/user/pw-dashboard' : '/user/folk-dashboard';
      const opposite = segment === 'PW' ? '/user/folk-dashboard' : '/user/pw-dashboard';
      let saved = false;
      let dashboardReads = 0;
      const indiaNow = Date.now() + 330 * 60_000;
      const today = new Date(indiaNow).toISOString().slice(0, 10);
      const yesterday = new Date(indiaNow - 86_400_000).toISOString().slice(0, 10);
      await page.clock.setFixedTime(new Date(`${today}T21:00:00+05:30`));
      // Seed a test-only Firebase session so the actual endpoint client can
      // obtain a token. No test token or API call is sent to a real server.
      await context.addInitScript(({ apiKey }) => {
        const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: 'test-member', exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`;
        localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({
          uid: 'test-member', email: 'dashboard@example.invalid', emailVerified: true, isAnonymous: false,
          providerData: [], apiKey, appName: '[DEFAULT]',
          stsTokenManager: { refreshToken: 'test-only', accessToken: token, expirationTime: Date.now() + 3600000 },
        }));
      }, { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('accounts:lookup')) {
          return route.fulfill({ json: { users: [{ localId: 'test-member', email: profile.email, emailVerified: true }] } });
        }
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const endpoint = url.pathname.split('/').pop();
        let response = {};
        if (endpoint === 'getUserProfile') response = { user: profile };
        if (endpoint === 'getUserDashboardData') {
          dashboardReads++;
          // A stale summary still claims yesterday's 96% as today's score.
          response = { metrics: { todaySubmitted: true, todayPercent: 96, entriesThisWeek: saved ? 2 : 1 },
            recentEntries: saved
              ? [{ entryId: 'saved-entry', entryDate: today, scorePercent: 75, submittedAt: new Date().toISOString() }]
              : [{ entryId: 'yesterday-entry', entryDate: yesterday, scorePercent: 96 }] };
        }
        if (endpoint === 'getUserProgressStats') response = { isPw: segment === 'PW', entries: [], fieldTrends: [], insightFields: [] };
        if (endpoint === 'getSadhanaLeaderboard') response = { leaderboard: [], currentUserAshrayLevel: 'Sevak' };
        if (endpoint === 'getMeetings') response = { meetings: [] };
        if (endpoint === 'getPwNotificationConfig') response = { enabled: false, times: [], title: '', body: '' };
        if (endpoint === 'getCleanlinessForSadhana') response = { enabled: false };
        if (endpoint === 'getSadhanaFormData') response = { exists: false, isResident: segment === 'FOLK', isOfficialResident: segment === 'FOLK',
          templateMode: segment === 'FOLK' ? 'RESIDENT_TEMPLATE' : 'NON_RESIDENT_TEMPLATE',
          fields: [{ fieldId: 'test-field', fieldKey: segment === 'FOLK' ? 'rounds' : 'chanting', fieldLabel: 'Chanting Rounds', fieldType: 'number',
            isRequired: false, contributesToScore: false, maxPoints: 0, displayOrder: 1, options: [], group: 'Daily' }] };
        if (endpoint === 'submitSadhana') {
          saved = true;
          response = { success: true, entryId: 'saved-entry', isUpdate: false, totalScore: 12, maxScore: 16, scorePercent: 75 };
        }
        return route.fulfill({ json: response });
      });

      await page.goto(`${origin}/user/dashboard?source=bookmark#leaderboard`);
      await expect(page).toHaveURL(`${origin}${canonical}?source=bookmark#leaderboard`);
      await expect(page.getByRole('tab', { name: 'Leaderboard', exact: true })).toHaveAttribute('aria-selected', 'true');
      await page.goto(`${origin}${opposite}#sadhana`);
      await expect(page).toHaveURL(`${origin}${canonical}#sadhana`);
      await expect(page.getByRole('button', { name: 'Fill / Edit Sadhana Form', exact: true })).toBeVisible();
      await expect(page.getByText('Not submitted yet', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: today, exact: true })).not.toHaveClass(/bg-green-500/);
      await expect(page.getByRole('tab', { name: 'Cleanliness', exact: true })).toHaveCount(segment === 'FOLK' ? 1 : 0);
      const mySadhana = page.getByRole('button', { name: 'My Sadhana', exact: true });
      await expect(mySadhana).toHaveClass(/bg-primary/);
      await mySadhana.click();
      await expect(page).toHaveURL(`${origin}${canonical}`);
      await page.getByRole('button', { name: 'Fill / Edit Sadhana Form', exact: true }).click();
      await expect(page).toHaveURL(`${origin}/sadhana`);
      await expect(page.locator('#sadhana-acknowledgement')).toBeVisible();
      await page.getByRole('button', { name: /Back/ }).first().click();
      await expect(page).toHaveURL(`${origin}${canonical}#sadhana`);

      await page.getByRole('button', { name: 'Fill / Edit Sadhana Form', exact: true }).click();
      await page.locator('label').filter({ hasText: 'I solemnly declare' }).click();
      const readsBeforeSave = dashboardReads;
      await page.getByRole('button', { name: 'Submit Sadhana', exact: true }).click();
      await expect(page).toHaveURL(`${origin}${canonical}#sadhana`);
      await expect(page.getByRole('button', { name: 'Edit Entry', exact: true })).toBeVisible();
      await expect(page.getByText('75%', { exact: true })).toBeVisible();
      assert.ok(saved, 'form must submit successfully');
      assert.ok(dashboardReads > readsBeforeSave, 'dashboard must refresh after save');
      assert.deepEqual(errors, [], 'dashboard and form should render without runtime errors');
      console.log(`${segment}: legacy redirect, department guard, selected tab, residency visibility, header, form back and save passed`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
