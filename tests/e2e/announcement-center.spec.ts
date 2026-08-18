import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function openFreshAnnouncement(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeVisible();
}

test.describe("進站最新消息／開發進度公告中心", () => {
  test("首次進站顯示四區公告並維持 focus trap", async ({ page }) => {
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /hydration|hydrated/i.test(message.text())) hydrationErrors.push(message.text());
    });
    await openFreshAnnouncement(page);
    expect(hydrationErrors).toEqual([]);

    const dialog = page.getByRole("dialog", { name: "進站最新消息" });
    await expect(dialog.getByTestId("announcement-section-completed")).toBeVisible();
    await expect(dialog.getByTestId("announcement-section-incomplete")).toBeVisible();
    await expect(dialog.getByTestId("announcement-section-changes")).toBeVisible();
    await expect(dialog.getByTestId("announcement-section-nextSteps")).toBeVisible();
    await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "82");
    await expect(page.getByTestId("announcement-center-close")).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("announcement-center-suppress")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("announcement-center-close")).toBeFocused();

    const accessibilityScan = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(accessibilityScan.violations).toEqual([]);
  });

  test("X 與 Escape 只關閉本次，且 launcher 可再次開啟", async ({ page }) => {
    await openFreshAnnouncement(page);
    const launcher = page.getByTestId("announcement-center-launcher");
    await page.getByTestId("announcement-center-close").click();
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeHidden();
    await expect(launcher).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
    await page.waitForTimeout(100);

    await page.reload();
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeVisible();
    await page.getByTestId("announcement-center-close").click();
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeHidden();

    await launcher.click();
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeHidden();
    await expect(launcher).toBeFocused();

    await launcher.click();
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeVisible();
    await page.getByTestId("announcement-center-backdrop").click({ position: { x: 2, y: 2 } });
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeHidden();
    await expect(launcher).toBeFocused();
  });

  test("checkbox 搭配 Escape 與 backdrop 關閉後會保存今日抑制", async ({ page }) => {
    await openFreshAnnouncement(page);
    await page.getByTestId("announcement-center-suppress").check();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeHidden();
    await page.reload();
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeHidden();

    await page.getByTestId("announcement-center-launcher").click();
    await page.getByTestId("announcement-center-suppress").check();
    await page.getByTestId("announcement-center-backdrop").click({ position: { x: 2, y: 2 } });
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeHidden();
    await page.reload();
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeHidden();
  });

  test("既存 dialog 時 auto 與 launcher 都不開，移除後 launcher 可開", async ({ page }) => {
    await page.addInitScript(() => {
      const now = new Date();
      const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
      window.localStorage.setItem(
        "celebratedeal.announcement-center.suppression.v1",
        JSON.stringify({ version: "2026-08-18-v2", localDate }),
      );
    });
    await page.goto("/");
    await expect(page.getByTestId("announcement-center-backdrop")).toBeHidden();
    await page.evaluate(() => {
      const existing = document.createElement("div");
      existing.id = "e2e-existing-dialog";
      existing.setAttribute("role", "dialog");
      existing.textContent = "既存 dialog";
      document.body.append(existing);
    });
    await page.getByTestId("announcement-center-launcher").click();
    await expect(page.getByTestId("announcement-center-backdrop")).toBeHidden();

    await page.evaluate(() => document.getElementById("e2e-existing-dialog")?.remove());
    await page.getByTestId("announcement-center-launcher").click();
    await expect(page.getByTestId("announcement-center-backdrop")).toBeVisible();
  });

  test("勾選今日抑制後關閉，跨 reload 不自動開啟但可手動開啟", async ({ page }) => {
    await openFreshAnnouncement(page);
    await page.getByTestId("announcement-center-suppress").check();
    await page.getByTestId("announcement-center-close").click();
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeHidden();

    const suppression = await page.evaluate(() => {
      const key = "celebratedeal.announcement-center.suppression.v1";
      return JSON.parse(window.localStorage.getItem(key) ?? "null") as { version: string; localDate: string };
    });
    expect(suppression.version).toBe("2026-08-18-v2");
    expect(suppression.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.reload();
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeHidden();
    await page.getByTestId("announcement-center-launcher").click();
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeVisible();
  });

  test("版本變更會重新顯示公告", async ({ page }) => {
    await page.addInitScript(() => {
      const now = new Date();
      const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
      window.localStorage.setItem(
        "celebratedeal.announcement-center.suppression.v1",
        JSON.stringify({ version: "old-version", localDate }),
      );
    });
    await page.goto("/");
    await expect(page.getByRole("dialog", { name: "進站最新消息" })).toBeVisible();
  });

  test("手機寬度使用可捲動卡片版面並維持可見操作目標", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFreshAnnouncement(page);
    await expect(page.getByTestId("announcement-section-completed")).toBeVisible();
    await expect(page.getByTestId("announcement-center-close")).toHaveCSS("min-width", "44px");
    await expect(page.getByTestId("announcement-center-suppress")).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    const contentCanReachBottom = await page.getByTestId("announcement-center-content").evaluate((element) => {
      const content = element as HTMLElement;
      content.scrollTop = content.scrollHeight;
      return content.scrollHeight <= content.clientHeight
        || content.scrollTop + content.clientHeight >= content.scrollHeight - 1;
    });
    expect(contentCanReachBottom).toBe(true);
    await page.getByTestId("announcement-center-suppress").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("announcement-center-suppress")).toBeInViewport();
  });
});
