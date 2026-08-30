import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
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
