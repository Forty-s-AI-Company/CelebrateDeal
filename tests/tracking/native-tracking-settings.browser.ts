import { createEmptyPageDocument, parsePageDocument, type FunnelNode } from "../../src/lib/funnel-page-document";
import type { Prisma } from "@prisma/client";
import { createFormSubmissionVerificationToken } from "../../src/lib/form-submission-verification";
import { revealTrackingBrowserContext } from "../../src/lib/tracking-browser-context";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { unprotectFacebookAccessToken } from "../../src/lib/tracking-credentials";
import { protectCommerceOrderPii } from "../../src/lib/commerce-order-pii";
import { PaymentWebhookPayload, processPaymentWebhook } from "../../src/lib/payment-webhooks";

test.use({ trace: "off", screenshot: "off", video: "off" });
const password = "SyntheticTrackingBrowserPassword!", syntheticToken = "synthetic-tracking-browser-meta-token";
const credentialForm = (page: Page) => page.locator('form:has(input[name="credentialRevision"])');
const savedStatus = (page: Page) => page.getByRole("status").filter({ hasText: /^伺服器追蹤設定已儲存。$/u });
// Wait for this POST, since an earlier success banner can remain during submission.
async function saveCredentials(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/settings/tracking" && response.request().method() === "POST"),
    page.getByRole("button", { name: "儲存伺服器追蹤設定" }).click(),
  ]);
  // RSC response streams can remain open after the transaction has committed.
  expect([200, 303]).toContain(response.status());
}
async function login(page: Page, email: string, destination: "dashboard" | "support-cases" = "dashboard") {
  await page.goto("/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/${destination}$`));
}
async function user(db: PrismaClient, vendorId: string, role: string) {
  return db.user.create({ data: { email: `tracking-${randomUUID()}@example.test`, name: "合成追蹤管理員", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId, role, status: "active" } } } });
}
async function vendor(db: PrismaClient) {
  const id = randomUUID(); return db.vendor.create({ data: { name: "合成追蹤商店", slug: `tracking-browser-${id}`, email: `${id}@example.test`, passwordHash: hashPassword(password), tracking: { create: { facebookPixelId: "123456789" } } } });
}

test("manager saves encrypted credentials, rejects stale and CSRF writes, reloads real paid events, and keeps foreign tenant isolated", async ({ page, browser, baseURL }) => {
  const db = new PrismaClient(), shop = await vendor(db), foreignShop = await vendor(db);
  const manager = await user(db, shop.id, "admin"), foreignOwner = await user(db, foreignShop.id, "owner");
  const otherContext = await browser.newContext({ baseURL }); const stale = await page.context().newPage();
  await page.route("**/*", route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
  try {
    await login(page, manager.email); await page.goto("/settings/tracking");
    await stale.goto(`${baseURL}/settings/tracking`);
    await expect(credentialForm(stale).locator('input[name="credentialRevision"]')).toHaveValue("0");
    await page.getByLabel("Meta CAPI Access Token").fill(syntheticToken);
    await page.getByLabel("Meta Test Event Code").fill("TEST_BROWSER");
    await saveCredentials(page);
    await expect(savedStatus(page)).toHaveText("伺服器追蹤設定已儲存。");
    const first = await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: shop.id } });
    expect(first.credentialRevision).toBe(1); expect(first.facebookAccessTokenEncrypted).not.toContain(syntheticToken);
    expect(unprotectFacebookAccessToken(shop.id, first.facebookAccessTokenEncrypted!)).toBe(syntheticToken);
    await page.reload(); await expect(page.getByLabel("Meta CAPI Access Token")).toHaveValue("");
    expect(await page.content()).not.toContain(syntheticToken); expect(await page.content()).not.toContain(first.facebookAccessTokenEncrypted!);
    await stale.getByLabel("Meta CAPI Access Token").fill("synthetic-stale-browser-meta-token");
    await stale.getByLabel("Meta Test Event Code").fill("STALE_TEST");
    await saveCredentials(stale);
    const trackingResult = new URL(stale.url()).searchParams.get("tracking");
    test.info().annotations.push({ type: "tracking-diagnostic", description: JSON.stringify({ stage: "stale_save", alertCount: await stale.getByRole("alert").count(), result: ["saved", "conflict", "invalid"].includes(trackingResult ?? "") ? trackingResult : null }) });
    await expect(stale.getByRole("alert").filter({ hasText: /^設定已被其他人修改，請重新載入後再儲存。$/u })).toHaveText("設定已被其他人修改，請重新載入後再儲存。");
    expect(await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: shop.id } })).toEqual(first);
    const rejectedCsrf = await credentialForm(page).evaluate(async form => {
      const data = new FormData(form as HTMLFormElement); data.set("_csrf", "synthetic-invalid-csrf");
      return (await fetch("/settings/tracking", { method: "POST", body: data })).status;
    });
    expect(rejectedCsrf).toBe(500);
    expect(await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: shop.id } })).toEqual(first);
    const foreignBefore = await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: foreignShop.id } });
    await credentialForm(page).evaluate((form, foreignId) => {
      const input = document.createElement("input"); input.type = "hidden"; input.name = "vendorId"; input.value = foreignId; form.appendChild(input);
    }, foreignShop.id);
    await page.getByLabel("Meta Test Event Code").fill("TEST_BROWSER_UPDATED");
    await saveCredentials(page);
    await expect(savedStatus(page)).toHaveText("伺服器追蹤設定已儲存。");
    const retained = await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: shop.id } });
    expect(retained).toMatchObject({ credentialRevision: 2, facebookAccessTokenEncrypted: first.facebookAccessTokenEncrypted, facebookTestEventCode: "TEST_BROWSER_UPDATED" });
    expect(await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: foreignShop.id } })).toEqual(foreignBefore);

    // Real accounting core on the disposable DB; no external payment or Meta call.
    const plan = await db.billingPlan.create({ data: { name: "Synthetic tracking plan", code: `tracking-${randomUUID()}`, monthlyPriceCents: 0 } });
    await db.vendorSubscription.create({ data: { vendorId: shop.id, planId: plan.id, status: "active", paymentMode: "platform" } });
    const orderId = randomUUID();
    const pii = protectCommerceOrderPii({ buyer: { name: "合成買家", email: "tracking-buyer@example.test" }, shipping: null }, { vendorId: shop.id, orderId });
    const payment = await db.paymentTransaction.create({ data: { vendorId: shop.id, providerName: "demo", status: "pending", orderNumber: orderId, grossAmountCents: 12345, currency: "TWD" } });
    await db.commerceOrder.create({ data: { id: orderId, vendorId: shop.id, orderNumber: orderId, checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash,
      primaryPaymentTransactionId: payment.id, status: "pending_payment", isTestOrder: true, subtotalAmountCents: 12345, totalAmountCents: 12345,
      buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked } });
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "demo", eventId: randomUUID(), eventType: "paid", vendorId: shop.id, orderNumber: orderId, grossAmountCents: 12345, currency: "TWD" }));
    await page.reload(); await expect(page.getByText("待傳送", { exact: true })).toHaveCount(1);
    await expect(page.getByText("已嘗試 0 次", { exact: true })).toBeVisible();
    const jobStatuses = await page.evaluate(async vendorId => {
      const body = JSON.stringify({ vendorId, limit: 1 });
      const denied = await fetch("/api/jobs/tracking-deliveries", { method: "POST", headers: { "content-type": "application/json" }, body });
      const configured = await fetch("/api/jobs/tracking-deliveries", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer synthetic-tracking-browser-job-secret" }, body });
      return { denied: denied.status, configured: configured.status };
    }, shop.id);
    expect(jobStatuses).toEqual({ denied: 401, configured: 202 });
    expect(await db.trackingDelivery.findFirstOrThrow({ where: { vendorId: shop.id } })).toMatchObject({ status: "queued", attemptCount: 0, eventId: `purchase:${payment.id}` });
    const other = await otherContext.newPage(); await login(other, foreignOwner.email); await other.goto("/settings/tracking");
    await expect(other.getByText("目前沒有伺服器追蹤事件。", { exact: true })).toBeVisible();
    await expect(other.getByLabel("Meta Test Event Code")).toHaveValue("");
    await page.getByLabel("撤除既有追蹤憑證").check(); await saveCredentials(page);
    await expect(savedStatus(page)).toHaveText("伺服器追蹤設定已儲存。");
    expect(await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: shop.id } })).toMatchObject({ credentialRevision: 3, facebookAccessTokenEncrypted: null });
  } finally { await stale.close(); await otherContext.close(); await db.$disconnect(); }
});

test("support member cannot render or forge the manager credential action", async ({ page, browser, baseURL }) => {
  const db = new PrismaClient(), shop = await vendor(db), manager = await user(db, shop.id, "owner"), support = await user(db, shop.id, "support");
  const supportContext = await browser.newContext({ baseURL });
  try {
    await login(page, manager.email); await page.goto("/settings/tracking");
    const actionFields = await credentialForm(page).evaluate(form => [...new FormData(form as HTMLFormElement).entries()].filter(([key]) => key.startsWith("$ACTION_")).map(([key, value]) => [key, String(value)]));
    expect(actionFields.length).toBeGreaterThan(0);
    const member = await supportContext.newPage(); await login(member, support.email, "support-cases");
    const before = await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: shop.id } });
    const csrf = await member.locator('input[name="_csrf"]').first().inputValue();
    await member.evaluate(({ fields, csrf }) => {
      const form = document.createElement("form"); form.method = "POST"; form.action = "/settings/tracking"; form.enctype = "multipart/form-data";
      for (const [name, value] of [...fields, ["_csrf", csrf], ["credentialRevision", "0"], ["facebookAccessToken", "synthetic-forged-support-meta-token"], ["facebookTestEventCode", "FORGED_TEST"]]) {
        const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.appendChild(input);
      }
      const button = document.createElement("button"); button.textContent = "合成權限拒絕測試"; form.appendChild(button); document.body.appendChild(form);
    }, { fields: actionFields, csrf });
    const denialResponse = member.waitForResponse(response => new URL(response.url()).pathname === "/settings/tracking" && response.request().method() === "POST");
    // Native submission exercises the forged form without React's delegated submit handler.
    await member.getByRole("button", { name: "合成權限拒絕測試" }).evaluate(button => {
      HTMLFormElement.prototype.submit.call((button as HTMLButtonElement).form!);
    });
    const denial = await denialResponse;
    expect(denial.status()).toBe(303);
    expect(denial.headers().location).toMatch(/\/dashboard\?error=insufficient_role$/);
    await expect(member).toHaveURL(/\/support-cases$/);
    expect(await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: shop.id } })).toEqual(before);
    await member.goto(`${baseURL}/settings/tracking`); await expect(member).toHaveURL(/\/support-cases$/);
    await expect(member.getByLabel("Meta CAPI Access Token")).toHaveCount(0);
  } finally { await supportContext.close(); await db.$disconnect(); }
});


test("public email verification queues one encrypted Lead, rejects invalid proof, and displays only the owning tenant event", async ({ page, browser, baseURL }) => {
  const db = new PrismaClient(), shop = await vendor(db), foreign = await vendor(db);
  const manager = await user(db, shop.id, "owner"), foreignOwner = await user(db, foreign.id, "owner");
  const buyerContext = await browser.newContext({ baseURL }), foreignContext = await browser.newContext({ baseURL });
  await buyerContext.route("**/*", route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
  try {
    await login(page, manager.email); await page.goto("/settings/tracking");
    await page.getByLabel("Meta CAPI Access Token").fill(syntheticToken);
    await page.getByLabel("Meta Test Event Code").fill("TEST_PUBLIC_LEAD");
    await saveCredentials(page); await expect(savedStatus(page)).toBeVisible();
    const form = await db.registrationForm.create({ data: { vendorId: shop.id, name: "合成公開報名", slug: `tracking-form-${randomUUID()}`, headline: "合成報名", fields: [] } });
    const submission = await db.formSubmission.create({ data: { formId: form.id, name: "合成報名者", email: "synthetic-public-lead@example.test", verificationStatus: "UNVERIFIED", verificationExpiresAt: new Date(Date.now() + 3_600_000) } });
    const token = createFormSubmissionVerificationToken({ submissionId: submission.id, version: 1, expiresAt: submission.verificationExpiresAt! });
    const buyer = await buyerContext.newPage();
    // The token belongs only to this disposable synthetic submission, never an external account.
    await buyer.goto(`/verify-registration?token=${encodeURIComponent(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))}`);
    await buyer.getByRole("button", { name: "確認 Email 並完成報名", exact: true }).click();
    await expect(buyer.getByRole("heading", { name: "確認連結無效或已過期" })).toBeVisible();
    expect(await db.trackingDelivery.count({ where: { vendorId: shop.id } })).toBe(0);
    expect((await db.formSubmission.findUniqueOrThrow({ where: { id: submission.id } })).verificationStatus).toBe("UNVERIFIED");
    for (let attempt = 0; attempt < 2; attempt++) {
      await buyer.goto(`/verify-registration?token=${encodeURIComponent(token)}`);
      await buyer.getByRole("button", { name: "確認 Email 並完成報名", exact: true }).click();
      await expect(buyer.getByRole("heading", { name: "Email 已確認", exact: true })).toBeVisible();
    }
    const rows = await db.trackingDelivery.findMany({ where: { vendorId: shop.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventName: "Lead", formId: form.id, submissionId: submission.id, status: "queued", attemptCount: 0 });
    const context = revealTrackingBrowserContext(shop.id, submission.id, rows[0].contextEncrypted!);
    expect(context.sourceUrl).toBe(`${baseURL}/verify-registration`);
    expect(context.userAgent).toBe(await buyer.evaluate(() => navigator.userAgent));
    expect(JSON.stringify(rows)).not.toContain(submission.email);
    expect(rows[0].contextEncrypted).not.toContain(context.userAgent);
    await page.reload(); await expect(page.getByText("驗證名單", { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain(rows[0].contextEncrypted!);
    const other = await foreignContext.newPage(); await login(other, foreignOwner.email); await other.goto("/settings/tracking");
    await expect(other.getByText("目前沒有伺服器追蹤事件。", { exact: true })).toBeVisible();
    expect(await db.trackingDelivery.count({ where: { vendorId: foreign.id } })).toBe(0);
  } finally { await buyerContext.close(); await foreignContext.close(); await db.$disconnect(); }
});


test("public published calendar books an actual slot and queues tenant-bound Schedule while foreign calendars stay disabled", async ({ page, browser, baseURL }) => {
  const db = new PrismaClient(), shop = await vendor(db), foreign = await vendor(db);
  const manager = await user(db, shop.id, "owner");
  const buyerContext = await browser.newContext({ baseURL, timezoneId: "UTC" });
  await buyerContext.route("**/*", route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
  try {
    await login(page, manager.email); await page.goto("/settings/tracking");
    await page.getByLabel("Meta CAPI Access Token").fill(syntheticToken);
    await page.getByLabel("Meta Test Event Code").fill("TEST_PUBLIC_SCHEDULE");
    await saveCredentials(page); await expect(savedStatus(page)).toBeVisible();
    const project = await db.salesProject.create({ data: { vendorId: shop.id, name: "合成預約專案", slug: `schedule-${randomUUID()}`, mode: "consulting", primaryFlow: "consultation", status: "published", publishedAt: new Date() } });
    const start = new Date(); start.setUTCDate(start.getUTCDate() + 2); start.setUTCHours(9, 0, 0, 0);
    const calendar = await db.consultationEvent.create({ data: { vendorId: shop.id, projectId: project.id, title: "合成公開日曆", timezone: "UTC", weeklySchedule: [{ day: start.getUTCDay(), ranges: ["09:00-10:00"] }], intakeFormFields: [] } });
    const foreignCalendar = await db.consultationEvent.create({ data: { vendorId: foreign.id, title: "外租戶日曆", weeklySchedule: [], intakeFormFields: [] } });
    async function publishedCalendar(eventId: string) {
      const document = createEmptyPageDocument(`calendar_${randomUUID()}`, "合成公開預約頁");
      const node = (id: string, type: FunnelNode["type"], children?: FunnelNode[]): FunnelNode => ({ schemaVersion: 1, id, type, props: type === "calendar" ? { eventId } : {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, ...(children ? { children } : {}) });
      document.root = [node("calendar_section", "section", [node("calendar_row", "row", [node("public_calendar", "calendar")])])];
      expect(parsePageDocument(document)).not.toBeNull();
      const landing = await db.landingPage.create({ data: { vendorId: shop.id, projectId: project.id, name: document.name, slug: `calendar-${randomUUID()}`, draftContent: document as unknown as Prisma.InputJsonValue } });
      const version = await db.landingPageVersion.create({ data: { vendorId: shop.id, pageId: landing.id, version: 1, content: document as unknown as Prisma.InputJsonValue } });
      await db.landingPage.update({ where: { id: landing.id }, data: { status: "published", publishedAt: new Date(), publishedVersionId: version.id } });
      return landing;
    }
    const deniedPage = await publishedCalendar(foreignCalendar.id), publicPage = await publishedCalendar(calendar.id);
    const buyer = await buyerContext.newPage();
    await buyer.goto(`/lp/${deniedPage.slug}`);
    await expect(buyer.getByText("尚未綁定行事曆事件，或事件不屬於此 Funnel 的公開專案；預約功能已停用。", { exact: true })).toBeVisible();
    await expect(buyer.getByRole("button", { name: "送出預約", exact: true })).toHaveCount(0);
    expect(await db.consultationBooking.count({ where: { vendorId: shop.id } })).toBe(0);
    await buyer.goto(`/lp/${publicPage.slug}`);
    await expect(buyer.getByRole("heading", { name: calendar.title, exact: true })).toBeVisible();
    // The synthetic appointment is two days ahead; handle the month boundary explicitly.
    if (start.getUTCMonth() !== new Date().getUTCMonth()) await buyer.getByRole("button", { name: "下個月", exact: true }).click();
    await buyer.getByRole("button", { name: String(start.getUTCDate()), exact: true }).click();
    await buyer.getByRole("button", { name: /09:00/u }).click();
    await buyer.getByLabel("姓名", { exact: true }).fill("合成預約者");
    await buyer.getByLabel("Email", { exact: true }).fill("synthetic-public-schedule@example.test");
    await buyer.getByLabel("手機", { exact: true }).fill("0900000000");
    await buyer.getByRole("button", { name: "送出預約", exact: true }).click();
    await expect(buyer.getByRole("heading", { name: "預約成功", exact: true })).toBeVisible();
    const bookings = await db.consultationBooking.findMany({ where: { vendorId: shop.id } });
    expect(bookings).toHaveLength(1); expect(bookings[0]).toMatchObject({ eventId: calendar.id, startTime: start, status: "scheduled" });
    const rows = await db.trackingDelivery.findMany({ where: { vendorId: shop.id } });
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ eventName: "Schedule", bookingId: bookings[0].id, status: "queued", attemptCount: 0 });
    const context = revealTrackingBrowserContext(shop.id, bookings[0].id, rows[0].contextEncrypted!);
    expect(context.sourceUrl).toBe(`${baseURL}/lp/${publicPage.slug}`);
    expect(context.userAgent).toBe(await buyer.evaluate(() => navigator.userAgent));
    expect(JSON.stringify(rows)).not.toContain(bookings[0].clientEmail);
    expect(await db.trackingDelivery.count({ where: { vendorId: foreign.id } })).toBe(0);
    await page.reload(); await expect(page.getByText("預約", { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain(rows[0].contextEncrypted!);
  } finally { await buyerContext.close(); await db.$disconnect(); }
});


test("real public live admission emits ViewContent once per admitted page and rejects absent or foreign viewer scope", async ({ page, browser, baseURL }) => {
  const db = new PrismaClient(), shop = await vendor(db), foreign = await vendor(db);
  const manager = await user(db, shop.id, "owner"), buyerContext = await browser.newContext({ baseURL });
  await buyerContext.route("**/*", route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
  try {
    await login(page, manager.email); await page.goto("/settings/tracking");
    await page.getByLabel("Meta CAPI Access Token").fill(syntheticToken);
    await page.getByLabel("Meta Test Event Code").fill("TEST_PUBLIC_VIEW");
    await saveCredentials(page); await expect(savedStatus(page)).toBeVisible();
    const video = await db.video.create({ data: { vendorId: shop.id, title: "合成直播來源", sourceType: "url", videoUrl: "https://video.example.test/synthetic-tracking.mp4", status: "ready", durationSec: 3600 } });
    const form = await db.registrationForm.create({ data: { vendorId: shop.id, name: "合成直播報名", slug: `view-form-${randomUUID()}`, headline: "合成直播報名", fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }] } });
    const template = await db.messageTemplate.create({ data: { vendorId: shop.id, name: "合成確認信", channel: "email", trigger: "registration_confirmed", subject: "{{live_title}} 合成報名", body: "{{name}} {{unsubscribe_url}}", isActive: true } });
    const live = await db.live.create({ data: { vendorId: shop.id, videoId: video.id, formId: form.id, messageTemplateId: template.id, title: "合成公開內容觀看", slug: `tracking-view-${randomUUID()}`, scheduledAt: new Date(Date.now() - 120_000), status: "live", streamMode: "vod", replayEnabled: true } });
    const buyer = await buyerContext.newPage(); await buyer.goto("/verify-registration");
    const postView = async (vendorId: string) => buyer.evaluate(async input => (await fetch("/api/analytics", {
      method: "POST", headers: { "content-type": "application/json", "x-celebratedeal-client": "web" }, body: JSON.stringify(input),
    })).status, { vendorId, liveId: live.id, eventType: "page_view", payload: { slug: live.slug } });
    expect(await postView(shop.id)).toBe(403);
    expect(await db.trackingDelivery.count({ where: { vendorId: shop.id } })).toBe(0);
    // The delivered player, not an injected cookie or session, performs admission and page_view.
    await buyer.goto(`/live/${live.slug}`);
    await expect.poll(() => db.trackingDelivery.count({ where: { vendorId: shop.id, eventName: "ViewContent" } })).toBe(1);
    expect(await db.liveViewerSession.count({ where: { vendorId: shop.id, liveId: live.id } })).toBe(1);
    expect(await postView(foreign.id)).toBe(403);
    expect(await postView(shop.id)).toBe(200);
    const rows = await db.trackingDelivery.findMany({ where: { vendorId: shop.id } });
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ eventName: "ViewContent", status: "queued", attemptCount: 0 });
    const source = await db.analyticsEvent.findUniqueOrThrow({ where: { id: rows[0].analyticsEventId! } });
    expect(source).toMatchObject({ vendorId: shop.id, liveId: live.id, eventType: "page_view", trustLevel: "ADMITTED_LIVE_SESSION" });
    const context = revealTrackingBrowserContext(shop.id, source.id, rows[0].contextEncrypted!);
    expect(context.sourceUrl).toBe(`${baseURL}/live/${live.slug}`);
    expect(context.userAgent).toBe(await buyer.evaluate(() => navigator.userAgent));
    expect(await db.trackingDelivery.count({ where: { vendorId: foreign.id } })).toBe(0);
    await page.reload(); await expect(page.getByText("內容觀看", { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain(rows[0].contextEncrypted!);
  } finally { await buyerContext.close(); await db.$disconnect(); }
});
