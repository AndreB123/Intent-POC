import { test, expect } from '@playwright/test';

test.describe('Demo Catalog Evidence', () => {
  test('should render the catalog components with correct theme toggle positioning', async ({ page }) => {
    await page.goto('/');
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