import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp56SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(60_000);

test("active accountant is denied same-vendor live analytics through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const canary = `wp56-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP56 ${suffix}`,
      slug: canary,
      email: `${canary}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const user = await db.user.create({
    data: {
      email: `accountant-${canary}@celebratedeal.test`,
      name: "WP56 Accountant",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } },
    },
  });
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: `WP56 Form ${suffix}`, slug: `form-${canary}`, headline: "WP56", fields: [], isActive: true },
  });
  const live = await db.live.create({
    data: { vendorId: vendor.id, formId: form.id, title: `WP56 Live ${suffix}`, slug: `live-${canary}`, scheduledAt: new Date("2026-01-01T00:00:00.000Z") },
  });
  const visitorId = `visitor-${canary}`;
  const referralCode = `referral-${canary}`;
  const [event, click, submission] = await Promise.all([
    db.analyticsEvent.create({ data: { vendorId: vendor.id, liveId: live.id, eventType: "page_view", visitorId } }),
    db.affiliateClick.create({ data: { vendorId: vendor.id, liveId: live.id, referralCode, visitorId: `click-${canary}`, landingPath: `/wp56-${suffix}` } }),
    db.formSubmission.create({ data: { formId: form.id, liveId: live.id, name: canary, email: `${canary}@example.test`, phone: "0900000056" } }),
  ]);
  const snapshot = () => Promise.all([
    db.live.findUniqueOrThrow({ where: { vendorId_id: { vendorId: vendor.id, id: live.id } } }),
    db.analyticsEvent.findMany({ where: { liveId: live.id }, orderBy: { id: "asc" } }),
    db.affiliateClick.findMany({ where: { liveId: live.id }, orderBy: { id: "asc" } }),
    db.formSubmission.findMany({ where: { liveId: live.id }, orderBy: { id: "asc" } }),
    db.analyticsEvent.count({ where: { liveId: live.id } }),
    db.affiliateClick.count({ where: { liveId: live.id } }),
    db.formSubmission.count({ where: { liveId: live.id } }),
  ]);
  const before = await snapshot();

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const path = `/lives/${live.id}/analytics`;
    const canaries = [
      visitorId,
      referralCode,
      canary,
      `${canary}@example.test`,
      "0900000056",
      event.id,
      click.id,
      submission.id,
    ];
    const { finalResponse } = await navigateAndAssertDirectUrlGuard({
      page,
      path,
      routeIdentityCanaries: [live.id, path],
      protectedPayloadCanaries: canaries,
      documentCanaries: canaries,
      transport: {
        kind: "streaming-redirect",
        status: 200,
        redirectMarker: "NEXT_REDIRECT",
        redirectTargetMarker: "/dashboard?error=insufficient_role",
      },
      finalUrl: "/dashboard?error=insufficient_role",
      finalStatus: 200,
      forbiddenPayload: [`${live.title} 分析`],
    });
    expect(finalResponse?.status()).toBe(200);

    // Dashboard has generic funnel, event, and affiliate widgets. The live-specific
    // analytics title and payload values must remain absent after the streaming redirect.
    await expect(page.getByRole("heading", { name: `${live.title} 分析` })).toHaveCount(0);
    // Dashboard may legitimately list a same-vendor live by title. Analytics
    // payload values and the analytics-specific title must never appear there.
    for (const value of canaries) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    const documentContent = await page.content();
    for (const value of canaries) expect(documentContent).not.toContain(value);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
