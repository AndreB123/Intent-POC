import { expect, test } from "playwright/test";

const baseUrl = process.env.INTENT_POC_BASE_URL ?? "http://127.0.0.1:6010";

test.describe('Dark Mode Toggle', () => {
  test('should display the correct icon in the top-left corner', async ({ page }) => {
    await page.goto(new URL('/', baseUrl).toString());
    const toggle = page.locator('#theme-toggle');
    await expect(toggle).toBeVisible();
    
    const initialIcon = await toggle.textContent();
    await toggle.click();
    const toggledIcon = await toggle.textContent();
    
    expect(initialIcon).not.toEqual(toggledIcon);
  });
});