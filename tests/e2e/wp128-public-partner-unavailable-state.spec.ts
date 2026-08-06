import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const slug = process.env.WP128_PUBLIC_SLUG ?? "wp128-unpublished-fixture";
const loopbackHost = /^127\.0\.0\.1$/;

async function assertUnavailableState(page: Page) {
  const response = await page.goto(`/p/${slug}`, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "此頁尚未公開" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("目前無法提供瀏覽");
  await expect(page.getByText("WP128 fixture headline")).toHaveCount(0);
  await expect(page.getByText("fixture@example.invalid")).toHaveCount(0);

  const recovery = page.getByRole("link", { name: "返回首頁" });
  await expect(recovery).toHaveAttribute("href", "/");
  await recovery.focus();
  await expect(recovery).toBeFocused();
  const box = await recovery.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
}

test("unpublished partner state is recoverable and accessible on desktop", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && !loopbackHost.test(url.hostname)) requests.push("external");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await assertUnavailableState(page);
  expect(requests).toEqual([]);
});

test("unpublished partner state has no mobile overflow", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && !loopbackHost.test(url.hostname)) requests.push("external");
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await assertUnavailableState(page);
  expect(requests).toEqual([]);
});
