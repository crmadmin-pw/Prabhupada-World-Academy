/**
 * Detects a newly published Next.js build and reloads only when the user is
 * not in the middle of a form. The running app is an App Router client shell:
 * publishes show up as a new flight build id (`b`) and new `/_next/static`
 * files, not as Vite `/assets/index-*.js` bundles.
 */

import { toast } from 'sonner';
import { isFormInProgress, installFormActivityTracking, subscribeFormActivity } from '@/lib/formActivity';

export const RELOAD_TS_KEY = 'folk_last_auto_reload';
export const RELOAD_COOLDOWN_MS = 30_000;
const REFRESH_DELAY_MS = 3_000;
const INITIAL_CHECK_DELAY_MS = 10_000;
const DEFER_WATCH_MS = 1_000;
const TOAST_ID = 'app-version';

export interface AppVersionSnapshot {
  buildId: string | null;
  assets: string[];
}

export type VersionAction = 'none' | 'reload' | 'defer';

const BUILD_ID_ESCAPED = /\\"b\\":\\"([^"\\]+)\\"/;
const BUILD_ID_PLAIN = /"b":"([^"]+)"/;
const SERVED_ASSET = /<(?:script|link)\b[^>]*\b(?:src|href)=["'](\/_next\/static\/[^"']+)["']/gi;

export function extractBuildId(source: string): string | null {
  const marker = source.indexOf('__next_f');
  const region = marker === -1 ? source : source.slice(marker);
  return region.match(BUILD_ID_ESCAPED)?.[1] ?? region.match(BUILD_ID_PLAIN)?.[1] ?? null;
}

/** Pathname of a Next static asset, without a dev cache-bust query. */
export function normalizeNextAssetPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, 'http://local');
    if (!url.pathname.startsWith('/_next/static/')) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

/** Script and stylesheet URLs from a freshly served document. */
export function extractServedAssets(html: string): string[] {
  const assets = new Set<string>();
  for (const match of html.matchAll(SERVED_ASSET)) {
    const path = normalizeNextAssetPath(match[1]);
    if (path) assets.add(path);
  }
  return [...assets].sort();
}

export function versionFromHtml(html: string): AppVersionSnapshot {
  return { buildId: extractBuildId(html), assets: extractServedAssets(html) };
}

export function readDocumentVersion(doc: Document): AppVersionSnapshot {
  let buildId: string | null = null;
  for (const script of doc.querySelectorAll('script')) {
    buildId = extractBuildId(script.textContent || '');
    if (buildId) break;
  }
  const assets = new Set<string>();
  for (const el of doc.querySelectorAll('script[src], link[href]')) {
    const raw = el.getAttribute('src') || el.getAttribute('href') || '';
    const path = normalizeNextAssetPath(raw);
    if (path) assets.add(path);
  }
  return { buildId, assets: [...assets].sort() };
}

export function versionsDiffer(local: AppVersionSnapshot, remote: AppVersionSnapshot): boolean {
  if (local.buildId && remote.buildId) return local.buildId !== remote.buildId;
  if (local.assets.length === 0 || remote.assets.length === 0) return false;
  const loaded = new Set(local.assets);
  return remote.assets.some(asset => !loaded.has(asset));
}

export function decideVersionAction(input: {
  pathname: string;
  local: AppVersionSnapshot;
  remote: AppVersionSnapshot | null;
  formInProgress: boolean;
  now: number;
  lastReloadAt: number;
  cooldownMs?: number;
}): VersionAction {
  if (input.pathname === '/auth-callback') return 'none';
  if (!input.remote || !versionsDiffer(input.local, input.remote)) return 'none';
  const cooldown = input.cooldownMs ?? RELOAD_COOLDOWN_MS;
  if (input.now - input.lastReloadAt < cooldown) return 'none';
  return input.formInProgress ? 'defer' : 'reload';
}

async function fetchServedVersion(): Promise<AppVersionSnapshot | null> {
  const response = await fetch(`/?_bust=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      Accept: 'text/html',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
  if (!response.ok) return null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !contentType.includes('html')) return null;
  const html = await response.text();
  const remote = versionFromHtml(html);
  if (!remote.buildId && remote.assets.length === 0) return null;
  return remote;
}

function readLastReload(): number {
  try {
    return parseInt(sessionStorage.getItem(RELOAD_TS_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function writeLastReload(now: number) {
  try {
    sessionStorage.setItem(RELOAD_TS_KEY, String(now));
  } catch {
    // Storage can be blocked; a reload still has the in-memory cooldown below.
  }
}

let pending = false;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let watchTimer: ReturnType<typeof setInterval> | null = null;
let reloading = false;
let lastReloadMemory = 0;

function announce(message: string) {
  toast(message, { id: TOAST_ID });
}

function stopWatch() {
  if (watchTimer != null) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

function watchUntilFormIsIdle() {
  if (watchTimer != null) return;
  watchTimer = setInterval(() => {
    if (!pending) {
      stopWatch();
      return;
    }
    if (isFormInProgress()) return;
    pending = false;
    stopWatch();
    announce('Refreshing to load the new version…');
    scheduleReload();
  }, DEFER_WATCH_MS);
}

function deferForForm() {
  pending = true;
  if (reloadTimer != null) {
    clearTimeout(reloadTimer);
    reloadTimer = null;
  }
  announce('A new version is ready. It will load after you finish this form.');
  watchUntilFormIsIdle();
}

async function commitReload() {
  if (reloading) return;
  if (typeof window === 'undefined') return;
  if (isFormInProgress()) {
    deferForForm();
    return;
  }
  const now = Date.now();
  const lastReloadAt = Math.max(readLastReload(), lastReloadMemory);
  if (now - lastReloadAt < RELOAD_COOLDOWN_MS) return;

  reloading = true;
  try {
    if (window.location.pathname === '/auth-callback') return;
    const response = await fetch(window.location.href, {
      cache: 'reload',
      credentials: 'same-origin',
    });
    if (!response.ok) return;
    await response.text();
  } catch {
    return;
  } finally {
    reloading = false;
  }

  if (window.location.pathname === '/auth-callback') return;
  if (isFormInProgress()) {
    deferForForm();
    return;
  }
  const stamped = Date.now();
  lastReloadMemory = stamped;
  writeLastReload(stamped);
  window.location.reload();
}

function scheduleReload() {
  if (reloadTimer != null || reloading) return;
  if (isFormInProgress()) {
    deferForForm();
    return;
  }
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void commitReload();
  }, REFRESH_DELAY_MS);
}

async function checkForAppUpdate(whenIdle: 'now' | 'soon') {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === '/auth-callback') return;
  try {
    const remote = await fetchServedVersion();
    const action = decideVersionAction({
      pathname: window.location.pathname,
      local: readDocumentVersion(document),
      remote,
      formInProgress: isFormInProgress(),
      now: Date.now(),
      lastReloadAt: Math.max(readLastReload(), lastReloadMemory),
    });
    if (action === 'defer') deferForForm();
    else if (action === 'reload' && whenIdle === 'soon') {
      announce('A new version is ready. Refreshing in a few seconds…');
      scheduleReload();
    } else if (action === 'reload') {
      await commitReload();
    }
  } catch {
    // Network or parse trouble — keep the current page.
  }
}

/** One delayed check, plus another when the tab becomes visible again. */
export function startAppVersionChecks(): () => void {
  const removeTracking = installFormActivityTracking();
  const removeSubscription = subscribeFormActivity(() => {
    if (reloadTimer != null && isFormInProgress()) deferForForm();
  });

  const initTimer = setTimeout(() => { void checkForAppUpdate('now'); }, INITIAL_CHECK_DELAY_MS);
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void checkForAppUpdate('soon');
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    clearTimeout(initTimer);
    if (reloadTimer != null) clearTimeout(reloadTimer);
    reloadTimer = null;
    stopWatch();
    pending = false;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    removeSubscription();
    removeTracking();
  };
}
