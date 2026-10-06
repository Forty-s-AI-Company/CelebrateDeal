import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { WP4_SANDBOX_FIXTURE as fixed } from "../../src/lib/wp4-sandbox-fixture";
import { PaymentWebhookPayload, processPaymentWebhook } from "../../src/lib/payment-webhooks";
test.use({ trace: "off", screenshot: "off", video: "off" });
const source = process.env.Q2_BROWSER_SOURCE_SHA!, job = "synthetic-q2-browser-job-secret";
async function ops(page: Page, route: string, method = "POST") {
 return page.evaluate(async ({ route, source, job, method }) => {
  const response = await fetch(`/api/admin/ops/payuni/${route}`, { method, headers: { authorization: `Bearer ${job}`, "x-celebratedeal-source-sha": source } });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
 }, { route, source, job, method });
}
test("fixed owner selects a private sandbox plan, reloads real entitlement/refund proof, and foreign owner cannot select it", async ({ page, browser, baseURL }) => {
 const db = new PrismaClient(), suffix = randomUUID();
 const foreignContext = await browser.newContext();
 const password = "SyntheticQ2ForeignOwnerPassword!";
 const foreignVendor = await db.vendor.create({ data: { name: "Foreign synthetic vendor", slug: `q2-foreign-${suffix}`, email: `vendor-${suffix}@invalid.example`, passwordHash: hashPassword(password), tracking: { create: {} } } });
 const foreignUser = await db.user.create({ data: { email: `owner-${suffix}@invalid.example`, name: "Foreign owner", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: foreignVendor.id, role: "owner", status: "active" } } } });
 const ordinaryPlan = await db.billingPlan.create({ data: { name: "Ordinary synthetic plan", code: `q2-ordinary-${suffix}`, monthlyPriceCents: 0, isActive: true } });
 const blockedProviderRequests: { url: string; method: string }[] = [];
 // Preserve the real local checkout response; never send synthetic credentials to any provider.
 await page.route("**/*", async route => {
  const request = route.request();
  if (new URL(request.url()).origin === baseURL) return route.continue();
  blockedProviderRequests.push({ url: request.url(), method: request.method() }); return route.abort();
 });
 try {
  await page.goto("/login");
  const unauthorized = await page.evaluate(async () => (await fetch("/api/admin/ops/payuni/wp4-fixture", { method: "POST" })).status);
  expect(unauthorized).toBe(401);
  expect((await ops(page, "wp4-fixture")).status).toBe(200);
  expect((await db.billingPlan.findUniqueOrThrow({ where: { id: fixed.planId } })).isActive).toBe(false);
  expect((await ops(page, "wp4-session")).status).toBe(204);
  await page.goto("/billing/plans");
  await expect(page.getByRole("heading", { name: "WP4 Synthetic Sandbox Plan" })).toBeVisible();
  const selection = page.waitForResponse(response => response.url().endsWith("/api/billing/plans/select") && response.request().method() === "POST");
  await page.locator(`form:has(input[name="planId"][value="${fixed.planId}"])`).getByRole("button").click();
  expect((await selection).status()).toBe(200);
  await expect.poll(() => blockedProviderRequests.filter(request => request.url === "https://sandbox-api.payuni.com.tw/api/upp" && request.method === "POST").length).toBe(1);
  expect(blockedProviderRequests.every(request => request.url === "https://sandbox-api.payuni.com.tw/api/upp")).toBe(true);
  const payments = await db.paymentTransaction.findMany({ where: { vendorId: fixed.vendorId, providerName: "payuni" } });
  expect(payments).toHaveLength(1); const payment = payments[0]!;
  expect(payment).toMatchObject({ status: "pending", grossAmountCents: 100, currency: "TWD", paymentMode: "platform", metadata: expect.objectContaining({ billingPurpose: "platform_subscription_checkout", billingPlanId: fixed.planId, wp4SourceCommit: source }) });
  await page.goto("/billing/plans"); await page.reload();
  expect(await db.paymentTransaction.count({ where: { vendorId: fixed.vendorId } })).toBe(1);
  expect((await ops(page, "wp4-subscription-payment-attempt")).body).toMatchObject({ status: "SUBMIT_ALLOWED", reservationCreated: true });
  expect((await ops(page, "wp4-subscription-payment-attempt")).body).toMatchObject({ status: "ALREADY_RESERVED", reservationCreated: false });
  // Exercise the real accounting core with synthetic local callbacks; external PayUni success is not claimed.
  await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "payuni", eventId: `q2-native-paid-${suffix}`, eventType: "paid", vendorId: fixed.vendorId, orderNumber: payment.orderNumber, grossAmountCents: 100, netAmountCents: 100, currency: "TWD" }));
  expect((await ops(page, "wp4-subscription-state")).body).toEqual({ status: "ACTIVE_VERIFIED" });
  await page.reload(); await expect(page.getByRole("button", { name: "目前方案", exact: true })).toBeVisible();
  const refund = PaymentWebhookPayload.parse({ provider: "payuni", eventId: `q2-native-refund-${suffix}`, eventType: "refunded", vendorId: fixed.vendorId, orderNumber: payment.orderNumber, refundAmountCents: 100, currency: "TWD" });
  await processPaymentWebhook(refund); await processPaymentWebhook(refund);
  expect((await ops(page, "wp4-subscription-state")).body).toEqual({ status: "REFUNDED_VERIFIED" });
  await page.reload(); await expect(page.getByRole("button", { name: "目前方案", exact: true })).toHaveCount(0);
  expect((await db.vendorUsageLimit.findUniqueOrThrow({ where: { vendorId: fixed.vendorId } })).entitlementStatus).toBe("revoked");
  expect(await db.refundRecord.count({ where: { paymentTransactionId: payment.id, status: "processed" } })).toBe(1);
  // Legacy active flags still cannot expose the fixed plan to another real authenticated owner.
  await db.billingPlan.update({ where: { id: fixed.planId }, data: { isActive: true } });
  const foreign = await foreignContext.newPage(); await foreign.goto(`${baseURL}/login`);
  await foreign.getByLabel("Email").fill(foreignUser.email); await foreign.getByLabel("密碼").fill(password);
  await foreign.getByRole("button", { name: "登入", exact: true }).click(); await expect(foreign).toHaveURL(/\/dashboard$/);
  await foreign.goto(`${baseURL}/billing/plans`); await expect(foreign.getByRole("heading", { name: "WP4 Synthetic Sandbox Plan" })).toHaveCount(0);
  const csrf = await foreign.locator('input[name="_csrf"]').first().inputValue();
  await foreign.evaluate(async ({ csrf, planId }) => {
   await fetch("/api/billing/plans/select", { method: "POST", body: new URLSearchParams({ _csrf: csrf, planId }), redirect: "manual" });
  }, { csrf, planId: fixed.planId });
  expect(await db.paymentTransaction.count({ where: { vendorId: foreignVendor.id } })).toBe(0);
  expect((await ops(page, "wp4-session", "DELETE")).status).toBe(204);
  await page.goto("/billing/plans"); await expect(page).toHaveURL(/\/login/);
 } finally {
  await foreignContext.close(); await db.webhookEvent.deleteMany({ where: { vendorId: fixed.vendorId } });
  await db.vendor.deleteMany({ where: { id: { in: [fixed.vendorId, foreignVendor.id] } } });
  await db.user.deleteMany({ where: { id: { in: [fixed.userId, foreignUser.id] } } });
  await db.billingPlan.deleteMany({ where: { id: { in: [fixed.planId, ordinaryPlan.id] } } }); await db.$disconnect();
 }
});
