import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const AUTH_COOKIE = "celebrate_session";
let userId = "";
let sessionId = "";
let sessionToken = "";

test.beforeAll(async ({}, workerInfo) => {
  const suffix = `${workerInfo.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const user = await db.user.create({
    data: {
      email: `visual-admin-${suffix}@example.test`,
      name: "平台財務管理員",
      passwordHash: "test",
      platformRole: "platform_admin",
      mfaFactor: { create: { factorType: "totp", secretEncrypted: "visual-fixture-only" } },
    },
  });
  sessionToken = randomBytes(32).toString("base64url");
  const session = await db.userSession.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
      mfaVerifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  userId = user.id;
  sessionId = session.id;
});

test.afterAll(async () => {
  if (sessionId) await db.userSession.deleteMany({ where: { id: sessionId } });
  if (userId) await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

test.beforeEach(async ({ context, baseURL, page }) => {
  await context.addCookies([{ name: AUTH_COOKIE, value: sessionToken, url: baseURL ?? "http://127.0.0.1:31023", httpOnly: true, sameSite: "Lax" }]);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

for (const route of ["/admin/billing/dashboard", "/admin/billing/webhooks"] as const) {
  test(`${route} admin visual baseline`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible();
    await page.waitForTimeout(500);
    const navSurface = (page.viewportSize()?.width ?? 1440) >= 1024 ? page.locator("aside") : page.locator("header");
    await expect(navSurface).toHaveScreenshot(`${route.slice(1).replaceAll("/", "-")}-navigation.png`, {
      animations: "disabled",
      caret: "initial",
      stylePath: "tests/visual/snapshot.css",
      maxDiffPixelRatio: 0.015,
    });
    const kpis = page.getByTestId(route.includes("webhooks") ? "webhook-kpis" : "billing-kpis");
    await expect(kpis).toHaveScreenshot(`${route.slice(1).replaceAll("/", "-")}-kpis.png`, {
      animations: "disabled",
      caret: "initial",
      stylePath: "tests/visual/snapshot.css",
      maxDiffPixelRatio: 0.015,
      mask: [kpis.locator(".text-3xl")],
      maskColor: "#e2e8f0",
    });
  });
}
