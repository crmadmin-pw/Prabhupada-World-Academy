// Local browser regression. External traffic is blocked and every API is mocked.
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:3135';

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const profile = { id: 'sonia-test', userId: 'USER-SONIA', fullName: 'Sonia Uppal', email: 'sonia@example.invalid',
        role: 'User', status: 'Active', segment: 'PW', isBvsl: true, isBvFacilitator: true, isBvSupervisor: true, isBvMentor: true };
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [], reads = [], writes = [], meetings = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.addInitScript(({ profile, apiKey }) => {
        const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`;
        localStorage.setItem('folk_login_ts', String(Date.now()));
        localStorage.setItem('folk_install_dismissed', '1');
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
        if (endpoint === 'getBvslGroups') response = { groups: [{ id: 'gauranga', groupId: 'GAURANGA', groupName: 'Gauranga', memberCount: 2 }] };
        if (endpoint === 'getBvslMembers') response = { members: [] };
        if (endpoint === 'getAttendanceForDate') response = { members: [], sessionExists: false, totalMeetingMinutes: 60 };
        if (endpoint === 'getBvSupervisorOverview') response = { groups: [{ id: 'gadadhara', groupName: 'Gadadhara', memberCount: 2 }], rgfs: [] };
        if (endpoint === 'getMeetings') response = { meetings: [] };
        if (endpoint === 'getGuides') response = { guides: [] };
        if (endpoint === 'getPwNotificationConfig') response = { enabled: false, times: [] };
        if (endpoint === 'getBvslOneToOneData') {
          const input = route.request().postDataJSON();
          reads.push(input);
          const own = input.viewScope === 'facilitator';
          response = { users: [{ userId: own ? 'own-member' : 'supervised-member', fullName: own ? 'Gauranga Member' : 'Gadadhara Member',
            groupId: own ? 'gauranga' : 'gadadhara', groupName: own ? 'Gauranga' : 'Gadadhara', eligibility: 'Guide', roleLabel: 'User', ashrayLevel: 'Jigyasa' }],
            weeks: ['2026-11-02'], meetings: own ? meetings : [], allAdmins: [], bvslLink: '' };
        }
        if (endpoint === 'getOneToOneContext') response = { weeks: [], improvementAreas: [] };
        if (endpoint === 'logOneToOneMeeting') {
          const input = route.request().postDataJSON();
          writes.push(input);
          meetings.push({ ...input, id: 'saved-call', guideId: profile.id });
          response = { id: 'saved-call', created: true };
        }
        return route.fulfill({ json: response });
      });

      await page.goto(`${origin}/bvsl/dashboard#onetone`);
      await expect(page.getByText('Gauranga Member', { exact: true }).first()).toBeVisible({ timeout: 60000 });
      await expect(page.getByText('Gadadhara Member', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Members of your own reading groups.', { exact: false })).toBeVisible();
      assert.equal(reads.at(-1).viewScope, 'facilitator');
      await page.getByRole('button', { name: 'Log Call', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByPlaceholder('e.g. 20').fill('20');
      await dialog.getByPlaceholder('Topics discussed, follow-ups, observations...').fill('Own Gauranga group call');
      await dialog.getByPlaceholder('https://drive.google.com/file/... or recording URL').fill('https://example.test/recording');
      await dialog.getByRole('button', { name: 'Log Meeting', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      assert.equal(writes[0].memberId, 'own-member');
      assert.equal(writes[0].recordingLink, 'https://example.test/recording');
      await page.goto(`${origin}/bv-supervisor/dashboard#callreports`);
      await expect(page.getByText('Gadadhara Member', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Gauranga Member', { exact: true })).toHaveCount(0);
      assert.equal(reads.at(-1).viewScope, 'supervisor');
      await page.goto(`${origin}/bvsl/dashboard#onetone`);
      await expect(page.getByText('Gauranga Member', { exact: true }).first()).toBeVisible();
      assert.equal(reads.at(-1).viewScope, 'facilitator');
      assert.deepEqual(errors, []);
      console.log(`${width}px: dual-role RGF scope, call save, supervisor scope and switching back passed`);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
