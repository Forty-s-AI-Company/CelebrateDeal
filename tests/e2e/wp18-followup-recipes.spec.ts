import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { processDueCheckoutFollowups } from "../../src/lib/checkout-followup-queue";

// 此 fixture 只由既有 disposable runner 注入隔離資料庫；不連外寄信。
const db = new PrismaClient();
const run = randomUUID();
const email = `wp18-${run}@example.test`;
const password = "Synthetic-WP18-Password-123!";
let vendorId = "";
let productId = "";

async function axe(page: Page) {
  await expect.poll(() => page.title()).toContain("CelebrateDeal");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.filter(v => v.impact === "serious" || v.impact === "critical")
    .map(v => ({ id: v.id, impact: v.impact }))).toEqual([]);
}

test.beforeAll(async () => {
  // 與 webServer 使用同一個明確 loopback origin，避免 worker 郵件連結回退。
  const origin = new URL(String(test.info().project.use.baseURL));
  expect(origin.hostname).toBe("127.0.0.1");
  process.env.NEXT_PUBLIC_APP_URL = origin.origin;
  process.env.E2E_TEST_MODE = "true";
  const vendor = await db.vendor.create({ data: {
    name: "WP18 合成商家", slug: `wp18-${run}`, email,
    passwordHash: hashPassword(password), tracking: { create: {} },
  } });
  vendorId = vendor.id;
  await db.user.create({ data: { email, name: "WP18 合成擁有者", status: "active",
    passwordHash: hashPassword(password), memberships: { create: { vendorId, role: "owner", status: "active" } },
  } });
  const product = await db.product.create({ data: {
    vendorId, name: "WP18 合成實體商品", slug: `wp18-product-${run}`,
    priceCents: 12800, currency: "TWD", inventory: 3, isActive: true,
    commerceDomain: "merchant", fulfillmentType: "physical", fulfillmentTypeConfirmed: true,
  } });
  productId = product.id;
});

test.afterAll(async () => { await db.$disconnect(); });

test("owner activates three draft recipes; real checkout produces one delayed follow-up; desktop/mobile axe", async ({ page }) => {
  test.setTimeout(180_000);
  // 模擬已驗證入口只限此隔離站；外部請求一律中止，合成 proof 不會送出。
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1"
    ? route.continue() : route.abort());
  await page.setExtraHTTPHeaders({
    "x-real-ip": "192.0.2.18",
    "x-forwarded-for": "192.0.2.18",
    "x-celebratedeal-live-chat-ingress": "wp18-owned-loopback-ingress-proof-20261016",
  });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/u);
  await page.goto("/settings/automations");
  for (const name of ["未到場追銷", "看完未下單追銷", "結帳未完成追銷"]) {
    const recipe = page.locator("form").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await recipe.getByRole("button", { name: "一鍵建立草稿", exact: true }).click();
    await expect(page).toHaveURL(/updated=recipe_created/u);
    const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(card.getByText("已停用", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "啟用", exact: true }).click();
    await expect(card.getByText("啟用中", { exact: true })).toBeVisible();
  }
  expect(await db.automationRule.count({ where: { vendorId, isActive: true } })).toBe(3);
  expect(await db.emailDelivery.count({ where: { vendorId } })).toBe(0);
  await axe(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await axe(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await page.goto(`/checkout/${vendorId}/${productId}`))?.status()).toBe(200);
  await axe(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await axe(page);
  await page.getByLabel("姓名", { exact: true }).fill("合成買家");
  await page.getByLabel("Email", { exact: true }).fill(`buyer-${run}@example.test`);
  await page.getByLabel("電話", { exact: true }).fill("0912345678");
  await page.getByLabel("收件人", { exact: true }).fill("合成收件人");
  await page.getByLabel("收件電話", { exact: true }).fill("0912345678");
  await page.getByLabel("縣市", { exact: true }).fill("台北市");
  await page.getByLabel("鄉鎮市區", { exact: true }).fill("中正區");
  await page.getByLabel("地址", { exact: true }).fill("合成驗收路 18 號");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /購買/u }).click();
  await expect(page.getByRole("status")).toContainText(/訂單 .* 已建立/u);
  const order = await db.commerceOrder.findFirstOrThrow({ where: { vendorId } });
  expect(order.status).toBe("pending_payment");
  expect(await db.commerceOrder.count({ where: { vendorId } })).toBe(1);
  expect(await db.commerceOrderEvent.count({ where: { vendorId, orderId: order.id, eventType: "checkout_incomplete_candidate" } })).toBe(1);
  // 只推進 scheduler 的合成 now，不改寫訂單／事件的真實來源時間。
  await processDueCheckoutFollowups(db);
  expect(await db.emailDelivery.count({ where: { vendorId } })).toBe(0);
  const now = new Date(Date.now() + 31 * 60_000);
  await processDueCheckoutFollowups(db, { now });
  expect(await db.emailDelivery.count({ where: { vendorId, status: "queued" } })).toBe(1);
  await processDueCheckoutFollowups(db, { now });
  expect(await db.emailDelivery.count({ where: { vendorId } })).toBe(1);
});
