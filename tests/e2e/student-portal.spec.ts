import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { automationCustomerKeyHash } from "../../src/lib/automation-workflow";
import { protectCommerceOrderPii } from "../../src/lib/commerce-order-pii";
import { revealEmailDeliveryPayload } from "../../src/lib/email-delivery-pii";
import { createStudentPortalAccessToken } from "../../src/lib/student-portal-auth";
import { AUTOMATION_VOUCHER_COOKIE } from "../../src/lib/live-interaction";
import { issueBuyerSupportGrant } from "../../src/lib/buyer-support-access";

// Synthetic capabilities stay inside the test process and never enter trace artifacts.
test.use({ trace: "off", video: "off" });
const db = new PrismaClient();
const vendorIds: string[] = [];

async function vendor() {
  const suffix = randomUUID();
  const row = await db.vendor.create({ data: { name: "合成學員中心", slug: `portal-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(row.id);
  return row;
}

async function order(vendorId: string, email: string, orderNumber: string) {
  const id = randomUUID();
  const pii = protectCommerceOrderPii({ buyer: { name: "合成學員", email }, shipping: null }, { vendorId, orderId: id });
  return db.commerceOrder.create({ data: {
    id, vendorId, automationCustomerKeyHash: automationCustomerKeyHash(vendorId, email), orderNumber,
    checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash,
    status: "paid", subtotalAmountCents: 10000, totalAmountCents: 10000, paidAmountCents: 10000,
    buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked,
  } });
}

test.afterEach(async () => {
  await db.automationVoucherGrant.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});
test.afterAll(async () => db.$disconnect());

test("mailbox login scopes the dashboard, prevents replay and supports logout", async ({ page, browser, baseURL }) => {
  const a = await vendor(); const b = await vendor();
  const email = `student-${randomUUID()}@example.test`;
  await order(a.id, email, "PORTAL-OWN-001");
  await order(a.id, "another-student@example.test", "PORTAL-OTHER-STUDENT");
  await order(b.id, email, "PORTAL-OTHER-TENANT");

  await page.goto(`/portal/${a.slug}`);
  await expect(page).toHaveURL(new RegExp(`/portal/${a.slug}/login$`));
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "寄送登入連結" }).click();
  await expect(page.getByRole("status").filter({ hasText: "15 分鐘有效" })).toBeVisible();
  await expect(page.getByText("開發環境：開啟安全連結")).toHaveCount(0);

  // This isolated queue reader represents the synthetic recipient's mailbox.
  // It never makes a provider request or exposes a production delivery payload.
  await expect.poll(() => db.emailDelivery.count({ where: { vendorId: a.id, trigger: "student_portal_magic_link" } })).toBe(1);
  const delivery = await db.emailDelivery.findFirstOrThrow({ where: { vendorId: a.id, trigger: "student_portal_magic_link" } });
  const payload = revealEmailDeliveryPayload(delivery.payloadEncryptedEnvelope, { vendorId: a.id, deliveryId: delivery.id });
  expect(payload.recipientEmail === email).toBe(true);
  const mailboxUrl = payload.body.split(/\s+/u).find((part) => part.startsWith(`${baseURL}/portal/`));
  if (!mailboxUrl) throw new Error("Synthetic portal mailbox did not receive an access URL.");
  const capabilityUrl = new URL(mailboxUrl);
  expect(capabilityUrl.origin === baseURL).toBe(true);

  // A wrong tenant URL cannot burn a valid recipient capability.
  const wrongTenant = new URL(mailboxUrl); wrongTenant.pathname = `/portal/${b.slug}/access`;
  await page.goto(wrongTenant.toString());
  await expect(page).toHaveURL(new RegExp(`/portal/${b.slug}/login\\?error=unauthorized$`));
  await page.goto(mailboxUrl);
  await expect(page).toHaveURL(new RegExp(`/portal/${a.slug}$`));
  await expect(page.getByText("PORTAL-OWN-001", { exact: true })).toBeVisible();
  await expect(page.getByText("PORTAL-OTHER-STUDENT", { exact: true })).toHaveCount(0);
  await expect(page.getByText("PORTAL-OTHER-TENANT", { exact: true })).toHaveCount(0);

  const replayContext = await browser.newContext();
  try {
    const replayPage = await replayContext.newPage();
    await replayPage.goto(mailboxUrl);
    await expect(replayPage).toHaveURL(new RegExp(`/portal/${a.slug}/login\\?error=invalid_or_expired$`));
  } finally { await replayContext.close(); }
  await page.goto(`/portal/${b.slug}`);
  await expect(page).toHaveURL(new RegExp(`/portal/${b.slug}/login\\?error=unauthorized$`));
  await page.goto(`/portal/${a.slug}`);
  await page.getByRole("button", { name: "安全登出" }).click();
  await expect(page).toHaveURL(new RegExp(`/portal/${a.slug}/login$`));
  await page.goto(`/portal/${a.slug}`);
  await expect(page).toHaveURL(new RegExp(`/portal/${a.slug}/login$`));
});

test("a paid order grant cannot log into the email owner's account", async ({ page, context, baseURL }) => {
  const owner = await vendor();
  const email = `shared-${randomUUID()}@example.test`;
  await order(owner.id, email, "PORTAL-PRIVATE-OLDER-ORDER");
  const recent = await order(owner.id, email, "PORTAL-BROWSER-OWN-ORDER");
  const grant = await issueBuyerSupportGrant(db, { request: new Request(`${baseURL}/api/payments/checkout`), vendorId: owner.id, orderId: recent.id });
  await context.addCookies([{ name: grant.name, value: grant.value, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/checkout/result");
  await expect(page.getByText(/PORTAL-BROWSER-OWN-ORDER/u)).toBeVisible();
  await expect(page.getByText(/PORTAL-PRIVATE-OLDER-ORDER/u)).toHaveCount(0);
  await page.getByRole("button", { name: "前往學員中心，驗證 Email" }).click();
  await expect(page).toHaveURL(new RegExp(`/portal/${owner.slug}/login$`));
  expect(await db.studentPortalAccessToken.count({ where: { vendorId: owner.id } })).toBe(0);
  await page.goto(`/portal/${owner.slug}`);
  await expect(page).toHaveURL(new RegExp(`/portal/${owner.slug}/login$`));
});

test("voucher availability is rechecked after rendering and the valid exchange keeps the public origin", async ({ page, context, baseURL }) => {
  const owner = await vendor();
  const email = `voucher-${randomUUID()}@example.test`;
  const product = await db.product.create({ data: { vendorId: owner.id, name: "Synthetic voucher checkout", slug: randomUUID(), priceCents: 10000, inventory: 10 } });
  const voucher = await db.automationVoucherGrant.create({ data: { vendorId: owner.id, productId: product.id, customerKeyHash: automationCustomerKeyHash(owner.id, email), claimTokenHash: randomUUID(), discountType: "percentage", discountValue: 10, expiresAt: new Date(Date.now() + 86_400_000) } });
  // Login rendering is exercised above; this synthetic mailbox capability isolates voucher behaviour.
  const token = await createStudentPortalAccessToken(db, { vendorId: owner.id, email, purpose: "magic_link" });
  await page.goto(`/portal/${owner.slug}/access?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole("button", { name: "立即使用", exact: true })).toBeVisible();
  await db.product.update({ where: { id: product.id }, data: { currency: "USD" } });
  await page.getByRole("button", { name: "立即使用", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/portal/${owner.slug}\\?voucher=unavailable$`));
  await expect(page.getByRole("button", { name: "立即使用", exact: true })).toHaveCount(0);
  expect((await db.automationVoucherGrant.findUniqueOrThrow({ where: { id: voucher.id } })).claimTokenHash === voucher.claimTokenHash).toBe(true);
  await db.product.update({ where: { id: product.id }, data: { currency: "TWD" } });
  await page.reload();
  await page.getByRole("button", { name: "立即使用", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/checkout/${owner.id}/${product.id}$`));
  expect(new URL(page.url()).origin === baseURL).toBe(true);
  const cookies = await context.cookies(baseURL!);
  expect(cookies.some((cookie) => cookie.name === AUTOMATION_VOUCHER_COOKIE && cookie.httpOnly)).toBe(true);
});
