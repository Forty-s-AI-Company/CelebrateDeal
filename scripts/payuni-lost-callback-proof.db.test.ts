import { createCipheriv, createDecipheriv, createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A4-05: the read-only lost-callback proof against the disposable PostgreSQL
// database. The WP4 fixture, the reserved checkout, the reconciler and the
// webhook pipeline are real; PayUni is a local fetch stub that answers with
// locally signed envelopes (synthetic keys), so no provider is called.
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/monitoring", async (original) => ({
  ...await original<typeof import("@/lib/monitoring")>(),
  captureOperationalError: monitoring.captureOperationalError,
}));
vi.mock("next/server", async (original) => ({
  ...await original<typeof import("next/server")>(),
  after: () => { throw new Error("`after` was called outside a request scope"); },
}));

import { POST as paymentWebhookRoute } from "@/app/api/webhooks/payments/route";
import { createCommerceOrderForCheckout } from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { generatePaymentOrderNumber } from "@/lib/payment-order-number";
import { runPendingPaymentReconciliation } from "@/lib/payment-pending-reconciliation";
import { pendingReconcileManualEventId } from "@/lib/payment-webhook-manual-reconciliation";
import { ensureWp4SandboxFixture, WP4_SANDBOX_FIXTURE as fixed } from "@/lib/wp4-sandbox-fixture";
import { RECONCILE_MANUAL_EVENT_PREFIX, readLostCallbackProof } from "./payuni-lost-callback-proof";

const db = getDb();
const HASH_KEY = "12345678901234567890123456789012";
const HASH_IV = "1234567890123456";
const MERCHANT = "TESTMER";
const MINUTE = 60_000;
const paidTrades = new Map<string, string>();
const tradeNumbers: string[] = [];

function encrypt(payload: Record<string, unknown>) {
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(HASH_KEY), Buffer.from(HASH_IV), { authTagLength: 16 });
  const plaintext = new URLSearchParams(
    Object.entries(payload).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]),
  ).toString();
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
  return Buffer.from(`${encrypted}:::${cipher.getAuthTag().toString("base64")}`).toString("hex");
}

function signedBody(payload: Record<string, unknown>, outer: Record<string, string> = {}) {
  const encryptInfo = encrypt(payload);
  const hashInfo = createHash("sha256").update(`${HASH_KEY}${encryptInfo}${HASH_IV}`).digest("hex").toUpperCase();
  return new URLSearchParams({ MerID: MERCHANT, Version: "2.0", ...outer, EncryptInfo: encryptInfo, HashInfo: hashInfo }).toString();
}

function requestedOrder(init: RequestInit | undefined) {
  const encryptInfo = (init?.body as URLSearchParams).get("EncryptInfo")!;
  const [encrypted, tag] = Buffer.from(encryptInfo, "hex").toString("utf8").split(":::");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(HASH_KEY), Buffer.from(HASH_IV));
  decipher.setAuthTag(Buffer.from(tag!, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(encrypted!, "base64")), decipher.final()]).toString("utf8");
  return new URLSearchParams(plain).get("MerTradeNo")!;
}

/** PayUni trade query: paid (before capture, CloseStatus 9) for drill orders, "not found" for anything else. */
async function payUniQueryStub(url: string | URL | Request, init?: RequestInit) {
  expect(String(url)).toBe("https://sandbox-api.payuni.com.tw/api/trade/query");
  const orderNumber = requestedOrder(init);
  const tradeNo = paidTrades.get(orderNumber);
  if (!tradeNo) return new Response(signedBody({ Status: "QUERY03001" }));
  return new Response(signedBody({ Status: "SUCCESS", Result: {
    MerTradeNo: orderNumber, TradeNo: tradeNo, TradeAmt: "1", TradeStatus: "1", PaymentType: "1", DataSource: "A", CloseStatus: "9",
  } }));
}

beforeEach(() => {
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("PAYUNI_SANDBOX_MERCHANT_ID", MERCHANT);
  vi.stubEnv("PAYUNI_SANDBOX_HASH_KEY", HASH_KEY);
  vi.stubEnv("PAYUNI_SANDBOX_HASH_IV", HASH_IV);
  vi.stubEnv("PAYMENT_PROVIDER", "payuni");
  vi.stubEnv("PAYMENT_RECONCILE_ENABLED", "true");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("CSRF_SECRET", "lost-callback-proof-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://lost-callback-proof.example.test");
  vi.stubGlobal("fetch", vi.fn(payUniQueryStub));
  paidTrades.clear();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  // Nothing of this file may stay due for a later reconciler test.
  await db.paymentTransaction.updateMany({ where: { vendorId: fixed.vendorId, status: { in: ["pending", "expired"] } }, data: { status: "failed" } });
  await db.webhookEvent.deleteMany({ where: { OR: [{ vendorId: fixed.vendorId }, { provider: "payuni", eventId: { in: tradeNumbers.splice(0).map((trade) => `${trade}:1`) } }] } });
  await db.auditLog.deleteMany({ where: { vendorId: fixed.vendorId } });
  await db.vendor.deleteMany({ where: { id: fixed.vendorId } });
  await db.user.deleteMany({ where: { id: fixed.userId } });
  await db.billingPlan.deleteMany({ where: { id: fixed.planId } });
});

/** The real WP4 checkout reservation for one source SHA, aged past the reconciler's minimum. */
async function drillCheckout(sourceSha: string) {
  await ensureWp4SandboxFixture(db);
  const orderNumber = generatePaymentOrderNumber();
  const checkoutIdempotencyKey = randomUUID();
  const payment = await createReservedPaymentTransaction({
    vendorId: fixed.vendorId, productId: fixed.productId, checkoutIdempotencyKey,
    transactionData: {
      vendorId: fixed.vendorId, providerName: "payuni", orderNumber, paymentMode: "platform", grossAmountCents: 100, netAmountCents: 100,
      currency: "TWD", status: "pending", checkoutIdempotencyKey,
      metadata: { billingPurpose: "buyer_order", productId: fixed.productId, wp4SourceCommit: sourceSha, wp4PaymentSubmissionReserved: true },
    },
    createCommerceOrder: async (tx, transaction) => {
      await createCommerceOrderForCheckout(tx, {
        vendorId: fixed.vendorId, productId: fixed.productId, orderNumber, checkoutIdempotencyKey, paymentTransactionId: transaction.id,
        totalAmountCents: 100, currency: "TWD", buyer: { name: "Synthetic buyer", email: "wp4-buyer-v1@invalid.example" }, shipping: null,
      });
    },
  });
  await db.paymentTransaction.update({ where: { id: payment.id }, data: { createdAt: new Date(Date.now() - 20 * MINUTE) } });
  const tradeNo = `LOSTCB${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  tradeNumbers.push(tradeNo);
  return { orderNumber, tradeNo, transactionId: payment.id };
}

const providerQuery = vi.fn(async () => ({ status: "FOUND", settlement: { TradeStatus: "1", CloseStatus: "9", RemainAmt: "ABSENT" } }));

describe("PayUni lost-callback proof (A4-05)", () => {
  it("pins the manual reconciliation event prefix to the reconciler's", () => {
    expect(pendingReconcileManualEventId("ORDER", "reason")).toBe(`${RECONCILE_MANUAL_EVENT_PREFIX}ORDER:reason`);
  });

  it("pay: an undecided checkout with no event is CALLBACK_WITHHELD; verify then reports NOT_YET_RECONCILED", async () => {
    const sha = "1".repeat(40);
    const drill = await drillCheckout(sha);
    const pay = await readLostCallbackProof(db, { sourceSha: sha, phase: "pay", queryProvider: providerQuery });
    expect(pay).toMatchObject({
      candidate: "FOUND", evaluation: "CALLBACK_WITHHELD",
      payment: { status: "pending", paymentMode: "platform", amountCents: 100, currency: "TWD", providerTradeRecorded: false, manualHold: false },
      providerEvents: { paid: 0, paidSource: "NONE", other: 0 }, manualEvents: 0, reconciliation: null,
      order: { count: 1, paidEvents: 0 }, reservation: { count: 1, status: "reserved" },
      provider: { status: "FOUND", settlement: { TradeStatus: "1", CloseStatus: "9", RemainAmt: "ABSENT" } },
    });
    expect(pay.payment!.ageMinutes).toBeGreaterThanOrEqual(19);
    expect(providerQuery).toHaveBeenLastCalledWith(drill.orderNumber);
    const serialized = JSON.stringify(pay);
    for (const identifier of [drill.orderNumber, drill.transactionId, fixed.vendorId, "invalid.example"]) expect(serialized).not.toContain(identifier);
    await expect(readLostCallbackProof(db, { sourceSha: sha, phase: "verify" })).resolves.toMatchObject({ evaluation: "NOT_YET_RECONCILED", provider: { status: "NOT_QUERIED" } });
  });

  it("verify: the reconciler posts the withheld payment exactly once and later runs change nothing", async () => {
    const sha = "2".repeat(40);
    const drill = await drillCheckout(sha);
    paidTrades.set(drill.orderNumber, drill.tradeNo);

    const first = await runPendingPaymentReconciliation({});
    expect(first.paid).toBeGreaterThanOrEqual(1);
    const verified = await readLostCallbackProof(db, { sourceSha: sha, phase: "verify" });
    expect(verified).toMatchObject({
      evaluation: "RECONCILED_ONCE",
      payment: { status: "paid", providerTradeRecorded: true, manualHold: false },
      providerEvents: { paid: 1, paidProcessed: 1, paidSource: "RECONCILER", paidMaxRetryCount: 0, other: 0 },
      manualEvents: 0,
      reconciliation: { status: "settled", attempts: 1, lastOutcome: "paid_applied" },
      order: { count: 1, status: "paid", paidAmountCents: 100, paidEvents: 1 },
      reservation: { count: 1, status: "committed" },
      reconcilerAudit: { applied: 1, manualReview: 0 },
    });

    // A later run (scheduled or dispatched) sees a settled row and never re-posts.
    const second = await runPendingPaymentReconciliation({ now: new Date(Date.now() + 60 * MINUTE) });
    expect(second.paid).toBe(0);
    const again = await readLostCallbackProof(db, { sourceSha: sha, phase: "verify" });
    expect({ ...again, payment: { ...again.payment, ageMinutes: 0 } }).toEqual({ ...verified, payment: { ...verified.payment, ageMinutes: 0 } });
    // The pay-phase expectation no longer holds for a posted payment.
    await expect(readLostCallbackProof(db, { sourceSha: sha, phase: "pay" })).resolves.toMatchObject({ evaluation: "UNEXPECTED_STATE" });
  });

  it("a payment posted by a delivered callback is not mistaken for a reconciled one", async () => {
    const sha = "3".repeat(40);
    const drill = await drillCheckout(sha);
    const body = signedBody(
      { MerID: MERCHANT, Status: "SUCCESS", TradeStatus: "1", PaymentType: "1", MerTradeNo: drill.orderNumber, TradeNo: drill.tradeNo, TradeAmt: 1 },
      { Status: "SUCCESS" },
    );
    const response = await paymentWebhookRoute(new Request("https://lost-callback-proof.example.test/api/webhooks/payments?provider=payuni&source=notify", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
    }));
    expect(response.status).toBe(200);
    const proof = await readLostCallbackProof(db, { sourceSha: sha, phase: "verify" });
    expect(proof).toMatchObject({ evaluation: "UNEXPECTED_STATE", payment: { status: "paid" }, providerEvents: { paid: 1, paidSource: "CALLBACK" }, reconciliation: null });
  });

  it("reports a missing or ambiguous drill checkout without touching the provider", async () => {
    providerQuery.mockClear();
    await expect(readLostCallbackProof(db, { sourceSha: "4".repeat(40), phase: "pay", queryProvider: providerQuery }))
      .resolves.toMatchObject({ candidate: "MISSING", evaluation: "UNEXPECTED_STATE", provider: { status: "NOT_QUERIED" } });
    expect(providerQuery).not.toHaveBeenCalled();
    await expect(readLostCallbackProof(db, { sourceSha: "main", phase: "pay" })).rejects.toThrow("LOST_CALLBACK_PROOF_INPUT_REJECTED");
  });
});
