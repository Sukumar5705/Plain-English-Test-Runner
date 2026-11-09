// Generated from a successful Plain-English Test Runner execution.
// This is a starting point: review selectors and test data before using in CI.
import 'dotenv/config';
import { test, expect } from '@playwright/test';

test("Attempt to log in using email {{email}} and password {{password}}, then verify that an authentication error is displayed.", async ({ page }) => {
  await page.goto("https://shop.qaautomationlabs.com/");
  await page.goto("https://shop.qaautomationlabs.com/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(process.env.DATA_EMAIL!);
  await page.getByPlaceholder("Password", { exact: true }).fill(process.env.DATA_PASSWORD!);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page.getByText("Invalid email or password!").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Invalid email or password!").filter({ visible: true }).first()).toBeVisible();
});
