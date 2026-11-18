import { createHash, randomUUID } from "node:crypto";
import { devices, expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
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

test("mobile 更多 drawer reaches products from billing plans when client JS loads slowly", async ({ page, baseURL }) => {
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
    await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
    await route.continue();
  });

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
