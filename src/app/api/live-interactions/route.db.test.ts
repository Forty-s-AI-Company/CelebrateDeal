import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import * as dbModule from "@/lib/db";
import { consumeCheckoutVoucherClaim, VoucherClaimConflictError } from "@/lib/checkout-voucher-claim";
import { resolveEligibleVoucherClaim, LiveVoucherAlreadyUsedError } from "@/lib/live-interaction";
import { createFormSubmissionVerificationToken } from "@/lib/form-submission-verification";
import { FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";
import { hashLiveViewerToken, LIVE_VIEWER_SESSION_COOKIE } from "@/lib/live-quota-admission";

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
// 只驗證註冊身分與資料庫狀態，不排程或寄送郵件。
vi.mock("@/lib/commerce-order-email", () => ({ ensureCommerceOrderPaidDelivery: vi.fn() }));
vi.mock("@/lib/taiwan-electronic-invoice", () => ({ reconcileElectronicInvoiceAfterPayment: vi.fn() }));
vi.mock("@/lib/email-delivery", () => ({ ensureRegistrationConfirmationDelivery: vi.fn(), ensureLiveReminderDelivery: vi.fn() }));
import { POST } from "./route";
import { POST as checkout } from "../payments/checkout/route";
import { processPaymentWebhook, PaymentWebhookPayload } from "@/lib/payment-webhooks";
import { issueCheckoutAdmission, CHECKOUT_ADMISSION_COOKIE } from "@/lib/checkout-admission";
import { POST as verifyRegistration } from "../form-submissions/verify/route";

const vendors: string[] = [];
beforeEach(() => vi.stubEnv("CSRF_SECRET", "disposable-interaction-database-secret-over-thirty-two-bytes"));
afterEach(async () => {
  vi.restoreAllMocks();
  await getDb().vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
  vi.unstubAllEnvs();
});

async function fixture() {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Interaction fixture", slug: suffix, email: `${suffix}@example.test`, passwordHash: "disposable-only" } });
  vendors.push(vendor.id);
  const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "Fixture", slug: suffix, headline: "Fixture", fields: [] } });
  const live = await db.live.create({ data: { vendorId: vendor.id, formId: form.id, title: "Fixture", slug: suffix, scheduledAt: new Date(), status: "live" } });
  const run = await db.liveInteractionRun.create({ data: { vendorId: vendor.id, liveId: live.id, source: "manual", eventType: "flash_voucher", title: "One voucher", startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60000), configuration: { kind: "flash_voucher", durationSec: 60, maxClaims: 1, discountType: "fixed", discountValue: 100, productId: null } } });
  const tokens = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
  await db.liveViewerSession.createMany({ data: tokens.map((token) => ({ vendorId: vendor.id, liveId: live.id, tokenHash: hashLiveViewerToken(token), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 60000) })) });
  const respond = (token: string) => POST(new Request("https://app.example.test/api/live-interactions", { method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json", "x-celebratedeal-client": "web", cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${token}` }, body: JSON.stringify({ action: "respond", vendorId: vendor.id, liveId: live.id, runId: run.id, value: "claim" }) }));
  return { db, run, tokens, respond };
}

describe("advanced interactions isolated PostgreSQL", () => {
  it("uses the actual verification-issued signed cookie for paid draw identity", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "demo");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:31027");
    const { db, run, tokens } = await fixture();
    const live = await db.live.findUniqueOrThrow({ where: { id: run.liveId } });
    const expiresAt = new Date(Date.now() + 600_000);
    const submission = await db.formSubmission.create({ data: { formId: live.formId!, liveId: live.id, name: "Synthetic buyer", email: `${randomUUID()}@example.test`, verificationExpiresAt: expiresAt } });
    const form = new FormData();
    form.set("token", createFormSubmissionVerificationToken({ submissionId: submission.id, expiresAt, version: submission.verificationVersion }));
    const verified = await verifyRegistration(new Request("https://app.example.test/api/form-submissions/verify", { method: "POST", headers: { origin: "https://app.example.test" }, body: form }));
    expect(verified.status).toBe(303);
    const cookie = verified.cookies.get(FORM_SUBMISSION_CHAT_SESSION_COOKIE);
    expect(cookie?.value).toBeTruthy();
    expect((await db.formSubmission.findUniqueOrThrow({ where: { id: submission.id } })).verificationStatus).toBe("VERIFIED");
    await db.liveInteractionRun.update({ where: { id: run.id }, data: { eventType: "lucky_draw", configuration: { kind: "lucky_draw", durationSec: 60, eligibility: "purchased", slogan: "entry" } } });
    const enter = (identityCookie: string) => POST(new Request("https://app.example.test/api/live-interactions", { method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json", "x-celebratedeal-client": "web", cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${tokens[0]}; ${identityCookie}` }, body: JSON.stringify({ action: "respond", vendorId: run.vendorId, liveId: run.liveId, runId: run.id, value: "entry" }) }));
    const identity = `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${cookie!.value}`;
    expect((await enter(identity)).status).toBe(403);
    const product = await db.product.create({ data: { vendorId: run.vendorId, name: "Purchased product", slug: randomUUID(), priceCents: 1000, inventory: 5 } });
    await db.liveProduct.create({ data: { vendorId: run.vendorId, liveId: run.liveId, productId: product.id } });
    const admission = issueCheckoutAdmission({ vendorId: run.vendorId, productId: product.id, productRevision: product.revision });
    const checkoutResponse = await checkout(new Request("https://app.example.test/api/payments/checkout", {
      method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json", "x-celebratedeal-client": "web", cookie: `${identity}; ${CHECKOUT_ADMISSION_COOKIE}=${admission.sessionToken}` },
      body: JSON.stringify({ vendorId: run.vendorId, productId: product.id, idempotencyKey: admission.idempotencyKey, admissionToken: admission.admissionToken,
        buyer: { name: "Synthetic buyer", email: "buyer@example.test", phone: "0912345678" },
        shipping: { recipientName: "Synthetic buyer", phone: "0912345678", countryCode: "TW", postalCode: "100", administrativeArea: "台北市", locality: "中正區", addressLine1: "合成測試路 1 號" },
      }),
    }));
    expect(checkoutResponse.status).toBe(200);
    const checkoutBody = await checkoutResponse.json();
    expect(checkoutBody.amountCents).toBe(1000);
    const payment = await db.paymentTransaction.findUniqueOrThrow({ where: { id: checkoutBody.transactionId } });
    expect(payment.metadata).toMatchObject({ formSubmissionId: submission.id, sourceLiveId: run.liveId });
    expect(checkoutResponse.cookies.has(FORM_SUBMISSION_CHAT_SESSION_COOKIE)).toBe(false);
    expect((await enter(identity)).status).toBe(403);
    // 執行真實付款事件 domain；本測試不包含外部 provider 簽章 transport。
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo", eventId: randomUUID(), eventType: "paid", vendorId: run.vendorId,
      orderNumber: payment.orderNumber!, grossAmountCents: 1000, currency: "TWD",
    }));
    expect((await db.commerceOrder.findFirstOrThrow({ where: { primaryPaymentTransactionId: payment.id } })).status).toBe("paid");
    expect((await db.inventoryReservation.findUniqueOrThrow({ where: { paymentTransactionId: payment.id } })).status).toBe("committed");
    expect((await enter(`celebratedeal_form_submission=${submission.id}`)).status).toBe(403);
    expect((await enter(`${identity}tampered`)).status).toBe(403);
    expect((await enter(identity)).status).toBe(200);
    expect(await db.liveInteractionResponse.findFirst({ where: { runId: run.id }, select: { formSubmissionId: true } })).toEqual({ formSubmissionId: submission.id });
  });

  it("allows repurchase only after the consumed voucher order is confirmed paid", async () => {
    const { db, run, tokens, respond } = await fixture();
    const response = await respond(tokens[0]!);
    expect(response.status).toBe(200);
    const bearer = response.cookies.get("celebratedeal_flash_voucher")!.value;
    const claim = await db.liveInteractionResponse.findFirstOrThrow({ where: { runId: run.id } });
    const order = await db.commerceOrder.create({ data: {
      vendorId: run.vendorId, orderNumber: randomUUID(), checkoutIdempotencyKey: randomUUID(),
      checkoutIdentityHash: randomBytes(32).toString("base64url"), subtotalAmountCents: 1000, totalAmountCents: 900,
      buyerEncryptedEnvelope: "synthetic-not-real-pii", buyerMaskedName: "Fixture", buyerMaskedEmail: "fixture@example.test",
    } });
    await db.liveInteractionResponse.update({ where: { id: claim.id }, data: { usedOrderId: order.id } });
    const input = { vendorId: run.vendorId, productId: "synthetic-product", priceCents: 1000, currency: "TWD", rejectUsed: true };
    for (const status of ["pending_payment", "payment_failed", "expired", "cancelled"] as const) {
      await db.commerceOrder.update({ where: { id: order.id }, data: { status } });
      await expect(resolveEligibleVoucherClaim(db, bearer, input)).rejects.toBeInstanceOf(LiveVoucherAlreadyUsedError);
    }
    await db.commerceOrder.update({ where: { id: order.id }, data: { status: "paid" } });
    await expect(resolveEligibleVoucherClaim(db, bearer, input)).rejects.toBeInstanceOf(LiveVoucherAlreadyUsedError);
    await db.commerceOrder.update({ where: { id: order.id }, data: { paidAt: new Date(), paidAmountCents: 900 } });
    await expect(resolveEligibleVoucherClaim(db, bearer, input)).resolves.toBeNull();
    expect((await db.liveInteractionResponse.findUniqueOrThrow({ where: { id: claim.id } })).usedOrderId).toBe(order.id);
  });

  it("allows only one order to consume a real issued live voucher", async () => {
    const { db, run, tokens, respond } = await fixture();
    expect((await respond(tokens[0]!)).status).toBe(200);
    const issued = await db.liveInteractionResponse.findFirstOrThrow({ where: { runId: run.id } });
    const claim = { id: issued.id, source: "live" as const, discountAmountCents: 100 };
    const results = await Promise.allSettled(["order-a", "order-b"].map(orderId => db.$transaction(tx => consumeCheckoutVoucherClaim(tx, claim, { vendorId: run.vendorId, orderId, now: new Date() }))));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const failure = results.find(result => result.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason instanceof VoucherClaimConflictError).toBe(true);
    const consumed = await db.liveInteractionResponse.findUniqueOrThrow({ where: { id: issued.id } });
    expect(["order-a", "order-b"]).toContain(consumed.usedOrderId);
    expect(consumed.discountAmountCents).toBe(100);
  });

  it("rolls back voucher consumption when the surrounding order transaction fails", async () => {
    const { db, run, tokens, respond } = await fixture();
    expect((await respond(tokens[0]!)).status).toBe(200);
    const issued = await db.liveInteractionResponse.findFirstOrThrow({ where: { runId: run.id } });
    const claim = { id: issued.id, source: "live" as const, discountAmountCents: 100 };
    await expect(db.$transaction(async tx => {
      await consumeCheckoutVoucherClaim(tx, claim, { vendorId: run.vendorId, orderId: "failed-order", now: new Date() });
      throw new Error("synthetic order persistence failure");
    })).rejects.toThrow("synthetic order persistence failure");
    const reverted = await db.liveInteractionResponse.findUniqueOrThrow({ where: { id: issued.id } });
    expect(reverted.usedOrderId).toBeNull();
    expect(reverted.discountAmountCents).toBeNull();
    await expect(db.$transaction(tx => consumeCheckoutVoucherClaim(tx, claim, { vendorId: run.vendorId, orderId: "retry-order", now: new Date() }))).resolves.toBeUndefined();
  });

  it.each([
    { isActive: false },
    { fulfillmentTypeConfirmed: false },
    { checkoutUrl: "https://external.example.test/checkout" },
  ])("rejects bound products that are unavailable for native checkout: %j", async (overrides) => {
    const { db, run, tokens, respond } = await fixture();
    const product = await db.product.create({ data: { vendorId: run.vendorId, name: "Unavailable product", slug: randomUUID(), priceCents: 1000, ...overrides } });
    await db.liveProduct.create({ data: { vendorId: run.vendorId, liveId: run.liveId, productId: product.id } });
    await db.liveInteractionRun.update({ where: { id: run.id }, data: { configuration: { kind: "flash_voucher", durationSec: 60, maxClaims: 5, discountType: "fixed", discountValue: 100, productId: product.id } } });
    const response = await respond(tokens[0]!);
    expect(response.status).toBe(409);
    expect(response.cookies.has("celebratedeal_flash_voucher")).toBe(false);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(0);
  });

  it("rejects an unbound voucher before creating a scheduled run, then permits binding", async () => {
    const { db, run, tokens } = await fixture();
    const product = await db.product.create({ data: { vendorId: run.vendorId, name: "Scoped product", slug: randomUUID(), priceCents: 1000, commerceDomain: "course" } });
    const script = await db.interactionScript.create({ data: { vendorId: run.vendorId, name: "Scoped script", status: "published" } });
    const event = await db.interactionEvent.create({ data: { scriptId: script.id, eventType: "flash_voucher", title: "Scoped voucher", productId: product.id, metadata: { kind: "flash_voucher", durationSec: 120, maxClaims: 2, discountType: "fixed", discountValue: 100, productId: product.id } } });
    await db.live.update({ where: { id: run.liveId }, data: { interactionScriptId: script.id, streamMode: "live", startedAt: new Date(Date.now() - 1000) } });
    const open = () => POST(new Request("https://app.example.test/api/live-interactions", { method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json", "x-celebratedeal-client": "web", cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${tokens[0]}` }, body: JSON.stringify({ action: "open", vendorId: run.vendorId, liveId: run.liveId, eventId: event.id }) }));
    expect((await open()).status).toBe(409);
    expect(await db.liveInteractionRun.count({ where: { sourceEventId: event.id } })).toBe(0);
    await db.liveProduct.create({ data: { vendorId: run.vendorId, liveId: run.liveId, productId: product.id } });
    expect((await open()).status).toBe(200);
    expect(await db.liveInteractionRun.count({ where: { sourceEventId: event.id } })).toBe(1);
  });

  it("rechecks voucher product binding when claiming, including removed bindings", async () => {
    const { db, run, tokens, respond } = await fixture();
    const product = await db.product.create({ data: { vendorId: run.vendorId, name: "Scoped product", slug: randomUUID(), priceCents: 1000 } });
    await db.liveInteractionRun.update({ where: { id: run.id }, data: { configuration: { kind: "flash_voucher", durationSec: 60, maxClaims: 5, discountType: "fixed", discountValue: 100, productId: product.id } } });
    const rejected = await respond(tokens[0]!);
    expect(rejected.status).toBe(409);
    expect(rejected.cookies.has("celebratedeal_flash_voucher")).toBe(false);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(0);
    const binding = await db.liveProduct.create({ data: { vendorId: run.vendorId, liveId: run.liveId, productId: product.id } });
    expect((await respond(tokens[0]!)).status).toBe(200);
    await db.liveProduct.delete({ where: { id: binding.id } });
    const removed = await respond(tokens[1]!);
    expect(removed.status).toBe(409);
    expect(removed.cookies.has("celebratedeal_flash_voucher")).toBe(false);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(1);
  });

  it("rejects a viewer session from another tenant before accepting a claim", async () => {
    const first = await fixture();
    const second = await fixture();
    expect((await first.respond(second.tokens[0]!)).status).toBe(401);
    expect(await first.db.liveInteractionResponse.count({ where: { runId: first.run.id } })).toBe(0);
  });

  it("rejects an expired viewer session before accepting a claim", async () => {
    const { db, run, tokens, respond } = await fixture();
    await db.liveViewerSession.update({ where: { tokenHash: hashLiveViewerToken(tokens[0]!) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await respond(tokens[0]!)).status).toBe(401);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(0);
  });

  it("does not issue a second voucher when the same admitted viewer replays a claim", async () => {
    const { db, run, tokens, respond } = await fixture();
    expect((await respond(tokens[0]!)).status).toBe(200);
    const replay = await respond(tokens[0]!);
    expect(replay.status).toBe(409);
    expect(replay.cookies.has("celebratedeal_flash_voucher")).toBe(false);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(1);
  });

  it("rejects a run closed after the initial read but before the response transaction", async () => {
    const { db, run, tokens, respond } = await fixture();
    let closed = false;
    const interleaved = db.$extends({ query: { liveInteractionRun: { async findFirst({ args, query }) {
      const result = await query(args);
      if (!closed && result?.id === run.id) {
        closed = true;
        // Commit a real concurrent close before returning the stale initial read.
        await db.liveInteractionRun.update({ where: { id: run.id }, data: { status: "closed" } });
      }
      return result;
    } } } });
    vi.spyOn(dbModule, "getDb").mockReturnValue(interleaved as unknown as ReturnType<typeof getDb>);
    const response = await respond(tokens[0]!);
    expect(closed).toBe(true);
    expect(response.status).toBe(409);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(0);
    expect(response.cookies.has("celebratedeal_flash_voucher")).toBe(false);
  });

  it("allows only one claim when two admitted viewers race for the final voucher", async () => {
    const { db, run, tokens, respond } = await fixture();
    const replies = await Promise.all(tokens.map(respond));
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(1);
    expect(replies.filter((reply) => reply.cookies.has("celebratedeal_flash_voucher"))).toHaveLength(1);
  });

  it("rejects closed and not-yet-started runs without persisting claims", async () => {
    const { db, run, tokens, respond } = await fixture();
    await db.liveInteractionRun.update({ where: { id: run.id }, data: { status: "closed" } });
    expect((await respond(tokens[0]!)).status).toBe(409);
    await db.liveInteractionRun.update({ where: { id: run.id }, data: { status: "active", startsAt: new Date(Date.now() + 30000) } });
    expect((await respond(tokens[0]!)).status).toBe(409);
    expect(await db.liveInteractionResponse.count({ where: { runId: run.id } })).toBe(0);
  });
});
