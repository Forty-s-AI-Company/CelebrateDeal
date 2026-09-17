import { expect, test } from "@playwright/test";

test.describe("Funnel advanced element browser boundaries", () => {
  test("sandboxed HTML cannot execute script or escape into the parent", async ({ page }) => {
    await page.goto("/browser-qa/funnel-elements");
    await expect(page.locator("#admin-sentinel")).toHaveText("safe");
    const iframe = page.locator('iframe[title="Raw HTML harness"]');
    await expect(iframe).toHaveAttribute("sandbox", "");
    const frame = page.frameLocator('iframe[title="Raw HTML harness"]');
    await expect(frame.locator("body")).toContainText("safe html");
    await expect(frame.locator("body")).not.toContainText("pwned");
  });

  test("carousel keyboard focus and reduced-motion contract remain operable", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/browser-qa/funnel-elements");
    const carousel = page.locator('[data-funnel-carousel="true"]');
    await carousel.focus();
    await page.keyboard.press("ArrowRight");
    await expect(carousel.getByText("第 2 張，共 3 張", { exact: true })).toBeAttached();
    await page.keyboard.press("End");
    await expect(carousel.getByText("第 3 張，共 3 張", { exact: true })).toBeAttached();
  });

  test("desktop exit intent triggers once and listener cleanup is reproducible", async ({ page }) => {
    await page.goto("/browser-qa/funnel-elements");
    await page.getByRole("button", { name: "啟用 Exit Intent 測試" }).click();
    await page.evaluate(() => window.dispatchEvent(new MouseEvent("mouseout", { clientY: -1 })));
    await expect(page.locator('[data-exit-count="true"]')).toHaveText("1");
    await page.evaluate(() => window.dispatchEvent(new MouseEvent("mouseout", { clientY: -1 })));
    await expect(page.locator('[data-exit-count="true"]')).toHaveText("1");
    const close = page.getByRole("button", { name: "關閉 Popup" });
    if (await close.isVisible()) await close.click();
    await page.getByRole("button", { name: "清理 Exit Intent 測試" }).click();
    await page.getByRole("button", { name: "卸載 Popup" }).click();
    await page.evaluate(() => window.dispatchEvent(new MouseEvent("mouseout", { clientY: -1 })));
    await expect(page.locator('[data-exit-count="true"]')).toHaveText("1");
    await expect(page.locator('[data-popup-unmounted="true"]')).toHaveText("unmounted");
  });
});
