import { expect, test } from "playwright/test";

const baseUrl = process.env.INTENT_POC_BASE_URL ?? "http://127.0.0.1:6010";

test.describe('Demo Catalog Evidence', () => {
  test('should render the catalog components with correct theme toggle positioning', async ({ page }) => {
    await page.goto(new URL('/', baseUrl).toString());
    const header = page.locator('.surface-header');
    await expect(header).toBeVisible();
    
    const toggle = page.locator('#theme-toggle');
    const box = await toggle.boundingBox();
    
    expect(box).not.toBeNull();
    expect(box!.x).toBeLessThan(200);
    expect(box!.y).toBeLessThan(100);
    
    await expect(page).toHaveScreenshot('intent-poc-app-header.png');
  });
});