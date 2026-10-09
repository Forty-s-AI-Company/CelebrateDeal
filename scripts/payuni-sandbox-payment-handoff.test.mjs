import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  assertPendingRefundTarget,
  createPendingRefundHandoff,
  reference,
  writePaymentHandoff,
} from "./payuni-sandbox-payment-handoff.mjs";

const fixture = Object.freeze({
  startedAt: "2026-07-30T00:00:00.000Z",
  completedAt: "2026-07-30T00:00:01.000Z",
  appUrl: "https://staging.example.test",
  checkout: { orderNumber: "cd_sandbox_fixture_order", transactionId: "fixture-transaction", amount: 125 },
  paid: { TradeStatus: "1", TradeNo: "fixture-trade", TradeAmt: 125 },
});

function exactTargetFixture() {
  return {
    receipt: createPendingRefundHandoff({ ...fixture, appUrl: "https://celebrate-deal-staging.carry-digital-nomad.in.net" }),
    now: new Date("2026-07-30T01:00:00.000Z"),
    runtime: { environment: "preview", payuniEnvironment: "sandbox", providerHost: "sandbox-api.payuni.com.tw",
      appHost: "celebrate-deal-staging.carry-digital-nomad.in.net", sourceCommit: "a".repeat(40), vendorId: "synthetic-vendor" },
    target: { id: fixture.checkout.transactionId, orderNumber: fixture.checkout.orderNumber,
      providerTradeNo: fixture.paid.TradeNo, vendorId: "synthetic-vendor", providerName: "payuni",
      status: "paid", refundedAmountCents: 0, grossAmountCents: 12500 },
  };
}

test("pending refund binds the exact transaction without exposing raw identifiers", () => {
  const input = exactTargetFixture();
  const bound = assertPendingRefundTarget(input);
  assert.equal(bound.transactionRef, input.receipt.transactionRef);
  assert.equal(bound.amountCents, 12500);
  assert.equal(JSON.stringify(bound).includes(input.target.id), false);
});

test("pending refund rejects other tenants, transactions, trades, orders and amounts", () => {
  for (const mismatch of [{ vendorId: "other" }, { id: "other" }, { orderNumber: "other" },
    { providerTradeNo: "other" }, { grossAmountCents: 100 }, { status: "refunded" }, { refundedAmountCents: 1 }]) {
    const input = exactTargetFixture();
    assert.throws(() => assertPendingRefundTarget({ ...input, target: { ...input.target, ...mismatch } }));
  }
});

test("pending refund rejects Production, live provider, another deployment and stale receipts", () => {
  for (const mismatch of [{ environment: "production" }, { payuniEnvironment: "live" },
    { providerHost: "api.payuni.com.tw" }, { appHost: "another.example.test" }, { sourceCommit: "unknown" }]) {
    const input = exactTargetFixture();
    assert.throws(() => assertPendingRefundTarget({ ...input, runtime: { ...input.runtime, ...mismatch } }));
  }
  const input = exactTargetFixture();
  assert.throws(() => assertPendingRefundTarget({ ...input, now: new Date("2026-08-01T00:00:00Z") }));
  assert.throws(() => assertPendingRefundTarget({ ...input, now: new Date("2026-07-29T00:00:00Z") }));
  assert.throws(() => assertPendingRefundTarget({ ...input, receipt: { ...input.receipt, checks: {} } }));
});

test("payment handoff retains only hashed identifiers and pending Chrome refund gates", () => {
  const receipt = createPendingRefundHandoff(fixture);
  assert.equal(receipt.status, "PENDING_REFUND");
  assert.equal(receipt.providerHost, "sandbox-api.payuni.com.tw");
  assert.equal(receipt.transactionRef, reference(fixture.checkout.transactionId));
  assert.equal(receipt.checks.sandboxRefundAccepted, "pending-chrome");
  assert.equal(JSON.stringify(receipt).includes(fixture.checkout.transactionId), false);
  assert.equal(JSON.stringify(receipt).includes(fixture.paid.TradeNo), false);
});

test("payment handoff rejects unpaid, inconsistent, or unsafe inputs", () => {
  assert.throws(() => createPendingRefundHandoff({ ...fixture, paid: { ...fixture.paid, TradeStatus: "0" } }), /已付款/);
  assert.throws(() => createPendingRefundHandoff({ ...fixture, paid: { ...fixture.paid, TradeAmt: 124 } }), /不一致/);
  assert.throws(() => createPendingRefundHandoff({ ...fixture, appUrl: "http://staging.example.test" }), /Staging host/);
});

test("payment handoff persists a closed receipt below the fixed report directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "payuni-handoff-"));
  const receipt = createPendingRefundHandoff(fixture);
  await writePaymentHandoff(receipt, root);
  const filename = `${receipt.completedAt.replace(/[-:.]/g, "").replace("Z", "Z")}-${receipt.transactionRef}.json`;
  const stored = await readFile(join(root, ".ai-team", "reports", "payuni-payment-handoff", filename), "utf8");
  assert.equal(stored.includes(fixture.checkout.transactionId), false);
  assert.deepEqual(JSON.parse(stored), receipt);
});
