import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { EXACT_SOURCE, readExactSyntheticState, queryExactProviderState } from "./q1-exact-state-details";
import { WP4_SANDBOX_FIXTURE } from "../src/lib/wp4-sandbox-fixture";

const payment = () => ({ id: "private-synthetic-id", orderNumber: "private-original-reference", status: "pending", providerTradeNo: "private-provider-id", grossAmountCents: 100,
  currency: "TWD", refundedAmountCents: 0, metadata: { wp4SourceCommit: EXACT_SOURCE, billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId as string } });
function fixture(rows = [payment()]) {
  const tx = { $executeRaw: vi.fn<(query: TemplateStringsArray) => Promise<number>>().mockResolvedValue(0), paymentTransaction: { findMany: vi.fn(async () => rows) },
    commerceOrder: { findMany: vi.fn(async () => [{ id: "private-order-id", status: "pending_payment", paidAmountCents: 0 }]) },
    inventoryReservation: { findMany: vi.fn(async () => [{ status: "reserved", releaseReason: null, productId: WP4_SANDBOX_FIXTURE.productId, quantity: 1 }]) },
    commerceOrderEvent: { count: vi.fn(async () => 0) },
    webhookEvent: { findMany: vi.fn<() => Promise<Array<{ status: string; vendorId: string | null; errorMessage: string | null; retryCount: number; maxRetries: number; eventId?: string; payload?: unknown }>>>().mockResolvedValue([]) } };
  const transaction = vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx));
  return { tx, transaction, db: { $transaction: transaction } as unknown as PrismaClient };
}
describe("exact existing synthetic transaction read-only diagnosis", () => {
  it("observes pending original state without exposing identifiers or mutating it", async () => {
    const { tx, db, transaction } = fixture();
    const result = await readExactSyntheticState(db);
    expect(result).toMatchObject({ category: "EXACT_SYNTHETIC_STATE_OBSERVED", paymentState: "pending", providerTradeNumberPresent: true, orderPaidAmountMatches: false, paidEventCount: 0 });
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(tx.$executeRaw.mock.calls[0]?.[0]?.join("")).toBe("SET TRANSACTION READ ONLY");
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.paymentTransaction.findMany.mock.invocationCallOrder[0]!);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 15000 });
    expect(tx.paymentTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2, where: expect.objectContaining({ vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni", AND: expect.arrayContaining([{ metadata: { path: ["wp4SourceCommit"], equals: EXACT_SOURCE } }]) }) }));
  });
  it.each([{ rows: [] }, { rows: [payment(), payment()] }])("never picks one of absent or ambiguous candidates", async ({ rows }) => {
    const { db, tx } = fixture(rows);
    expect(await readExactSyntheticState(db)).toEqual({ category: rows.length ? "EXACT_FIXTURE_AMBIGUOUS" : "EXACT_FIXTURE_ABSENT" });
    expect(tx.commerceOrder.findMany).not.toHaveBeenCalled();
    expect(tx.webhookEvent.findMany).not.toHaveBeenCalled();
  });
  it.each(["source", "purpose", "product"])("rejects mismatched %s even if a database adapter returns it", async (field) => {
    const row = payment();
    if (field === "source") row.metadata.wp4SourceCommit = "a".repeat(40);
    if (field === "purpose") row.metadata.billingPurpose = "invoice_payment";
    if (field === "product") row.metadata.productId = "other";
    expect(await readExactSyntheticState(fixture([row]).db)).toEqual({ category: "EXACT_FIXTURE_ABSENT" });
  });
  it("converts unknown private status values to closed OTHER", async () => {
    const row = payment(); row.status = "private-status";
    const result = await readExactSyntheticState(fixture([row]).db);
    expect("paymentState" in result && result.paymentState).toBe("OTHER");
  });
  it("stops if PostgreSQL refuses the read-only transaction", async () => {
    const { tx, db } = fixture(); tx.$executeRaw.mockRejectedValueOnce(new Error("synthetic"));
    await expect(readExactSyntheticState(db)).rejects.toThrow();
    expect(tx.paymentTransaction.findMany).not.toHaveBeenCalled();
  });
  it("does not infer a callback from a paid provider query", async () => {
    const { db, tx } = fixture();
    const result = await readExactSyntheticState(db, async () => ({ MerTradeNo: "private-original-reference", TradeNo: "private-trade", TradeStatus: "1", TradeAmt: 1 }));
    expect("callback" in result && result.callback).toEqual({ callbackState: "NOT_OBSERVED" });
    expect(tx.webhookEvent.findMany).toHaveBeenCalledExactlyOnceWith({ where: { provider: "payuni", eventType: "paid",
      payload: { path: ["normalized", "orderNumber"], equals: "private-original-reference" } }, take: 2,
      select: { status: true, vendorId: true, errorMessage: true, retryCount: true, maxRetries: true, eventId: true, payload: true } });
    expect(JSON.stringify(result)).not.toContain("private-");
  });
  it("reports durable submission and callback-retry reservations without changing them", async () => {
    const row = { ...payment(), metadata: { ...payment().metadata, wp4PaymentSubmissionReserved: true, wp4CallbackRetryReserved: true } };
    const result = await readExactSyntheticState(fixture([row]).db);
    expect(result).toMatchObject({ paymentSubmissionReserved: true, callbackRetryReserved: true });
    expect(row.metadata.wp4PaymentSubmissionReserved).toBe(true);
    expect(row.metadata.wp4CallbackRetryReserved).toBe(true);
  });
  it("retains a real timeout category without revealing callback or tenant identifiers", async () => {
    const { db, tx } = fixture();
    tx.webhookEvent.findMany.mockResolvedValue([{ status: "failed", vendorId: null, errorMessage: "Payment webhook processing failed (processing_timeout).", retryCount: 1, maxRetries: 3 }]);
    const result = await readExactSyntheticState(db);
    expect("callback" in result && result.callback).toEqual({ callbackState: "failed", callbackTenantState: "UNASSIGNED", callbackFailure: "processing_timeout", callbackRetryBudgetAvailable: true,
      callbackPayloadValid: false, callbackEventIdentityMatches: false, callbackProviderOrderMatches: false, callbackPayloadTenantMatches: false,
      callbackAmountMatches: false, callbackTradeMatches: false, callbackCurrencyMatches: false, callbackSingleRecoveryCountAllowed: true });
    expect(JSON.stringify(result)).not.toContain("private-");
  });
  it("closes unknown errors and reports a conflicting tenant without revealing its value", async () => {
    const { db, tx } = fixture();
    tx.webhookEvent.findMany.mockResolvedValue([{ status: "private-status", vendorId: "private-foreign-tenant", errorMessage: "private-token-error", retryCount: 3, maxRetries: 3 }]);
    const result = await readExactSyntheticState(db);
    expect("callback" in result && result.callback).toEqual({ callbackState: "OTHER", callbackTenantState: "MISMATCHED", callbackFailure: "OTHER", callbackRetryBudgetAvailable: false,
      callbackPayloadValid: false, callbackEventIdentityMatches: false, callbackProviderOrderMatches: false, callbackPayloadTenantMatches: false,
      callbackAmountMatches: false, callbackTradeMatches: false, callbackCurrencyMatches: false, callbackSingleRecoveryCountAllowed: false });
    expect(JSON.stringify(result)).not.toContain("private-");
  });
  it("does not select one of two callbacks or query an invalid original reference", async () => {
    const first = fixture();
    first.tx.webhookEvent.findMany.mockResolvedValue(Array.from({ length: 2 }, () => ({ status: "failed", vendorId: null, errorMessage: null, retryCount: 0, maxRetries: 3 })));
    const ambiguous = await readExactSyntheticState(first.db);
    expect("callback" in ambiguous && ambiguous.callback).toEqual({ callbackState: "AMBIGUOUS" });
    const row = payment(); row.orderNumber = "private-invalid reference";
    const second = fixture([row]); const invalid = await readExactSyntheticState(second.db);
    expect("callback" in invalid && invalid.callback).toEqual({ callbackState: "REFERENCE_UNAVAILABLE" });
    expect(second.tx.webhookEvent.findMany).not.toHaveBeenCalled();
  });
});


describe("fixed original provider query classification", () => {
  it("queries only the uniquely selected original reference and never serializes it", async () => {
    const query = vi.fn(async () => ({ MerTradeNo: "private-original-reference", TradeNo: "private-provider", TradeStatus: "0", TradeAmt: 1, Message: "private-message" }));
    const result = await readExactSyntheticState(fixture().db, query);
    expect(query).toHaveBeenCalledExactlyOnceWith("private-original-reference");
    expect("provider" in result && result.provider).toMatchObject({ providerQuery: "OBSERVED", providerTradeState: "0", providerAmountMatches: true });
    expect(JSON.stringify(result)).not.toContain("private-");
  });
  it.each([{ rows: [] }, { rows: [payment(), payment()] }])("never queries absent or ambiguous candidates", async ({ rows }) => {
    const query = vi.fn(async () => ({})); await readExactSyntheticState(fixture(rows).db, query);
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects changed amount before any provider query", async () => {
    const row = payment(); row.grossAmountCents = 200; const query = vi.fn(async () => ({}));
    const result = await readExactSyntheticState(fixture([row]).db, query);
    expect("provider" in result && result.provider).toEqual({ providerQuery: "EXACT_IDENTITY_UNAVAILABLE" });
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects a provider response for a different reference", async () => {
    expect(await queryExactProviderState("fixed", async () => ({ MerTradeNo: "other" }))).toEqual({ providerQuery: "IDENTITY_MISMATCH" });
  });
  it("closes unknown provider values and amount mismatch without leaking data", async () => {
    expect(await queryExactProviderState("fixed", async () => ({ MerTradeNo: "fixed", TradeStatus: "private-status", TradeAmt: 2 })))
      .toMatchObject({ providerTradeState: "OTHER", providerAmountMatches: false });
  });
  it("never serializes raw errors or grants permission to resubmit", async () => {
    const result = await queryExactProviderState("fixed", async () => { throw new Error("private-key"); });
    expect(result).toEqual({ providerQuery: "UNAVAILABLE" });
  });
});

describe("closed original callback rejection observations", () => {
  const normalized = () => ({ provider: "payuni", eventId: "private-event", eventType: "paid", orderNumber: "private-original-reference",
    providerTradeNo: "private-provider-id", grossAmountCents: 100, currency: "TWD" });
  async function observe(payload: unknown, retryCount = 1) {
    const { db, tx } = fixture();
    tx.webhookEvent.findMany.mockResolvedValue([{ status: "failed", vendorId: null, errorMessage: null,
      retryCount, maxRetries: 5, eventId: "private-event", payload: { normalized: payload } }]);
    const result = await readExactSyntheticState(db);
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(tx.$executeRaw.mock.calls[0]?.[0]?.join("")).toBe("SET TRANSACTION READ ONLY");
    if (!("callback" in result)) throw new Error("Expected exact callback observation");
    return result.callback;
  }
  it("separates the stricter fixed-recovery count from the provider retry budget", async () => {
    expect(await observe(normalized(), 2)).toMatchObject({ callbackRetryBudgetAvailable: true,
      callbackSingleRecoveryCountAllowed: false, callbackPayloadValid: true, callbackEventIdentityMatches: true,
      callbackProviderOrderMatches: true, callbackPayloadTenantMatches: true, callbackAmountMatches: true,
      callbackTradeMatches: true, callbackCurrencyMatches: true });
  });
  it.each([
    ["eventId", "private-other-event", "callbackEventIdentityMatches"],
    ["provider", "other", "callbackProviderOrderMatches"],
    ["vendorId", "private-other-tenant", "callbackPayloadTenantMatches"],
    ["vendorSlug", "private-other-slug", "callbackPayloadTenantMatches"],
    ["grossAmountCents", 200, "callbackAmountMatches"],
    ["providerTradeNo", "private-other-trade", "callbackTradeMatches"],
    ["currency", "USD", "callbackCurrencyMatches"],
  ])("closes mismatched %s to a boolean without exporting values", async (field, value, flag) => {
    expect(await observe({ ...normalized(), [field]: value })).toHaveProperty(flag, false);
  });
  it("does not interpret an invalid stored shape as a usable callback", async () => {
    expect(await observe({ ...normalized(), grossAmountCents: "100", token: "private-token" }))
      .toMatchObject({ callbackPayloadValid: false, callbackAmountMatches: false });
  });
});
