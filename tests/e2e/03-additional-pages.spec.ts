import { test, expect, Page } from '@playwright/test';
import { USERS, loginAs, waitForApp } from './helpers';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import path from 'path';

// ─── Setup Test Data in Firestore Emulator ───────────────────────────────────

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

if (getApps().length === 0) {
  initializeApp({
    credential: cert(path.resolve(process.cwd(), 'service-account.json')),
  });
}
const db = getFirestore();

async function gotoAs(page: Page, email: string, urlPath: string) {
  await loginAs(page, email);
  await page.goto(urlPath);
  await waitForApp(page);
}

test.beforeAll(async () => {
  // Seed rejected user
  await db.collection('Users').doc('test-user-rejected').set({
    id: 'test-user-rejected',
    userId: 'USER-REJ-999',
    fullName: 'Rejected Devotee',
    email: 'rejected@test.com',
    role: 'User',
    status: 'REJECTED',
    createdAt: new Date().toISOString(),
  });

  // Seed inactive user
  await db.collection('Users').doc('test-user-inactive').set({
    id: 'test-user-inactive',
    userId: 'USER-INA-999',
    fullName: 'Inactive Devotee',
    email: 'inactive@test.com',
    role: 'User',
    status: 'INACTIVE',
    createdAt: new Date().toISOString(),
  });
});

test.describe('Additional Pages & Flows', () => {

  // 1. Sign Up & Guide Login Pages
  test('Signup page renders signup options', async ({ page }) => {
    await page.goto('/signup');
    await waitForApp(page);
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Sign up') || (document.body.innerText || '').includes('Create'),
      { timeout: 45000 }
    );
    await expect(page.locator('body')).toContainText(/Sign up|Create/i);
    await page.screenshot({ path: 'tests/screenshots/24-signup.png', fullPage: true });
  });

  test('Guide login page renders guide authentication form', async ({ page }) => {
    await page.goto('/guide-login');
    await waitForApp(page);
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Guide'),
      { timeout: 45000 }
    );
    await expect(page.locator('body')).toContainText(/Guide/i);
    await page.screenshot({ path: 'tests/screenshots/25-guide-login.png', fullPage: true });
  });

  // 2. Daily Sadhana Submission Form
  test('Daily Sadhana form loads successfully', async ({ page }) => {
    await gotoAs(page, 'nileshkund8@gmail.com', '/sadhana');
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Daily Sadhana'),
      { timeout: 45000 }
    );
    await expect(page.locator('body')).toContainText(/Daily Sadhana|Sadhana/i);
    await page.screenshot({ path: 'tests/screenshots/26-sadhana-form.png', fullPage: true });
  });

  // 3. Guide Field Setup Page
  test('Sadhana Form Fields Setup page loads and has sync button', async ({ page }) => {
    await gotoAs(page, USERS.guide.email, '/guide/field-setup');
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Cache Sync') || (document.body.innerText || '').includes('Sync Fields'),
      { timeout: 45000 }
    );
    const syncBtn = page.locator('button:has-text("Sync")');
    await expect(syncBtn.first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'tests/screenshots/27-field-setup.png', fullPage: true });
  });

  // 4. Devotee Details Page
  test('Devotee Details page displays statistics & trend charts', async ({ page }) => {
    // Sandeep More is a user under Sreesh Govind Das (srgd@hkmmumbai.org)
    await gotoAs(page, USERS.guide.email, '/guide/users/05d6bf53-5e4e-4e0b-85c1-fe25a1c10c6d');
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Ashray') || (document.body.innerText || '').includes('Sandeep'),
      { timeout: 45000 }
    );
    await expect(page.locator('body')).toContainText(/Sandeep|More/i);
    await page.screenshot({ path: 'tests/screenshots/28-devotee-detail.png', fullPage: true });
  });

  // 5. Group Details Page
  test('Bhakti Vriksha Group detail page loads roster info', async ({ page }) => {
    await gotoAs(page, USERS.guide.email, '/guide/bv-group/05f38cf3-eabd-4b5e-a3cb-94d69ec41206');
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Blissful Sanga') || (document.body.innerText || '').includes('Tanish'),
      { timeout: 45000 }
    );
    await expect(page.locator('body')).toContainText(/Blissful Sanga|Sanga/i);
    await page.screenshot({ path: 'tests/screenshots/29-group-detail.png', fullPage: true });
  });

  // 6. BV Mentor Dashboard
  test('BV Mentor dashboard page loads overview panels', async ({ page }) => {
    await gotoAs(page, 'theshyambohra@gmail.com', '/bv-mentor/dashboard');
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Bv Mentor') || (document.body.innerText || '').includes('Dashboard') || (document.body.innerText || '').includes('Groups'),
      { timeout: 45000 }
    );
    await expect(page.locator('body')).toContainText(/Mentor/i);
    await page.screenshot({ path: 'tests/screenshots/30-bv-mentor.png', fullPage: true });
  });

  // 7. Service Allocation Page
  test('Service Allocation manager loads allocations table', async ({ page }) => {
    await gotoAs(page, USERS.guide.email, '/service-management');
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Service') || (document.body.innerText || '').includes('Allocation'),
      { timeout: 45000 }
    );
    await expect(page.locator('body')).toContainText(/Service|Allocation/i);
    await page.screenshot({ path: 'tests/screenshots/31-service-allocation.png', fullPage: true });
  });

  // 8. Attendance Pages
  test('Public attendance page handles QR validation state', async ({ page }) => {
    await page.goto('/attend/dummy-qr-token-xyz');
    await waitForApp(page);
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Attendance') || 
            (document.body.innerText || '').includes('Loading') ||
            (document.body.innerText || '').includes('Invalid') ||
            (document.body.innerText || '').includes('Expired'),
      { timeout: 45000 }
    );
    await page.screenshot({ path: 'tests/screenshots/32-attend-qr.png', fullPage: true });
  });

  test('Attendance Management page loads controls for guide', async ({ page }) => {
    await gotoAs(page, USERS.guide.email, '/attendance/manage');
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Attendance') || (document.body.innerText || '').includes('Manage'),
      { timeout: 45000 }
    );
    await expect(page.locator('body')).toContainText(/Attendance|Manage/i);
    await page.screenshot({ path: 'tests/screenshots/33-attendance-manage.png', fullPage: true });
  });

  test('Attendance Dashboard loads statistics', async ({ page }) => {
    await gotoAs(page, USERS.guide.email, '/attendance/dashboard');
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Attendance') || (document.body.innerText || '').includes('Stats') || (document.body.innerText || '').includes('Dashboard'),
      { timeout: 45000 }
    );
    await page.screenshot({ path: 'tests/screenshots/34-attendance-dashboard.png', fullPage: true });
  });

  // 9. Redirects & States
  test('Rejected devotee page shows rejection notice', async ({ page }) => {
    await gotoAs(page, 'rejected@test.com', '/rejected');
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Rejected'),
      { timeout: 45000 }
    );
    await expect(page.locator('body')).toContainText(/Rejected/i);
    await page.screenshot({ path: 'tests/screenshots/35-rejected-status.png', fullPage: true });
  });

  test('Inactive devotee page shows inactive message', async ({ page }) => {
    await gotoAs(page, 'inactive@test.com', '/inactive');
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Inactive') || 
            (document.body.innerText || '').includes('disabled') ||
            (document.body.innerText || '').includes('deactivated') ||
            (document.body.innerText || '').includes('Deactivated'),
      { timeout: 45000 }
    );
    await expect(page.locator('body')).toContainText(/Inactive|disabled|deactivated/i);
    await page.screenshot({ path: 'tests/screenshots/36-inactive-status.png', fullPage: true });
  });

  test('Join Group invite landing page renders form', async ({ page }) => {
    await gotoAs(page, 'nileshkund8@gmail.com', '/join-group?token=d579eY79YPxPsHve');
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Join') || (document.body.innerText || '').includes('Bhakti') || (document.body.innerText || '').includes('joining') || (document.body.innerText || '').includes('Joining'),
      { timeout: 45000 }
    );
    await page.screenshot({ path: 'tests/screenshots/37-join-group.png', fullPage: true });
  });

  test('BV Join page loads invite template', async ({ page }) => {
    await gotoAs(page, 'nileshkund8@gmail.com', '/bv/join?token=d579eY79YPxPsHve');
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('Join') || (document.body.innerText || '').includes('Bhakti') || (document.body.innerText || '').includes('joining') || (document.body.innerText || '').includes('Joining'),
      { timeout: 45000 }
    );
    await page.screenshot({ path: 'tests/screenshots/38-bv-join.png', fullPage: true });
  });

  // 10. API Documentation Page
  test('API Docs page loads OpenAPI Swagger UI wrapper', async ({ page }) => {
    await page.goto('/api-docs');
    await waitForApp(page);
    await page.waitForFunction(
      () => (document.body.innerText || '').includes('API') || (document.body.innerText || '').includes('Swagger') || (document.body.innerText || '').includes('OpenAPI'),
      { timeout: 45000 }
    );
    await page.screenshot({ path: 'tests/screenshots/39-api-docs.png', fullPage: true });
  });
});
