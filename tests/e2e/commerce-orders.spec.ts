import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request as PlaywrightRequest, type Response } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  applyPaymentInventoryTransition,
  createReservedPaymentTransaction,
} from "../../src/lib/inventory-reservations";
import {
  createCommerceOrderForCheckout,
  reconcileCommerceOrderPaymentTransition,
  reconcileCommerceOrderRefund,
} from "../../src/lib/commerce-orders";
import { getRuntimeLivePublishReadiness } from "../../src/lib/live-runtime-readiness";
import { publicLiveAvailabilityWhere } from "../../src/lib/sellable-live";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const runId = randomUUID().replace(/-/g, "");
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? "31023"}`;
// This is a deliberately synthetic local token. The browser receives only the
// token, while the database stores its deterministic SHA-256 hash as production
// auth does.
const sessionToken = `g7-04-local-playwright-session-token-${runId}`;
const sessionTokenHash = createHash("sha256").update(sessionToken).digest("hex");

const buyer = {
  name: "合成買家王小明",
  email: `g7-04-buyer-${runId}@celebratedeal.local`,
  phone: "0912345678",
};
const shipping = {
  recipientName: "合成收件人王小明",
  phone: "0912345678",
  countryCode: "TW",
  postalCode: "100",
  administrativeArea: "台北市",
  locality: "中正區",
  addressLine1: "合成驗收路 100 號",
  addressLine2: "10 樓",
};

const fixture = {
  vendorIds: [] as string[],
  userId: "",
  orderId: "",
  orderNumber: "",
  foreignOrderId: "",
  foreignOrderNumber: "",
  productId: "",
  productSlug: "",
  foreignProductId: "",
  foreignLiveId: "",
  foreignLiveSlug: "",
  sellableLiveId: "",
  sellableLiveSlug: "",
  catalogProductId: "",
  catalogProductSlug: "",
  deliveryProductId: "",
  deliveryProductSlug: "",
  registrationTemplateId: "",
  reminderTemplateId: "",
  buyerGrantId: "",
  buyerGrantCookieKey: "",
  buyerGrantToken: "",
  foreignBuyerGrantId: "",
  buyerEncryptedEnvelope: "",
  shippingEncryptedEnvelope: "",
};

async function shippingFulfillmentSnapshot() {
  return db.shippingFulfillment.findFirst({
    where: { vendorId: fixture.vendorIds[0], orderItem: { orderId: fixture.orderId } },
    select: { status: true, revision: true, carrierName: true, trackingNumber: true },
  });
}

async function shippingFulfillmentDiagnostic() {
  const snapshot = await shippingFulfillmentSnapshot();
  return {
    status: snapshot?.status ?? "missing",
    revision: snapshot?.revision ?? null,
  };
}

function normalizePathQuery(value: string) {
  try {
    const parsed = new URL(value, baseURL);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

test.use({ trace: "off", screenshot: "off", video: "off" });

async function expectNoBlockingAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = result.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target.map((selector) => (
        String(selector).split(" > ").slice(-3).join(" > ")
      ))),
    }));

  if (blocking.length > 0) {
    throw new Error(`AXE_BLOCKING:${JSON.stringify(blocking)}`);
  }
}

async function installOwnerSession(page: Page) {
  await page.context().addCookies([{
    name: "celebrate_session",
    value: sessionToken,
    url: baseURL,
    httpOnly: true,
    sameSite: "Lax",
  }]);
}

type LiveWizardControlName = "scheduledAt" | "messageTemplateId";

async function openWizardPanelForControl(page: Page, controlName: LiveWizardControlName) {
  const panels = page.locator("[data-step-index]").filter({
    // controlName is restricted to fixed internal form names before it is used in a selector.
    has: page.locator(`[name="${controlName}"]`),
  });
  await expect(panels).toHaveCount(1);
  const panel = panels.first();
  const panelId = await panel.getAttribute("id");
  if (!panelId) throw new Error(`WIZARD_PANEL_ID_MISSING:${controlName}`);

  const navigation = page.locator(`button[aria-controls="${panelId}"]`);
  await expect(navigation).toHaveCount(1);
  await expect(navigation).toBeVisible();
  await navigation.click();
  await expect(panel).toBeVisible();
  return panel;
}

async function installBuyerOrderCapability(page: Page) {
  await page.context().addCookies([{
    name: `celebrate_support_${fixture.buyerGrantCookieKey}`,
    value: fixture.buyerGrantToken,
    url: baseURL,
    httpOnly: true,
    sameSite: "Lax",
  }]);
}

function classifyServerActionBody(body: string) {
  const signatures: Array<[RegExp, string]> = [
    [/Invalid CSRF token/iu, "CSRF_REJECTED"],
    [/Invalid request origin|origin.*host/iu, "ORIGIN_REJECTED"],
    [/Failed to find Server Action/iu, "ACTION_ID_NOT_FOUND"],
    [/Only plain objects|cannot be serialized|serialization/iu, "ACTION_STATE_NOT_SERIALIZABLE"],
    [/Prisma|P2002|Unique constraint/iu, "PRISMA_RUNTIME_FAILED"],
    [/NEXT_REDIRECT/iu, "REDIRECT_CONTROL_FLOW_FAILED"],
    [/TypeError|ReferenceError|Cannot read properties/iu, "SERVER_RUNTIME_TYPE_ERROR"],
  ];
  return signatures.find(([pattern]) => pattern.test(body))?.[1] ?? "UNCLASSIFIED";
}

async function captureIfRequested(
  page: Page,
  filename: "desktop.png" | "mobile.png" | "product-desktop.png" | "product-mobile.png" | "payment-result.png" | "finance-pending.png" | "email-templates.png" | "live-studio-desktop.png" | "live-studio-mobile.png" | "buyer-orders-desktop.png" | "buyer-orders-mobile.png" | "product-delivery-desktop.png" | "product-delivery-mobile.png" | "buyer-delivery-desktop.png" | "buyer-delivery-mobile.png" | "onboarding-desktop.png" | "onboarding-mobile.png" | "stream-quota-desktop.png" | "stream-quota-mobile.png" | "stream-retry-desktop.png" | "stream-retry-mobile.png" | "checkout-recovery-desktop.png" | "checkout-recovery-mobile.png" | "message-template-draft-desktop.png" | "message-template-draft-mobile.png" | "interaction-role-desktop.png" | "interaction-role-mobile.png" | "persistent-player-desktop.png" | "persistent-player-mobile.png",
) {
  const screenshotDirectory = process.env.G7_COMMERCE_SCREENSHOT_DIR;
  if (!screenshotDirectory) return;

  const outputDirectory = resolve(screenshotDirectory);
  await mkdir(outputDirectory, { recursive: true });
  await page.screenshot({ path: join(outputDirectory, filename), fullPage: true });
}

async function createPaidPhysicalOrder(input: {
  vendorId: string;
  productId: string;
  orderPrefix: string;
}) {
  const checkoutIdempotencyKey = `g7-04-checkout-${input.orderPrefix}-${runId}`;
  const orderNumber = `G7-04-${input.orderPrefix}-${runId}`;
  const transaction = await createReservedPaymentTransaction({
    vendorId: input.vendorId,
    productId: input.productId,
    checkoutIdempotencyKey,
    transactionData: {
      vendorId: input.vendorId,
      providerName: "demo",
      orderNumber,
      checkoutIdempotencyKey,
      grossAmountCents: 12_800,
      netAmountCents: 12_800,
      currency: "TWD",
      status: "pending",
      metadata: { productId: input.productId, fixture: "g7-04-local-e2e" },
    },
    createCommerceOrder: async (tx, payment) => {
      await createCommerceOrderForCheckout(tx, {
        vendorId: input.vendorId,
        productId: input.productId,
        orderNumber,
        checkoutIdempotencyKey,
        paymentTransactionId: payment.id,
        totalAmountCents: 12_800,
        currency: "TWD",
        buyer,
        shipping,
      });
    },
  });

  const paidAt = new Date("2026-08-08T04:00:00.000Z");
  await db.$transaction(async (tx) => {
    const paidTransaction = await tx.paymentTransaction.update({
      where: { id: transaction.id },
      data: { status: "paid", occurredAt: paidAt },
    });
    await applyPaymentInventoryTransition(tx, {
      transaction: paidTransaction,
      eventType: "paid",
      trustedCheckoutMetadata: { productId: input.productId },
      now: paidAt,
    });
    const convergence = await reconcileCommerceOrderPaymentTransition(tx, {
      vendorId: input.vendorId,
      paymentTransactionId: paidTransaction.id,
      eventIdentity: `g7-04-paid-${input.orderPrefix}-${runId}`,
      transition: "paid",
      occurredAt: paidAt,
    });
    expect(convergence).toMatchObject({ changed: true, status: "paid" });
  });

  const order = await db.commerceOrder.findUniqueOrThrow({
    where: { vendorId_checkoutIdempotencyKey: { vendorId: input.vendorId, checkoutIdempotencyKey } },
    include: { items: { include: { shippingFulfillment: true } } },
  });
  expect(order).toMatchObject({ status: "paid", paidAmountCents: 12_800 });
  expect(order.items).toHaveLength(1);
  expect(order.items[0]?.shippingFulfillment).toMatchObject({ status: "pending", revision: 1 });
  expect(await db.inventoryReservation.findUniqueOrThrow({ where: { paymentTransactionId: transaction.id } }))
    .toMatchObject({ status: "committed" });

  return { order, orderNumber };
}

function fixtureUrlSafeSlugPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

async function createSellableLiveFixture(input: {
  vendorId: string;
  productId: string;
  prefix: string;
  includeProductSpotlight?: boolean;
}) {
  const slugPrefix = `${fixtureUrlSafeSlugPart(input.prefix)}-${runId}`;
  const video = await db.video.create({
    data: {
      vendorId: input.vendorId,
      title: `${input.prefix} 合成可播放影片`,
      sourceType: "url",
      videoUrl: `https://media.example.test/${slugPrefix}.mp4`,
      status: "ready",
    },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId: input.vendorId,
      name: `${input.prefix} 合成報名表單`,
      slug: `g7-49-form-${slugPrefix}`,
      headline: `${input.prefix} 合成報名`,
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
      isActive: true,
    },
  });
  const role = await db.interactionRole.create({
    data: {
      vendorId: input.vendorId,
      name: `${input.prefix} 合成官方角色`,
      label: "官方角色",
      roleType: "official",
      isActive: true,
    },
  });
  const script = await db.interactionScript.create({
    data: {
      vendorId: input.vendorId,
      name: `${input.prefix} 合成已發布腳本`,
      status: "published",
      events: {
        create: [
          {
            roleId: role.id,
            eventType: "chat_message",
            triggerSec: 10,
            title: "歡迎加入",
            message: "這是本機合成互動訊息。",
          },
          ...(input.includeProductSpotlight ? [{
            eventType: "product_spotlight" as const,
            triggerSec: 5,
            title: "推薦商品",
            productId: input.productId,
          }] : []),
        ],
      },
    },
  });
  const template = await db.messageTemplate.create({
    data: {
      vendorId: input.vendorId,
      name: `${input.prefix} 合成報名成功 Email`,
      channel: "email",
      trigger: "registration_confirmed",
      subject: "{{live_title}} 報名成功",
      body: "{{name}}，你已報名 {{live_title}}。",
      isActive: true,
    },
  });
  const live = await db.live.create({
    data: {
      vendorId: input.vendorId,
      videoId: video.id,
      formId: form.id,
      messageTemplateId: template.id,
      interactionScriptId: script.id,
      title: `${input.prefix} 合成可販售直播`,
      slug: `g7-49-live-${slugPrefix}`,
      scheduledAt: new Date("2027-01-15T12:00:00.000Z"),
      status: "scheduled",
      streamMode: "live",
      replayEnabled: true,
      products: {
        create: {
          productId: input.productId,
          sortOrder: 0,
          isPinned: true,
        },
      },
    },
  });
  expect(live.slug).not.toMatch(/[\s%]/u);
  expect(encodeURIComponent(live.slug)).toBe(live.slug);
  const publicRuntimeLive = await db.live.findFirst({
    where: {
      id: live.id,
      slug: live.slug,
      ...publicLiveAvailabilityWhere(),
    },
    include: {
      vendor: true,
      video: true,
      form: true,
      messageTemplate: true,
      interactionScript: {
        include: {
          events: {
            orderBy: { triggerSec: "asc" },
            include: { role: true },
          },
        },
      },
      products: {
        orderBy: { sortOrder: "asc" },
        include: { product: true },
      },
    },
  });
  expect(
    publicRuntimeLive,
    `可販售直播 fixture 必須通過公開頁 availability query：${live.slug}`,
  ).not.toBeNull();
  if (!publicRuntimeLive) {
    throw new Error(`公開直播 fixture 不存在或不符合 availability 條件：${live.slug}`);
  }
  expect(
    getRuntimeLivePublishReadiness(publicRuntimeLive),
    `可販售直播 fixture 必須通過公開頁 runtime readiness：${live.slug}`,
  ).toMatchObject({ ready: true, blockers: [] });
  return { video, form, role, script, template, live };
}

test.describe.serial("G7-04 商家訂單 UI", () => {
  test.beforeAll(async () => {
    const [vendor, foreignVendor] = await Promise.all([
      db.vendor.create({
        data: {
          name: `G7-04 商家 ${runId}`,
          slug: `g7-04-owner-${runId}`,
          email: `g7-04-owner-${runId}@celebratedeal.local`,
          supportEmail: `g7-49-support-${runId}@celebratedeal.local`,
          passwordHash: "g7-04-synthetic-password-hash",
        },
      }),
      db.vendor.create({
        data: {
          name: `G7-04 跨租戶商家 ${runId}`,
          slug: `g7-04-foreign-${runId}`,
          email: `g7-04-foreign-${runId}@celebratedeal.local`,
          passwordHash: "g7-04-synthetic-password-hash",
        },
      }),
    ]);
    fixture.vendorIds.push(vendor.id, foreignVendor.id);

    const user = await db.user.create({
      data: {
        email: `g7-04-owner-user-${runId}@celebratedeal.local`,
        name: "G7-04 合成商家 Owner",
        passwordHash: "g7-04-synthetic-password-hash",
        platformRole: "platform_admin",
        status: "active",
        memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
      },
    });
    fixture.userId = user.id;
    await db.userMfaFactor.create({
      data: {
        userId: user.id,
        factorType: "totp",
        secretEncrypted: "g7-04-synthetic-mfa-factor",
      },
    });
    await db.userSession.create({
      data: {
        userId: user.id,
        vendorId: vendor.id,
        tokenHash: sessionTokenHash,
        mfaVerifiedAt: new Date("2026-08-08T03:00:00.000Z"),
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });

    const [product, foreignProduct] = await Promise.all([
      db.product.create({
        data: {
          vendorId: vendor.id,
          name: "G7-04 合成實體商品",
          slug: `g7-04-physical-${runId}`,
          description: "僅供本機 Playwright 驗收的合成商品",
          priceCents: 12_800,
          currency: "TWD",
          // This serial acceptance flow consumes three units: one prebuilt paid
          // order, one public checkout, and one response-loss recovery checkout.
          inventory: 4,
          isActive: true,
          commerceDomain: "merchant",
          fulfillmentType: "physical",
          fulfillmentTypeConfirmed: true,
        },
      }),
      db.product.create({
        data: {
          vendorId: foreignVendor.id,
          name: "G7-04 跨租戶實體商品",
          slug: `g7-04-foreign-physical-${runId}`,
          priceCents: 12_800,
          currency: "TWD",
          inventory: 2,
          isActive: true,
          commerceDomain: "merchant",
          fulfillmentType: "physical",
          fulfillmentTypeConfirmed: true,
        },
      }),
    ]);

    const [registrationTemplate, reminderTemplate] = await Promise.all([
      db.messageTemplate.create({
        data: {
          vendorId: vendor.id,
          name: "G7-21 合成報名成功 Email",
          channel: "email",
          trigger: "registration_confirmed",
          subject: "{{live_title}} 報名成功",
          body: "{{name}}，你已報名 {{live_title}}。",
          isActive: true,
        },
      }),
      db.messageTemplate.create({
        data: {
          vendorId: vendor.id,
          name: "G7-21 合成開播提醒 Email",
          channel: "email",
          trigger: "live_reminder",
          subject: "{{live_title}} 即將開始",
          body: "{{name}}，{{live_start_at}} 即將開播。",
          isActive: true,
        },
      }),
    ]);
    fixture.registrationTemplateId = registrationTemplate.id;
    fixture.reminderTemplateId = reminderTemplate.id;

    // A complete foreign commerce journey must never improve the owner
    // vendor's onboarding progress.
    const foreignLive = await createSellableLiveFixture({
      vendorId: foreignVendor.id,
      productId: foreignProduct.id,
      prefix: "G7-49 FOREIGN",
      includeProductSpotlight: true,
    });
    expect(foreignLive.live.vendorId).toBe(foreignVendor.id);
    fixture.sellableLiveId = foreignLive.live.id;
    fixture.sellableLiveSlug = foreignLive.live.slug;

    // Keep the quota-stop proof isolated from commerce data. The public runtime
    // still requires an active registration form and confirmation template, but
    // this fixture intentionally has no product and does not alter quota policy.
    const streamQuotaVideo = await db.video.create({
      data: {
        vendorId: foreignVendor.id,
        title: "G7-50 合成額度播放影片",
        sourceType: "url",
        videoUrl: `https://media.example.test/g7-50-stream-quota-${runId}.mp4`,
        status: "ready",
      },
    });
    const [streamQuotaForm, streamQuotaTemplate] = await Promise.all([
      db.registrationForm.create({
        data: {
          vendorId: foreignVendor.id,
          name: `G7-50 合成額度播放報名表單 ${runId}`,
          slug: `g7-50-stream-quota-form-${runId}`,
          headline: "G7-50 合成額度播放報名",
          fields: [
            { key: "name", label: "姓名", type: "text", required: true },
            { key: "email", label: "Email", type: "email", required: true },
          ],
          isActive: true,
        },
      }),
      db.messageTemplate.create({
        data: {
          vendorId: foreignVendor.id,
          name: `G7-50 合成額度播放報名成功 Email ${runId}`,
          channel: "email",
          trigger: "registration_confirmed",
          subject: "{{live_title}} 報名成功",
          body: "{{name}}，你已報名 {{live_title}}。",
          isActive: true,
        },
      }),
    ]);
    const streamQuotaLive = await db.live.create({
      data: {
        vendorId: foreignVendor.id,
        videoId: streamQuotaVideo.id,
        formId: streamQuotaForm.id,
        messageTemplateId: streamQuotaTemplate.id,
        title: "G7-50 合成額度播放直播",
        slug: `g7-50-stream-quota-${runId}`,
        scheduledAt: new Date("2026-08-10T12:00:00.000Z"),
        status: "live",
        streamMode: "live",
        startedAt: new Date("2026-08-10T12:00:00.000Z"),
        replayEnabled: true,
      },
    });
    fixture.foreignLiveId = streamQuotaLive.id;
    fixture.foreignLiveSlug = streamQuotaLive.slug;

    // These orders use separate tenants, but both serializable transactions
    // touch shared commerce tables. Keep fixture creation deterministic so a
    // disposable PostgreSQL deadlock cannot obscure the browser assertions.
    const ownOrder = await createPaidPhysicalOrder({ vendorId: vendor.id, productId: product.id, orderPrefix: "OWNER" });
    const foreignOrder = await createPaidPhysicalOrder({ vendorId: foreignVendor.id, productId: foreignProduct.id, orderPrefix: "FOREIGN" });
    fixture.orderId = ownOrder.order.id;
    fixture.orderNumber = ownOrder.orderNumber;
    fixture.productId = product.id;
    fixture.productSlug = product.slug;
    fixture.foreignProductId = foreignProduct.id;
    fixture.foreignOrderId = foreignOrder.order.id;
    fixture.foreignOrderNumber = foreignOrder.orderNumber;
    fixture.buyerEncryptedEnvelope = ownOrder.order.buyerEncryptedEnvelope;
    fixture.shippingEncryptedEnvelope = ownOrder.order.shippingEncryptedEnvelope ?? "";

    fixture.buyerGrantId = randomUUID();
    fixture.foreignBuyerGrantId = randomUUID();
    fixture.buyerGrantCookieKey = createHash("sha256").update(`g7-47-cookie:${runId}`).digest("hex").slice(0, 32);
    fixture.buyerGrantToken = createHash("sha256").update(`g7-47-token:${runId}`).digest("base64url");
    await Promise.all([
      db.buyerSupportOrderGrant.create({
        data: {
          id: fixture.buyerGrantId,
          vendorId: vendor.id,
          orderId: fixture.orderId,
          cookieKey: fixture.buyerGrantCookieKey,
          tokenHash: createHash("sha256").update(fixture.buyerGrantToken).digest("hex"),
          expiresAt: new Date("2027-08-09T00:00:00.000Z"),
        },
      }),
      db.buyerSupportOrderGrant.create({
        data: {
          id: fixture.foreignBuyerGrantId,
          vendorId: foreignVendor.id,
          orderId: fixture.foreignOrderId,
          cookieKey: createHash("sha256").update(`g7-47-foreign-cookie:${runId}`).digest("hex").slice(0, 32),
          tokenHash: createHash("sha256").update(`g7-47-foreign-token:${runId}`).digest("hex"),
          expiresAt: new Date("2027-08-09T00:00:00.000Z"),
        },
      }),
    ]);
  });

  test.afterAll(async () => {
    try {
      // Exact IDs keep cleanup limited to the two vendors and owner created in
      // this file; vendor cascades remove the commerce graph.
      await db.vendor.deleteMany({ where: { id: { in: fixture.vendorIds } } });
      if (fixture.userId) await db.user.deleteMany({ where: { id: fixture.userId } });
    } finally {
      await db.$disconnect();
    }
  });

test("desktop merchant can recover upload and validation errors, then publish and preview one product", async ({ page }, testInfo) => {
    await installOwnerSession(page);
    const productName = `G7-15 Browser 商品 ${runId.slice(0, 8)}`;
    const productSlug = `g7-15-browser-${runId}`;

    const response = await page.goto("/products/new");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "新增商品" })).toBeVisible();
    await expect(page.getByText("新商品會先儲存為草稿；確認預覽、價格、庫存與交付方式後，再勾選上架。", { exact: true })).toBeVisible();

    const foreignProductName = "G7-04 跨租戶實體商品";
    const foreignProductSnapshot = await db.product.findUniqueOrThrow({
      where: { id: fixture.foreignProductId },
      select: {
        id: true,
        vendorId: true,
        name: true,
        slug: true,
        priceCents: true,
        inventory: true,
        isActive: true,
      },
    });
    for (const path of [
      `/products/${fixture.foreignProductId}/edit`,
      `/products/${fixture.foreignProductId}/preview`,
    ]) {
      await navigateAndAssertDirectUrlGuard({
        page,
        path,
        transport: { kind: "streaming-not-found", status: 200 },
        routeIdentityCanaries: [fixture.foreignProductId],
        protectedPayloadCanaries: [foreignProductName],
        documentCanaries: [foreignProductName],
        finalUrl: path,
        finalStatus: 200,
      });
    }
    await expect(db.product.findUniqueOrThrow({
      where: { id: fixture.foreignProductId },
      select: {
        id: true,
        vendorId: true,
        name: true,
        slug: true,
        priceCents: true,
        inventory: true,
        isActive: true,
      },
    })).resolves.toEqual(foreignProductSnapshot);
    expect((await page.goto("/products/new"))?.status()).toBe(200);

    await page.getByLabel("商品名稱", { exact: true }).fill(productName);
    await page.getByLabel("Slug", { exact: true }).fill(fixture.productSlug);
    await page.getByLabel("售價（元）", { exact: true }).fill("1680");
    await page.getByLabel("可售庫存", { exact: true }).fill("3");
    await page.getByLabel("商品描述", { exact: true }).fill("G7-15 合成商品，驗證草稿、錯誤復原、預覽與上架流程。");

    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    await page.locator('input[type="file"][accept^="image/"]').setInputFiles({
      name: "g7-15-product.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(page.getByText("已選擇：g7-15-product.png", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "儲存", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "開始上傳", exact: true }).click();
    await expect(page.getByText("R2 圖片儲存尚未完成設定，請稍後重試。", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "重試上傳", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "移除", exact: true }).click();
    await expect(page.getByRole("button", { name: "儲存", exact: true })).toBeEnabled();

    expect(await db.product.count({
      where: { vendorId: fixture.vendorIds[0], slug: fixture.productSlug },
    })).toBe(1);
    await expect(page.getByLabel("Slug", { exact: true })).toHaveValue(fixture.productSlug);
    const duplicateResponse = page.waitForResponse((candidate) => {
      const request = candidate.request();
      return request.method() === "POST" && new URL(candidate.url()).pathname === "/products/new";
    });
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    const duplicateHttpResponse = await duplicateResponse;
    if (duplicateHttpResponse.status() !== 200) {
      const classification = classifyServerActionBody(await duplicateHttpResponse.text());
      throw new Error(`PRODUCT_ACTION_HTTP_${duplicateHttpResponse.status()}_${classification}`);
    }
    await expect(page).toHaveURL(/\/products\/new$/u);
    const productFormAlert = page.locator('form [role="alert"]');
    await expect(productFormAlert).toHaveCount(1);
    await expect(productFormAlert).toHaveText("這個 Slug 已被目前商家的另一個商品使用，請更換後再儲存。");
    await expect(page.getByLabel("商品名稱", { exact: true })).toHaveValue(productName);
    await expect(page.getByLabel("售價（元）", { exact: true })).toHaveValue("1680");
    await expect(page.getByLabel("可售庫存", { exact: true })).toHaveValue("3");

    await page.getByLabel("Slug", { exact: true }).fill(productSlug);
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page).toHaveURL(/\/products\?updated=created$/u);
    await expect(page.getByText("商品已建立為草稿。", { exact: true })).toBeVisible();
    const created = await db.product.findFirstOrThrow({
      where: { vendorId: fixture.vendorIds[0], slug: productSlug },
      select: { id: true, slug: true, isActive: true, inventory: true },
    });
    expect(created).toMatchObject({ slug: productSlug, isActive: false, inventory: 3 });
    fixture.catalogProductId = created.id;
    fixture.catalogProductSlug = created.slug;

    await page.goto(`/products/${created.id}/preview`);
    await expect(page.getByRole("heading", { name: "商品預覽" })).toBeVisible();
    await expect(page.getByText(productName, { exact: true })).toBeVisible();
    await expect(page.getByText("尚不可販售：請確認已上架、售價與庫存有效、交付方式已確認，且非實體商品已有完整的付款後交付設定。", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "開啟買家結帳預覽" })).toHaveCount(0);

    await page.getByRole("link", { name: "返回編輯" }).click();
    await page.getByRole("checkbox", { name: /上架商品/u }).check();
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page).toHaveURL(/\/products\?updated=saved$/u);
    await page.goto(`/products/${created.id}/preview`);
    await expect(page.getByRole("link", { name: "開啟買家結帳預覽" })).toBeVisible();

    await page.getByRole("link", { name: "返回編輯" }).click();
    await page.getByLabel("外部結帳 URL（選填／進階）", { exact: true }).fill("https://shop.example.test/g7-15");
    const productActionDiagnostics = new Map<PlaywrightRequest, {
      pathname: string;
      method: string;
      startedAt: string;
      completedAt: string | null;
      responseStatus: number | null;
    }>();
    const sameOrigin = new URL(baseURL).origin;
    const onProductActionRequest = (request: PlaywrightRequest) => {
      const url = new URL(request.url());
      if (url.origin !== sameOrigin || request.method() !== "POST" || !url.pathname.startsWith("/products/")) return;
      productActionDiagnostics.set(request, {
        pathname: url.pathname,
        method: request.method(),
        startedAt: new Date().toISOString(),
        completedAt: null,
        responseStatus: null,
      });
    };
    const onProductActionResponse = (response: Response) => {
      const diagnostic = productActionDiagnostics.get(response.request());
      if (diagnostic) diagnostic.responseStatus = response.status();
    };
    const onProductActionFinished = (request: PlaywrightRequest) => {
      const diagnostic = productActionDiagnostics.get(request);
      if (diagnostic) diagnostic.completedAt = new Date().toISOString();
    };
    page.on("request", onProductActionRequest);
    page.on("response", onProductActionResponse);
    page.on("requestfinished", onProductActionFinished);
    try {
      await page.getByRole("button", { name: "儲存", exact: true }).click();
      try {
        await expect(page).toHaveURL(/\/products\?updated=saved$/u);
      } catch (error) {
        const productRow = await db.product.findUnique({
          where: { id: created.id },
          select: { id: true, vendorId: true, checkoutUrl: true, revision: true },
        });
        await testInfo.attach("g7-15-external-checkout-save-diagnostic.json", {
          body: JSON.stringify({
            requests: [...productActionDiagnostics.values()],
            db: productRow
              ? {
                  id: productRow.id,
                  vendorId: productRow.vendorId,
                  checkoutUrlState: productRow.checkoutUrl ? "set" : "unset",
                  revision: productRow.revision,
                }
              : { state: "missing" },
          }),
          contentType: "application/json",
        });
        throw error;
      }
    } finally {
      page.off("request", onProductActionRequest);
      page.off("response", onProductActionResponse);
      page.off("requestfinished", onProductActionFinished);
    }
    await page.goto(`/products/${created.id}/preview`);
    await expect(page.getByText("此外部結帳 URL 不會產生完整的 CelebrateDeal 訂單、退款與分潤證據。", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "開啟買家結帳預覽" })).toHaveCount(0);

    await page.goto(`/products?q=${encodeURIComponent(productSlug)}&status=active`);
    await expect(page.getByRole("heading", { name: productName, exact: true })).toBeVisible();
    await expect(page.getByText("上架", { exact: true })).toBeVisible();
    await captureIfRequested(page, "product-desktop.png");
    await expectNoBlockingAxeViolations(page);
  });

  test("mobile product upload has no overflow, preserves recovery actions and passes axe", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installOwnerSession(page);
    const response = await page.goto("/products/new");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "新增商品" })).toBeVisible();

    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    await page.locator('input[type="file"][accept^="image/"]').setInputFiles({
      name: "g7-15-mobile-product.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(page.getByText("已選擇：g7-15-mobile-product.png", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "開始上傳", exact: true }).click();
    await expect(page.getByText("R2 圖片儲存尚未完成設定，請稍後重試。", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "重試上傳", exact: true })).toBeVisible();
    await captureIfRequested(page, "product-mobile.png");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "product upload must not overflow horizontally on mobile").toBeLessThanOrEqual(1);
    await page.reload();
    await expect(page.getByRole("heading", { name: "新增商品" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "跳至主要內容" })).toBeFocused();
    await expectNoBlockingAxeViolations(page);
  });

  test("merchant configures encrypted digital delivery and checkout keeps an immutable order snapshot", async ({ page }) => {
    test.setTimeout(90_000);
    await installOwnerSession(page);
    const productName = `G7-48 數位交付 ${runId.slice(0, 8)}`;
    const productSlug = `g7-48-delivery-${runId}`;
    const firstDestination = "https://delivery.example.com/buyer/content";
    const secondDestination = "https://delivery.example.com/buyer/content-v2";

    expect((await page.goto("/products/new"))?.status()).toBe(200);
    await page.getByLabel("商品名稱", { exact: true }).fill(productName);
    await page.getByLabel("Slug", { exact: true }).fill(productSlug);
    await page.getByLabel("售價（元）", { exact: true }).fill("880");
    await page.getByLabel("可售庫存", { exact: true }).fill("5");
    const fulfillmentTypeSelect = page.locator('select[name="fulfillmentType"]');
    await expect(fulfillmentTypeSelect).toBeVisible();
    await fulfillmentTypeSelect.selectOption("digital");
    await expect(page.getByRole("group", { name: "付款後交付設定" })).toBeVisible();
    await page.getByLabel("買家看到的交付標題", { exact: true }).fill("數位教材下載");
    await page.getByLabel("付款後入口 URL", { exact: true }).fill(`${firstDestination}?token=forbidden`);
    await page.getByLabel("付款後說明（選填）", { exact: true }).fill("付款後從訂單頁開啟內容。");
    await page.getByLabel("我確認這是商家授權的公開 HTTPS 交付網域").check();
    await page.getByRole("checkbox", { name: /上架商品/u }).check();
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page.locator('form [role="alert"]')).toHaveText("交付設定不完整或網址不安全。上架前請填妥標題、必要的 HTTPS 入口或服務說明，並確認交付網域。");
    await expect(page.getByLabel("付款後入口 URL", { exact: true })).toHaveValue(`${firstDestination}?token=forbidden`);
    expect(await db.product.count({ where: { vendorId: fixture.vendorIds[0], slug: productSlug } })).toBe(0);

    await page.getByLabel("付款後入口 URL", { exact: true }).fill(firstDestination);
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page).toHaveURL(/\/products\?updated=created$/u);
    const created = await db.product.findFirstOrThrow({
      where: { vendorId: fixture.vendorIds[0], slug: productSlug },
      include: { deliveryConfig: { include: { allowlist: true } } },
    });
    fixture.deliveryProductId = created.id;
    fixture.deliveryProductSlug = created.slug;
    expect(created).toMatchObject({ isActive: true, fulfillmentType: "digital" });
    expect(created.deliveryConfig).toMatchObject({
      status: "active",
      revision: 1,
      title: "數位教材下載",
      destinationMaskedSummary: "安全 HTTPS 入口 · delivery.example.com",
      allowlist: { hostname: "delivery.example.com", pathPrefix: "/buyer/content", allowQuery: false, status: "active" },
    });
    expect(created.deliveryConfig?.destinationEncryptedEnvelope).toMatch(/^v1\./u);
    expect(JSON.stringify(created.deliveryConfig)).not.toContain(firstDestination);
    expect(JSON.stringify(created.deliveryConfig)).not.toContain("付款後從訂單頁開啟內容。");

    await page.context().clearCookies();
    expect((await page.goto(`/checkout/${fixture.vendorIds[0]}/${created.id}`))?.status()).toBe(200);
    await page.getByLabel("姓名", { exact: true }).fill("G7-48 合成買家");
    await page.getByLabel("Email", { exact: true }).fill(`g7-48-buyer-${runId}@celebratedeal.local`);
    await page.getByLabel("電話（選填）", { exact: true }).fill("0912345678");
    await page.getByRole("checkbox").check();
    const admissionResponsePromise = page.waitForResponse((candidate) => {
      const request = candidate.request();
      return request.method() === "POST" && new URL(candidate.url()).pathname === "/api/payments/checkout/admission";
    });
    const checkoutResponsePromise = page.waitForResponse((candidate) => {
      const request = candidate.request();
      return request.method() === "POST" && new URL(candidate.url()).pathname === "/api/payments/checkout";
    });
    await page.getByRole("button", { name: /購買/u }).click();
    const admissionResponse = await admissionResponsePromise;
    expect(admissionResponse.status(), "digital delivery checkout admission must succeed").toBe(200);
    const checkoutResponse = await checkoutResponsePromise;
    if (checkoutResponse.status() !== 200) {
      const payload = await checkoutResponse.json().catch(() => null) as { error?: unknown } | null;
      // Keep the diagnostic token under the evidence sanitizer's 40-character
      // boundary while exposing only an allowlisted branch and aggregate counts.
      const errorCode = new Map<string, string>([
        ["Checkout admission unavailable", "A"],
        ["Checkout is temporarily unavailable", "P"],
        ["Unable to validate checkout", "I"],
        ["Checkout support access unavailable", "S"],
      ]).get(typeof payload?.error === "string" ? payload.error : "") ?? "U";
      const [transactionCount, orderCount, snapshotCount, buyerGrantCount] = await Promise.all([
        db.paymentTransaction.count({ where: { vendorId: fixture.vendorIds[0], metadata: { path: ["productId"], equals: created.id } } }),
        db.commerceOrder.count({ where: { vendorId: fixture.vendorIds[0], items: { some: { productId: created.id } } } }),
        db.commerceOrderItemDeliverySnapshot.count({ where: { vendorId: fixture.vendorIds[0], orderItem: { productId: created.id } } }),
        db.buyerSupportOrderGrant.count({ where: { vendorId: fixture.vendorIds[0], order: { items: { some: { productId: created.id } } } } }),
      ]);
      throw new Error(`G748:${checkoutResponse.status()}:${errorCode}:T${transactionCount}O${orderCount}S${snapshotCount}G${buyerGrantCount}`);
    }
    await expect(page.getByRole("status")).toContainText(/訂單 .* 已建立/u);
    const buyerSupportCookie = (await page.context().cookies())
      .find((cookie) => cookie.name.startsWith("celebrate_support_"));
    expect(buyerSupportCookie?.httpOnly).toBe(true);
    if (!buyerSupportCookie) throw new Error("G748:COOKIE:MISSING");

    const purchasedItem = await db.commerceOrderItem.findFirstOrThrow({
      where: { vendorId: fixture.vendorIds[0], productId: created.id },
      orderBy: { createdAt: "desc" },
      include: { deliverySnapshot: true, order: { select: { status: true } } },
    });
    expect(purchasedItem.order.status).toBe("pending_payment");
    expect(purchasedItem.deliverySnapshot).toMatchObject({
      deliveryKind: "digital_link",
      title: "數位教材下載",
      destinationMaskedSummary: "安全 HTTPS 入口 · delivery.example.com",
      allowlistSnapshot: { hostname: "delivery.example.com", pathPrefix: "/buyer/content", allowQuery: false },
    });
    expect(purchasedItem.deliverySnapshot?.destinationEncryptedEnvelope).toMatch(/^v1\./u);
    const immutableSnapshot = {
      configRevision: purchasedItem.deliverySnapshot?.productDeliveryConfigRevision,
      destinationEncryptedEnvelope: purchasedItem.deliverySnapshot?.destinationEncryptedEnvelope,
      instructionsEncryptedEnvelope: purchasedItem.deliverySnapshot?.instructionsEncryptedEnvelope,
      allowlistSnapshot: purchasedItem.deliverySnapshot?.allowlistSnapshot,
    };
    expect(JSON.stringify(purchasedItem.deliverySnapshot)).not.toContain(firstDestination);
    expect(JSON.stringify(purchasedItem.deliverySnapshot)).not.toContain("付款後從訂單頁開啟內容。");

    const payment = await db.commerceOrder.findUniqueOrThrow({
      where: { vendorId_id: { vendorId: fixture.vendorIds[0], id: purchasedItem.orderId } },
      select: { primaryPaymentTransactionId: true },
    });
    expect(payment.primaryPaymentTransactionId).toBeTruthy();
    const paidAt = new Date("2026-08-09T15:00:00.000Z");
    await db.$transaction(async (tx) => {
      const paidTransaction = await tx.paymentTransaction.update({
        where: { id: payment.primaryPaymentTransactionId! },
        data: { status: "paid", occurredAt: paidAt },
      });
      await applyPaymentInventoryTransition(tx, {
        transaction: paidTransaction,
        eventType: "paid",
        trustedCheckoutMetadata: { productId: created.id },
        now: paidAt,
      });
      await reconcileCommerceOrderPaymentTransition(tx, {
        vendorId: fixture.vendorIds[0],
        paymentTransactionId: paidTransaction.id,
        eventIdentity: `g7-48-paid-${runId}`,
        transition: "paid",
        occurredAt: paidAt,
      });
    });
    await expect(db.commerceEntitlement.findUniqueOrThrow({
      where: { vendorId_orderItemId: { vendorId: fixture.vendorIds[0], orderItemId: purchasedItem.id } },
    })).resolves.toMatchObject({ status: "granted", revokedAt: null });

    await page.context().clearCookies();
    await installOwnerSession(page);
    expect((await page.goto(`/products/${created.id}/edit`))?.status()).toBe(200);
    await expect(page.getByLabel("付款後入口 URL", { exact: true })).toHaveValue(firstDestination);
    await expect(page.getByLabel("我確認這是商家授權的公開 HTTPS 交付網域")).toBeChecked();
    await page.getByLabel("付款後入口 URL", { exact: true }).fill(secondDestination);
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page).toHaveURL(/\/products\?updated=saved$/u);

    const [updatedConfig, persistedSnapshot] = await Promise.all([
      db.productDeliveryConfig.findUniqueOrThrow({ where: { vendorId_productId: { vendorId: fixture.vendorIds[0], productId: created.id } } }),
      db.commerceOrderItemDeliverySnapshot.findUniqueOrThrow({
        where: {
          vendorId_orderId_orderItemId: {
            vendorId: fixture.vendorIds[0],
            orderId: purchasedItem.orderId,
            orderItemId: purchasedItem.id,
          },
        },
      }),
    ]);
    expect(updatedConfig).toMatchObject({ revision: 2, destinationMaskedSummary: "安全 HTTPS 入口 · delivery.example.com" });
    expect({
      configRevision: persistedSnapshot.productDeliveryConfigRevision,
      destinationEncryptedEnvelope: persistedSnapshot.destinationEncryptedEnvelope,
      instructionsEncryptedEnvelope: persistedSnapshot.instructionsEncryptedEnvelope,
      allowlistSnapshot: persistedSnapshot.allowlistSnapshot,
    }).toEqual(immutableSnapshot);

    await page.goto(`/products/${created.id}/edit`);
    await captureIfRequested(page, "product-delivery-desktop.png");
    await expectNoBlockingAxeViolations(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/products/${created.id}/edit`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `RWD_HORIZONTAL_OVERFLOW:${overflow}`).toBeLessThanOrEqual(1);
    await captureIfRequested(page, "product-delivery-mobile.png");
    await expectNoBlockingAxeViolations(page);

    const buyerGrant = await db.buyerSupportOrderGrant.findUniqueOrThrow({
      where: { vendorId_orderId: { vendorId: fixture.vendorIds[0], orderId: purchasedItem.orderId } },
      select: { id: true },
    });
    await page.context().clearCookies();
    await page.context().addCookies([{
      name: buyerSupportCookie.name,
      value: buyerSupportCookie.value,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    }]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect((await page.goto(`/support/orders/${buyerGrant.id}`))?.status()).toBe(200);
    const deliveryLink = page.getByRole("link", { name: "開啟付款後內容" });
    await expect(deliveryLink).toHaveAttribute("href", `/support/orders/${buyerGrant.id}/delivery/${purchasedItem.id}`);
    await deliveryLink.click();
    await expect(page).toHaveURL(new RegExp(`/support/orders/${buyerGrant.id}/delivery/${purchasedItem.id}$`, "u"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("數位教材下載");
    await expect(page.getByText("付款後從訂單頁開啟內容。", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "前往商家提供的安全入口" })).toHaveAttribute("href", firstDestination);
    await captureIfRequested(page, "buyer-delivery-desktop.png");
    await expectNoBlockingAxeViolations(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "數位教材下載" })).toBeVisible();
    await expect(page.getByRole("link", { name: "前往商家提供的安全入口" })).toHaveAttribute("href", firstDestination);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await captureIfRequested(page, "buyer-delivery-mobile.png");
    await expectNoBlockingAxeViolations(page);

    const refundedAt = new Date("2026-08-09T16:00:00.000Z");
    await db.$transaction(async (tx) => {
      await reconcileCommerceOrderRefund(tx, {
        vendorId: fixture.vendorIds[0],
        orderId: purchasedItem.orderId,
        providerName: "demo",
        eventIdentity: `g7-48-refund-${runId}`,
        amountCents: created.priceCents,
        paymentTransactionId: payment.primaryPaymentTransactionId,
        occurredAt: refundedAt,
      });
    });
    await expect(db.commerceOrderItemDeliverySnapshot.findUniqueOrThrow({
      where: { vendorId_orderId_orderItemId: { vendorId: fixture.vendorIds[0], orderId: purchasedItem.orderId, orderItemId: purchasedItem.id } },
    })).resolves.toMatchObject({ revokedAt: refundedAt });
    await expect(db.commerceEntitlement.findUniqueOrThrow({
      where: { vendorId_orderItemId: { vendorId: fixture.vendorIds[0], orderItemId: purchasedItem.id } },
    })).resolves.toMatchObject({ status: "revoked", revokedAt: refundedAt, accessEncryptedEnvelope: null });
    await page.goto(`/support/orders/${buyerGrant.id}/delivery/${purchasedItem.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "付款後內容目前無法使用" })).toBeVisible();
    await expect(page.getByRole("link", { name: "前往商家提供的安全入口" })).toHaveCount(0);
    await expect(page.getByText("付款後從訂單頁開啟內容。", { exact: true })).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toContain(firstDestination);
    expect((await page.goto(`/support/orders/${buyerGrant.id}`))?.status()).toBe(200);
    await expect(page.getByText(/目前已停止提供/u)).toBeVisible();
  });

  test("buyer order capability shows only exact safe fulfillment projection on desktop and mobile", async ({ page }) => {
    await installBuyerOrderCapability(page);

    const listResponse = await page.goto("/support/orders");
    expect(listResponse?.status()).toBe(200);
    expect(listResponse?.headers()["cache-control"] ?? "").toMatch(/private|no-store/iu);
    await expect(page.getByRole("heading", { name: "我的訂單" })).toBeVisible();
    await expect(page.locator("p").filter({ hasText: `訂單 ${fixture.orderNumber}` })).toHaveCount(1);
    const listHtml = await page.content();
    expect(listHtml).toContain(fixture.orderNumber);
    expect(listHtml).not.toContain(fixture.foreignOrderNumber);

    await page.getByRole("link", { name: "查看商品與履約進度" }).click();
    await expect(page.getByRole("heading", { name: `訂單 ${fixture.orderNumber}` })).toBeVisible();
    const fulfillmentRegion = page.getByRole("region", { name: "商品與履約進度" });
    await expect(fulfillmentRegion).toBeVisible();
    await expect(fulfillmentRegion.getByText("物流狀態", { exact: true })).toBeVisible();
    await expect(fulfillmentRegion.getByRole("definition").filter({ hasText: /^等待處理$/u })).toBeVisible();
    const desktopHtml = await page.content();
    for (const value of [buyer.name, buyer.email, buyer.phone, shipping.addressLine1, fixture.buyerEncryptedEnvelope, fixture.shippingEncryptedEnvelope]) {
      expect(desktopHtml).not.toContain(value);
    }
    await captureIfRequested(page, "buyer-orders-desktop.png");
    await expectNoBlockingAxeViolations(page);

    const foreignResponse = await page.goto(`/support/orders/${fixture.foreignBuyerGrantId}`);
    expect([200, 404]).toContain(foreignResponse?.status());
    await expect(page.getByRole("heading", { name: `訂單 ${fixture.foreignOrderNumber}` })).toHaveCount(0);
    expect(await page.content()).not.toContain(fixture.foreignOrderNumber);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/support/orders/${fixture.buyerGrantId}`);
    await expect(page.getByRole("heading", { name: `訂單 ${fixture.orderNumber}` })).toBeVisible();
    await captureIfRequested(page, "buyer-orders-mobile.png");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `RWD_HORIZONTAL_OVERFLOW:${overflow}`).toBeLessThanOrEqual(1);
    await expectNoBlockingAxeViolations(page);
  });

  test("desktop owner can see only its canonical order, reveal PII safely, and complete physical fulfillment", async ({ page }, testInfo) => {
    await installOwnerSession(page);

    const indexResponse = await page.goto("/orders");
    expect(indexResponse?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "訂單與履約" })).toBeVisible();
    await expect(page.getByText(fixture.orderNumber, { exact: true })).toBeVisible();
    await expect(page.getByText(fixture.foreignOrderNumber, { exact: true })).toHaveCount(0);
    expect(await page.content()).not.toContain(fixture.foreignOrderNumber);

    const detailResponse = await page.goto(`/orders/${fixture.orderId}`);
    expect(detailResponse?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: `訂單 ${fixture.orderNumber}` })).toBeVisible();
    for (const value of [buyer.name, buyer.email, buyer.phone]) {
      await expect(page.getByText(value, { exact: true })).toBeVisible();
    }
    const address = page.locator("address");
    await expect(address).toContainText(`${shipping.recipientName} · ${shipping.phone}`);
    await expect(address).toContainText(shipping.addressLine1);
    await expect(address).toContainText(shipping.addressLine2);
    const html = await page.content();
    expect(html).not.toContain(fixture.buyerEncryptedEnvelope);
    expect(html).not.toContain(fixture.shippingEncryptedEnvelope);

    const foreignResponse = await page.goto(`/orders/${fixture.foreignOrderId}`);
    // orders/loading.tsx starts the response stream before the scoped lookup
    // resolves. Next.js therefore returns 200 and signals a streamed not-found
    // with noindex plus the segment's not-found UI.
    expect(foreignResponse?.status()).toBe(200);
    const robotsTags = page.locator('meta[name="robots"]');
    await expect.poll(() => robotsTags.count()).toBeGreaterThan(0);
    expect(await robotsTags.evaluateAll((elements) => elements.every((element) =>
      element.getAttribute("content")?.split(",").some((directive) => directive.trim() === "noindex"),
    ))).toBe(true);
    await expect(page.getByRole("heading", { name: "找不到這筆訂單" })).toBeVisible();
    await expect(page.getByText(fixture.foreignOrderNumber, { exact: true })).toHaveCount(0);
    expect(await page.content()).not.toContain(fixture.foreignOrderNumber);

    await page.goto(`/orders/${fixture.orderId}`);
    const startPacking = page.getByRole("button", { name: "開始備貨" });
    await expect(startPacking).toBeEnabled();
    const packingActionResponse = page.waitForResponse((candidate) => {
      const request = candidate.request();
      return request.method() === "POST" && new URL(candidate.url()).pathname === "/api/orders/shipping";
    }, { timeout: 15_000 });
    await startPacking.click();
    let packingResponse: Response;
    try {
      packingResponse = await packingActionResponse;
    } catch {
      throw new Error(`SHIPPING_ACTION_POST_NOT_OBSERVED_DB_${JSON.stringify(await shippingFulfillmentSnapshot())}`);
    }
    const packingResponseStatus = packingResponse.status();
    const packingResponseIsRedirect = [301, 302, 303, 307, 308].includes(packingResponseStatus);
    const packingActionClassification = packingResponseIsRedirect
      ? "SERVER_ACTION_REDIRECT"
      : classifyServerActionBody(await packingResponse.text());
    if (packingResponseStatus !== 200 && !packingResponseIsRedirect) {
      throw new Error(`SHIPPING_ACTION_HTTP_${packingResponseStatus}_${packingActionClassification}_DB_${JSON.stringify(await shippingFulfillmentSnapshot())}`);
    }
    const shippingUpdatedUrl = new RegExp(`/orders/${fixture.orderId}\\?updated=shipping$`);
    try {
      await expect(page).toHaveURL(shippingUpdatedUrl);
    } catch {
      throw new Error(`SHIPPING_ACTION_REDIRECT_LOST_HTTP_${packingResponseStatus}_${packingActionClassification}_DB_${JSON.stringify(await shippingFulfillmentSnapshot())}`);
    }
    await expect(page.getByText("履約狀態已更新。", { exact: true })).toBeVisible();
    await expect.poll(shippingFulfillmentSnapshot).toMatchObject({ status: "packing", revision: 2 });
    await page.goto(`/orders/${fixture.orderId}`);
    await expect(page.getByText("備貨中", { exact: true })).toBeVisible();

    await page.getByLabel("物流／交付方式").fill("黑貓宅急便");
    await page.getByLabel("追蹤編號（選填）").fill("G7-04-TRACK-1234");
    await page.getByLabel("追蹤網址（HTTPS／選填）").fill("https://tracking.example.test/G7-04-TRACK-1234");
    await page.getByRole("button", { name: "確認出貨" }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${fixture.orderId}\\?updated=shipping$`));
    await expect(page.getByText("履約狀態已更新。", { exact: true })).toBeVisible();
    await expect.poll(shippingFulfillmentSnapshot).toEqual({ status: "shipped", revision: 3, carrierName: "黑貓宅急便", trackingNumber: "G7-04-TRACK-1234" });
    await expect(page.getByText("已出貨", { exact: true })).toBeVisible();
    const shippingSummary = page.locator("p").filter({ hasText: "物流：" });
    await expect(shippingSummary).toContainText("黑貓宅急便");
    await expect(shippingSummary).toContainText("G7-04-TRACK-1234");

    await page.goto(`/orders/${fixture.orderId}`);
    await expect(page.getByText("已出貨", { exact: true })).toBeVisible();
    const markDelivered = page.getByRole("button", { name: "標記已送達", exact: true });
    await expect(markDelivered).toBeEnabled();
    const deliveredActionResponse = page.waitForResponse((candidate) => {
      const request = candidate.request();
      return request.method() === "POST" && new URL(candidate.url()).pathname === "/api/orders/shipping";
    }, { timeout: 15_000 });
    await markDelivered.click();
    let deliveredResponse: Response;
    try {
      deliveredResponse = await deliveredActionResponse;
    } catch {
      throw new Error(`DELIVERED_ACTION_POST_NOT_OBSERVED_DB_${JSON.stringify(await shippingFulfillmentDiagnostic())}`);
    }
    const deliveredResponseStatus = deliveredResponse.status();
    const deliveredResponseIsRedirect = [301, 302, 303, 307, 308].includes(deliveredResponseStatus);
    const deliveredActionRedirectTarget = normalizePathQuery(deliveredResponse.headers()["x-action-redirect"] ?? "");
    const deliveredActionClassification = deliveredResponseIsRedirect
      ? "SERVER_ACTION_REDIRECT"
      : deliveredResponseStatus === 200 ? "SERVER_ACTION_RESPONSE" : "HTTP_RESPONSE";
    const deliveredRedirectTarget = `/orders/${fixture.orderId}?updated=shipping`;
    if (deliveredResponseStatus === 200 && deliveredActionRedirectTarget !== deliveredRedirectTarget) {
      const evidence = {
        responseStatus: deliveredResponseStatus,
        actionRedirectTarget: deliveredActionRedirectTarget ?? "missing",
        finalPageUrl: normalizePathQuery(page.url()) ?? "unparseable",
        shipping: await shippingFulfillmentDiagnostic(),
      };
      await testInfo.attach("delivered-action-sanitized-diagnostic.json", {
        body: JSON.stringify(evidence, null, 2),
        contentType: "application/json",
      });
      throw new Error(`DELIVERED_ACTION_REDIRECT_HEADER_MISSING_${deliveredActionClassification}_${JSON.stringify(evidence)}`);
    }
    if (deliveredResponseStatus !== 200 && !deliveredResponseIsRedirect) {
      const evidence = {
        responseStatus: deliveredResponseStatus,
        actionRedirectTarget: deliveredActionRedirectTarget ?? "missing",
        finalPageUrl: normalizePathQuery(page.url()) ?? "unparseable",
        shipping: await shippingFulfillmentDiagnostic(),
      };
      await testInfo.attach("delivered-action-sanitized-diagnostic.json", {
        body: JSON.stringify(evidence, null, 2),
        contentType: "application/json",
      });
      throw new Error(`DELIVERED_ACTION_HTTP_${deliveredActionClassification}_${JSON.stringify(evidence)}`);
    }
    const deliveredUrl = new RegExp(`/orders/${fixture.orderId}\\?updated=shipping$`);
    try {
      await expect(page).toHaveURL(deliveredUrl);
    } catch {
      const evidence = {
        responseStatus: deliveredResponseStatus,
        actionRedirectTarget: deliveredActionRedirectTarget ?? "missing",
        finalPageUrl: normalizePathQuery(page.url()) ?? "unparseable",
        shipping: await shippingFulfillmentDiagnostic(),
      };
      await testInfo.attach("delivered-action-sanitized-diagnostic.json", {
        body: JSON.stringify(evidence, null, 2),
        contentType: "application/json",
      });
      if (
        deliveredActionRedirectTarget === deliveredRedirectTarget
        && evidence.shipping.status === "delivered"
        && evidence.shipping.revision === 4
      ) {
        const recoveryResponse = await page.goto(deliveredRedirectTarget);
        expect(recoveryResponse?.status()).toBe(200);
        await expect(page).toHaveURL(deliveredUrl);
      } else {
        throw new Error(`DELIVERED_ACTION_REDIRECT_LOST_${JSON.stringify(evidence)}`);
      }
    }
    await expect(page.getByText("履約狀態已更新。", { exact: true })).toBeVisible();
    await expect(page.getByText("已送達", { exact: true })).toBeVisible();
    await expect.poll(shippingFulfillmentSnapshot).toEqual({ status: "delivered", revision: 4, carrierName: "黑貓宅急便", trackingNumber: "G7-04-TRACK-1234" });
    await captureIfRequested(page, "desktop.png");
    await expectNoBlockingAxeViolations(page);
  });

  test("mobile order detail has no horizontal overflow, keeps keyboard focus visible, and passes axe", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installOwnerSession(page);
    const response = await page.goto(`/orders/${fixture.orderId}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: `訂單 ${fixture.orderNumber}` })).toBeVisible();
    await expect(page.getByText("已送達", { exact: true })).toBeVisible();

    await captureIfRequested(page, "mobile.png");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) {
      const overflowElements = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        return [...document.body.querySelectorAll("*")]
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === "string" ? element.className.slice(0, 180) : "",
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
            };
          })
          .filter((element) => element.left < -1 || element.right > viewportWidth + 1)
          .slice(0, 12);
      });
      throw new Error(`RWD_HORIZONTAL_OVERFLOW:${JSON.stringify({ overflow, elements: overflowElements })}`);
    }

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "跳至主要內容" });
    await expect(skipLink).toBeFocused();
    const focusStyle = await skipLink.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
    });
    expect(focusStyle.outlineStyle).not.toBe("none");
    expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(1);

    await expectNoBlockingAxeViolations(page);
  });

  test("public buyer receives a server admission, creates exactly one reserved order, and safely reviews payment status", async ({ page }) => {
    await page.context().clearCookies();
    const before = await Promise.all([
      db.product.findUniqueOrThrow({ where: { id: fixture.productId }, select: { inventory: true, revision: true } }),
      db.paymentTransaction.count({ where: { vendorId: fixture.vendorIds[0] } }),
      db.commerceOrder.count({ where: { vendorId: fixture.vendorIds[0] } }),
      db.inventoryReservation.count({ where: { productId: fixture.productId } }),
    ]);

    const response = await page.goto(`/checkout/${fixture.vendorIds[0]}/${fixture.productId}`);
    expect(response?.status()).toBe(200);
    await page.getByLabel("姓名", { exact: true }).fill("合成公開買家");
    await page.getByLabel("Email", { exact: true }).fill(`g7-14-public-${runId}@celebratedeal.local`);
    await page.getByLabel("電話", { exact: true }).fill("0912345678");
    await page.getByLabel("收件人", { exact: true }).fill("合成公開收件人");
    await page.getByLabel("收件電話", { exact: true }).fill("0912345678");
    await page.getByLabel("縣市", { exact: true }).fill("台北市");
    await page.getByLabel("鄉鎮市區", { exact: true }).fill("中正區");
    await page.getByLabel("地址", { exact: true }).fill("合成公開驗收路 14 號");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /購買/u }).click();

    await expect(page.getByRole("status")).toContainText(/訂單 .* 已建立/u);
    const checkoutCookies = await page.context().cookies();
    const admissionCookie = checkoutCookies
      .find((cookie) => cookie.name === "celebratedeal_checkout_session");
    expect(admissionCookie).toMatchObject({ httpOnly: true, sameSite: "Strict" });
    const buyerSupportCookie = checkoutCookies
      .find((cookie) => cookie.name.startsWith("celebrate_support_"));
    expect(buyerSupportCookie).toMatchObject({ httpOnly: true, sameSite: "Lax", secure: true });

    // The acceptance server is a production build on HTTP loopback. Production
    // correctly issues Secure cookies, which a real HTTPS deployment sends back
    // automatically. Bridge that transport property only inside this synthetic
    // browser after proving the issued cookie remained Secure.
    expect(process.env.G7_COMMERCE_LOOPBACK_TLS_BRIDGE).toBe("1");
    await page.context().addCookies([{
      name: buyerSupportCookie!.name,
      value: buyerSupportCookie!.value,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
      expires: buyerSupportCookie!.expires,
    }]);

    const after = await Promise.all([
      db.product.findUniqueOrThrow({ where: { id: fixture.productId }, select: { inventory: true, revision: true } }),
      db.paymentTransaction.count({ where: { vendorId: fixture.vendorIds[0] } }),
      db.commerceOrder.count({ where: { vendorId: fixture.vendorIds[0] } }),
      db.inventoryReservation.count({ where: { productId: fixture.productId } }),
    ]);
    expect(after[0]).toEqual({ inventory: before[0].inventory - 1, revision: before[0].revision + 1 });
    expect(after[1]).toBe(before[1] + 1);
    expect(after[2]).toBe(before[2] + 1);
    expect(after[3]).toBe(before[3] + 1);

    const resultResponse = await page.goto("/checkout/result?payment=pending");
    expect(resultResponse?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "付款結果仍在確認" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "可安全查看的訂單" })).toBeVisible();
    await expect(page.getByText("等待付款確認", { exact: true })).toBeVisible();
    await expect(page.getByText(/g7-14-public-.*@celebratedeal\.local/u)).toHaveCount(0);
    const resultHtml = await page.content();
    for (const cookie of await page.context().cookies()) {
      if (cookie.name.startsWith("celebrate_support_")) expect(resultHtml).not.toContain(cookie.value);
    }
    const resultOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(resultOverflow, "payment result must not overflow horizontally").toBeLessThanOrEqual(1);
    await expectNoBlockingAxeViolations(page);
    await captureIfRequested(page, "payment-result.png");
  });

  test("public checkout recovers one committed order after response loss and page refresh", async ({ page }) => {
    test.setTimeout(90_000);
    await page.context().clearCookies();
    const before = await Promise.all([
      db.product.findUniqueOrThrow({ where: { id: fixture.productId }, select: { inventory: true } }),
      db.paymentTransaction.count({ where: { vendorId: fixture.vendorIds[0] } }),
      db.commerceOrder.count({ where: { vendorId: fixture.vendorIds[0] } }),
    ]);
    const checkoutIdentities: string[] = [];
    let checkoutAttempts = 0;
    await page.route(/\/api\/payments\/checkout$/u, async (route) => {
      checkoutAttempts += 1;
      const body = route.request().postDataJSON() as { idempotencyKey?: unknown };
      expect(body.idempotencyKey).toEqual(expect.any(String));
      checkoutIdentities.push(String(body.idempotencyKey));
      if (checkoutAttempts === 1) {
        const upstream = await route.fetch();
        expect(upstream.status()).toBe(200);
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    const fillCheckout = async () => {
      await page.getByLabel("姓名", { exact: true }).fill("回應遺失測試買家");
      await page.getByLabel("Email", { exact: true }).fill(`g7-57-recovery-${runId}@celebratedeal.local`);
      await page.getByLabel("電話", { exact: true }).fill("0912345678");
      await page.getByLabel("收件人", { exact: true }).fill("回應遺失測試收件人");
      await page.getByLabel("收件電話", { exact: true }).fill("0912345678");
      await page.getByLabel("縣市", { exact: true }).fill("台北市");
      await page.getByLabel("鄉鎮市區", { exact: true }).fill("中正區");
      await page.getByLabel("地址", { exact: true }).fill("合成回應遺失路 57 號");
      await page.getByRole("checkbox").check();
    };

    expect((await page.goto(`/checkout/${fixture.vendorIds[0]}/${fixture.productId}`))?.status()).toBe(200);
    await fillCheckout();
    await page.getByRole("button", { name: /購買/u }).click();
    await expect(page.locator("#checkout-live-status")).toContainText("連線逾時或暫時中斷");

    const afterLostResponse = await Promise.all([
      db.product.findUniqueOrThrow({ where: { id: fixture.productId }, select: { inventory: true } }),
      db.paymentTransaction.count({ where: { vendorId: fixture.vendorIds[0] } }),
      db.commerceOrder.count({ where: { vendorId: fixture.vendorIds[0] } }),
    ]);
    expect(afterLostResponse).toEqual([
      { inventory: before[0].inventory - 1 },
      before[1] + 1,
      before[2] + 1,
    ]);

    await page.reload();
    await fillCheckout();
    await page.getByRole("button", { name: /購買/u }).click();
    await expect(page.getByRole("status")).toContainText(/訂單 .* 已建立/u);
    expect(checkoutAttempts).toBe(2);
    expect(checkoutIdentities).toHaveLength(2);
    expect(checkoutIdentities[1]).toBe(checkoutIdentities[0]);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("celebratedeal:checkout:")))).toEqual([]);

    const afterRecovery = await Promise.all([
      db.product.findUniqueOrThrow({ where: { id: fixture.productId }, select: { inventory: true } }),
      db.paymentTransaction.count({ where: { vendorId: fixture.vendorIds[0] } }),
      db.commerceOrder.count({ where: { vendorId: fixture.vendorIds[0] } }),
    ]);
    expect(afterRecovery).toEqual(afterLostResponse);
    await captureIfRequested(page, "checkout-recovery-desktop.png");
    await expectNoBlockingAxeViolations(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await captureIfRequested(page, "checkout-recovery-mobile.png");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expectNoBlockingAxeViolations(page);
  });

  test("public playback stops once on exact Stream quota exhaustion and keeps recovery guidance accessible", async ({ page }) => {
    await page.context().clearCookies();
    let heartbeatRequests = 0;
    await page.route("**/api/stream-usage", async (route) => {
      heartbeatRequests += 1;
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({
        vendorId: fixture.vendorIds[1],
        liveId: fixture.foreignLiveId,
        watchSeconds: 60,
      });
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify({ error: "Stream quota exhausted", code: "stream_minutes_exhausted" }),
      });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    const response = await page.goto(`/live/${fixture.foreignLiveSlug}`);
    expect(response?.status()).toBe(200);
    const video = page.locator("video");
    await expect(video).toBeVisible();
    await expect(video).toHaveJSProperty("controls", true);

    await video.evaluate((element) => {
      const media = element as HTMLVideoElement;
      const quotaWindow = window as typeof window & { __quotaPauseCalls?: number };
      Object.defineProperty(media, "currentTime", { configurable: true, writable: true, value: 0 });
      quotaWindow.__quotaPauseCalls = 0;
      media.pause = () => { quotaWindow.__quotaPauseCalls = (quotaWindow.__quotaPauseCalls ?? 0) + 1; };
      media.dispatchEvent(new Event("play", { bubbles: true }));
      for (let second = 1; second <= 60; second += 1) {
        media.currentTime = second;
        media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
      }
    });

    const quotaAlert = page.getByRole("alert").filter({ hasText: "直播播放額度已用完" });
    await expect(quotaAlert).toBeVisible();
    await expect(quotaAlert).toContainText("播放已暫停");
    await expect(quotaAlert).toContainText("請聯絡主辦人調整直播額度");
    await expect(video).toHaveCount(0);
    expect(await page.evaluate(() => (window as typeof window & { __quotaPauseCalls?: number }).__quotaPauseCalls)).toBe(1);
    expect(heartbeatRequests).toBe(1);
    await expect(page.getByRole("button", { name: "商品", exact: true })).toHaveCount(0);
    await expectNoBlockingAxeViolations(page);
    await captureIfRequested(page, "stream-quota-desktop.png");

    await page.waitForTimeout(3_000);
    await expect(video).toHaveCount(0);
    expect(heartbeatRequests).toBe(1);

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "Stream quota recovery UI must not overflow horizontally").toBeLessThanOrEqual(1);
    await expect(quotaAlert).toBeVisible();
    await expectNoBlockingAxeViolations(page);
    await captureIfRequested(page, "stream-quota-mobile.png");
  });

  test("public live keeps the same video node, playback state and controls through internal checkout", async ({ page }) => {
    test.setTimeout(180_000);
    await page.context().clearCookies();
    // The shared sellable fixture is scheduled in the future so other tests can
    // exercise publish readiness. This playback case must explicitly enter the
    // live state; otherwise the pre-live waiting room correctly hides media.
    await db.live.update({
      where: { id: fixture.sellableLiveId },
      data: { status: "live", streamMode: "live", startedAt: new Date() },
    });
    let admissionRequests = 0;
    let renewalPending = false;
    await page.route("**/api/live-admission", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      admissionRequests += 1;
      const response = await route.fetch();
      if (!response.ok()) {
        throw new Error(`LIVE_ADMISSION_FAILED:${response.status()}:${await response.text()}`);
      }
      if (admissionRequests === 2) {
        renewalPending = true;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        await route.fulfill({ response });
        renewalPending = false;
        return;
      }
      await route.fulfill({ response });
    });
    await page.route("**/api/stream-usage", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.setViewportSize({ width: 1280, height: 900 });

    const liveResponse = await page.goto(`/live/${fixture.sellableLiveSlug}`);
    expect(liveResponse?.status()).toBe(200);
    const video = page.locator("video");
    await expect(video).toBeVisible();
    await video.evaluate((element) => {
      const media = element as HTMLVideoElement;
      const browserWindow = window as typeof window & {
        __persistentPlayerNode?: HTMLVideoElement;
        __persistentPlayerSource?: string;
        __persistentPlayerTimer?: number;
      };
      browserWindow.__persistentPlayerNode = media;
      browserWindow.__persistentPlayerSource = media.currentSrc || media.src;
      Object.defineProperty(media, "currentTime", { configurable: true, writable: true, value: 42 });
      media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
      media.volume = 0.35;
      media.muted = false;
      media.dispatchEvent(new Event("play", { bubbles: true }));
      browserWindow.__persistentPlayerTimer = window.setInterval(() => { media.currentTime += 0.25; }, 250);
    });

    await page.getByRole("button", { name: "立即搶購" }).click();
    await expect(page).toHaveURL(new RegExp(`/checkout/${fixture.vendorIds[1]}/${fixture.foreignProductId}$`, "u"));
    await expect(page.getByRole("dialog", { name: "商品結帳" })).toBeVisible();
    await expect(page.getByRole("button", { name: "暫停直播" })).toBeVisible();
    await page.waitForTimeout(750);
    const checkoutState = await page.evaluate(() => {
      const browserWindow = window as typeof window & { __persistentPlayerNode?: HTMLVideoElement };
      const current = document.querySelector("video");
      return {
        sameNode: current === browserWindow.__persistentPlayerNode,
        currentTime: current?.currentTime ?? 0,
        volume: current?.volume ?? 0,
        muted: current?.muted ?? true,
      };
    });
    expect(checkoutState).toMatchObject({ sameNode: true, volume: 0.35, muted: false });
    expect(checkoutState.currentTime).toBeGreaterThan(42);

    await expect.poll(() => renewalPending, { timeout: 40_000 }).toBe(true);
    const renewalState = await page.evaluate(() => {
      const browserWindow = window as typeof window & {
        __persistentPlayerNode?: HTMLVideoElement;
        __persistentPlayerSource?: string;
      };
      const current = document.querySelector("video");
      return {
        sameNode: current === browserWindow.__persistentPlayerNode,
        sameSource: (current?.currentSrc || current?.src) === browserWindow.__persistentPlayerSource,
        currentTime: current?.currentTime ?? 0,
        volume: current?.volume ?? 0,
        muted: current?.muted ?? true,
        controls: current?.controls ?? false,
      };
    });
    expect(renewalState).toMatchObject({
      sameNode: true,
      sameSource: true,
      volume: 0.35,
      muted: false,
      controls: true,
    });
    expect(renewalState.currentTime).toBeGreaterThan(checkoutState.currentTime);
    await expect.poll(() => renewalPending).toBe(false);
    expect(admissionRequests).toBe(2);
    const renewedState = await page.evaluate(() => {
      const browserWindow = window as typeof window & {
        __persistentPlayerNode?: HTMLVideoElement;
        __persistentPlayerSource?: string;
      };
      const current = document.querySelector("video");
      return {
        sameNode: current === browserWindow.__persistentPlayerNode,
        sameSource: (current?.currentSrc || current?.src) === browserWindow.__persistentPlayerSource,
        currentTime: current?.currentTime ?? 0,
        volume: current?.volume ?? 0,
        muted: current?.muted ?? true,
        controls: current?.controls ?? false,
      };
    });
    expect(renewedState).toMatchObject({
      sameNode: true,
      sameSource: true,
      volume: 0.35,
      muted: false,
      controls: true,
    });
    expect(renewedState.currentTime).toBeGreaterThan(renewalState.currentTime);
    await expectNoBlockingAxeViolations(page);
    await captureIfRequested(page, "persistent-player-desktop.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "暫停直播" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expectNoBlockingAxeViolations(page);
    await captureIfRequested(page, "persistent-player-mobile.png");

    await page.getByRole("dialog", { name: "商品結帳" }).getByRole("button", { name: "返回直播", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/live/${fixture.sellableLiveSlug}$`, "u"));
    expect(await page.evaluate(() => document.querySelector("video") === (window as typeof window & { __persistentPlayerNode?: HTMLVideoElement }).__persistentPlayerNode)).toBe(true);
    await page.evaluate(() => {
      const browserWindow = window as typeof window & { __persistentPlayerTimer?: number };
      if (browserWindow.__persistentPlayerTimer) window.clearInterval(browserWindow.__persistentPlayerTimer);
    });

    const directCheckoutResponse = await page.goto(`/checkout/${fixture.vendorIds[1]}/${fixture.foreignProductId}`);
    expect(directCheckoutResponse?.status()).toBe(200);
    await expect(page.locator("video")).toHaveCount(0);
  });

  test("public playback retries an ambiguous Stream heartbeat with one stable event identity", async ({ page }) => {
    await page.context().clearCookies();
    const heartbeatPayloads: Array<Record<string, unknown>> = [];
    await page.route("**/api/stream-usage", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      heartbeatPayloads.push(body);
      expect(body).toMatchObject({
        vendorId: fixture.vendorIds[1],
        liveId: fixture.foreignLiveId,
        watchSeconds: 60,
      });
      if (heartbeatPayloads.length === 1) {
        // Hold the first response past the client timeout. A later stale 200
        // must not suppress the retry that reuses this event identity.
        await new Promise((resolve) => setTimeout(resolve, 3_300));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, duplicate: false }),
        }).catch(() => undefined);
        return;
      }
      if (heartbeatPayloads.length === 2) {
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          headers: { "Cache-Control": "private, no-store" },
          body: JSON.stringify({ error: "Too many requests" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, duplicate: false }),
      });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    const response = await page.goto(`/live/${fixture.foreignLiveSlug}`);
    expect(response?.status()).toBe(200);
    const video = page.locator("video");
    await expect(video).toBeVisible();
    await expect(video).toHaveJSProperty("controls", true);

    await video.evaluate((element) => {
      const media = element as HTMLVideoElement & { __retryPauseCalls?: number };
      Object.defineProperty(media, "currentTime", { configurable: true, writable: true, value: 0 });
      media.__retryPauseCalls = 0;
      media.pause = () => { media.__retryPauseCalls = (media.__retryPauseCalls ?? 0) + 1; };
      media.dispatchEvent(new Event("play", { bubbles: true }));
      for (let second = 1; second <= 60; second += 1) {
        media.currentTime = second;
        media.dispatchEvent(new Event("timeupdate", { bubbles: true }));
      }
    });

    await expect.poll(() => heartbeatPayloads.length, { timeout: 7_000 }).toBe(3);
    expect(new Set(heartbeatPayloads.map((payload) => payload.eventId)).size).toBe(1);
    expect(heartbeatPayloads.every((payload) => payload.watchSeconds === 60)).toBe(true);
    expect(await video.evaluate((element) => (element as HTMLVideoElement & { __retryPauseCalls?: number }).__retryPauseCalls)).toBe(0);
    await expect(page.getByRole("alert").filter({ hasText: "直播播放額度已用完" })).toHaveCount(0);
    await expect(video).toHaveJSProperty("controls", true);
    await expectNoBlockingAxeViolations(page);
    await captureIfRequested(page, "stream-retry-desktop.png");

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "Stream retry playback UI must not overflow horizontally").toBeLessThanOrEqual(1);
    await expect(video).toHaveJSProperty("controls", true);
    await expectNoBlockingAxeViolations(page);
    await captureIfRequested(page, "stream-retry-mobile.png");
  });

  test("finance admin payout batch prevents duplicate submission and exposes accessible pending feedback", async ({ page }) => {
    await installOwnerSession(page);
    const response = await page.goto("/admin/billing/platform-referral-payouts");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Platform referral payable", exact: true })).toBeVisible();

    let releaseRequest: () => void = () => undefined;
    const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
    let intercepted = false;
    await page.route("**/admin/billing/platform-referral-payouts*", async (route) => {
      if (route.request().method() === "POST") {
        intercepted = true;
        await requestGate;
      }
      await route.continue();
    });

    await page.getByPlaceholder("2026-07").fill("2026-07");
    await page.getByPlaceholder("PRP-202607-001").fill(`G7-20-${runId.slice(0, 12)}`);
    const submit = page.getByRole("button", { name: "建立 batch" });
    const submission = submit.click();

    await expect.poll(() => intercepted).toBe(true);
    const pendingState = async () => {
      const pendingButton = page.locator('button[aria-busy="true"]:disabled');
      if (await pendingButton.count()) return "button";
      const routeLoading = page.locator('section[aria-busy="true"]').filter({ hasText: "正在載入財務作業資料" });
      if (await routeLoading.count()) return "route-loading";
      return "missing";
    };
    await expect.poll(pendingState).not.toBe("missing");
    const pendingKind = await pendingState();
    if (pendingKind === "button") {
      await expect(page.locator('button[aria-busy="true"]:disabled')).toContainText("建立中…");
      await expect(page.getByRole("status").filter({ hasText: "正在同步平台推薦 ledger 並建立 payout batch" })).toContainText("正在同步平台推薦 ledger 並建立 payout batch");
    } else {
      await expect(page.getByRole("heading", { name: "正在載入財務作業資料", exact: true })).toBeVisible();
      await expect(page.locator('section[aria-busy="true"]')).toContainText("完成前不會送出任何財務操作");
    }
    await captureIfRequested(page, "finance-pending.png");

    releaseRequest();
    await submission;
    await page.waitForURL(/\/admin\/billing\/platform-referral-payouts\?error=conflict$/u);
    await expect(page.locator('p[role="alert"]')).toContainText("平台推薦 payout 操作未完成");
    await expectNoBlockingAxeViolations(page);
  });

  test("merchant message template keeps every field after server validation and can recover as a new template", async ({ page }) => {
    const original = await db.messageTemplate.create({
      data: {
        vendorId: fixture.vendorIds[0],
        name: `G7-58 原模板 ${runId.slice(0, 8)}`,
        channel: "email",
        trigger: "live_reminder",
        subject: "原本主旨",
        body: "原本內容",
        isActive: true,
      },
    });
    const recoveredName = `G7-58 保留草稿 ${runId.slice(0, 8)}`;
    const recoveredSubject = "{{live_title}} 草稿不能消失";
    const invalidBody = "嗨 {{name}}，這段商家內容 {{unknown_variable}} 必須保留。";
    const validBody = "嗨 {{name}}，{{live_title}} 即將開始。\n{{unsubscribe_url}}";
    const bodyEditor = page.getByRole("textbox", { name: "內容", exact: true });

    await installOwnerSession(page);
    const response = await page.goto(`/messages/templates/${original.id}/edit`);
    expect(response?.status()).toBe(200);
    await page.getByLabel("模板名稱").fill(recoveredName);
    await page.getByLabel("主旨").fill(recoveredSubject);
    await bodyEditor.fill(invalidBody);
    await page.getByLabel("啟用模板").uncheck();
    await page.getByRole("button", { name: "儲存", exact: true }).click();

    await expect(page.locator('p[role="alert"]')).toContainText("內容已保留");
    await expect(page.getByLabel("模板名稱")).toHaveValue(recoveredName);
    await expect(page.getByLabel("主旨")).toHaveValue(recoveredSubject);
    await expect(bodyEditor).toHaveValue(invalidBody);
    await expect(page.getByLabel("啟用模板")).not.toBeChecked();
    await expect(page).toHaveURL(new RegExp(`/messages/templates/${original.id}/edit$`, "u"));

    await bodyEditor.fill(validBody);
    await db.messageTemplate.update({
      where: { id: original.id },
      data: { body: "另一分頁已儲存的伺服器新版" },
    });
    await page.getByRole("button", { name: "儲存", exact: true }).click();

    await expect(page.locator('p[role="alert"]')).toContainText("其他分頁已有新版");
    await expect(page.getByLabel("模板名稱")).toHaveValue(recoveredName);
    await expect(page.getByLabel("主旨")).toHaveValue(recoveredSubject);
    await expect(bodyEditor).toHaveValue(validBody);
    await expect(page.locator('input[name="expectedUpdatedAt"]')).not.toHaveValue(original.updatedAt.toISOString());

    await db.messageTemplate.delete({ where: { id: original.id } });
    await page.getByRole("button", { name: "儲存", exact: true }).click();

    await expect(page.locator('p[role="alert"]')).toContainText("再次儲存會建立新模板");
    await expect(page.getByLabel("模板名稱")).toHaveValue(recoveredName);
    await expect(page.getByLabel("主旨")).toHaveValue(recoveredSubject);
    await expect(bodyEditor).toHaveValue(validBody);
    await expect(page.getByLabel("啟用模板")).not.toBeChecked();
    await expect(page.locator('input[name="id"]')).toHaveCount(0);

    await captureIfRequested(page, "message-template-draft-desktop.png");
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "Message template recovery must not overflow horizontally").toBeLessThanOrEqual(1);
    await expectNoBlockingAxeViolations(page);
    await captureIfRequested(page, "message-template-draft-mobile.png");

    await page.getByRole("button", { name: "儲存", exact: true }).click();
    await page.waitForURL(/\/messages\/templates$/u);
    const recovered = await db.messageTemplate.findMany({
      where: { vendorId: fixture.vendorIds[0], name: recoveredName },
      select: { subject: true, body: true, isActive: true },
    });
    expect(recovered).toEqual([{ subject: recoveredSubject, body: validBody, isActive: false }]);
  });

  test("merchant Email templates keep live reminders scoped, then Live Studio separates registration and reminder templates", async ({ page }) => {
    await installOwnerSession(page);
    const response = await page.goto("/messages/templates/new");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "新增訊息模板", exact: true })).toBeVisible();

    const channel = page.locator('select[name="channel"]');
    const trigger = page.locator('select[name="trigger"]');
    await expect(channel).toHaveValue("email");
    await expect(channel.locator('option[value="sms"]')).toHaveAttribute("disabled", "");
    await expect(channel.locator('option[value="line"]')).toHaveAttribute("disabled", "");
    await expect(trigger.locator('option[value="live_reminder"]')).not.toHaveAttribute("disabled");
    const postLiveFollowupOption = trigger.locator('option[value="post_live_followup"]');
    await expect(postLiveFollowupOption).toHaveCount(1);
    await expect(postLiveFollowupOption).not.toHaveAttribute("disabled");
    await expect(trigger.locator('option[value="cart_followup"]')).toHaveAttribute("disabled", "");
    await expect(page.locator("p").filter({ hasText: "{{live_start_at}}" })).toHaveText("{{name}} · {{live_title}} · {{live_url}} · {{live_start_at}} · {{vendor_name}} · {{unsubscribe_url}}");
    await expect(page.getByText("報名成功、開播提醒與課後通知會自動附上退訂連結；購買追蹤、SMS、LINE 在事件來源或 provider 完成前保持停用。", { exact: true })).toBeVisible();
    await expect(page.getByText(/購買追蹤已接通/u)).toHaveCount(0);

    await channel.focus();
    await page.keyboard.press("Tab");
    await expect(trigger).toBeFocused();
    await expectNoBlockingAxeViolations(page);

    await page.setViewportSize({ width: 390, height: 844 });
    const templateOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(templateOverflow, "Email template UI must not overflow horizontally on mobile").toBeLessThanOrEqual(1);
    await captureIfRequested(page, "email-templates.png");

    await page.setViewportSize({ width: 1280, height: 900 });
    const liveResponse = await page.goto("/lives/new");
    expect(liveResponse?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "先選這場直播的用途", exact: true })).toBeVisible();
    const commerceStarter = page.getByRole("button", { name: /商品銷售直播/u });
    await expect(commerceStarter).toHaveAttribute("aria-pressed", "false");
    await commerceStarter.click();
    await expect(commerceStarter).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('input[name="studioPreset"]')).toHaveValue("COMMERCE");
    await expect(page.locator('input[name="accentCopy"]')).toHaveValue("直播限定優惠");
    await expect(page.getByRole("status").filter({ hasText: "已選擇：商品銷售直播" })).toBeVisible();
    const desktopLivePreview = page.getByRole("complementary", { name: "即時手機預覽" });
    await expect(desktopLivePreview).toBeVisible();
    await expect(desktopLivePreview).toContainText("未命名直播");
    await page.locator('input[name="title"]').fill("G7-21 合成開播提醒直播");
    await expect(desktopLivePreview).toContainText("G7-21 合成開播提醒直播");
    await captureIfRequested(page, "live-studio-desktop.png");
    await page.locator('input[name="slug"]').fill(`g7-21-live-reminder-${runId}`);
    const schedulePanel = await openWizardPanelForControl(page, "scheduledAt");
    await schedulePanel.locator('input[name="scheduledAt"]').fill("2026-12-31T12:00");

    const emailPanel = await openWizardPanelForControl(page, "messageTemplateId");

    const registrationTemplate = emailPanel.locator('select[name="messageTemplateId"]');
    await expect(registrationTemplate.locator(`option[value="${fixture.registrationTemplateId}"]`)).toHaveText("G7-21 合成報名成功 Email · email");
    await expect(registrationTemplate.locator(`option[value="${fixture.reminderTemplateId}"]`)).toHaveCount(0);
    await registrationTemplate.selectOption(fixture.registrationTemplateId);

    const notificationEditor = emailPanel.getByRole("region", { name: "選配通知規則" });
    await notificationEditor.getByRole("button", { name: "新增開播前通知", exact: true }).click();
    const reminderTemplate = notificationEditor.getByRole("combobox", { name: "開播前第 1 則 Email 模板", exact: true });
    await expect(reminderTemplate.locator(`option[value="${fixture.reminderTemplateId}"]`)).toHaveText("G7-21 合成開播提醒 Email");
    await expect(reminderTemplate.locator(`option[value="${fixture.registrationTemplateId}"]`)).toHaveCount(0);
    await reminderTemplate.selectOption(fixture.reminderTemplateId);
    await expect(registrationTemplate).toHaveValue(fixture.registrationTemplateId);
    await expect(reminderTemplate).toHaveValue(fixture.reminderTemplateId);
    const reminderOffset = notificationEditor.getByRole("spinbutton", { name: "開播前第 1 則寄送分鐘", exact: true });
    await reminderOffset.fill("30");
    await expect(reminderOffset).toHaveValue("30");
    await expect(notificationEditor.getByText("開播前與直播中通知已接通排程；課後通知維持既有排程。", { exact: true })).toBeVisible();
    await expectNoBlockingAxeViolations(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(desktopLivePreview).toBeHidden();
    const mobileLivePreview = page.getByText("查看即時手機預覽", { exact: true });
    await expect(mobileLivePreview).toBeVisible();
    await mobileLivePreview.click();
    await expect(page.locator("details").filter({ hasText: "查看即時手機預覽" })).toContainText("G7-21 合成開播提醒直播");
    const liveStudioOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(liveStudioOverflow, "Live Studio preview must not overflow horizontally on mobile").toBeLessThanOrEqual(1);
    await expectNoBlockingAxeViolations(page);
    await captureIfRequested(page, "live-studio-mobile.png");
  });

  test("merchant interaction role previews transparent identity and exact script impact before disabling", async ({ page }) => {
    const role = await db.interactionRole.create({
      data: {
        vendorId: fixture.vendorIds[0],
        name: "G7-52 合成直播小編",
        label: "官方預設角色",
        roleType: "official",
        tone: "溫暖、簡潔，清楚提醒下一步",
        isActive: true,
        isScheduled: true,
      },
    });
    const script = await db.interactionScript.create({
      data: {
        vendorId: fixture.vendorIds[0],
        name: "G7-52 夏季活動腳本",
        status: "published",
        events: {
          create: [
            { roleId: role.id, eventType: "chat_message", triggerSec: 10, title: "開場", message: "歡迎加入。" },
            { roleId: role.id, eventType: "reminder", triggerSec: 60, title: "提醒", message: "稍後會介紹商品。" },
          ],
        },
      },
    });
    const live = await db.live.create({
      data: {
        vendorId: fixture.vendorIds[0],
        interactionScriptId: script.id,
        title: "G7-52 合成草稿直播",
        slug: `g7-52-role-preview-${runId}`,
        scheduledAt: new Date("2027-02-01T12:00:00.000Z"),
        status: "draft",
        replayEnabled: true,
      },
    });
    const foreignLive = await db.live.create({
      data: {
        vendorId: fixture.vendorIds[1],
        interactionScriptId: script.id,
        title: "G7-52 跨租戶污染直播",
        slug: `g7-52-foreign-role-preview-${runId}`,
        scheduledAt: new Date("2027-02-01T13:00:00.000Z"),
        status: "draft",
        replayEnabled: true,
      },
    });

    try {
      await installOwnerSession(page);
      await page.setViewportSize({ width: 1440, height: 1000 });
      const response = await page.goto(`/interaction-roles/${role.id}/edit`);
      expect(response?.status()).toBe(200);

      await expect(page.getByRole("heading", { name: "編輯互動角色", exact: true })).toBeVisible();
      const preview = page.getByRole("region", { name: "角色即時預覽" });
      await expect(preview).toContainText("G7-52 合成直播小編");
      await expect(preview).toContainText("官方預設角色");
      await expect(preview).toContainText("排程角色");
      await expect(preview).toContainText("這個預覽不會發布訊息，也不會建立觀看、報名、訂單、付款、評論或成效資料。");
      await expect(page.getByText("它不代表真人、即時留言、觀看人數、報名、訂單、付款、評論或成效。", { exact: false })).toBeVisible();

      const usage = page.getByRole("region", { name: "腳本與直播使用狀況" });
      await expect(usage).toContainText("1 個腳本 · 1 場直播");
      await expect(usage).toContainText("G7-52 夏季活動腳本");
      await expect(usage).toContainText("已發布");
      await expect(usage).toContainText("2 個引用事件");
      await expect(usage).toContainText("刪除後，目前有 1 個腳本引用的事件會改顯示為官方系統");
      await expect(usage.getByRole("link", { name: "檢查腳本", exact: true })).toHaveAttribute("href", `/interaction-scripts/${script.id}/edit`);

      const roleName = page.getByLabel("暱稱", { exact: true });
      await roleName.fill("");
      const dialogPromise = page.waitForEvent("dialog");
      const deleteClick = page.getByRole("button", { name: "刪除", exact: true }).click();
      const dialog = await dialogPromise;
      expect(dialog.message()).toContain("目前有 1 個腳本引用");
      await dialog.dismiss();
      await deleteClick;
      expect(await db.interactionRole.count({ where: { id: role.id, vendorId: fixture.vendorIds[0] } })).toBe(1);
      await roleName.fill("G7-52 合成直播小編");

      const activeToggle = page.getByLabel("啟用角色", { exact: true });
      await expect(activeToggle).toBeChecked();
      await activeToggle.focus();
      await expect(activeToggle).toBeFocused();
      await page.keyboard.press("Space");
      await expect(activeToggle).not.toBeChecked();
      await expect(usage.getByRole("alert")).toContainText("停用後，下列腳本中 2 個官方留言／提醒事件不會出現在公開直播");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await expectNoBlockingAxeViolations(page);
      await captureIfRequested(page, "interaction-role-desktop.png");

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole("heading", { name: "角色即時預覽", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "腳本與直播使用狀況", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await expectNoBlockingAxeViolations(page);
      await captureIfRequested(page, "interaction-role-mobile.png");
    } finally {
      await db.live.deleteMany({ where: { id: { in: [live.id, foreignLive.id] }, vendorId: { in: fixture.vendorIds } } });
      await db.interactionScript.deleteMany({ where: { id: script.id, vendorId: fixture.vendorIds[0] } });
      await db.interactionRole.deleteMany({ where: { id: role.id, vendorId: fixture.vendorIds[0] } });
    }
  });

  test("merchant onboarding shows exact sales-live blockers and skips deferred payment work", async ({ page }) => {
    await installOwnerSession(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const response = await page.goto("/onboarding");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { name: "商家上線導引", exact: true })).toBeVisible();
    await expect(page.getByText("2 / 5", { exact: true })).toBeVisible();
    await expect(page.getByText("外部驗證，可稍後", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "繼續：啟用報名表單", exact: true })).toHaveAttribute("href", "/forms/new");
    await expect(page.getByRole("link", { name: "驗證付款方式", exact: true })).toHaveAttribute("href", "/billing/payment-methods");

    const launchHeading = page.getByRole("heading", { name: "Step 5. 準備第一場可販售直播", exact: true });
    const launchStep = page.locator("li").filter({ has: launchHeading });
    await expect(launchStep).toContainText("準備可播放媒體");
    await expect(launchStep).toContainText("準備有效報名表單");
    await expect(launchStep).toContainText("發布互動腳本");
    await expect(launchStep).toContainText("完成直播綁定並進入可販售狀態");
    const requirementLink = (label: string, action: string) => launchStep
      .locator("li")
      .filter({ hasText: label })
      .getByRole("link", { name: action, exact: true });
    await expect(requirementLink("準備可播放媒體", "新增影片或 Live Input")).toHaveAttribute("href", "/videos/new");
    await expect(requirementLink("準備有效報名表單", "建立報名表單")).toHaveAttribute("href", "/forms/new");
    await expect(requirementLink("發布互動腳本", "建立互動腳本")).toHaveAttribute("href", "/interaction-scripts/new");
    await expect(requirementLink("完成直播綁定並進入可販售狀態", "建立或繼續直播")).toHaveAttribute("href", "/lives/new");
    await expect(page.getByText("內容直播仍可依自己的發布規則建立，不會被銷售檢查誤擋。", { exact: false })).toBeVisible();

    const firstRecoveryLink = requirementLink("準備可播放媒體", "新增影片或 Live Input");
    await firstRecoveryLink.focus();
    await expect(firstRecoveryLink).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expectNoBlockingAxeViolations(page);
    await captureIfRequested(page, "onboarding-desktop.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Step 5. 準備第一場可販售直播", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expectNoBlockingAxeViolations(page);
    await captureIfRequested(page, "onboarding-mobile.png");

    const paymentOnlyReference = await db.paymentMethodReference.create({
      data: {
        vendorId: fixture.vendorIds[0],
        scopeType: "VENDOR",
        providerName: "demo",
        providerPaymentMethodRef: `g7-49-payment-only-${runId}`,
        status: "verified",
        verifiedAt: new Date("2026-08-09T17:25:00.000Z"),
      },
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/onboarding");
    await expect(page.getByText("3 / 5", { exact: true })).toBeVisible();
    await expect(page.getByText("核心流程完成", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "繼續：啟用報名表單", exact: true })).toHaveAttribute("href", "/forms/new");
    await expect(page.getByText("外部驗證，可稍後", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Step 5. 準備第一場可販售直播", exact: true })).toBeVisible();

    await db.paymentMethodReference.delete({ where: { id: paymentOnlyReference.id } });
    await page.goto("/onboarding");
    await expect(page.getByText("2 / 5", { exact: true })).toBeVisible();

    await createSellableLiveFixture({
      vendorId: fixture.vendorIds[0],
      productId: fixture.productId,
      prefix: "G7-49 OWNER",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/onboarding");
    await expect(page.getByText("4 / 5", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "繼續：驗證付款方式", exact: true })).toHaveAttribute("href", "/billing/payment-methods");
    await expect(page.getByText("核心流程完成", { exact: true })).toHaveCount(0);
    await expect(page.getByText("外部驗證，可稍後", { exact: true })).toBeVisible();

    await db.paymentMethodReference.create({
      data: {
        vendorId: fixture.vendorIds[0],
        scopeType: "VENDOR",
        providerName: "demo",
        providerPaymentMethodRef: `g7-49-final-reference-${runId}`,
        status: "verified",
        verifiedAt: new Date("2026-08-09T17:30:00.000Z"),
      },
    });
    await page.goto("/onboarding");
    await expect(page.getByText("5 / 5", { exact: true })).toBeVisible();
    await expect(page.getByText("核心流程完成", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /^繼續：/u })).toHaveCount(0);
    await expect(page.getByText("外部驗證，可稍後", { exact: true })).toHaveCount(0);
  });
});
