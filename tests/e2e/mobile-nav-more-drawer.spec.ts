import { createHash, randomUUID } from "node:crypto";
import { devices, expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedBetaAgreementForLogin } from "./helpers/beta-agreement";
import {
  elementHydratedInPage,
  MOBILE_NAV_MORE_BUTTON,
  MOBILE_NAV_PRODUCTS_LINK,
  waitForMobileNavHydration,
} from "../../scripts/staging-browser-hydration.mjs";

/**
 * 2026-11-18 staging browser smoke (runs 44231762166, 44232725695): on the mobile
 * /billing/plans journey the runner clicked 「更多」 before React hydrated the app shell.
 * The button is a React state toggle, so the drawer never opened and the products link
 * wait timed out (NAV_MORE_PRODUCTS_LINK). Slow client chunks reproduce that window
 * locally; the runner's hydration wait must carry the same journey to /products.
 */
const db = new PrismaClient();
const runId = randomUUID().slice(0, 12);
const sessionToken = `e2e-mobile-nav-${runId}-${randomUUID()}`;
const CHUNK_DELAY_MS = 2_500;
let vendorId = "";
let userId = "";

test.use({ ...devices["Pixel 7"], trace: "off", screenshot: "off", video: "off" });

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      name: `E2E Mobile Nav ${runId}`,
      slug: `e2e-mobile-nav-${runId}`,
      email: `e2e-mobile-nav-${runId}@celebratedeal.local`,
      passwordHash: "e2e-not-a-login-credential",
      // /billing/plans is a closed-beta module, as on the staging smoke vendor.
      betaFeatureGrants: ["billing"],
      tracking: { create: {} },
    },
  });
  vendorId = vendor.id;
  const user = await db.user.create({
    data: {
      email: `e2e-mobile-nav-owner-${runId}@celebratedeal.local`,
      name: "E2E Mobile Nav Owner",
      passwordHash: "e2e-not-a-login-credential",
      status: "active",
      memberships: { create: { vendorId, role: "owner", status: "active" } },
      sessions: {
        create: {
          tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
          expiresAt: new Date(Date.now() + 15 * 60_000),
        },
      },
    },
  });
  userId = user.id;
  // The owner accepted the 封測合作協議 earlier (O-11); this spec is about navigation.
  await seedBetaAgreementForLogin(db, user.email);
});

test.afterAll(async () => {
  if (userId) await db.userSession.deleteMany({ where: { userId } });
  if (vendorId || userId) {
    await db.auditLog.deleteMany({
      where: { OR: [...(vendorId ? [{ vendorId }] : []), ...(userId ? [{ actorId: userId }, { targetId: userId }] : [])] },
    });
  }
  if (userId) await db.user.deleteMany({ where: { id: userId } });
  if (vendorId) await db.vendor.deleteMany({ where: { id: vendorId } });
  await db.$disconnect();
});

async function signInWithSlowChunks(page: Page, baseURL: string | undefined, delayMs = CHUNK_DELAY_MS) {
  // F-036: __Host- session cookie; Chromium accepts Secure on the http loopback origin.
  await page.context().addCookies([{
    name: "__Host-celebrate_session",
    value: sessionToken,
    domain: new URL(baseURL!).hostname,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.route("**/_next/static/chunks/**/*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  });
}

test("mobile 更多 drawer reaches products from billing plans when client JS loads slowly", async ({ page, baseURL }) => {
  await signInWithSlowChunks(page, baseURL);

  // Same entry as the staging runner: DOMContentLoaded only, then the shell assertions.
  await page.goto("/billing/plans", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "方案", exact: true })).toBeVisible();
  const moreButton = page.locator(MOBILE_NAV_MORE_BUTTON);
  await expect(moreButton).toBeVisible();
  // The server-rendered button is already visible and clickable, but React does not own it yet.
  expect(await page.evaluate(elementHydratedInPage, MOBILE_NAV_MORE_BUTTON)).toBe(false);

  await waitForMobileNavHydration(page);
  await moreButton.click({ timeout: 8_000 });
  await expect(page.getByRole("dialog", { name: "更多功能" })).toBeVisible();
  await page.locator(MOBILE_NAV_PRODUCTS_LINK).click({ timeout: 8_000 });
  await page.waitForURL(/\/products$/u, { timeout: 8_000 });
  await expect(page.getByRole("heading", { name: "商品", exact: true })).toBeVisible();
});

test("A2-11: 更多 opens before hydration without waiting for React and reaches products", async ({ page, baseURL }) => {
  await signInWithSlowChunks(page, baseURL);
  await page.goto("/billing/plans", { waitUntil: "domcontentloaded" });
  const moreButton = page.locator(MOBILE_NAV_MORE_BUTTON);
  await expect(moreButton).toBeVisible();
  expect(await page.evaluate(elementHydratedInPage, MOBILE_NAV_MORE_BUTTON)).toBe(false);
  // Screen reader name and relationship are present in server HTML.
  await expect(moreButton).toHaveAccessibleName("更多");
  await expect(moreButton).toHaveAttribute("aria-haspopup", "dialog");

  // No hydration wait: this click is handled by the browser (native popover), not React.
  await moreButton.click({ timeout: 8_000 });
  const dialog = page.getByRole("dialog", { name: "更多功能" });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(elementHydratedInPage, MOBILE_NAV_MORE_BUTTON)).toBe(false);
  await page.locator(MOBILE_NAV_PRODUCTS_LINK).click({ timeout: 8_000 });
  await page.waitForURL(/\/products$/u, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "商品", exact: true })).toBeVisible();
});

test("A2-11: pre-hydration popover closes with Escape and the close button, then hydration keeps an open menu open", async ({ page, baseURL }) => {
  await signInWithSlowChunks(page, baseURL, 8_000);
  await page.goto("/billing/plans", { waitUntil: "domcontentloaded" });
  const moreButton = page.locator(MOBILE_NAV_MORE_BUTTON);
  const dialog = page.getByRole("dialog", { name: "更多功能" });
  await expect(moreButton).toBeVisible();

  await moreButton.click({ timeout: 8_000 });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(moreButton).toBeFocused();

  await moreButton.click({ timeout: 8_000 });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "關閉更多功能" }).click();
  await expect(dialog).toBeHidden();

  // Open again and let hydration finish underneath: the menu must not vanish.
  expect(await page.evaluate(elementHydratedInPage, MOBILE_NAV_MORE_BUTTON)).toBe(false);
  await moreButton.click({ timeout: 8_000 });
  await expect(dialog).toBeVisible();
  await waitForMobileNavHydration(page);
  await expect(dialog).toBeVisible();
  await expect(moreButton).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByRole("button", { name: "關閉更多功能" })).toBeFocused();

  // After hydration the React drawer behaves as before: Esc closes and focus returns to 更多.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(moreButton).toHaveAttribute("aria-expanded", "false");
  await expect(moreButton).toBeFocused();
});
