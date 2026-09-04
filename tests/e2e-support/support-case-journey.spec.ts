import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { protectCommerceOrderPii } from "../../src/lib/commerce-order-pii";

const db = new PrismaClient();
test.use({ trace: "off", screenshot: "off", video: "off" });
const runId = randomUUID().replace(/-/g, "");
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? "31023"}`;
const sessionToken = `support-case-local-session-${runId}`;
const sessionTokenHash = createHash("sha256").update(sessionToken).digest("hex");
const buyerToken = randomBytes(32).toString("base64url");
const buyerTokenHash = createHash("sha256").update(buyerToken).digest("hex");
const buyerCookieKey = createHash("sha256").update(`support-case-cookie:${runId}`).digest("hex").slice(0, 32);

const fixture = {
  vendorId: "",
  userId: "",
  orderId: "",
  grantId: "",
};

test.describe.serial("客服案件 browser journey", () => {
  test.beforeAll(async () => {
    try {
      await db.$connect();
      await db.vendor.count();
    } catch {
      throw new Error("SUPPORT_CASE_E2E_DATABASE_UNAVAILABLE");
    }

    const vendor = await db.vendor.create({
      data: {
        name: `客服案件合成商家 ${runId}`,
        slug: `support-case-${runId}`,
        email: `support-case-${runId}@celebratedeal.local`,
        passwordHash: "synthetic-test-password-hash",
      },
    });
    fixture.vendorId = vendor.id;

    const user = await db.user.create({
      data: {
        email: `support-case-owner-${runId}@celebratedeal.local`,
        name: "客服案件合成 Owner",
        passwordHash: "synthetic-test-password-hash",
        platformRole: "none",
        status: "active",
        memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
      },
    });
    fixture.userId = user.id;
    await db.userMfaFactor.create({
      data: { userId: user.id, factorType: "totp", secretEncrypted: "synthetic-test-mfa" },
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

    const orderId = randomUUID();
    const pii = protectCommerceOrderPii({
      buyer: {
        name: "合成買家",
        email: `buyer-${runId}@celebratedeal.local`,
        phone: "0912345678",
      },
      shipping: null,
    }, { vendorId: vendor.id, orderId });
    const order = await db.commerceOrder.create({
      data: {
        id: orderId,
        vendorId: vendor.id,
        orderNumber: `SUPPORT-${runId}`,
        checkoutIdempotencyKey: `support-checkout-${runId}`,
        checkoutIdentityHash: pii.checkoutIdentityHash,
        currency: "TWD",
        subtotalAmountCents: 1_000,
        totalAmountCents: 1_000,
        buyerEncryptedEnvelope: pii.buyerEncrypted,
        buyerMaskedName: pii.buyerNameMasked,
        buyerMaskedEmail: pii.buyerEmailMasked,
      },
    });
    fixture.orderId = order.id;

    const grant = await db.buyerSupportOrderGrant.create({
      data: {
        vendorId: vendor.id,
        orderId: order.id,
        cookieKey: buyerCookieKey,
        tokenHash: buyerTokenHash,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
    fixture.grantId = grant.id;
  });

  test.afterAll(async () => {
    try {
      if (fixture.orderId) {
        await db.supportCaseEvent.deleteMany({ where: { supportCase: { orderId: fixture.orderId } } });
        await db.supportCase.deleteMany({ where: { orderId: fixture.orderId } });
        await db.buyerSupportOrderGrant.deleteMany({ where: { orderId: fixture.orderId } });
        await db.commerceOrder.delete({ where: { id: fixture.orderId } });
      }
      if (fixture.vendorId) await db.vendor.delete({ where: { id: fixture.vendorId } });
      if (fixture.userId) await db.user.deleteMany({ where: { id: fixture.userId } });
    } finally {
      await db.$disconnect();
    }
  });

  test("買家建立案件、商家回覆後買家可看見公開內容", async ({ page }) => {
    test.setTimeout(60_000);
    await page.context().addCookies([{
      name: `celebrate_support_${buyerCookieKey}`,
      value: buyerToken,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    }]);

    expect((await page.goto("/support/requests"))?.status()).toBe(200);
    await page.getByLabel("問題說明").fill("合成客服案件：需要確認訂單狀態。");
    await page.getByRole("button", { name: "建立客服案件" }).click();
    await expect(page).toHaveURL(/\/support\/requests\/[A-Za-z0-9_-]+\?updated=created/u);
    const caseUrl = new URL(page.url());
    const caseId = caseUrl.pathname.split("/").at(-1);
    if (!caseId) throw new Error("SUPPORT_CASE_ID_MISSING");
    await expect(page.getByRole("status")).toContainText("客服案件已更新");

    await page.context().clearCookies();
    await page.context().addCookies([{
      name: "celebrate_session",
      value: sessionToken,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    }]);
    expect((await page.goto(`/support-cases/${caseId}`))?.status()).toBe(200);
    await page.getByLabel("處理紀錄").fill("合成內部處理紀錄，不應向買家公開。");
    await page.getByRole("button", { name: "保存紀錄" }).click();
    await expect(page).toHaveURL(new RegExp(`/support-cases/${caseId}\\?updated=note$`, "u"));
    await page.getByLabel("公開回覆").fill("我們已收到案件，正在確認訂單狀態。");
    await page.getByRole("button", { name: "傳送給買家" }).click();
    await expect(page).toHaveURL(new RegExp(`/support-cases/${caseId}\\?updated=customer_reply$`, "u"));
    await expect(page.getByText("我們已收到案件，正在確認訂單狀態。", { exact: true })).toBeVisible();

    const stored = await db.supportCase.findUniqueOrThrow({
      where: { id: caseId },
      include: { events: { orderBy: { occurredAt: "asc" } } },
    });
    expect(stored.status).toBe("waiting_customer");
    expect(stored.firstRespondedAt).not.toBeNull();
    expect(stored.events.map((event) => [event.eventType, event.audience])).toEqual([
      ["created", "buyer"],
      ["note_added", "internal"],
      ["customer_reply_added", "buyer"],
    ]);

    await page.context().clearCookies();
    await page.context().addCookies([{
      name: `celebrate_support_${buyerCookieKey}`,
      value: buyerToken,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    }]);
    expect((await page.goto(`/support/requests/${caseId}`))?.status()).toBe(200);
    await expect(page.getByText("我們已收到案件，正在確認訂單狀態。", { exact: true })).toBeVisible();
    await expect(page.getByText("合成內部處理紀錄，不應向買家公開。", { exact: true })).toHaveCount(0);
  });
});
