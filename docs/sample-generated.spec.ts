// Illustrative export only. The real exporter writes this file after a PASS.
// Replace the example URL and review locators/data before using in CI.
import { test, expect } from '@playwright/test';

test('verify the SauceDemo landing page', async ({ page }) => {
  await page.goto('https://www.saucedemo.com/');
  await expect(page.getByText('Swag Labs').first()).toBeVisible();
});
