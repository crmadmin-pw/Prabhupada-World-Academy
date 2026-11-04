// Local browser regression. All APIs are mocked; external traffic is blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium, expect } = require('@playwright/test');
const { unzipSync, strFromU8 } = require('fflate');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:3135';

async function readWorkbook(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.xlsx$/);
  const entries = unzipSync(await fs.readFile(await download.path()));
  return {
    filename: download.suggestedFilename(),
    text: strFromU8(entries['xl/sharedStrings.xml']),
    sheet: strFromU8(entries['xl/worksheets/sheet1.xml']),
    details: strFromU8(entries['xl/worksheets/sheet2.xml']),
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const { width, segment } of [{ width: 1440, segment: 'PW' }, { width: 390, segment: 'PW' }, { width: 390, segment: 'FOLK' }]) {
      const profile = { id: 'excel-admin', userId: 'USER-EXCEL', fullName: 'Excel Admin', email: 'excel@example.invalid',
        role: 'ADMIN', status: 'Active', segment, isBvAdmin: true, isBvsl: true, isBvFacilitator: true };
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [], reads = [];
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
        if (endpoint === 'getCurrentGuide') response = { name: profile.fullName };
        if (endpoint === 'getGuides') response = { guides: [] };
        if (endpoint === 'getBvslGroups') response = { groups: [] };
        if (endpoint === 'getBvslMembers') response = { members: [] };
        if (['getPendingApprovals', 'getPendingBvRegistrations'].includes(endpoint)) response = [];
        if (endpoint === 'getGuideRequests') response = { ashrayUpgrades: [] };
        if (endpoint === 'getBvSessionMatrix') {
          const input = route.request().postDataJSON(); reads.push(input);
          response = { members: [
            { userId: 'present', fullName: 'Present Member', ashrayLevel: 'Jigyasa', groupId: 'gauranga', groupName: 'Gauranga' },
            { userId: 'missing', fullName: 'Missing Entry', ashrayLevel: 'Sevak', groupId: 'gauranga', groupName: 'Gauranga' },
            { userId: 'absent', fullName: 'Other Group Member', groupId: 'other', groupName: 'Other BV' },
          ], groups: [{ id: 'gauranga', name: 'Gauranga' }, { id: 'other', name: 'Other BV' }],
          allDates: [input.startDate], sessionDates: [input.startDate],
          attendance: { present: { [input.startDate]: true }, absent: { [input.startDate]: false } },
          quizScores: { present: { [input.startDate]: 75 } } };
        }
        if (endpoint === 'getGuideDetailedReport') response = { users: [
          { id: 'present', userId: 'present', fullName: 'Present Member', ashrayLevel: 'Jigyasa', segment: 'PW', isResident: false,
            submitted: true, fieldScores: {}, currentStreak: 3, scorePercent: 50, pwScorePercent: 75 },
          { id: 'missing', userId: 'missing', fullName: 'Missing Entry', ashrayLevel: 'Sevak', segment: 'PW', isResident: false,
            submitted: false, fieldScores: {}, currentStreak: 0, scorePercent: null },
        ], fieldDefs: [], availableResidencies: [] };
        if (endpoint === 'getBvPreachingReport') response = { groups: [], bvsls: [
          { id: 'rgf', fullName: 'Submitted RGF', groupName: 'Gauranga', submitted: true, callingTime: 45,
            oneOnOneTime: 10, bookDistTime: 0, rduaTime: 0, planTime: 5, booksDistributed: 2, contactsCollected: 0, uniqueOneOnOnes: 1, totalMinutes: 60 },
          { id: 'missing-rgf', fullName: 'Missing RGF', groupName: 'Gauranga', submitted: false },
        ] };
        return route.fulfill({ json: response });
      });
      await page.goto(`${origin}${segment === 'PW' ? '/pw-admin/dashboard#bv' : '/bvsl/dashboard#bvreport'}`);
      const button = page.getByRole('button', { name: 'Export Excel', exact: true });
      await expect(button).toBeEnabled({ timeout: 60000 });
      let workbook = await readWorkbook(page);
      assert.match(workbook.text, /Other Group Member/);
      assert.match(workbook.text, /Absent/);
      if (segment === 'PW') assert.doesNotMatch(workbook.text, /Quiz/); // PW reports are attendance only.
      else assert.match(workbook.text, /Quiz/);
      await page.getByRole('combobox').filter({ hasText: 'All BVs' }).click();
      await page.getByRole('option', { name: 'Gauranga', exact: true }).click();
      workbook = await readWorkbook(page);
      assert.match(workbook.filename, /gauranga/);
      assert.match(workbook.text, /Missing Entry/);
      assert.match(workbook.text, /Present/);
      assert.doesNotMatch(workbook.text, /Other Group Member|Absent/);
      assert.match(workbook.sheet, /<v>100<\/v>/);
      assert.match(workbook.text, new RegExp(reads.at(-1).startDate));
      if (width < 768) await page.getByRole('button', { name: /Filters/ }).click();
      if (segment === 'FOLK') {
        await page.getByRole('combobox').filter({ hasText: 'Both' }).click();
        await page.getByRole('option', { name: 'Quiz Only', exact: true }).click();
      }
      await page.getByRole('combobox').filter({ hasText: 'Weekly' }).click();
      await page.getByRole('option', { name: 'Monthly', exact: true }).click();
      if (width < 768) await page.keyboard.press('Escape');
      await expect(button).toBeEnabled();
      workbook = await readWorkbook(page);
      assert.match(workbook.text, /monthly/);
      assert.match(workbook.filename, new RegExp(reads.at(-1).endDate));
      if (segment === 'FOLK') {
        assert.doesNotMatch(workbook.text, /\d{4}-\d{2}-\d{2} Attendance|<t>Att%<\/t>/);
        assert.match(workbook.sheet, /<v>75<\/v>/);
        await page.getByRole('button', { name: 'RGF/RGSF Report', exact: true }).click();
        await expect(button).toBeEnabled();
        workbook = await readWorkbook(page);
        assert.match(workbook.filename, /rgf-report/);
        assert.match(workbook.text, /Submitted RGF/);
        assert.match(workbook.text, /Missing RGF/);
        assert.match(workbook.sheet, /<v>45<\/v>/);
        assert.deepEqual(errors, []);
        await context.close();
        console.log(`PASS Excel downloads: FOLK quiz filter and RGF preaching (${width}px)`);
        continue;
      }
      await page.getByRole('button', { name: 'RGF/RGSF Sadhana', exact: true }).click();
      await expect(button).toBeEnabled();
      workbook = await readWorkbook(page);
      assert.match(workbook.filename, /sadhana-report/);
      assert.match(workbook.text, /Submitted/);
      assert.match(workbook.text, /Missing Entry/);
      assert.match(workbook.sheet, /<v>75<\/v>/); // Saved PW score, not the generic score.
      await expect(button).toBeEnabled();
      const box = await button.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, 'Excel button fits viewport');
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS Excel downloads: weekly, monthly, filtered BV and Sadhana (${width}px)`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
