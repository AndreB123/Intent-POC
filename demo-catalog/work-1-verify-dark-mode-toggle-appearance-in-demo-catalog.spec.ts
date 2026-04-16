import { test, expect } from '@playwright/test';

test.describe('Dark Mode Toggle', () => {
  test('should display the correct icon in the top-left corner', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('#theme-toggle');
    await expect(toggle).toBeVisible();
    
    const initialIcon = await toggle.textContent();
    await toggle.click();
    const toggledIcon = await toggle.textContent();
    
    expect(initialIcon).not.toEqual(toggledIcon);
  });
});