import { beforeEach, describe, expect, it, vi } from "vitest";
import { listLivePurchaseBroadcasts, LivePurchaseBroadcastAccessDenied } from "./live-purchase-broadcasts";

const now = new Date("2026-10-07T01:00:00Z");
function fixture() {
  const tx = {
    liveViewerSession: { findUnique: vi.fn().mockResolvedValue({ vendorId: "vendor-1", liveId: "live-1", expiresAt: new Date(now.getTime() + 60_000) }) },
    live: { findFirst: vi.fn().mockResolvedValue({ id: "live-1" }) },
    liveProduct: { findFirst: vi.fn().mockResolvedValue({ id: "live-product-1" }) },
    commerceOrder: { findMany: vi.fn().mockResolvedValue([{ id: "private-order-1", buyerMaskedName: "王*明", paidAt: new Date(now.getTime() - 10_000), items: [{ productName: "本場課程" }] }]) },
  };
  const db = { $transaction: vi.fn(async (run: (value: typeof tx) => unknown) => run(tx)) };
  return { tx, db, input: { vendorId: "vendor-1", liveId: "live-1", admissionToken: "a".repeat(43), now } };
}

beforeEach(() => vi.clearAllMocks());
describe("exact live purchase broadcasts", () => {
  it("requires an active same-tenant, same-live admission before reading orders", async () => {
    for (const changes of [{ vendorId: "other-vendor" }, { liveId: "other-live" }, { expiresAt: now }]) {
      const f = fixture();
      f.tx.liveViewerSession.findUnique.mockResolvedValue({ vendorId: "vendor-1", liveId: "live-1", expiresAt: new Date(now.getTime() + 60_000), ...changes });
      await expect(listLivePurchaseBroadcasts(f.db as never, f.input)).rejects.toBeInstanceOf(LivePurchaseBroadcastAccessDenied);
      expect(f.tx.commerceOrder.findMany).not.toHaveBeenCalled();
    }
  });
  it("fails closed on missing admission without entering the transaction", async () => {
    const f = fixture();
    await expect(listLivePurchaseBroadcasts(f.db as never, { ...f.input, admissionToken: null })).rejects.toBeInstanceOf(LivePurchaseBroadcastAccessDenied);
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it("does not widen an empty live product list to the merchant", async () => {
    const f = fixture(); f.tx.liveProduct.findFirst.mockResolvedValue(null);
    await expect(listLivePurchaseBroadcasts(f.db as never, f.input)).resolves.toEqual([]);
    expect(f.tx.commerceOrder.findMany).not.toHaveBeenCalled();
  });
  it("checks live ownership even with a valid admission row", async () => {
    const f = fixture(); f.tx.live.findFirst.mockResolvedValue(null);
    await expect(listLivePurchaseBroadcasts(f.db as never, f.input)).rejects.toBeInstanceOf(LivePurchaseBroadcastAccessDenied);
    expect(f.tx.live.findFirst).toHaveBeenCalledWith({ where: { id: "live-1", vendorId: "vendor-1" }, select: { id: true } });
    expect(f.tx.commerceOrder.findMany).not.toHaveBeenCalled();
  });
  it("binds paid, unrefunded orders to server checkout attribution and visible products", async () => {
    const f = fixture(); await listLivePurchaseBroadcasts(f.db as never, f.input);
    expect(f.tx.liveProduct.findFirst).toHaveBeenCalledWith({ where: { vendorId: "vendor-1", liveId: "live-1", isVisible: true }, select: { id: true } });
    expect(f.tx.commerceOrder.findMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", status: "paid", isTestOrder: false, paidAmountCents: { gt: 0 }, refundedAmountCents: 0,
        paidAt: { gte: new Date(now.getTime() - 30 * 60_000), lte: now },
        primaryPaymentTransaction: { vendorId: "vendor-1", status: "paid", refundedAmountCents: 0, metadata: { path: ["sourceLiveId"], equals: "live-1" } },
        items: { some: { vendorId: "vendor-1", product: { vendorId: "vendor-1", liveProducts: { some: { vendorId: "vendor-1", liveId: "live-1", isVisible: true } } } } } },
      select: { id: true, buyerMaskedName: true, paidAt: true, items: { where: { vendorId: "vendor-1", product: { vendorId: "vendor-1", liveProducts: { some: { vendorId: "vendor-1", liveId: "live-1", isVisible: true } } } }, select: { productName: true }, orderBy: { lineIndex: "asc" }, take: 1 } },
      orderBy: [{ paidAt: "desc" }, { id: "desc" }], take: 8,
    });
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
  });
  it("returns only masked, bounded cards without canonical order identifiers", async () => {
    const f = fixture(); const result = await listLivePurchaseBroadcasts(f.db as never, f.input);
    expect(result).toEqual([{ id: expect.stringMatching(/^[a-f0-9]{64}$/u), buyerMaskedName: "王*明", productName: "本場課程", secondsAgo: 10 }]);
    expect(JSON.stringify(result)).not.toContain("private-order-1");
    expect(await listLivePurchaseBroadcasts(f.db as never, f.input)).toEqual(result);
  });
});
