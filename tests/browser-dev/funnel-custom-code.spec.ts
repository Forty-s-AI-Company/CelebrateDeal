import { expect, test, type Page } from "@playwright/test";

const HARNESS = "/browser-qa/funnel-elements/custom-code";
const FRAME = 'iframe[title="商家自訂程式碼"]';

async function probe(page: Page) {
  const frame = page.frameLocator(FRAME);
  await expect(frame.locator("#probe")).not.toHaveText("loading");
  await expect(frame.locator("#probe")).not.toContainText('"fetch":"pending"');
  return JSON.parse(await frame.locator("#probe").innerText()) as Record<string, string>;
}

// Chromium only (playwright.funnel-elements.config.ts). The guarantees rely on
// standard sandbox, srcdoc CSP inheritance and COOP behaviour; WebKit/Firefox
// runs are a follow-up (COOP + popups from sandboxed frames differ most there).
test.describe("Funnel custom code isolation (real browser)", () => {
  test.beforeEach(async ({ context }) => {
    // A readable (non-HttpOnly) platform cookie: the worst case for leakage.
    await context.addCookies([{ name: "celebrate_platform_probe", value: "platform-secret-value", domain: "127.0.0.1", path: "/", httpOnly: false, sameSite: "Lax" }]);
  });

  test("merchant JS cannot read platform cookies, the parent DOM, storage or the network, nor navigate the top page", async ({ page }) => {
    const response = await page.goto(HARNESS);
    expect(response?.headers()["cross-origin-opener-policy"]).toBe("same-origin");
    const startUrl = page.url();
    await expect(page.locator(FRAME)).toHaveAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
    // The cookie exists for the platform page itself.
    expect(await page.evaluate(() => document.cookie)).toContain("platform-secret-value");

    const result = await probe(page);
    expect(result.cookie).toMatch(/^threw:SecurityError$|^$/u);
    expect(JSON.stringify(result)).not.toContain("platform-secret-value");
    expect(result.parentDocument).toBe("threw:SecurityError");
    expect(result.parentCookie).toBe("threw:SecurityError");
    expect(result.topHref).toBe("threw:SecurityError");
    expect(result.localStorage).toBe("threw:SecurityError");
    expect(result.origin).toBe("null");
    expect(result.fetch).toMatch(/^blocked:/u);
    // Whether or not the assignment threw, the top page did not move.
    await page.waitForTimeout(500);
    expect(page.url()).toBe(startUrl);
    await expect(page.getByTestId("platform-sentinel")).toHaveText("platform");
  });

  test("a popup opened by merchant code has no opener (no reverse tabnabbing)", async ({ page }) => {
    await page.goto(HARNESS);
    await probe(page);
    const popupPromise = page.waitForEvent("popup");
    await page.frameLocator(FRAME).locator("#open").click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    // COOP same-origin on the opener page forces no-opener for popups from the opaque-origin frame,
    // so merchant code does not even get a handle to the new tab.
    await expect(page.frameLocator(FRAME).locator("#probe")).toContainText('"popupHandle":"null"');
    await popup.close();
    // The opener page is untouched.
    await expect(page.getByTestId("platform-sentinel")).toHaveText("platform");
  });

  test("auto height follows the content and ignores spoofed messages from the page or other sources", async ({ page }) => {
    await page.goto(HARNESS);
    await probe(page);
    const frame = page.locator(FRAME);
    const initial = await frame.evaluate((element) => element.getBoundingClientRect().height);
    await page.frameLocator(FRAME).locator("#grow").click();
    await expect.poll(async () => frame.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(initial + 400);
    const grown = await frame.evaluate((element) => element.getBoundingClientRect().height);
    // Same message shape, wrong source (the page itself) and out-of-range values.
    await page.evaluate(() => {
      window.postMessage({ type: "celebratedeal:custom-code-height", height: 5 }, "*");
      window.postMessage({ type: "celebratedeal:custom-code-height", height: 99_999 }, "*");
    });
    await page.waitForTimeout(300);
    expect(await frame.evaluate((element) => element.getBoundingClientRect().height)).toBe(grown);
  });

  for (const variant of ["hide", "overlay"] as const) {
    test(`page custom CSS (${variant}) cannot hide or cover the platform disclosure`, async ({ page }) => {
      await page.goto(`${HARNESS}?variant=${variant}`);
      const disclosure = page.locator("[data-funnel-platform-disclosure]");
      await disclosure.scrollIntoViewIfNeeded();
      await expect(disclosure).toBeVisible();
      await expect(disclosure).toContainText("部分互動內容為商家自訂腳本");
      await expect(disclosure.getByRole("link", { name: "隱私通知" })).toBeVisible();
      // Policy links are plain full-page navigations (no client-side router), so merchant tags do not follow.
      expect(await disclosure.getByRole("link", { name: "隱私通知" }).evaluate((element) => element.tagName)).toBe("A");
      // Whatever sits at the centre of the disclosure and its links is the disclosure itself.
      const covered = await disclosure.evaluate((element) => {
        const targets = [element, ...element.querySelectorAll("a")];
        return targets.some((target) => {
          const rect = target.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return !hit || !element.contains(hit);
        });
      });
      expect(covered).toBe(false);
      await expect(page.getByTestId("platform-sentinel")).toBeVisible();
      // The above-the-fold notice is outside the content container as well.
      const notice = page.locator("[data-funnel-platform-top-notice]");
      await notice.scrollIntoViewIfNeeded();
      await expect(notice).toBeVisible();
      await expect(notice).toContainText("請勿在其中輸入 CelebrateDeal 帳號密碼");
      expect(await notice.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(hit && element.contains(hit));
      })).toBe(true);
      if (variant === "overlay") {
        // The fixed "takeover" element is clipped to the contained page shell.
        const geometry = await page.evaluate(() => {
          const takeover = document.getElementById("takeover")!.getBoundingClientRect();
          const shell = document.querySelector("[data-funnel-content-shell]")!.getBoundingClientRect();
          return { takeoverTop: takeover.top, shellTop: shell.top, shellBottom: shell.bottom };
        });
        expect(geometry.takeoverTop).toBeGreaterThanOrEqual(geometry.shellTop - 1);
        const sentinel = await page.getByTestId("platform-sentinel").evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.left + 4, rect.top + rect.height / 2));
        });
        expect(sentinel).toBe(true);
      } else {
        await expect(page.locator("[data-funnel-content]")).toBeHidden();
      }
    });
  }
});
