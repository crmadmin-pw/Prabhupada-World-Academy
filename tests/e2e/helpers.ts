// ────────────────────────────────────────────────────────────────────────────
// helpers.ts — shared utilities for all E2E tests
// ────────────────────────────────────────────────────────────────────────────
import { Page, APIRequestContext, expect } from '@playwright/test';

export const BASE = 'http://localhost:3000';

// Test accounts (all use mock_token_for_* auth)
export const USERS = {
  regular:  { email: 'nileshkund8@gmail.com',      name: 'Nilesh Kund',        role: 'User' },
  regular2: { email: 'roshankeshari220@gmail.com',  name: 'Roshan Keshari',     role: 'User' },
  guide:    { email: 'srgd@hkmmumbai.org',          name: 'Sreesh Govind Das',  role: 'Guide' },
  guide2:   { email: 'ajkd@hkmmumbai.org',          name: 'Anjana Kumar Das',   role: 'Guide' },
  super:    { email: 'gmnd@hkmmumbai.org',          name: 'Gaurmandal Das',     role: 'Super Guide' },
  super2:   { email: 'aggd.hkm@gmail.com',          name: 'Anagha Gopal Das',   role: 'Super Guide' },
  mentor:   { email: 'elevatemind321@gmail.com',    name: 'Gaurav Nagpal',      role: 'Sadhana Mentor' },
  bvsl:     { email: 'ayushdodiya153@gmail.com',    name: 'Ayush Dodiya',       role: 'BVSL' },
};

/** Inject mock auth into browser localStorage and window, then navigate */
export async function loginAs(page: Page, email: string) {
  // Set auth via localStorage before navigating
  await page.addInitScript(([em]) => {
    localStorage.setItem('auth_email', em);
    (window as any).__firebase_id_token = `mock_token_for_${em}`;
  }, [email]);
}

/** Make an authenticated API call directly */
export async function apiCall(
  request: APIRequestContext,
  endpoint: string,
  body: Record<string, unknown> = {},
  email?: string
) {
  const token = email ? `mock_token_for_${email}` : '';
  const res = await request.post(`${BASE}/api/run/${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    data: body,
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

export async function waitForApp(page: Page) {
  await page.waitForSelector('body', { timeout: 10_000 });
  // give React a moment to render
  await page.waitForTimeout(800);
}
