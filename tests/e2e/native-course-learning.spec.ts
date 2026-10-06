import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { automationCustomerKeyHash } from "../../src/lib/automation-workflow";
import { protectCommerceOrderPii } from "../../src/lib/commerce-order-pii";
import { grantCommerceEntitlement } from "../../src/lib/commerce-order-fulfillment";
import { reconcileCommerceOrderRefund } from "../../src/lib/commerce-orders";
import { createStudentPortalAccessToken } from "../../src/lib/student-portal-auth";

test.use({ trace: "off", screenshot: "off", video: "off" });
test("manager publishes a lesson; a purchasing learner saves, resumes, completes and loses access after refund", async ({ page, browser, baseURL }) => {
  const db = new PrismaClient();
  const suffix = randomUUID();
  const password = "SyntheticCourseManagerPassword!";
  const vendor = await db.vendor.create({ data: { name: "合成課程學院", slug: `native-course-${suffix}`, email: `${suffix}@example.test`, passwordHash: hashPassword(password), tracking: { create: {} } } });
  const user = await db.user.create({ data: { email: `manager-${suffix}@example.test`, name: "合成管理員", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "admin", status: "active" } } } });
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "實際瀏覽器課程", slug: randomUUID(), priceCents: 10000, commerceDomain: "course", fulfillmentType: "course", isActive: true } });
  const learnerContext = await browser.newContext();
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto(`/products/${product.id}/edit`);
    await page.getByRole("link", { name: "管理課程單元" }).click();
    await page.getByLabel("章節", { exact: true }).fill("第一章");
    await page.getByLabel("單元名稱").fill("實作單元");
    await page.getByLabel("影片網址").fill("https://media.example.test/native-course.mp4");
    await page.getByLabel("影片秒數").fill("100");
    await page.getByLabel("發布，讓有權益的學員可以學習").check();
    await page.getByRole("button", { name: "新增單元", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("課程單元已儲存。");
    const lesson = await db.courseLesson.findFirstOrThrow({ where: { vendorId: vendor.id, productId: product.id } });
    expect(lesson.publishedAt).not.toBeNull();

    const orderId = randomUUID(); const email = `learner-${suffix}@example.test`;
    const pii = protectCommerceOrderPii({ buyer: { name: "合成學員", email }, shipping: null }, { vendorId: vendor.id, orderId });
    await db.commerceOrder.create({ data: { id: orderId, vendorId: vendor.id, orderNumber: orderId, checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash, automationCustomerKeyHash: automationCustomerKeyHash(vendor.id, email), status: "paid", subtotalAmountCents: 10000, totalAmountCents: 10000, paidAmountCents: 10000, buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked } });
    const item = await db.commerceOrderItem.create({ data: { vendorId: vendor.id, orderId, productId: product.id, lineIndex: 0, productName: product.name, productSlug: product.slug, commerceDomain: "course", fulfillmentType: "course", unitPriceCents: 10000, quantity: 1, lineTotalCents: 10000, nonSensitiveSnapshot: {} } });
    const entitlement = await db.commerceEntitlement.create({ data: { vendorId: vendor.id, orderItemId: item.id } });
    await db.$transaction((tx) => grantCommerceEntitlement(tx, { vendorId: vendor.id, entitlementId: entitlement.id, expectedRevision: entitlement.revision, actor: { id: "synthetic-browser-fixture" } }));
    const token = await createStudentPortalAccessToken(db, { vendorId: vendor.id, email, purpose: "magic_link" });
    const learner = await learnerContext.newPage();
    // No external media provider is contacted. This gate verifies manual completion,
    // real backend persistence and rights; provider playback is not claimed here.
    await learner.route("https://media.example.test/**", (route) => route.abort());
    await learner.goto(`${baseURL}/portal/${vendor.slug}/access?token=${encodeURIComponent(token)}`);
    await expect(learner).toHaveURL(new RegExp(`/portal/${vendor.slug}$`));
    await learner.getByRole("link", { name: "開始課程學習" }).click();
    await expect(learner.getByRole("heading", { name: product.name })).toBeVisible();
    const progressPath = `/portal/${vendor.slug}/learn/${product.id}/progress`;
    const rejected = await learner.request.post(progressPath, { headers: { origin: baseURL!, "x-celebratedeal-client": "web", "x-csrf-token": "invalid" }, data: { lessonId: lesson.id, watchedSeconds: 100, markedComplete: true } });
    expect(rejected.status()).toBe(403);
    expect(await db.courseLessonProgress.count({ where: { vendorId: vendor.id } })).toBe(0);
    // A synthetic media clock exercises the real player handlers and backend;
    // it does not represent decoding or delivery by the external video provider.
    // Real playback emits timeupdate repeatedly. Keep the exact 75-second
    // checkpoint assertion while allowing React hydration to attach its handler.
    await expect.poll(async () => {
      await learner.locator("video").evaluate((element) => {
        Object.defineProperty(element, "currentTime", { configurable: true, writable: true, value: 75 });
        element.dispatchEvent(new Event("timeupdate"));
      });
      return (await db.courseLessonProgress.findFirst({ where: { vendorId: vendor.id } }))?.watchedSeconds;
    }).toBe(75);
    await learner.reload();
    await learner.locator("video").evaluate((element) => {
      Object.defineProperty(element, "duration", { configurable: true, value: 100 });
      Object.defineProperty(element, "currentTime", { configurable: true, writable: true, value: 0 });
      element.dispatchEvent(new Event("loadedmetadata"));
    });
    await expect.poll(() => learner.locator("video").evaluate((element) => (element as HTMLVideoElement).currentTime)).toBe(75);
    await learner.getByRole("button", { name: "標記完成", exact: true }).click();
    await expect(learner.getByText("100% 完成")).toBeVisible();
    await learner.reload();
    await expect(learner.getByRole("button", { name: "已標記完成" })).toBeVisible();
    // Use the browser transport used by the actual download link. A standalone
    // APIRequestContext has different Secure-cookie handling on local HTTP.
    const certificate = await learner.evaluate(async (url) => {
      const response = await fetch(url);
      return { status: response.status, contentType: response.headers.get("content-type"), text: await response.text() };
    }, `/portal/${vendor.slug}/learn/${product.id}/certificate`);
    expect(certificate.status).toBe(200);
    expect(certificate.contentType).toContain("image/svg+xml");
    expect(certificate.text).toContain("合成學員");
    expect(await db.courseLessonProgress.count({ where: { vendorId: vendor.id } })).toBe(1);
    await db.$transaction((tx) => reconcileCommerceOrderRefund(tx, { vendorId: vendor.id, orderId, providerName: "synthetic", eventIdentity: randomUUID(), amountCents: 10000, occurredAt: new Date() }));
    const revokedStatus = await learner.evaluate(async (url) => (await fetch(url)).status, `/portal/${vendor.slug}/learn/${product.id}/certificate`);
    expect(revokedStatus).toBe(404);
    await learner.goto(`/portal/${vendor.slug}`);
    await expect(learner.getByRole("link", { name: "開始課程學習" })).toHaveCount(0);
  } finally {
    await learnerContext.close();
    await db.vendor.delete({ where: { id: vendor.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
