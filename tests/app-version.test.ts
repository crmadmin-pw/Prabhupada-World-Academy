import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  decideVersionAction,
  extractBuildId,
  extractServedAssets,
  versionFromHtml,
  versionsDiffer,
  type AppVersionSnapshot,
} from '../src/lib/appVersion';
import { holdUnsavedWork, isFormInProgress } from '../src/lib/formActivity';

const servedHtml = `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="/_next/static/css/app/layout.css?v=1791205531341"/>
<link rel="preload" as="script" href="/_next/static/chunks/webpack.js?v=1791205531341"/>
<script src="/_next/static/chunks/main-app.js?v=1791205531341" async=""></script>
<script src="/assets/index-legacyvite.js"></script>
</head><body>
<script>self.__next_f.push([1,"0:{\\"b\\":\\"development\\",\\"f\\":[]}\\n"])</script>
</body></html>`;

const publishedHtml = servedHtml.replace('development', 'build-2026-10-05');

const now = 1_700_000_000_000;

function action(local: AppVersionSnapshot, remote: AppVersionSnapshot | null, formInProgress: boolean, pathname = '/sadhana') {
  return decideVersionAction({
    pathname,
    local,
    remote,
    formInProgress,
    now,
    lastReloadAt: 0,
  });
}

test('a Next document exposes its build id and static files, not a Vite bundle', () => {
  assert.equal(extractBuildId(servedHtml), 'development');
  assert.deepEqual(extractServedAssets(servedHtml), [
    '/_next/static/chunks/main-app.js',
    '/_next/static/chunks/webpack.js',
    '/_next/static/css/app/layout.css',
  ]);
  assert.equal(extractServedAssets(servedHtml).some(asset => asset.includes('/assets/index-')), false);
});

test('the same Next build is not treated as an update', () => {
  const version = versionFromHtml(servedHtml);
  assert.equal(versionsDiffer(version, versionFromHtml(servedHtml.replace('v=1791205531341', 'v=1791205539999'))), false);
  assert.equal(action(version, version, false), 'none');
});

test('a published Next build reloads only when no form is in progress', () => {
  const local = versionFromHtml(servedHtml);
  const remote = versionFromHtml(publishedHtml);
  assert.equal(versionsDiffer(local, remote), true);
  assert.equal(action(local, remote, false), 'reload');
  assert.equal(action(local, remote, true), 'defer');
});

test('hashed Next chunks count when the flight build id is missing', () => {
  const local: AppVersionSnapshot = { buildId: null, assets: ['/_next/static/chunks/main-app.js'] };
  const remote: AppVersionSnapshot = {
    buildId: null,
    assets: ['/_next/static/chunks/main-app.js', '/_next/static/chunks/app/layout-newhash.js'],
  };
  assert.equal(action(local, remote, false), 'reload');
  assert.equal(action(local, remote, true), 'defer');
  assert.equal(action(
    { buildId: null, assets: ['/_next/static/chunks/app/layout-newhash.js', '/_next/static/chunks/main-app.js'] },
    remote,
    false,
  ), 'none');
});

test('an unreadable document and an auth callback never reload', () => {
  const local = versionFromHtml(servedHtml);
  assert.equal(action(local, null, false), 'none');
  assert.equal(action(local, { buildId: null, assets: [] }, false), 'none');
  assert.equal(action(local, versionFromHtml(publishedHtml), false, '/auth-callback'), 'none');
  assert.equal(decideVersionAction({
    pathname: '/sadhana',
    local,
    remote: versionFromHtml(publishedHtml),
    formInProgress: false,
    now,
    lastReloadAt: now - 1_000,
  }), 'none');
});

test('an explicit unsaved-work lease blocks a reload until it is released', () => {
  assert.equal(isFormInProgress(), false);
  const release = holdUnsavedWork();
  try {
    assert.equal(isFormInProgress(), true);
  } finally {
    release();
  }
  assert.equal(isFormInProgress(), false);
});

test('the app no longer looks for the retired Vite bundle', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const checker = readFileSync(new URL('../src/lib/appVersion.ts', import.meta.url), 'utf8');
  assert.equal(app.includes('getLocalScriptPath'), false);
  assert.equal(app.includes("startsWith('/assets/index-')"), false);
  assert.equal(checker.includes("startsWith('/assets/index-')"), false);
  assert.equal(checker.includes('window.location.href ='), false);
  assert.match(checker, /isFormInProgress\(\)/);
});
