import { beforeEach, describe, expect, it, vi } from "vitest";
import { readIssuedPendingState, FIXED_PENDING } from "./f2-issued-pending-state";
vi.mock("./payuni-sandbox-payment-handoff.mjs", () => ({ reference: (value: string) =>
  value === "fixed-txn" ? FIXED_PENDING.transactionRef : value === "fixed-order" ? FIXED_PENDING.orderRef : "000000000000" }));
const payment = () => ({ id: "fixed-txn", orderNumber: "fixed-order", providerTradeNo: "fixed-trade",
  grossAmountCents: 100, currency: "TWD", status: "pending", refundedAmountCents: 0, refunds: [] as { status: string }[] });
function fixture(rows = [payment()]) {
  const tx = { $executeRaw: vi.fn().mockResolvedValue(0), paymentTransaction: { findMany: vi.fn().mockResolvedValue(rows) } };
  const db = { $transaction: vi.fn(async callback => callback(tx)) } as unknown as Parameters<typeof readIssuedPendingState>[0];
  const query = vi.fn().mockResolvedValue({ MerTradeNo: "fixed-order", TradeNo: "fixed-trade", TradeAmt: "1", TradeStatus: "3", DataSource: "A", PaymentType: "1" });
  return { db, tx, query };
}
describe("exact pending F2 query cannot select replacements or submit payment/refund", () => {
  beforeEach(() => vi.clearAllMocks());
  it("uses a database-enforced readonly snapshot and exact catalog before signed query", async () => {
    const { db, tx, query } = fixture();
    const result = await readIssuedPendingState(db, query);
    expect(result.outcome).toBe("TERMINAL_UNPAID");
    expect(query).toHaveBeenCalledExactlyOnceWith("fixed-order");
    expect(tx.$executeRaw.mock.calls[0]![0].join("")).toBe("SET TRANSACTION READ ONLY");
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.paymentTransaction.findMany.mock.invocationCallOrder[0]!);
    const argument = tx.paymentTransaction.findMany.mock.calls[0]![0];
    expect(argument.where).toMatchObject({ vendorId: "wp4_synthetic_vendor_v1", providerName: "payuni", grossAmountCents: 100, currency: "TWD" });
    expect(argument.where.AND).toContainEqual({ metadata: { path: ["wp4SourceCommit"], equals: FIXED_PENDING.source } });
    expect(argument.where.AND).toContainEqual({ metadata: { path: ["wp4PaymentSubmissionReserved"], equals: true } });
    expect(argument.where.checkoutIdempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(argument.orderBy).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/fixed-(?:txn|order|trade)/);
  });
  it.each([{ rows: [] }, { rows: [payment(), payment()] }])("rejects absent or ambiguous originals without provider request", async ({ rows }) => {
    const { db, query } = fixture(rows);
    await expect(readIssuedPendingState(db, query)).rejects.toThrow("Fixed pending F2 state rejected.");
    expect(query).not.toHaveBeenCalled();
  });
  it.each([{ id: "replacement" }, { orderNumber: "replacement" }, { orderNumber: null }, { grossAmountCents: 200 }, { currency: "USD" }])("rejects wrong original identity/amount before provider query", async patch => {
    const { db, query } = fixture([{ ...payment(), ...patch } as ReturnType<typeof payment>]);
    await expect(readIssuedPendingState(db, query)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
  it.each(["0", "9", "2", "3", "4", "8", "1", "private-error"])("reports closed provider state %s without performing a retry", async state => {
    const { db, query } = fixture();
    query.mockResolvedValue({ MerTradeNo: "fixed-order", TradeNo: "fixed-trade", TradeAmt: 1, TradeStatus: state, DataSource: "A", PaymentType: 1 });
    const result = await readIssuedPendingState(db, query);
    const expected = state === "1" ? "PAID_REFUND_RECONCILIATION_REQUIRED" : ["2", "3", "4"].includes(state) ? "TERMINAL_UNPAID" : ["0", "9"].includes(state) ? "ISSUED_UNPAID" : state === "8" ? "PROCESSING" : "UNCONFIRMED";
    expect(result.outcome).toBe(expected); expect(query).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private-error");
  });
  it.each([{ MerTradeNo: "replacement" }, { TradeNo: "replacement" }, { TradeAmt: 2 }, { TradeNo: null }, { TradeNo: "private bad id" }])("does not report paid on mismatching signed provider identity", async patch => {
    const { db, query } = fixture();
    query.mockResolvedValue({ MerTradeNo: "fixed-order", TradeNo: "fixed-trade", TradeAmt: 1, TradeStatus: "1", DataSource: "A", PaymentType: "1", ...patch });
    expect((await readIssuedPendingState(db, query)).outcome).toBe("UNCONFIRMED");
  });
  it("does not promote unpaid query-source B to verified credit payment", async () => {
    const { db, query } = fixture();
    query.mockResolvedValue({ MerTradeNo: "fixed-order", TradeNo: "fixed-trade", TradeAmt: 1, TradeStatus: "1", DataSource: "B", PaymentType: "1" });
    expect((await readIssuedPendingState(db, query)).outcome).toBe("UNCONFIRMED");
  });
  it("keeps unknown historical TradeNo distinct from same-trade proof", async () => {
    const { db, query } = fixture([{ ...payment(), providerTradeNo: null } as unknown as ReturnType<typeof payment>]);
    const result = await readIssuedPendingState(db, query);
    expect(result.originalProviderTradeKnown).toBe(false); expect("originalProviderTradeMatches" in result && result.originalProviderTradeMatches).toBeNull();
  });
  it("never exposes provider exceptions or reports their arbitrary text as state", async () => {
    const { db, query } = fixture(); query.mockRejectedValue(new Error("private-card-token-payload"));
    const result = await readIssuedPendingState(db, query);
    expect(result.outcome).toBe("UNCONFIRMED"); expect(JSON.stringify(result)).not.toContain("private-");
  });
});
