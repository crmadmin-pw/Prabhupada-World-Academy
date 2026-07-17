
import { test, expect } from '@playwright/test';

test('Homepage loads successfully', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(5000);
  const body = await page.innerHTML('body');
  console.log('HTML BODY:', body);
});
