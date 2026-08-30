import { expect, test } from "@playwright/test";

test("same-origin navigation exposes accessible progress feedback while a route is slow", async ({ page }) => {
  await page.goto("/login", { waitUntil: "load" });

  await page.route("**/password-reset/request**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue();
  });

  await page.getByRole("link", { name: "忘記密碼" }).click();
  const progress = page.locator('[data-navigation-progress="active"]');
  await expect(progress).toHaveAttribute("aria-busy", "true");
  await expect(progress).toHaveAttribute("aria-label", "正在載入頁面");
  await expect(progress).toHaveText(/正在載入頁面/);
  await expect(page).toHaveURL(/\/password-reset\/request$/);
});
