import test from "node:test";
import assert from "node:assert/strict";
import { runIssuedRecoveryProbe, runIssuedRecoveryQa, verifyIssuedRecoveryProofSource, persistIssuedRecoveryPending } from "./payuni-issued-recovery-runner.mjs";
import { mkdtemp, readFile, writeFile, mkdir, rename, unlink, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { reference } from "./payuni-sandbox-payment-handoff.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("interrupted pending write preserves the previous conservative receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "issued-recovery-receipt-"));
  const previous = { transactionRef: "a".repeat(64), refundSubmissionMayHaveOccurred: true };
  try {
    await persistIssuedRecoveryPending(directory, previous);
    await assert.rejects(persistIssuedRecoveryPending(directory, { status: "CLEANUP_VERIFIED" }, {
      mkdir, rename, unlink,
      writeFile: async (path, contents, options) => {
        await writeFile(path, contents.slice(0, 8), options);
        throw new Error("synthetic disk write failure");
      },
    }), /synthetic disk write failure/);
    assert.deepEqual(JSON.parse(await readFile(join(directory, "pending.json"), "utf8")), previous);
    assert.deepEqual(await readdir(directory), ["pending.json"]);
    const next = { ...previous, status: "CLEANUP_VERIFIED" };
    await persistIssuedRecoveryPending(directory, next);
    assert.deepEqual(JSON.parse(await readFile(join(directory, "pending.json"), "utf8")), next);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const input = { sourceSha: "a".repeat(40), previewHost: "synthetic-preview.vercel.app", payuniEnv: "sandbox",
  jobSecret: "synthetic-job", cardNumber: "4147631000000001", cardExpiry: "1230", cardCvv: "123" };
function fixture({ preflight = true } = {}) {
  const calls = [];
  const dependencies = {
    queryProvider: async () => { throw new Error("should only be used by browser observer"); },
    request: async operation => {
      calls.push(operation);
      const path = new URL(operation.url).pathname;
      if (path.endsWith("/wp4-preflight")) return { status: preflight ? 200 : 404, body: { ready: preflight, buyerOrder: preflight } };
      if (path.endsWith("/wp4-fixture")) return { status: 200, body: { ready: true, createdCount: 6, reusedCount: 0 } };
      if (path.endsWith("/checkout/admission")) return { status: 200, body: {
        admissionToken: `ca1.${"a".repeat(64)}.${"b".repeat(43)}`, idempotencyKey: "11111111-1111-4111-8111-111111111111", expiresAt: "2030-01-01T00:00:00.000Z" },
      sessionCookie: "celebratedeal_checkout_session=synthetic" };
      if (path === "/api/payments/checkout") return { status: 200, body: { ok: true, provider: "payuni", orderNumber: "synthetic_order",
        transactionId: "synthetic_transaction", amountCents: 100, currency: "TWD", checkoutUrl: null,
        formAction: "https://sandbox-api.payuni.com.tw/api/upp", formMethod: "POST",
        formPayload: { MerID: "synthetic", Version: "2.0", EncryptInfo: "synthetic", HashInfo: "synthetic" },
        nextAction: "submit_payuni_upp_form", externalRequired: false }, supportCookie: "celebrate_support_synthetic=synthetic" };
      if (path.endsWith("/wp4-payment-attempt")) return { status: 200, body: { status: "SUBMIT_ALLOWED", reservationCreated: true } };
      throw new Error("unexpected path");
    },
    observeBrowser: async value => {
      assert.equal(value.prepared.canonicalStagingOrigin, true);
      assert.equal(value.prepared.invocation.payuniEnv, "sandbox");
      return { result: "ORIGINAL_PAGE_RETRY_UNAVAILABLE" };
    },
  };
  return { calls, dependencies };
}
test("source-bound Sandbox runtime rejection precedes all fixture and checkout writes", async () => {
  const f = fixture({ preflight: false });
  await assert.rejects(runIssuedRecoveryProbe(input, f.dependencies), /RUNNER_REJECTED/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].headers["x-celebratedeal-source-sha"], input.sourceSha);
});
test("prepares one fixed canonical staging checkout without selecting another order", async () => {
  const f = fixture();
  assert.equal((await runIssuedRecoveryProbe(input, f.dependencies)).result, "ORIGINAL_PAGE_RETRY_UNAVAILABLE");
  assert.equal(f.calls.length, 5);
  for (const operation of f.calls) {
    assert.equal(new URL(operation.url).origin, "https://celebrate-deal-staging.carry-digital-nomad.in.net");
    if (operation.headers.origin) assert.equal(operation.headers.origin, "https://celebrate-deal-staging.carry-digital-nomad.in.net");
  }
  assert.equal(f.calls.filter(call => new URL(call.url).pathname === "/api/payments/checkout").length, 1);
});
test("Production input never accesses the application or provider", async () => {
  const f = fixture();
  await assert.rejects(runIssuedRecoveryProbe({ ...input, payuniEnv: "production" }, f.dependencies), /RUNNER_REJECTED/);
  assert.equal(f.calls.length, 0);
});

function cleanupFixture() {
  const f = fixture();
  const history = [];
  const pending = [];
  const trade = "synthetic_trade";
  const refs = { transactionRef: reference("synthetic_transaction"), orderRef: reference("synthetic_order"), tradeRef: reference(trade) };
  const checks = Object.fromEntries(["sandboxRefundAccepted", "refundVisibleInProviderQuery", "refundIdempotency",
    "paymentTransactionRefunded", "refundRecordProcessed", "singleRefundRecord"].map(key => [key, "passed"]));
  Object.assign(f.dependencies, {
    context: {}, verifyFinanceSession: async () => { history.push("finance"); return true; },
    verifyRefundCapability: async sourceSha => { assert.equal(sourceSha, input.sourceSha); history.push("capability"); return true; },
    persistPending: async record => pending.push(structuredClone(record)),
    now: () => new Date("2026-10-09T00:00:00Z"),
    observeBrowser: async () => { history.push("observe"); return { result: "SAME_TRADE_PAYMENT_OBSERVED", sameTrade: true,
      paid: true, tradeRef: `sha256:${createHash("sha256").update(trade).digest("hex")}` }; },
    queryProvider: async order => { assert.equal(order, "synthetic_order"); history.push("query");
      return { MerTradeNo: order, TradeNo: trade, TradeStatus: "1", TradeAmt: "1", PaymentType: "1" }; },
    loadProof: async (transactionId, sourceSha) => {
      assert.equal(transactionId, "synthetic_transaction"); assert.equal(sourceSha, input.sourceSha); history.push("proof");
      return { schemaVersion: "celebratedeal-payuni-pending-refund-proof/v1", environment: "preview", payuniEnvironment: "sandbox",
        appHost: "celebrate-deal-staging.carry-digital-nomad.in.net", providerHost: "sandbox-api.payuni.com.tw",
        sourceCommit: input.sourceSha, paymentCallbackMatched: true, databaseBound: true, nonProductionScope: "fixed-staging-project",
        grossAmountCents: 100, ...refs, status: "paid", refundRecordCount: 0, refundedAmountCents: 0 };
    },
    writeHandoff: async receipt => { history.push("handoff"); assert.equal(receipt.tradeRef, refs.tradeRef); },
    consumeRefund: async operation => { history.push("refund"); assert.equal(operation.transactionId, "synthetic_transaction");
      assert.equal(operation.expectedSourceSha, input.sourceSha);
      return { status: "COMPLETED", ...refs, sourceCommit: input.sourceSha, checks }; },
  });
  return { ...f, history, pending };
}
test("finance readiness rejection precedes all application and provider writes", async () => {
  const f = cleanupFixture(); f.dependencies.verifyFinanceSession = async () => false;
  await assert.rejects(runIssuedRecoveryQa(input, f.dependencies), /RUNNER_REJECTED/);
  assert.equal(f.calls.length, 0); assert.deepEqual(f.history, ["capability"]);
});
test("a paid original trade is handed to exact application refund and proof only", async () => {
  const f = cleanupFixture();
  assert.equal((await runIssuedRecoveryQa(input, f.dependencies)).refundCleanupVerified, true);
  assert.deepEqual(f.history, ["capability", "finance", "observe", "query", "proof", "handoff", "refund"]);
  assert.equal(f.calls.filter(call => new URL(call.url).pathname === "/api/payments/checkout").length, 1);
});
test("unavailable original retry cannot be relabeled as paid or cleaned up", async () => {
  const f = cleanupFixture(); f.dependencies.observeBrowser = async () => ({ result: "ORIGINAL_PAGE_RETRY_UNAVAILABLE" });
  assert.equal((await runIssuedRecoveryQa(input, f.dependencies)).refundCleanupVerified, false);
  assert.deepEqual(f.history, ["capability", "finance"]);
});
test("changed provider trade cannot become the refund target", async () => {
  const f = cleanupFixture(); const query = f.dependencies.queryProvider;
  f.dependencies.queryProvider = async order => ({ ...await query(order), TradeNo: "replacement_trade" });
  await assert.rejects(runIssuedRecoveryQa(input, f.dependencies), /RUNNER_REJECTED/);
  assert.deepEqual(f.history, ["capability", "finance", "observe", "query"]);
});
test("unmapped callback cannot produce a successful handoff or refund", async () => {
  const f = cleanupFixture(); const proof = f.dependencies.loadProof;
  f.dependencies.loadProof = async (...args) => ({ ...await proof(...args), paymentCallbackMatched: false });
  await assert.rejects(runIssuedRecoveryQa(input, f.dependencies));
  assert.equal(f.history.includes("handoff"), false); assert.equal(f.history.includes("refund"), false);
});
test("incomplete cleanup evidence never marks refund cleanup verified", async () => {
  const f = cleanupFixture(); const consume = f.dependencies.consumeRefund;
  f.dependencies.consumeRefund = async operation => ({ ...await consume(operation), checks: {} });
  await assert.rejects(runIssuedRecoveryQa(input, f.dependencies), /RUNNER_REJECTED/);
});

test("missing exact-source proof capability rejects before finance, checkout or card submission", async () => {
  const f = cleanupFixture(); f.dependencies.verifyRefundCapability = async () => false;
  await assert.rejects(runIssuedRecoveryQa(input, f.dependencies), /RUNNER_REJECTED/);
  assert.equal(f.calls.length, 0); assert.deepEqual(f.history, []); assert.deepEqual(f.pending, []);
});
test("failure to persist the prepared target prevents all card submission", async () => {
  const f = cleanupFixture(); f.dependencies.persistPending = async () => { throw new Error("synthetic persistence failure"); };
  await assert.rejects(runIssuedRecoveryQa(input, f.dependencies));
  assert.equal(f.history.includes("observe"), false); assert.equal(f.history.includes("refund"), false);
});
for (const [stage, submitted] of [["refund-ui-preparation", false], ["refund-submit-pending-confirmation", true]]) {
  test(`cleanup failure at ${stage} retains the exact sanitized pending target`, async () => {
    const f = cleanupFixture();
    f.dependencies.consumeRefund = async operation => {
      await operation.onStage({ stage, refundSubmissionMayHaveOccurred: submitted });
      throw new Error("synthetic cleanup failure");
    };
    await assert.rejects(runIssuedRecoveryQa(input, f.dependencies));
    const pending = f.pending.at(-1);
    assert.equal(pending.stage, stage); assert.equal(pending.refundSubmissionMayHaveOccurred, submitted);
    assert.equal(pending.status, "PENDING_REFUND"); assert.equal(pending.sourceCommit, input.sourceSha);
    assert.equal(pending.transactionRef, reference("synthetic_transaction"));
    assert.equal(pending.tradeRef, reference("synthetic_trade"));
    for (const raw of ["synthetic_transaction", "synthetic_order", "synthetic_trade", "synthetic-job", "4147631000000001"])
      assert.equal(JSON.stringify(pending).includes(raw), false);
    assert.equal(f.history.filter(value => value === "observe").length, 1);
  });
}
test("a paid original trade remains durable when its first application proof fails", async () => {
  const f = cleanupFixture(); f.dependencies.loadProof = async () => { throw new Error("synthetic proof failure"); };
  await assert.rejects(runIssuedRecoveryQa(input, f.dependencies));
  assert.equal(f.pending.at(-1).stage, "paid-original-trade-proof");
  assert.equal(f.pending.at(-1).providerPaid, true);
  assert.equal(f.pending.at(-1).applicationCallbackVerified, false);
  assert.equal(f.pending.at(-1).refundSubmissionMayHaveOccurred, false);
});

test("proof source capability requires both exact reviewed route and service blobs", async () => {
  const calls = [];
  const shas = ["5b90f3d557cb3f1fbee0d1af9b20189df9acc8cf", "3cb7b6541551df4f4565f7e0f89ec84d6126f535"];
  assert.equal(await verifyIssuedRecoveryProofSource({ sourceSha: input.sourceSha, token: "synthetic-github" }, async url => {
    calls.push(url); assert.equal(url.searchParams.get("ref"), input.sourceSha);
    return new Response(JSON.stringify({ type: "file", path: url.pathname.split("/contents/")[1], sha: shas[calls.length - 1] }));
  }), true);
  assert.equal(calls.length, 2);
});
for (const outcome of ["missing", "changed-sha", "wrong-path", "oversized"]) {
  test(`proof capability rejects ${outcome} without accepting a different source`, async () => {
    const passed = await verifyIssuedRecoveryProofSource({ sourceSha: input.sourceSha, token: "synthetic-github" }, async url => {
      if (outcome === "missing") return new Response("{}", { status: 404 });
      if (outcome === "oversized") return new Response("x".repeat(65537));
      return new Response(JSON.stringify({ type: "file", path: outcome === "wrong-path" ? "unrelated.ts" : url.pathname.split("/contents/")[1],
        sha: outcome === "changed-sha" ? "b".repeat(40) : "5b90f3d557cb3f1fbee0d1af9b20189df9acc8cf" }));
    });
    assert.equal(passed, false);
  });
}

for (const [mode, email] of [["production", "q1-synthetic-finance-v1@invalid.example"], ["sandbox", "unrelated-synthetic@invalid.example"]]) {
  test(`real CLI rejects ${mode} / ${email} before any network or browser`, () => {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("./payuni-issued-recovery-runner.mjs", import.meta.url))], {
      encoding: "utf8", timeout: 30000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/master", GITHUB_REF_PROTECTED: "true",
        PAYUNI_ENV: mode, PAYUNI_SANDBOX_QA_ENABLED: "true", PAYUNI_SANDBOX_REFUND_ENABLED: "true", PAYUNI_QA_FINANCE_EMAIL: email },
    });
    assert.equal(child.status, 1);
    assert.deepEqual(JSON.parse(child.stdout.trim()), { schemaVersion: "celebratedeal-payuni-issued-recovery-observation/v1",
      status: "BLOCKED_OR_FAILED", stage: "configuration", productionOperations: false, applicationRecoveryAccepted: false });
    assert.equal(child.stdout.includes(email), false);
  });
}
