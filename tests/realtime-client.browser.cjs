// Actual React hooks/cache with a deterministic API transport. This complements
// the real-auth Firestore emulator test; it is not a production latency test.
const assert = require('node:assert/strict');
const http = require('node:http');
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');

async function main() {
  const bundle = await build({ entryPoints: ['tests/realtime-client.fixture.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'test-identity', setup(build) { build.onResolve({ filter: /app-auth-sdk$/ }, () => ({ path: 'identity', namespace: 'test' })); build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const auth = {currentUser:{uid:"test",email:"test@example.invalid",getIdToken:async()=>"test-only"}};' })); } }],
  });
  const requests = [];
  const values = new Map();
  const failures = new Map();
  let slow = false;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (req.url.startsWith('/api/run/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      const name = req.url.split('/').at(-1);
      const key = `${name}:${input.group}`;
      const value = values.get(key) || 1;
      requests.push({ key, at: Date.now() });
      if (failures.get(key) > 0) {
        failures.set(key, failures.get(key) - 1);
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Simulated transient outage' })); return;
      }
      const delay = slow && input.group === 'A' ? 350 : 20;
      await new Promise(resolve => setTimeout(resolve, delay));
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Realtime-Token', key);
      res.setHeader('X-Realtime-Version', String(value).padStart(8, '0'));
      res.end(JSON.stringify({ value })); return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for (const id of ['query', 'duplicate', 'legacy', 'effect', 'unrelated', 'compat']) await expect(page.getByTestId(id)).toHaveText('1');
    assert.equal(requests.filter(item => item.key === 'getQueryReport:A').length, 1, 'shared hook reads deduplicate');
    await page.getByLabel('Preserved draft').fill('keep my input');
    const initialCount = requests.length;
    const change = async (name, group, value) => {
      const key = `${name}:${group}`;
      values.set(key, value);
      await page.evaluate(({key, value}) => window.receiveRevision(key, String(value).padStart(8, '0')), {key, value});
    };
    const started = Date.now();
    const unrelatedRenders = await page.evaluate(() => window.renderCounts.unrelated);
    await change('getQueryReport', 'A', 2);
    await expect(page.getByTestId('query')).toHaveText('2');
    await expect(page.getByTestId('duplicate')).toHaveText('2');
    assert.equal(requests.length, initialCount + 1, 'only the changed query is fetched');
    assert.equal(await page.evaluate(() => window.renderCounts.unrelated), unrelatedRenders, 'unrelated query does not rerender');
    const propagationMs = Date.now() - started;
    await change('getLoaderReport', 'A', 2);
    await expect(page.getByTestId('legacy')).toHaveText('2');
    await change('getEffectReport', 'A', 2);
    await expect(page.getByTestId('effect')).toHaveText('2');
    await expect(page.getByLabel('Preserved draft')).toHaveValue('keep my input');

    const beforeLoaderRevisit = requests.length;
    await page.getByRole('button', {name:'Toggle loader view'}).click();
    await page.getByRole('button', {name:'Toggle loader view'}).click();
    await expect(page.getByTestId('legacy')).toHaveText('2');
    assert.equal(requests.length, beforeLoaderRevisit, 'stateful loader reuses a fresh cached response on remount');

    const beforeRevisit = requests.length;
    await page.getByRole('button', {name:'Toggle compatibility view'}).click();
    await page.getByRole('button', {name:'Toggle compatibility view'}).click();
    await expect(page.getByTestId('compat')).toHaveText('1');
    await page.waitForTimeout(150);
    assert.equal(requests.length, beforeRevisit, 'fresh cached revisit attaches without a network read');
    await change('getCompatReport', 'A', 2);
    await expect(page.getByTestId('compat')).toHaveText('2');
    await page.getByRole('button', {name:'Toggle compatibility view'}).click();
    await change('getCompatReport', 'A', 3);
    await page.getByRole('button', {name:'Toggle compatibility view'}).click();
    await expect(page.getByTestId('compat')).toHaveText('3');

    // Duplicate/old revisions produce no API traffic. The short wait below
    // observes a negative test assertion; it is not application polling.
    const beforeDuplicates = requests.length;
    await page.evaluate(() => { window.receiveRevision('getQueryReport:A', '00000002'); window.receiveRevision('getQueryReport:A', '00000001'); });
    await page.waitForTimeout(200);
    assert.equal(requests.length, beforeDuplicates);

    const beforeBurst = requests.length;
    values.set('getQueryReport:A', 102);
    await page.evaluate(() => { for (let value = 3; value <= 102; value++) window.receiveRevision('getQueryReport:A', String(value).padStart(8, '0')); });
    await expect(page.getByTestId('query')).toHaveText('102');
    assert.equal(requests.length, beforeBurst + 1, '100 revisions coalesce into one read');

    await page.getByRole('button', {name:'Toggle panel'}).click();
    const beforeHidden = requests.length;
    await change('getQueryReport', 'A', 103);
    await change('getLoaderReport', 'A', 3);
    await change('getEffectReport', 'A', 3);
    await page.waitForTimeout(200);
    assert.equal(requests.length, beforeHidden, 'inactive panels defer API reads');
    await page.getByRole('button', {name:'Toggle panel'}).click();
    await expect(page.getByTestId('query')).toHaveText('103');
    await expect(page.getByTestId('legacy')).toHaveText('3');
    await expect(page.getByTestId('effect')).toHaveText('3');

    slow = true;
    // Starting a draft while the read is in flight must defer its result.
    await change('getLoaderReport', 'A', 4);
    await page.waitForTimeout(120);
    await page.getByRole('button', {name:'Toggle editing'}).click();
    await page.waitForTimeout(400);
    await expect(page.getByTestId('legacy')).toHaveText('3');
    await page.getByRole('button', {name:'Toggle editing'}).click();
    await expect(page.getByTestId('legacy')).toHaveText('4');

    await change('getLoaderReport', 'A', 5);
    await change('getEffectReport', 'A', 4);
    await page.waitForTimeout(120);
    await page.getByRole('button', {name:'Change group'}).click();
    await expect(page.getByTestId('group')).toHaveText('B');
    for (const id of ['query', 'legacy', 'effect']) await expect(page.getByTestId(id)).toHaveText('1');
    await page.waitForTimeout(400);
    for (const id of ['query', 'legacy', 'effect']) await expect(page.getByTestId(id)).toHaveText('1');
    for (const name of ['getQueryReport', 'getLoaderReport', 'getEffectReport']) values.set(`${name}:B`, 2);
    await page.evaluate(() => window.setPermissionScope('new-authority'));
    for (const id of ['query', 'legacy', 'effect']) await expect(page.getByTestId(id)).toHaveText('2');
    const recoveringNames = ['getQueryReport', 'getLoaderReport', 'getEffectReport'];
    for (const name of recoveringNames) { failures.set(`${name}:B`, 1); await change(name, 'B', 3); }
    for (const id of ['query', 'legacy', 'effect']) await expect(page.getByTestId(id)).toHaveText('3', { timeout: 8000 });
    const beforeOutage = requests.length;
    for (const name of recoveringNames) { failures.set(`${name}:B`, 10); await change(name, 'B', 4); }
    await page.waitForTimeout(9000);
    assert.equal(requests.length - beforeOutage, 12, 'three consumers stop after an initial failure and three retries each');
    for (const id of ['query', 'legacy', 'effect']) await expect(page.getByTestId(id)).toHaveText('3');
    failures.clear();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    for (const id of ['query', 'legacy', 'effect']) await expect(page.getByTestId(id)).toHaveText('4');
    const beforeIdle = requests.length;
    // Longer than the old minute-based freshness timer. Test-only observation.
    await page.waitForTimeout(65_000);
    assert.equal(requests.length, beforeIdle, 'idle clients make no periodic API reads');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', propagationMs, queries: requests.length, idleSeconds: 65, idleRequests: 0, unaffectedRenders: 0, covered: ['query hook', 'stateful loader', 'read effect', 'compatibility cached remount', 'authority scope reattachment', 'dedupe', '100-event burst', 'hidden panel', 'draft retention', 'draft starts during request', 'filter race', 'bounded failure retries', 'online recovery'] }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
