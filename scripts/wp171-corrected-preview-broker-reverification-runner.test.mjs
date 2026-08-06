import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  CONTRACT,
  buildLocalChildArgs,
  initialReceipt,
  mapChildStatus,
  validateReceipt,
} from "./wp171-corrected-preview-broker-reverification-runner.mjs";
import {
  buildBrokerArgs,
  parseBrokerOutput,
  parseFreshness,
  runReconciliation,
} from "./wp170-staging-payuni-readonly-reconciliation-runner.mjs";

const absolute = process.platform === "win32" ? "C:\\safe" : "/safe";

test("local child command requires absolute TSX CLI, tsconfig and runner paths", () => {
  const args = buildLocalChildArgs(
    path.join(absolute, "node.exe"),
    path.join(absolute, "tsx", "cli.mjs"),
    path.join(absolute, "tsconfig.json"),
    path.join(absolute, "wp170.mjs"),
    path.join(absolute, "temp"),
  );
  assert.deepEqual(args.slice(1, 4), ["--tsconfig", path.join(absolute, "tsconfig.json"), path.join(absolute, "wp170.mjs")]);
  assert.throws(() => buildLocalChildArgs("node", "tsx", "tsconfig.json", "runner", "temp"), /ABSOLUTE_PATH_REQUIRED/u);
  assert.equal(args.includes("npx"), false);
});

test("external broker command preserves absolute TSX CLI plus project tsconfig", () => {
  const args = buildBrokerArgs(
    path.join(absolute, "node.exe"),
    path.join(absolute, "tsx", "cli.mjs"),
    path.join(absolute, "tsconfig.json"),
    CONTRACT.wp170Runner,
    path.join(absolute, "temp"),
  );
  assert.equal(args.includes("--tsconfig"), true);
  assert.equal(args.includes(path.join(absolute, "tsconfig.json")), true);
  assert.equal(args.includes("npx"), false);
});

test("freshness accepts only the exact WP-167 Ready Preview deployment", () => {
  const ok = parseFreshness(`id ${CONTRACT.expectedDeployment}\nname ${CONTRACT.project}\ntarget preview\nstatus ● Ready`, 0);
  assert.equal(ok.ok, true);
  assert.equal(parseFreshness(`id dpl_stale\nname ${CONTRACT.project}\ntarget preview\nstatus ● Ready`, 0).ok, false);
  assert.equal(parseFreshness(`id ${CONTRACT.expectedDeployment}\nname ${CONTRACT.project}\ntarget production\nstatus ● Ready`, 0).ok, false);
});

test("child statuses map to WP-171 without accepting unknown values", () => {
  assert.equal(mapChildStatus("WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED"), "WP171_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED");
  assert.equal(mapChildStatus("WP170_CANDIDATE_EXACT_NO_GO_ZERO"), "WP171_CANDIDATE_EXACT_NO_GO_ZERO");
  assert.equal(mapChildStatus("UNKNOWN"), "WP171_BROKER_EXACT_NO_GO");
});

test("zero and ambiguous candidates keep PayUni calls at zero", async () => {
  for (const candidates of [[], [{}, {}]]) {
    let providerCalls = 0;
    const receipt = await runReconciliation({
      env: safeEnvironment(),
      queryDatabase: async () => ({ databaseIdentity: "staging", transactionReadOnly: "on", candidates, disconnected: true }),
      queryProvider: async () => { providerCalls += 1; },
    });
    assert.equal(providerCalls, 0);
    assert.equal(receipt.payuni.queryAttempts, 0);
  }
});

test("provider-ahead result remains divergence and never becomes consistency", async () => {
  const row = candidate();
  const receipt = await runReconciliation({
    env: safeEnvironment(),
    queryDatabase: async () => ({ databaseIdentity: "staging", transactionReadOnly: "on", candidates: [row], disconnected: true }),
    queryProvider: async () => ({
      officialSandbox: true,
      status: "refunded",
      providerTradeNo: row.provider_trade_no,
      orderNumber: row.order_number,
      grossAmountCents: row.gross_amount_cents,
      refundedAmountCents: row.gross_amount_cents,
      remainingRefundableAmountCents: 0,
    }),
  });
  assert.equal(receipt.status, "WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED");
  assert.equal(receipt.reconciliation.classification, "PROVIDER_AHEAD_MISSING_CALLBACK_CANDIDATE");
});

test("broker parser rejects autoload, assignments and duplicate child records", () => {
  assert.equal(parseBrokerOutput("", "Loaded env from .env.local", 2).ok, false);
  assert.equal(parseBrokerOutput("PAYUNI_HASH_KEY=value", "", 2).ok, false);
  assert.equal(parseBrokerOutput("WP170_CHILD_RESULT:{}\nWP170_CHILD_RESULT:{}", "", 2).ok, false);
});

test("receipt denies package, retry, write and sensitive persistence", () => {
  const clean = initialReceipt();
  assert.equal(validateReceipt(clean).ok, true);
  const packageAttempt = structuredClone(clean);
  packageAttempt.startupPreflight.npxUsed = true;
  assert.equal(validateReceipt(packageAttempt).ok, false);
  const retry = structuredClone(clean);
  retry.broker.retries = 1;
  assert.equal(validateReceipt(retry).ok, false);
  const write = structuredClone(clean);
  write.sideEffects.databaseWrites = 1;
  assert.equal(validateReceipt(write).ok, false);
  const raw = structuredClone(clean);
  raw.safety.rawDatabaseRowsPersisted = true;
  assert.equal(validateReceipt(raw).ok, false);
});

test("receipt rejects URLs and raw identifier field names", () => {
  const withUrl = { ...initialReceipt(), note: "https://example.invalid" };
  assert.equal(validateReceipt(withUrl).ok, false);
  const withIdentifier = { ...initialReceipt(), orderNumber: "synthetic" };
  assert.equal(validateReceipt(withIdentifier).ok, false);
});

test("successful status requires startup, freshness, DB and provider gates", () => {
  const receipt = initialReceipt();
  receipt.status = "WP171_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED";
  assert.equal(validateReceipt(receipt).ok, false);
});

function safeEnvironment() {
  return {
    STAGING_DATABASE_URL: "postgresql://synthetic:synthetic@db.safeproject.supabase.co/staging",
    PAYUNI_ENV: "sandbox",
    PAYUNI_MERCHANT_ID: "synthetic",
    PAYUNI_HASH_KEY: "synthetic",
    PAYUNI_HASH_IV: "synthetic",
    NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
    NEXT_PUBLIC_SUPABASE_URL: "https://safeproject.supabase.co",
  };
}

function candidate() {
  return {
    reservation_status: "reserved",
    transaction_status: "pending",
    synthetic: true,
    provider_name: "payuni",
    provider_trade_no: "sandbox_ref_123456",
    order_number: "cd_sandbox_wp171_123456",
    currency: "TWD",
    gross_amount_cents: 168000,
  };
}
