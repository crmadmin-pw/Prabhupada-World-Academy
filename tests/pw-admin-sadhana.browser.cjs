// Real app UI with mocked APIs and all external traffic blocked. No live writes.
// DASHBOARD_TEST_ORIGIN=http://127.0.0.1:3135 node tests/pw-admin-sadhana.browser.cjs
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:3135';

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const kind of ['admin', 'super', 'folk-guide', 'folk-super']) {
      const folk = kind.startsWith('folk');
      const superAdmin = kind === 'super';
      const profile = { id: 'test-admin', userId: 'TEST-ADMIN', email: 'admin@example.invalid', fullName: 'Test Admin',
        status: 'Active', segment: folk ? 'FOLK' : 'PW', role: folk ? (kind === 'folk-super' ? 'SUPER_GUIDE' : 'GUIDE') : 'User',
        isBvAdmin: !folk, isBvSuperAdmin: superAdmin, ashrayLevel: 'Sevak' };
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1500, height: 1000 } });
      const page = await context.newPage();
      const errors = [], requests = [], targetWrites = [];
      let saved = false;
      page.on('pageerror', error => errors.push(error.message));
      await context.addInitScript(({ apiKey, email }) => {
        const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: 'test-admin', exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`;
        localStorage.setItem('folk_login_ts', String(Date.now()));
        localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({ uid: 'test-admin', email,
          emailVerified: true, isAnonymous: false, providerData: [], apiKey, appName: '[DEFAULT]',
          stsTokenManager: { refreshToken: 'test-only', accessToken: token, expirationTime: Date.now() + 3600000 } }));
      }, { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, email: profile.email });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('accounts:lookup')) {
          return route.fulfill({ json: { users: [{ localId: 'test-admin', email: profile.email, emailVerified: true }] } });
        }
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const endpoint = url.pathname.split('/').pop();
        const input = route.request().postDataJSON() || {};
        requests.push(endpoint);
        let response = {};
        if (endpoint === 'getUserProfile') response = { user: profile };
        if (endpoint === 'getCurrentGuide') response = { guide: { id: profile.id, guideId: profile.userId, fullName: profile.fullName, folkResidencies: [] } };
        if (endpoint === 'getAllResidencies') response = [];
        if (endpoint === 'getGuides') response = { guides: [] };
        if (endpoint === 'getActiveSadhanaMentors' || endpoint.startsWith('getPending') || endpoint === 'getCleanlinessReviews') response = [];
        if (endpoint === 'getGuideRequests') response = { guideTransfers: [], ashrayUpgrades: [] };
        if (endpoint === 'getMeetings') response = { meetings: [] };
        if (endpoint === 'getPwNotificationConfig') response = { enabled: false, times: [] };
        if (endpoint === 'getGuideDetailedReport') response = { users: superAdmin ? [{ id: 'private-admin', userId: 'PRIVATE-ADMIN', fullName: 'PW Admin Participant', submitted: true, isResident: false, fieldScores: {}, fieldRawValues: {}, scorePercent: 80 }] : [], fieldDefs: [], availableGuides: [], availableResidencies: [], summary: {} };
        if (endpoint === 'listPwStaffTargets') response = { members: [
          ...(superAdmin ? [{ userId: 'PRIVATE-ADMIN', fullName: 'PW Admin Participant', roleLabel: 'Admin', pwTargets: {} }] : []),
          { userId: 'RGF', fullName: 'Reading Group Facilitator', roleLabel: 'RGF', pwTargets: {} },
        ] };
        if (endpoint === 'getPwAshrayaTargets') response = { levels: {}, submissionDeadline: '10:00', canEdit: true };
        if (endpoint === 'setPwSadhanaTargets') {
          targetWrites.push(input);
          response = { success: true, source: 'super_admin', pwTargets: input };
        }
        if (endpoint === 'getUserDashboardData') response = { metrics: { todaySubmitted: saved, entriesThisWeek: saved ? 1 : 0 }, recentEntries: [] };
        if (endpoint === 'getUserProgressStats') response = { isPw: true, entries: [], fieldTrends: [], insightFields: [] };
        if (endpoint === 'getCleanlinessForSadhana') response = { enabled: false };
        if (endpoint === 'getSadhanaFormData') response = { exists: false, isPw: true, isResident: false, templateMode: 'NR_TEMPLATE', pwTargetSource: 'super_admin',
          pwTargets: { chanting: 16 }, fields: [{ fieldId: 'chanting', fieldKey: 'chanting', fieldLabel: 'Chanting Rounds', fieldType: 'number',
            isRequired: false, contributesToScore: false, maxPoints: 0, displayOrder: 1, options: [], group: 'Daily', helpText: 'Chanting set by your super admin: 16 rounds' }] };
        if (endpoint === 'submitSadhana') {
          saved = true;
          response = { success: true, entryId: 'saved-admin-entry', isUpdate: false, totalScore: 8, maxScore: 16, scorePercent: 50 };
        }
        return route.fulfill({ json: response });
      });

      const root = folk ? '/folk-guide/dashboard' : '/pw-admin/dashboard';
      await page.goto(`${origin}${root}`);
      if (folk) await expect(page.getByRole('heading', { name: /FOLK.*Dashboard/ })).toBeVisible({ timeout: 45000 });
      else await expect(page.getByText('Sadhana Reports', { exact: true })).toBeVisible({ timeout: 45000 });
      const mySadhana = page.getByRole('button', { name: 'My Sadhana', exact: true });
      if (folk) {
        await expect(mySadhana).toHaveCount(0);
      } else if (superAdmin) {
        await expect(mySadhana).toHaveCount(0);
        await expect(page.getByText('PW Admin Participant', { exact: true }).first()).toBeVisible();
        await page.getByRole('button', { name: 'Sadhana Targets', exact: true }).click();
        const adminRow = page.getByRole('listitem').filter({ hasText: 'PW Admin Participant' });
        await expect(adminRow).toBeVisible();
        await adminRow.getByRole('button', { name: 'Assign Sadhana' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Wake-up', { exact: true }).fill('04:30');
        await dialog.getByLabel('Sleep', { exact: true }).fill('22:00');
        await dialog.getByLabel('Chanting rounds').fill('16');
        await dialog.getByLabel('Reading minutes').fill('30');
        await dialog.getByLabel('Hearing minutes').fill('45');
        await dialog.getByLabel('Seva minutes').fill('60');
        await dialog.getByRole('button', { name: 'Save targets' }).click();
        await expect(dialog).toHaveCount(0);
        assert.deepEqual(targetWrites, [{ userId: 'PRIVATE-ADMIN', wakeUp: '04:30', sleep: '22:00', chantingRounds: 16, readingMinutes: 30, hearingMinutes: 45, sevaMinutes: 60 }]);
        await page.goto(`${origin}/sadhana`);
        await expect(page).toHaveURL(`${origin}${root}`);
        assert.ok(!requests.includes('getSadhanaFormData'));
      } else {
        await expect(mySadhana).toBeVisible();
        await page.getByRole('button', { name: 'Sadhana Targets', exact: true }).click();
        await expect(page.getByText('Reading Group Facilitator', { exact: true })).toBeVisible();
        await expect(page.getByText('PW Admin Participant', { exact: true })).toHaveCount(0);
        await mySadhana.click();
        await expect(page).toHaveURL(`${origin}/user/pw-dashboard`);
        await page.getByRole('button', { name: 'Fill / Edit Sadhana Form', exact: true }).click();
        // Before 6 PM today's form is intentionally locked for every PW role.
        const previousDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        await page.goto(`${origin}/sadhana?date=${previousDate}`);
        await expect(page.getByText('Chanting set by your super admin: 16 rounds', { exact: true })).toBeVisible();
        await page.locator('label').filter({ hasText: 'I solemnly declare' }).click();
        await page.getByRole('button', { name: 'Submit Sadhana', exact: true }).click();
        await expect(page).toHaveURL(`${origin}/user/pw-dashboard#sadhana`);
        assert.equal(saved, true);
      }
      assert.deepEqual(errors, []);
      console.log(`${kind}: navigation, private reports and target/form controls passed`);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
