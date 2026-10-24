// All APIs are mocked: no messages or Firebase writes are sent.
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:3135';

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const { nativeShare, period } of [{ nativeShare: true, period: 'Daily' }, { nativeShare: true, period: 'Weekly' }, { nativeShare: false, period: 'Monthly' }]) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.addInitScript(({ apiKey, nativeShare }) => {
        const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: 'guide-a', exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`;
        localStorage.setItem('folk_login_ts', String(Date.now()));
        localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({ uid: 'guide-a', email: 'guide@example.invalid', emailVerified: true, isAnonymous: false, providerData: [], apiKey, appName: '[DEFAULT]', stsTokenManager: { refreshToken: 'test', accessToken: token, expirationTime: Date.now() + 3600000 } }));
        Object.defineProperty(navigator, 'canShare', { value: () => nativeShare });
        Object.defineProperty(navigator, 'share', { value: async data => {
          window.sharedReport = { name: data.files[0].name, type: data.files[0].type, size: data.files[0].size, text: data.text };
        } });
        window.drawnReportText = [];
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
          window.drawnReportText.push(String(text));
          return fillText.call(this, text, ...args);
        };
        const serialize = XMLSerializer.prototype.serializeToString;
        XMLSerializer.prototype.serializeToString = function(node) {
          const result = serialize.call(this, node);
          window.reportSvg = result;
          return result;
        };
      }, { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, nativeShare });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'identitytoolkit.googleapis.com') return route.fulfill({ json: { users: [{ localId: 'guide-a', email: 'guide@example.invalid', emailVerified: true }] } });
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const name = url.pathname.split('/').pop();
        let response = {};
        if (name === 'getUserProfile') response = { user: { id: 'guide-a', userId: 'guide-a', fullName: 'Guide A', email: 'guide@example.invalid', role: 'Guide', status: 'Active', segment: 'FOLK' } };
        if (name === 'getCurrentGuide') response = { guide: { id: 'guide-a', guideId: 'guide-a', fullName: 'Guide A', folkResidencies: [] } };
        if (name === 'getGuides') response = { guides: [] };
        if (name === 'getAllResidencies') response = { residencies: [] };
        if (name === 'getMissingSadhanaReport') response = {
          users: [
            { id: 'missing-1', userId: 'missing-1', fullName: 'Pending Resident', segment: 'FOLK', phone: '9876543210', residencyType: 'Resident', guideName: 'Guide A', residencyName: 'Powai' },
            { id: 'missing-2', userId: 'missing-2', fullName: 'Filtered Nonresident', segment: 'FOLK', phone: '9876543211', residencyType: 'Non-Resident', guideName: 'Guide A' },
          ],
          dates: ['2026-10-19', '2026-10-20'],
          matrix: { 'missing-1': { '2026-10-19': 'missed', '2026-10-20': 'filled' }, 'missing-2': { '2026-10-19': 'filled', '2026-10-20': 'missed' } },
          stats: { totalUsers: 2, totalDays: 2, totalMissing: 2, totalLate: 0, completionRate: 50 }, guides: [],
        };
        if (name === 'getGuideDetailedReport') response = {
          users: ['Included boy', 'Excluded boy', 'Included other level'].map((fullName, i) => ({ id: `boy-${i}`, userId: `boy-${i}`, fullName, ashrayLevel: i === 2 ? 'Sadhak' : 'Sevak', isResident: false, submitted: true, fieldScores: {}, fieldRawValues: {}, scorePercent: 80 })),
          fieldDefs: [], availableResidencies: [], availableGuides: [], summary: {},
        };
        return route.fulfill({ json: response });
      });
      await page.goto(origin + '/folk-guide/dashboard', { timeout: 120000 });
      await expect(page.getByText('Included boy', { exact: true }).first()).toBeVisible({ timeout: 120000 });
      if (period !== 'Daily') {
        await page.getByRole('combobox').filter({ hasText: 'Daily' }).click();
        await page.getByRole('option', { name: period, exact: true }).click();
      }
      await page.getByRole('combobox').filter({ hasText: 'All Levels' }).click();
      await page.getByRole('option', { name: 'Sevak', exact: true }).click();
      await page.getByPlaceholder('Search by name...').fill('Included');
      await page.getByRole('button', { name: 'Share to WhatsApp', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('img')).toBeVisible();
      const drawn = await page.evaluate(() => window.drawnReportText);
      assert.ok(drawn.some(text => text.includes('Included boy')));
      assert.ok(!drawn.some(text => text.includes('Excluded boy')));
      assert.ok(!drawn.some(text => text.includes('Included other level')));
      assert.ok(drawn.includes(`${period} Sadhana Report`));
      assert.ok(drawn.some(text => text.includes('Sevak')));
      if (nativeShare) {
        await dialog.getByRole('button', { name: 'Share to WhatsApp', exact: true }).click();
        const shared = await page.evaluate(() => window.sharedReport);
        assert.equal(shared.type, 'image/png');
        assert.ok(shared.size > 0);
        assert.match(shared.name, /^sadhana-report-.*\.png$/);
      } else {
        await expect(dialog.getByRole('link', { name: 'Open WhatsApp' })).toBeVisible();
        const downloadEvent = page.waitForEvent('download');
        await dialog.getByRole('link', { name: 'Download Image' }).click();
        assert.match((await downloadEvent).suggestedFilename(), /\.png$/);
      }
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: 'Missing Sadhana', exact: true }).filter({ visible: true }).first().click();
      await expect(page.getByText('Pending Resident', { exact: true }).first()).toBeVisible();
      await page.getByRole('combobox').filter({ hasText: 'All Statuses' }).click();
      await page.getByRole('option', { name: 'Resident', exact: true }).click();
      await page.getByRole('button', { name: 'Message Individuals', exact: true }).click();
      const individuals = page.getByRole('dialog');
      await expect(individuals.getByText('Pending Resident', { exact: true })).toBeVisible();
      await expect(individuals.getByText('Filtered Nonresident', { exact: true })).toHaveCount(0);
      const href = await individuals.getByRole('link', { name: /Remind Pending Resident/ }).getAttribute('href');
      const message = new URL(href).searchParams.get('text');
      assert.match(message, /Hare Krishna, Pending Resident Prabhu! 🙏/);
      assert.match(message, /19 Oct 2026/);
      assert.doesNotMatch(message, /20 Oct 2026/);
      await individuals.getByRole('button', { name: 'Close', exact: true }).click();
      if (period === 'Weekly') await page.getByRole('button', { name: 'List', exact: true }).click();
      if (period === 'Monthly') await page.getByRole('button', { name: 'Cards', exact: true }).click();
      await page.getByRole('button', { name: 'Share to WhatsApp Group', exact: true }).click();
      const group = page.getByRole('dialog');
      await expect(group.getByRole('img')).toBeVisible({ timeout: 60000 });
      const svg = await page.evaluate(() => window.reportSvg);
      assert.ok(svg.includes('Pending Resident'));
      assert.ok(!svg.includes('Filtered Nonresident'));
      if (nativeShare) {
        await group.getByRole('button', { name: 'Share Image and Message', exact: true }).click();
        const shared = await page.evaluate(() => window.sharedReport);
        assert.ok(shared.size > 0);
        assert.match(shared.name, /^missing-sadhana-.*\.png$/);
        assert.match(shared.text, /Hare Krishna, Prabhus! 🙏/);
        assert.match(shared.text, /attached report/);
        assert.doesNotMatch(shared.text, /Pending Resident|2026-10/);
      } else {
        await expect(group.getByRole('button', { name: 'Copy Message' })).toBeVisible();
        await expect(group.getByRole('link', { name: 'Download Image' })).toBeVisible();
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${period} filtered PNG ${nativeShare ? 'native share' : 'download fallback'}`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
