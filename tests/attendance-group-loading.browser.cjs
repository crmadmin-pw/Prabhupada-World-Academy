// Isolated real-component browser test. Endpoint calls are mocked; no Firebase access.
const assert = require('node:assert/strict');
const http = require('node:http');
const esbuild = require('esbuild');
const { chromium, expect } = require('@playwright/test');

async function main() {
  const built = await esbuild.build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import Attendance from './src/components/bvsl/BvslSessionPanel';
      function Harness() {
        const [groups, setGroups] = useState([]);
        window.setAttendanceGroups = setGroups;
        return <Attendance bvslId="USER-YOGA" groups={groups} />;
      }
      createRoot(document.getElementById('root')).render(<Harness />);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'mock-endpoints', setup(build) {
      build.onResolve({ filter: /^@\/lib\/(?:app-)?endpoints-sdk$/ }, () => ({ path: 'endpoints', namespace: 'attendance-test' }));
      build.onLoad({ filter: /.*/, namespace: 'attendance-test' }, () => ({ contents: `
        async function api(name, body) {
          const response = await fetch('/api/' + name, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
          if (!response.ok) throw Object.assign(new Error('Unable to load attendance'), {status:response.status});
          return response.json();
        }
        export const getAttendanceForDate = body => api('read', body);
        export const conductBvSession = body => api('save', body);
        export const observeEndpointReads = request => request();
        export const retainEndpointQuery = () => () => {};
      ` }));
    } }],
  });
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? built.outputFiles[0].contents : '<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const sri = { id: 'sri-advaita', groupId: 'SRI-ADVAITA', groupName: 'Sri Advaita' };
  const other = { id: 'other-group', groupId: 'OTHER', groupName: 'Other assigned group' };
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [], reads = [], writes = [];
      let fail = false, saved = false;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/*', async route => {
        const input = route.request().postDataJSON();
        if (route.request().url().endsWith('/save')) {
          writes.push(input); saved = true;
          return route.fulfill({ json: { success: true } });
        }
        reads.push(input);
        if (fail) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
        const own = input.groupId === sri.id;
        return route.fulfill({ json: { totalMeetingMinutes: saved ? 40 : 60, sessionExists: saved,
          members: (own ? ['Yogalakshmi Shrinivas', 'Sri Advaita Member'] : ['Other Member']).map((name, index) => ({
            userDbId: `${input.groupId}-${index}`, userId: `USER-${index}`, fullName: name,
            present: saved ? true : null, attendedMinutes: saved ? 40 : 0, status: saved ? 'P' : null,
          })),
        } });
      });
      await page.goto(origin);
      await expect(page.getByText('No groups found', { exact: true })).toBeVisible();
      assert.equal(reads.length, 0);
      await page.evaluate(groups => window.setAttendanceGroups(groups), [sri, other]);
      await expect(page.getByText('Sri Advaita Member', { exact: true })).toBeVisible();
      assert.equal(reads.at(-1).groupId, sri.id);
      await page.getByRole('button', { name: sri.groupName, exact: true }).click();
      await page.getByRole('button', { name: other.groupName, exact: true }).click();
      await expect(page.getByText('Other Member', { exact: true })).toBeVisible();
      await expect(page.getByText('Sri Advaita Member', { exact: true })).toHaveCount(0);
      await page.evaluate(groups => window.setAttendanceGroups(groups), [sri, other]);
      await expect(page.getByRole('button', { name: other.groupName, exact: true })).toBeVisible();
      await page.evaluate(groups => window.setAttendanceGroups(groups), [sri]);
      await expect(page.getByText('Sri Advaita Member', { exact: true })).toBeVisible();
      await expect(page.getByText('Other Member', { exact: true })).toHaveCount(0);
      fail = true;
      await page.evaluate(groups => window.setAttendanceGroups(groups), [other]);
      await expect(page.getByRole('alert')).toContainText('Could not load attendance');
      await expect(page.getByRole('button', { name: 'Save Attendance', exact: true })).toBeDisabled();
      await expect(page.getByText('Sri Advaita Member', { exact: true })).toHaveCount(0);
      fail = false;
      await page.getByRole('button', { name: 'Retry loading members', exact: true }).click();
      await expect(page.getByText('Other Member', { exact: true })).toBeVisible();
      await page.evaluate(groups => window.setAttendanceGroups(groups), [sri]);
      await expect(page.getByText('Sri Advaita Member', { exact: true })).toBeVisible();
      await page.getByLabel('Total meeting duration in minutes').fill('40');
      await page.getByRole('button', { name: 'All Present', exact: true }).click();
      await page.getByRole('button', { name: 'Save Attendance', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Update Attendance', exact: true })).toBeVisible();
      assert.equal(writes.length, 1);
      assert.equal(writes[0].groupId, sri.id);
      assert.equal(writes[0].sessionDate, reads.at(-1).date);
      assert.equal(writes[0].totalMeetingMinutes, 40);
      assert.deepEqual(writes[0].memberAttendance.map(member => member.userDbId), ['sri-advaita-0', 'sri-advaita-1']);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS attendance loads delayed groups, retains selection, retries failures and saves the correct roster (${width}px)`);
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
