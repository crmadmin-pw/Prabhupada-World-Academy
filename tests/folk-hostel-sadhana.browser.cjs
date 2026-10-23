// Built UI smoke test with mocked APIs; never writes to live Firebase.
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:3135';

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const superGuide of [false, true]) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1500, height: 1000 } });
      const page = await context.newPage();
      const writes = [], errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const profile = { id: 'guide-a', userId: 'guide-a', fullName: 'Guide A', email: 'guide-a@example.invalid', role: superGuide ? 'SUPER_GUIDE' : 'Guide', status: 'Active', segment: 'FOLK' };
      const guides = [{ guideId: 'guide-a', name: 'Guide A' }, { guideId: 'guide-b', name: 'Guide B' }];
      const centers = [{ residencyId: 'powai', residencyName: 'FOLK Powai', isActive: true, residentCount: 2, guides: [{ guideId: 'guide-a', recordId: 'guide-a', guideName: 'Guide A', residentCount: 2 }], assignedGuideIds: ['guide-a'], monthlyAvgs: [], quarterAvg: null }];
      const members = ['Direct boy', 'Hostel peer', 'Cross-hostel resident'].map((fullName, index) => ({ id: 'member-' + index, userId: 'member-' + index, fullName, segment: 'FOLK', submitted: true, isResident: false, guideId: index === 1 ? 'guide-b' : 'guide-a', fieldScores: {}, fieldRawValues: {}, totalScore: 16, scorePercent: 80, currentStreak: 3 }));
      await context.addInitScript(({ apiKey }) => {
        const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: 'guide-a', exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`;
        localStorage.setItem('folk_login_ts', String(Date.now()));
        localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({ uid: 'guide-a', email: 'guide-a@example.invalid', emailVerified: true, isAnonymous: false, providerData: [], apiKey, appName: '[DEFAULT]', stsTokenManager: { refreshToken: 'test-only', accessToken: token, expirationTime: Date.now() + 3600000 } }));
      }, { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('accounts:lookup')) return route.fulfill({ json: { users: [{ localId: 'guide-a', email: profile.email, emailVerified: true }] } });
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const name = url.pathname.split('/').pop();
        const input = route.request().postDataJSON() || {};
        let response = {};
        if (name === 'getUserProfile') response = { user: profile };
        if (name === 'getCurrentGuide') response = { guide: { id: 'guide-a', guideId: 'guide-a', fullName: 'Guide A', folkResidencies: ['powai'] } };
        if (name === 'getGuides') response = { guides };
        if (name === 'getAllResidencies') response = { residencies: centers };
        if (name === 'getAllResidenciesWithStats') response = centers;
        if (name === 'getGuideDetailedReport') response = { users: input.filterGuideId ? members.filter(u => u.guideId === input.filterGuideId) : members, fieldDefs: [], availableResidencies: [{ residencyId: 'powai', residencyName: 'FOLK Powai' }], availableGuides: guides.map(g => ({ guideId: g.guideId, guideName: g.name })), summary: {} };
        if (/getPending|getCleanlinessReviews|getResidencyTransferRequests|getGuideResidencyAssignmentRequests/.test(name)) response = [];
        if (name === 'getGuideRequests') response = { guideTransfers: [], ashrayUpgrades: [] };
        if (name === 'createResidency') {
          writes.push({ name, input });
          centers.push({ ...centers[0], residencyId: 'new-hostel', residencyName: input.residencyName, guides: [], assignedGuideIds: [] });
          response = { success: true, residencyId: 'new-hostel' };
        }
        if (name === 'assignFolkResidencyGuides') { writes.push({ name, input }); response = { success: true }; }
        return route.fulfill({ json: response });
      });
      await page.goto(origin + '/folk-guide/dashboard');
      await expect(page.getByText('Hostel peer', { exact: true }).first()).toBeVisible({ timeout: 20000 });
      await expect(page.getByText('Cross-hostel resident', { exact: true }).first()).toBeVisible();
      if (!superGuide) {
        await page.getByRole('combobox').filter({ hasText: 'All Guides' }).first().click();
        await page.getByRole('option', { name: 'Guide B', exact: true }).click();
        await expect(page.getByText('Hostel peer', { exact: true }).first()).toBeVisible();
        await expect(page.getByText('Direct boy', { exact: true })).toHaveCount(0);
      } else {
        await page.getByRole('button', { name: 'Residencies / Hostels', exact: true }).filter({ visible: true }).first().click();
        await page.getByRole('textbox', { name: 'New FOLK hostel name' }).fill('New Test Hostel');
        await page.getByRole('button', { name: 'Create hostel', exact: true }).click();
        await expect(page.getByText('New Test Hostel', { exact: true })).toBeVisible();
        assert.equal(writes[0].input.residencyName, 'New Test Hostel');
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ role: superGuide ? 'FOLK Super Guide' : 'FOLK Guide', passed: true }));
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
