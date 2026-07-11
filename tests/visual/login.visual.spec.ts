import { expect, test } from "@playwright/test";

test("login visual baseline", async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "登入直播商務後台" })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot("login-page.png", {
    fullPage: true,
    animations: "disabled",
    caret: "initial",
    stylePath: "tests/visual/snapshot.css",
    maxDiffPixelRatio: 0.01,
  });
});
