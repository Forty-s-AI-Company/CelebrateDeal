import { describe, expect, it, vi } from "vitest";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import {
  reserveWp4PayUniPaymentAttempt,
  reserveWp4PayUniSubscriptionPaymentAttempt,
} from "@/lib/wp4-payuni-sandbox-payment-attempt";

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

function subscriptionRow(status = "pending", marker = false) {
  return {
    id: "subscription-transaction-1",
    status,
    metadata: {
      billingPurpose: "platform_subscription_checkout",
      platformSubscriptionId: "wp4_synthetic_subscription_v1",
      billingPlanId: WP4_SANDBOX_FIXTURE.planId,
      wp4SourceCommit: sourceCommit,
      ...(marker ? { wp4PaymentSubmissionReserved: true } : {}),
    },
  };
}

type PaymentAttemptRow = ReturnType<typeof row> | ReturnType<typeof subscriptionRow>;

function database(rows: PaymentAttemptRow[]) {
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

  it("reserves exactly one source-owned SaaS payment submission", async () => {
    const { db, update } = database([subscriptionRow()]);
    await expect(reserveWp4PayUniSubscriptionPaymentAttempt(db as never, sourceCommit)).resolves.toEqual({
      status: "SUBMIT_ALLOWED",
      reservationCreated: true,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "subscription-transaction-1" } }));
  });

  it("keeps buyer and SaaS reservations isolated", async () => {
    const { db, update } = database([row(), subscriptionRow()]);

    await expect(reserveWp4PayUniPaymentAttempt(db as never, sourceCommit)).resolves.toEqual({
      status: "SUBMIT_ALLOWED",
      reservationCreated: true,
    });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "transaction-1" } }));

    await expect(reserveWp4PayUniSubscriptionPaymentAttempt(db as never, sourceCommit)).resolves.toEqual({
      status: "SUBMIT_ALLOWED",
      reservationCreated: true,
    });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "subscription-transaction-1" } }));
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("does not reserve a cross-purpose payment submission", async () => {
    const onlySaaS = database([subscriptionRow()]);
    await expect(reserveWp4PayUniPaymentAttempt(onlySaaS.db as never, sourceCommit)).resolves.toEqual({
      status: "FIXTURE_UNAVAILABLE",
      reservationCreated: false,
    });
    expect(onlySaaS.update).not.toHaveBeenCalled();

    const onlyBuyer = database([row()]);
    await expect(reserveWp4PayUniSubscriptionPaymentAttempt(onlyBuyer.db as never, sourceCommit)).resolves.toEqual({
      status: "FIXTURE_UNAVAILABLE",
      reservationCreated: false,
    });
    expect(onlyBuyer.update).not.toHaveBeenCalled();
  });
});
