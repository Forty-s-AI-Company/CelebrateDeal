import { describe, expect, it, vi } from "vitest";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { reserveWp4PayUniPaymentAttempt } from "@/lib/wp4-payuni-sandbox-payment-attempt";

const sourceCommit = "a".repeat(40);

function row(status = "pending", marker = false) {
  return {
    id: "transaction-1",
    status,
    metadata: {
      billingPurpose: "buyer_order",
      productId: WP4_SANDBOX_FIXTURE.productId,
      wp4SourceCommit: sourceCommit,
      ...(marker ? { wp4PaymentSubmissionReserved: true } : {}),
    },
  };
}

function database(rows: ReturnType<typeof row>[]) {
  const update = vi.fn().mockResolvedValue({});
  const tx = { paymentTransaction: { findMany: vi.fn().mockResolvedValue(rows), update } };
  const $transaction = vi.fn(async (callback, options) => {
    expect(options).toEqual({ isolationLevel: "Serializable" });
    return callback(tx);
  });
  return { db: { $transaction }, update };
}

describe("WP4 PayUni payment submission reservation", () => {
  it("creates exactly one durable reservation", async () => {
    const { db, update } = database([row()]);
    await expect(reserveWp4PayUniPaymentAttempt(db as never, sourceCommit)).resolves.toEqual({
      status: "SUBMIT_ALLOWED",
      reservationCreated: true,
    });
    expect(update).toHaveBeenCalledOnce();
  });

  it("never authorizes a second submit for a reserved pending transaction", async () => {
    const { db, update } = database([row("pending", true)]);
    await expect(reserveWp4PayUniPaymentAttempt(db as never, sourceCommit)).resolves.toEqual({
      status: "ALREADY_RESERVED",
      reservationCreated: false,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("allows recovery from an already-paid transaction without a second submit", async () => {
    const { db, update } = database([row("paid", true)]);
    await expect(reserveWp4PayUniPaymentAttempt(db as never, sourceCommit)).resolves.toEqual({
      status: "ALREADY_PAID",
      reservationCreated: false,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("fails closed for ambiguity", async () => {
    const { db, update } = database([row(), { ...row(), id: "transaction-2" }]);
    await expect(reserveWp4PayUniPaymentAttempt(db as never, sourceCommit)).resolves.toEqual({
      status: "CANDIDATE_AMBIGUOUS",
      reservationCreated: false,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
