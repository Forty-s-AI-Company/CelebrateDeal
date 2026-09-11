import { expect, test } from "@playwright/test";

test.describe("personalized sales onboarding entry", () => {
  test("registration entry is clear and keyboard accessible", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "建立你的商家 Workspace" })).toBeVisible();
    await expect(page.getByRole("button", { name: "建立帳號並開始設定" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus-visible")).toBeVisible();
  });

  test("mobile registration has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/register");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("link", { name: "返回登入" })).toBeVisible();
  });
});
