import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { createCommerceOrderForCheckout } from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";
import { createInteractionBearer, hashInteractionBearer } from "@/lib/live-interaction";
import { consumeFlashSaleQuote, FlashSaleUnavailableError, resolveFlashSaleQuote } from "./live-flash-sale";
import { FLASH_SALE_COOKIE } from "./live-flash-sale";
import { CHECKOUT_ADMISSION_COOKIE } from "@/lib/checkout-admission";
import { POST as admitCheckout } from "@/app/api/payments/checkout/admission/route";
import { POST as checkout } from "@/app/api/payments/checkout/route";
import { processPaymentWebhook, PaymentWebhookPayload } from "@/lib/payment-webhooks";
import { POST as respondToInteraction } from "@/app/api/live-interactions/route";
import { hashLiveViewerToken, LIVE_VIEWER_SESSION_COOKIE } from "@/lib/live-quota-admission";
import * as paymentProviders from "@/lib/payment-providers";
import { resolveBuyerSupportGrants } from "@/lib/buyer-support-access";

// 隔離外部寄信與發票；保留真實付款事件、訂單及庫存處理。
vi.mock("@/lib/commerce-order-email", () => ({ ensureCommerceOrderPaidDelivery: vi.fn() }));
vi.mock("@/lib/taiwan-electronic-invoice", () => ({ reconcileElectronicInvoiceAfterPayment: vi.fn() }));

const vendors: string[] = [];
beforeEach(() => vi.stubEnv("CSRF_SECRET", "synthetic-flash-sale-db-secret-over-thirty-two-bytes"));
afterEach(async () => {
  vi.restoreAllMocks();
  await getDb().vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
  vi.unstubAllEnvs();
});

async function fixture(configuration: Record<string, unknown> = {}, issueThroughViewer = false) {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic flash sale", slug: suffix, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  const live = await db.live.create({ data: { vendorId: vendor.id, title: "Synthetic live", slug: suffix, scheduledAt: new Date(), status: "live" } });
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic product", slug: suffix, priceCents: 2000, inventory: 5, fulfillmentTypeConfirmed: true } });
  await db.liveProduct.create({ data: { vendorId: vendor.id, liveId: live.id, productId: product.id } });
  const run = await db.liveInteractionRun.create({ data: {
    vendorId: vendor.id, liveId: live.id, source: "manual", eventType: "flash_sale", title: "Sale",
    startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60000),
    configuration: { kind: "flash_sale", durationSec: 60, productId: product.id, salePriceCents: 1000, originalPriceCents: 2000, stockLimit: 1, ...configuration },
  } });
  const bearers = [createInteractionBearer(), createInteractionBearer()];
  if (!issueThroughViewer) await db.liveInteractionResponse.createMany({ data: bearers.map((bearer) => ({
    vendorId: vendor.id, liveId: live.id, runId: run.id, productId: product.id,
    eventType: "flash_sale", participantHash: randomUUID(), value: "buy",
    claimTokenHash: hashInteractionBearer(bearer), expiresAt: run.endsAt,
  })) });
  return { db, vendor, live, product, run, bearers, scope: { vendorId: vendor.id, productId: product.id } };
}

describe("flash sale authoritative price and reservation", () => {
  it.each([0, 2500, 999])("does not issue a cookie or persist a claim for invalid sale amount %s", async (salePriceCents) => {
    const f = await fixture({ salePriceCents }, true);
    const viewer = createInteractionBearer();
    await f.db.liveViewerSession.create({ data: { vendorId: f.vendor.id, liveId: f.live.id, tokenHash: hashLiveViewerToken(viewer), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });
    const response = await respondToInteraction(new Request("https://app.example.test/api/live-interactions", {
      method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json", "x-celebratedeal-client": "web", cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${viewer}` },
      body: JSON.stringify({ action: "respond", vendorId: f.vendor.id, liveId: f.live.id, runId: f.run.id, value: "buy" }),
    }));
    expect(response.status).toBe(409);
    expect(response.cookies.get(FLASH_SALE_COOKIE)).toBeUndefined();
    expect(await f.db.liveInteractionResponse.count({ where: { runId: f.run.id } })).toBe(0);
  });

  it.each(["unchanged", "missing-cookie", "changed-offer", "provider-failure"])("enforces signed offer in real admission and checkout APIs: %s", async (scenario) => {
    vi.stubEnv("PAYMENT_PROVIDER", "demo");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:31027");
    const f = await fixture({}, true);
    const request = (path: string, body: unknown, cookie: string) => new Request(`http://127.0.0.1:31027${path}`, {
      method: "POST", headers: { origin: "http://127.0.0.1:31027", "content-type": "application/json", "x-celebratedeal-client": "web", cookie }, body: JSON.stringify(body),
    });
    const viewer = createInteractionBearer();
    await f.db.liveViewerSession.create({ data: { vendorId: f.vendor.id, liveId: f.live.id, tokenHash: hashLiveViewerToken(viewer), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });
    const issued = await respondToInteraction(request("/api/live-interactions", { action: "respond", vendorId: f.vendor.id, liveId: f.live.id, runId: f.run.id, value: "buy" }, `${LIVE_VIEWER_SESSION_COOKIE}=${viewer}`));
    expect(issued.status).toBe(200);
    expect(await issued.json()).toMatchObject({ run: { sale: { priceCents: 2000, salePriceCents: 1000, currency: "TWD" } } });
    const issuedCookie = issued.cookies.get(FLASH_SALE_COOKIE)!;
    expect(issuedCookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect((await f.db.liveInteractionResponse.findFirstOrThrow({ where: { runId: f.run.id } })).expiresAt).toEqual(f.run.endsAt);
    const refreshed = await respondToInteraction(request("/api/live-interactions", { action: "respond", vendorId: f.vendor.id, liveId: f.live.id, runId: f.run.id, value: "buy" }, `${LIVE_VIEWER_SESSION_COOKIE}=${viewer}`));
    expect(refreshed.status).toBe(200);
    const refreshedCookie = refreshed.cookies.get(FLASH_SALE_COOKIE)!;
    expect(refreshedCookie.value).not.toBe(issuedCookie.value);
    expect(await f.db.liveInteractionResponse.count({ where: { runId: f.run.id } })).toBe(1);
    expect(await f.db.liveInteractionResponse.count({ where: { claimTokenHash: hashInteractionBearer(issuedCookie.value) } })).toBe(0);
    const saleCookie = `${FLASH_SALE_COOKIE}=${refreshedCookie.value}`;
    const saleIntent = { ...f.scope, flashSaleRunId: f.run.id };
    const lostBeforeAdmission = await admitCheckout(request("/api/payments/checkout/admission", saleIntent, ""));
    expect(lostBeforeAdmission.status).toBe(409);
    expect(lostBeforeAdmission.cookies.get(CHECKOUT_ADMISSION_COOKIE)).toBeUndefined();
    expect((await admitCheckout(request("/api/payments/checkout/admission", { ...saleIntent, flashSaleRunId: "another-run" }, saleCookie))).status).toBe(409);
    const admission = await admitCheckout(request("/api/payments/checkout/admission", saleIntent, saleCookie));
    expect(admission.status).toBe(200);
    const authorized = await admission.json();
    expect(authorized.offer).toMatchObject({ priceCents: 1000, currency: "TWD" });
    const session = admission.cookies.get(CHECKOUT_ADMISSION_COOKIE)!;
    if (scenario === "changed-offer") await f.db.liveInteractionRun.update({ where: { id: f.run.id }, data: { updatedAt: new Date(f.run.updatedAt.getTime() + 1000) } });
    if (scenario === "provider-failure") {
      const demo = paymentProviders.getPaymentProvider("demo");
      vi.spyOn(paymentProviders, "getPaymentProvider").mockReturnValue({
        ...demo, createCheckoutSession: async () => { throw new Error("synthetic provider failure"); },
      });
    }
    const response = await checkout(request("/api/payments/checkout", {
      ...f.scope, admissionToken: authorized.admissionToken, idempotencyKey: authorized.idempotencyKey,
      buyer: { name: "Synthetic buyer", email: "buyer@example.test", phone: "0912345678" },
      shipping: { recipientName: "Synthetic buyer", phone: "0912345678", countryCode: "TW", postalCode: "100", administrativeArea: "台北市", locality: "中正區", addressLine1: "合成測試路 1 號" },
    }, `${session.name}=${session.value}${scenario === "missing-cookie" ? "" : `; ${saleCookie}`}`));
    if (scenario === "provider-failure") {
      expect(response.status).toBe(502);
      const order = await f.db.commerceOrder.findFirstOrThrow({ where: { vendorId: f.vendor.id } });
      expect(order).toMatchObject({ status: "payment_failed", totalAmountCents: 1000 });
      const grants = await resolveBuyerSupportGrants(f.db, { getAll: () => response.cookies.getAll() });
      expect(grants.map((grant) => grant.orderId)).toEqual([order.id]);
      expect(await resolveBuyerSupportGrants(f.db, { getAll: () => [] })).toEqual([]);
      expect(await f.db.liveInteractionResponse.count({ where: { runId: f.run.id, usedOrderId: order.id } })).toBe(1);
      expect((await f.db.product.findUniqueOrThrow({ where: { id: f.product.id } })).inventory).toBe(5);
      expect((await admitCheckout(request("/api/payments/checkout/admission", f.scope, saleCookie))).status).toBe(409);
      // 延遲付款仍歸屬原訂單，優惠保持單次核銷。
      const payment = await f.db.paymentTransaction.findFirstOrThrow({ where: { vendorId: f.vendor.id } });
      await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "demo", eventId: randomUUID(), eventType: "paid", vendorId: f.vendor.id, orderNumber: payment.orderNumber!, grossAmountCents: 1000, currency: "TWD" }));
      expect((await f.db.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("paid");
      expect(await f.db.commerceOrder.count({ where: { vendorId: f.vendor.id } })).toBe(1);
      expect(await f.db.liveInteractionResponse.count({ where: { runId: f.run.id, usedOrderId: order.id } })).toBe(1);
    } else if (scenario === "unchanged") {
      expect(response.status).toBe(200);
      expect(await f.db.paymentTransaction.findFirstOrThrow({ where: { vendorId: f.vendor.id } })).toMatchObject({ grossAmountCents: 1000, currency: "TWD" });
      expect(await f.db.commerceOrder.findFirstOrThrow({ where: { vendorId: f.vendor.id } })).toMatchObject({ totalAmountCents: 1000, subtotalAmountCents: 2000 });
      expect(await f.db.commerceOrderItem.findFirstOrThrow({ where: { vendorId: f.vendor.id } })).toMatchObject({ nonSensitiveSnapshot: { discountAmountCents: 1000 } });
      expect(await f.db.liveInteractionResponse.count({ where: { runId: f.run.id, usedOrderId: { not: null } } })).toBe(1);
      const usedAgain = await respondToInteraction(request("/api/live-interactions", { action: "respond", vendorId: f.vendor.id, liveId: f.live.id, runId: f.run.id, value: "buy" }, `${LIVE_VIEWER_SESSION_COOKIE}=${viewer}`));
      expect(usedAgain.status).toBe(200);
      expect(usedAgain.cookies.get(FLASH_SALE_COOKIE)).toBeUndefined();
      // 未確認付款時不可用新 key 避開核銷；確認 paid 後則可原價再購。
      expect((await admitCheckout(request("/api/payments/checkout/admission", f.scope, saleCookie))).status).toBe(409);
      const order = await f.db.commerceOrder.findFirstOrThrow({ where: { vendorId: f.vendor.id } });
      await f.db.commerceOrder.update({ where: { id: order.id }, data: { status: "payment_failed" } });
      expect((await admitCheckout(request("/api/payments/checkout/admission", f.scope, saleCookie))).status).toBe(409);
      const payment = await f.db.paymentTransaction.findFirstOrThrow({ where: { vendorId: f.vendor.id } });
      await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "demo", eventId: randomUUID(), eventType: "paid", vendorId: f.vendor.id, orderNumber: payment.orderNumber!, grossAmountCents: 1000, currency: "TWD" }));
      const newAdmission = await admitCheckout(request("/api/payments/checkout/admission", f.scope, saleCookie));
      expect(newAdmission.status).toBe(200);
      const newAuthorized = await newAdmission.json();
      expect(newAuthorized.offer).toBeUndefined();
      const newSession = newAdmission.cookies.get(CHECKOUT_ADMISSION_COOKIE)!;
      const repurchase = await checkout(request("/api/payments/checkout", {
        ...f.scope, admissionToken: newAuthorized.admissionToken, idempotencyKey: newAuthorized.idempotencyKey,
        buyer: { name: "Synthetic buyer", email: "buyer@example.test", phone: "0912345678" },
        shipping: { recipientName: "Synthetic buyer", phone: "0912345678", countryCode: "TW", postalCode: "100", administrativeArea: "台北市", locality: "中正區", addressLine1: "合成測試路 1 號" },
      }, `${newSession.name}=${newSession.value}; ${saleCookie}`));
      expect(repurchase.status).toBe(200);
      expect(await f.db.paymentTransaction.findFirstOrThrow({ where: { vendorId: f.vendor.id, checkoutIdempotencyKey: newAuthorized.idempotencyKey } })).toMatchObject({ grossAmountCents: 2000 });
      expect(await f.db.liveInteractionResponse.count({ where: { runId: f.run.id, usedOrderId: order.id } })).toBe(1);
    } else {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "FLASH_SALE_UNAVAILABLE" });
      expect(await f.db.paymentTransaction.count({ where: { vendorId: f.vendor.id } })).toBe(0);
      expect((await f.db.product.findUniqueOrThrow({ where: { id: f.product.id } })).inventory).toBe(5);
    }
  });

  it.each(["none", "price", "currency", "revision"])("uses real reservation evidence and atomically handles %s changes", async (change) => {
    const f = await fixture();
    const quote = (await resolveFlashSaleQuote(f.db, f.bearers[0], f.scope))!;
    const key = randomUUID();
    const reservation = createReservedPaymentTransaction({
      ...f.scope, expectedProductRevision: quote.productRevision, checkoutIdempotencyKey: key,
      transactionData: {
        vendorId: f.vendor.id, checkoutIdempotencyKey: key, providerName: "demo", orderNumber: key,
        paymentMode: "platform", grossAmountCents: 1000, netAmountCents: 1000, currency: "TWD", status: "pending",
      },
      createCommerceOrder: async (tx, payment, revisions) => {
        const order = await createCommerceOrderForCheckout(tx, {
          ...f.scope, orderNumber: key, checkoutIdempotencyKey: key, paymentTransactionId: payment.id,
          totalAmountCents: 1000, discountAmountCents: 1000, currency: "TWD",
          buyer: { name: "Synthetic buyer", email: "buyer@example.test", phone: "0912345678" },
          shipping: { recipientName: "Synthetic buyer", phone: "0912345678", countryCode: "TW", postalCode: "100", administrativeArea: "台北市", locality: "中正區", addressLine1: "合成測試路 1 號" },
        });
        // 模擬同交易後續程式修改商品；優惠不得接受未報價的改動。
        if (change !== "none") await tx.product.update({ where: { id: f.product.id }, data:
          change === "price" ? { priceCents: 3000 } : change === "currency" ? { currency: "USD" } : { revision: { increment: 1 } },
        });
        await consumeFlashSaleQuote(tx, f.bearers[0]!, quote, order.id, new Date(), revisions.find((item) => item.productId === f.product.id));
      },
    });
    if (change === "none") {
      await expect(reservation).resolves.toMatchObject({ grossAmountCents: 1000 });
      expect(await f.db.commerceOrder.count({ where: { vendorId: f.vendor.id } })).toBe(1);
      expect(await f.db.inventoryReservation.count({ where: { vendorId: f.vendor.id } })).toBe(1);
      expect(await f.db.liveInteractionResponse.count({ where: { runId: f.run.id, usedOrderId: { not: null } } })).toBe(1);
      expect((await f.db.product.findUniqueOrThrow({ where: { id: f.product.id } })).inventory).toBe(4);
    } else {
      await expect(reservation).rejects.toBeInstanceOf(FlashSaleUnavailableError);
      expect(await f.db.paymentTransaction.count({ where: { vendorId: f.vendor.id } })).toBe(0);
      expect(await f.db.commerceOrder.count({ where: { vendorId: f.vendor.id } })).toBe(0);
      expect(await f.db.inventoryReservation.count({ where: { vendorId: f.vendor.id } })).toBe(0);
      expect(await f.db.liveInteractionResponse.count({ where: { runId: f.run.id, usedOrderId: { not: null } } })).toBe(0);
      expect(await f.db.product.findUniqueOrThrow({ where: { id: f.product.id } })).toMatchObject({ inventory: 5, revision: quote.productRevision, priceCents: 2000, currency: "TWD" });
    }
  });

  it("quotes only server prices and rejects unrelated tenant/product, expired and closed offers", async () => {
    const f = await fixture();
    const quote = await resolveFlashSaleQuote(f.db, f.bearers[0], f.scope);
    expect(quote).toMatchObject({ priceCents: 2000, salePriceCents: 1000, currency: "TWD", stockLimit: 1 });
    expect(await resolveFlashSaleQuote(f.db, f.bearers[0], { ...f.scope, vendorId: "other" })).toBeNull();
    expect(await resolveFlashSaleQuote(f.db, f.bearers[0], { ...f.scope, productId: "other" })).toBeNull();
    await expect(resolveFlashSaleQuote(f.db, f.bearers[0], { ...f.scope, now: f.run.endsAt })).rejects.toBeInstanceOf(FlashSaleUnavailableError);
    await f.db.liveInteractionRun.update({ where: { id: f.run.id }, data: { status: "closed" } });
    await expect(resolveFlashSaleQuote(f.db, f.bearers[0], f.scope)).rejects.toBeInstanceOf(FlashSaleUnavailableError);
  });

  it.each([{ salePriceCents: 0 }, { salePriceCents: 2500 }, { salePriceCents: 999 }, { salePriceCents: "1000" }, { originalPriceCents: 3000 }, { stockLimit: -1 }])("rejects invalid displayed terms %j", async (configuration) => {
    const f = await fixture(configuration);
    await expect(resolveFlashSaleQuote(f.db, f.bearers[0], f.scope)).rejects.toBeInstanceOf(FlashSaleUnavailableError);
  });

  it("rejects a product unbound after quoting and rolls back claim consumption", async () => {
    const f = await fixture();
    const quote = (await resolveFlashSaleQuote(f.db, f.bearers[0], f.scope))!;
    await expect(f.db.$transaction(async (tx) => {
      await consumeFlashSaleQuote(tx, f.bearers[0]!, quote, "synthetic-order");
      throw new Error("simulated later order failure");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toThrow("simulated later order failure");
    expect((await f.db.liveInteractionResponse.findUniqueOrThrow({ where: { id: quote.claimId } })).usedOrderId).toBeNull();
    await f.db.liveProduct.deleteMany({ where: { liveId: f.live.id } });
    await expect(f.db.$transaction((tx) => consumeFlashSaleQuote(tx, f.bearers[0]!, quote, "synthetic-order"), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toBeInstanceOf(FlashSaleUnavailableError);
  });

  it("allows only one concurrent last-slot reservation and preserves the consumed claim", async () => {
    const f = await fixture();
    const quotes = await Promise.all(f.bearers.map((bearer) => resolveFlashSaleQuote(f.db, bearer, f.scope)));
    const results = await Promise.allSettled(quotes.map((quote, index) => f.db.$transaction(
      (tx) => consumeFlashSaleQuote(tx, f.bearers[index]!, quote!, `synthetic-order-${index}`),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await f.db.liveInteractionResponse.count({ where: { runId: f.run.id, usedOrderId: { not: null } } })).toBe(1);
    const loser = results.findIndex((result) => result.status === "rejected");
    await expect(f.db.$transaction((tx) => consumeFlashSaleQuote(tx, f.bearers[loser]!, quotes[loser]!, "retry"), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toBeInstanceOf(FlashSaleUnavailableError);
  });

  it("rejects product or run revision changes between quote and reservation", async () => {
    const f = await fixture();
    const quote = (await resolveFlashSaleQuote(f.db, f.bearers[0], f.scope))!;
    await f.db.product.update({ where: { id: f.product.id }, data: { revision: { increment: 1 } } });
    await expect(f.db.$transaction((tx) => consumeFlashSaleQuote(tx, f.bearers[0]!, quote, "changed"), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toBeInstanceOf(FlashSaleUnavailableError);
    const revisedQuote = (await resolveFlashSaleQuote(f.db, f.bearers[0], f.scope))!;
    await f.db.liveInteractionRun.update({ where: { id: f.run.id }, data: { updatedAt: new Date(f.run.updatedAt.getTime() + 1000) } });
    await expect(f.db.$transaction((tx) => consumeFlashSaleQuote(tx, f.bearers[0]!, revisedQuote, "changed-again"), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toBeInstanceOf(FlashSaleUnavailableError);
  });
});
