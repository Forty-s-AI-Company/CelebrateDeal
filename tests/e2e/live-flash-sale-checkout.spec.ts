import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

const db = new PrismaClient();
test.afterAll(async () => { await db.$disconnect(); });

for (const width of [1440, 390]) {
  test(`live flash sale confirms price and recovers the same order at ${width}px`, async ({ page }) => {
    // 包含真實入場、發券、授權、交易與重新載入；不呼叫外部金流或寄信。
    test.setTimeout(60_000);
    const suffix = randomUUID();
    const vendor = await db.vendor.create({ data: { name: "Synthetic sale vendor", slug: suffix, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
    try {
      const video = await db.video.create({ data: { vendorId: vendor.id, title: "Synthetic video", videoUrl: "https://video.example.test/sale.mp4", sourceType: "url", status: "ready", durationSec: 600 } });
      const product = await db.product.create({ data: { vendorId: vendor.id, name: "快閃測試商品", slug: suffix, priceCents: 2000, inventory: 5, fulfillmentTypeConfirmed: true } });
      const startedAt = new Date(Date.now() - 1000);
      // 使用完整、可發布的場次資料，讓測試經過正式的入場檢查。
      const form = await db.registrationForm.create({ data: {
        vendorId: vendor.id, name: "Synthetic registration", slug: suffix, headline: "測試報名",
        fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }],
      } });
      const template = await db.messageTemplate.create({ data: {
        vendorId: vendor.id, name: "Synthetic confirmation", channel: "email", trigger: "registration_confirmed",
        subject: "{{live_title}} 報名成功", body: "{{name}} 已完成報名。{{unsubscribe_url}}", isActive: true,
      } });
      const script = await db.interactionScript.create({ data: {
        vendorId: vendor.id, name: "Synthetic sale script", status: "published",
        events: { create: { eventType: "product_spotlight", triggerSec: 5, title: "測試商品介紹", productId: product.id } },
      } });
      const live = await db.live.create({ data: { vendorId: vendor.id, videoId: video.id, formId: form.id, messageTemplateId: template.id, interactionScriptId: script.id, title: "Synthetic sale live", slug: suffix, scheduledAt: startedAt, startedAt, status: "live", streamMode: "vod", products: { create: { productId: product.id } } } });
      const run = await db.liveInteractionRun.create({ data: { vendorId: vendor.id, liveId: live.id, source: "manual", eventType: "flash_sale", title: "測試快閃優惠", startsAt: startedAt, endsAt: new Date(Date.now() + 300000), configuration: { kind: "flash_sale", productId: product.id, durationSec: 300, salePriceCents: 1000, originalPriceCents: 2000, stockLimit: 1 } } });
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(`/live/${live.slug}`, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      await expect(page.getByTestId("live-advanced-interaction")).toContainText("測試快閃優惠");
      await page.getByRole("button", { name: "立即搶購特惠方案" }).click();
      await expect(page).toHaveURL(new RegExp(`/checkout/${vendor.id}/${product.id}\\?flashSale=${run.id}$`, "u"));
      await expect(page.getByRole("heading", { name: "確認購買資料", exact: true })).toBeVisible();
      await page.getByLabel("姓名", { exact: true }).fill("Synthetic buyer");
      await page.locator('input[name="buyerEmail"]').fill("buyer@example.test");
      await page.getByLabel("電話", { exact: true }).fill("0912345678");
      await page.getByLabel("收件人", { exact: true }).fill("Synthetic buyer");
      await page.getByLabel("收件電話", { exact: true }).fill("0912345678");
      await page.getByLabel("縣市", { exact: true }).fill("台北市");
      await page.getByLabel("鄉鎮市區", { exact: true }).fill("中正區");
      await page.getByLabel("地址", { exact: true }).fill("合成測試路 1 號");
      await page.getByRole("checkbox", { name: /我已閱讀目前的/u }).check();
      await page.getByRole("button", { name: "購買「快閃測試商品」", exact: true }).click();
      await expect(page.getByRole("button", { name: "確認優惠並前往付款" })).toBeVisible();
      await expect(page.locator("form strong.text-xl")).toHaveText(/10/u);
      expect(await db.commerceOrder.count({ where: { vendorId: vendor.id } })).toBe(0);
      await page.getByRole("button", { name: "確認優惠並前往付款" }).click();
      await expect(page.locator("#checkout-live-status")).toContainText(/訂單 .* 已建立/u);
      const order = await db.commerceOrder.findFirstOrThrow({ where: { vendorId: vendor.id } });
      expect(order.totalAmountCents).toBe(1000);
      expect(await db.liveInteractionResponse.count({ where: { runId: run.id, usedOrderId: order.id } })).toBe(1);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText(/已找到原本的待付款訂單/u)).toBeVisible();
      await expect(page.locator("form strong.text-xl")).toHaveText(/10/u);
      expect(await db.commerceOrder.count({ where: { vendorId: vendor.id } })).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      // 此段只驗證失敗狀態的瀏覽器呈現與憑證查詢；金流失敗及庫存恢復另由真實 DB 測試涵蓋。
      await db.$transaction([
        db.paymentTransaction.updateMany({ where: { vendorId: vendor.id }, data: { status: "failed" } }),
        db.commerceOrder.update({ where: { id: order.id }, data: { status: "payment_failed", failedAt: new Date() } }),
      ]);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText("原結帳請求已結束。請先查看訂單狀態，避免重複付款。")).toBeVisible();
      await page.getByRole("link", { name: "查看原訂單與付款狀態" }).click();
      await expect(page.getByRole("heading", { name: "我的訂單", exact: true })).toBeVisible();
      await expect(page.getByText("付款失敗", { exact: true })).toBeVisible();
      await expect(page.getByText(`訂單 ${order.orderNumber}`, { exact: false })).toBeVisible();
      expect(await db.liveInteractionResponse.count({ where: { runId: run.id, usedOrderId: order.id } })).toBe(1);
    } finally {
      await page.goto("about:blank");
      await db.vendor.delete({ where: { id: vendor.id } });
    }
  });
}
