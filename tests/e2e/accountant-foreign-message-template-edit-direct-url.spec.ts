import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp48SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("active accountant is denied a foreign message-template editor before tenant lookup", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP37 Owner ${suffix}`, slug: `wp37-owner-${suffix}`, email: `wp37-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP37 Foreign ${suffix}`, slug: `wp37-foreign-${suffix}`, email: `wp37-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const [user, ownTemplate, foreignTemplate] = await Promise.all([
    db.user.create({ data: { email: `wp48-accountant-${suffix}@celebratedeal.test`, name: "WP48 Accountant", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "accountant", status: "active" } } } }),
    db.messageTemplate.create({ data: { vendorId: ownerVendor.id, name: `WP37 Own ${suffix}`, channel: "email", trigger: "registration_confirmed", subject: `WP37 Own Subject ${suffix}`, body: `WP37 own body canary ${suffix}`, isActive: true } }),
    db.messageTemplate.create({ data: { vendorId: foreignVendor.id, name: `WP37 Foreign ${suffix}`, channel: "sms", trigger: "live_reminder", subject: `WP37 Foreign Subject ${suffix}`, body: `WP37 foreign body canary ${suffix}`, isActive: true } }),
  ]);
  const snapshot = async () => Promise.all([
    db.messageTemplate.findUniqueOrThrow({ where: { id: ownTemplate.id } }),
    db.messageTemplate.findUniqueOrThrow({ where: { id: foreignTemplate.id } }),
    db.messageTemplate.count({ where: { vendorId: ownerVendor.id } }),
    db.messageTemplate.count({ where: { vendorId: foreignVendor.id } }),
  ]);
  const before = await snapshot();

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    const foreignPath = `/messages/templates/${foreignTemplate.id}/edit`;
    const canaries = [
      foreignTemplate.name,
      foreignTemplate.subject ?? "",
      foreignTemplate.body,
    ].filter((value): value is string => Boolean(value));
    const { finalResponse } = await navigateAndAssertDirectUrlGuard({
      page,
      path: foreignPath,
      routeIdentityCanaries: [foreignTemplate.id, foreignPath],
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
    });
    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL("/dashboard?error=insufficient_role");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "編輯訊息模板" })).toHaveCount(0);
    for (const label of ["模板名稱", "渠道", "觸發條件", "主旨", "內容"]) {
      await expect(page.getByLabel(label)).toHaveCount(0);
    }
    for (const value of [foreignTemplate.name, foreignTemplate.subject ?? "", foreignTemplate.body]) {
      await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    }
    expect(requests.some((url) => /^https:\/\/(?!127\.0\.0\.1|localhost)/i.test(url) || /resend|sms|cloudflare|sentry|posthog|payuni/i.test(url))).toBe(false);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
