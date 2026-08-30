import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  TARGET_KEYS,
  buildBrokerArgs,
  buildProviderTransaction,
  canonical,
  cleanupTemp,
  classifyChildEnvironment,
  classifyMarker,
  digest,
  initialReceipt,
  parseInspectJson,
  queryOfficialSandbox,
  querySyntheticCandidate,
  validateReceipt,
} from "./fin08-staging-payuni-reconciliation-runner.mjs";

const safeEnv = {
  STAGING_DATABASE_URL: ["postgres", "ql://"].join("") + "synthetic.projectref:masked@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
  PAYUNI_ENV: "sandbox",
  PAYUNI_MERCHANT_ID: "synthetic-merchant",
  PAYUNI_HASH_KEY: "x".repeat(32),
  PAYUNI_HASH_IV: "y".repeat(16),
  NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
  NEXT_PUBLIC_SUPABASE_URL: "https://projectref.supabase.co",
};

test("FIN-08 freshness accepts only named Preview READY metadata", () => {
  const ready = JSON.stringify({ name: "celebrate-deal-staging", target: "preview", readyState: "READY", id: "synthetic-deployment" });
  assert.equal(parseInspectJson(ready, 0).ok, true);
  assert.equal(parseInspectJson(ready.replace("preview", "production"), 0).ok, false);
  assert.equal(parseInspectJson(ready.replace("READY", "ERROR"), 0).ok, false);
  assert.equal(parseInspectJson("not-json", 0).ok, false);
});

test("FIN-08 marker gate requires accepted WP-187 source digest", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  assert.deepEqual(classifyMarker({ workPackage: "WP-187", sourceDigest: digest }, digest), {
    workPackageMatched: true,
    sourceDigestValid: true,
    sourceDigestMatched: true,
  });
  assert.equal(classifyMarker({ workPackage: "WP-196", sourceDigest: digest }, digest).workPackageMatched, false);
  assert.equal(classifyMarker({ workPackage: "WP-187", sourceDigest: "raw" }, digest).sourceDigestValid, false);
});

test("FIN-08 child environment reports presence and exact sandbox classification only", () => {
  const facts = classifyChildEnvironment(safeEnv);
  assert.equal(TARGET_KEYS.length, 7);
  assert.equal(facts.requiredPresent, true);
  assert.equal(facts.appHostMatched, true);
  assert.equal(facts.sandbox, true);
  assert.equal(facts.databaseIdentity, true);
  assert.equal(facts.supabaseIdentity, true);
  assert.equal(facts.production, false);
  assert.equal(classifyChildEnvironment({ ...safeEnv, PAYUNI_ENV: "production" }).sandbox, false);
  assert.equal(classifyChildEnvironment({ ...safeEnv, NEXT_PUBLIC_APP_URL: "https://production.example.test" }).appHostMatched, false);
});

test("FIN-08 receipt validator rejects values, URLs and non-idempotent replay", () => {
  const receipt = initialReceipt();
  receipt.processIsolation.targetKeyPresenceBefore = 0;
  receipt.processIsolation.targetKeyPresenceAfter = 0;
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(validateReceipt({ ...receipt, debugUrl: "https://sensitive.example.test" }).ok, false);
  assert.equal(validateReceipt({ ...receipt, replay: { ...receipt.replay, databaseWrites: 1 } }).ok, false);
  assert.equal(validateReceipt({ ...receipt, safety: { ...receipt.safety, rawValuesPersisted: true } }).ok, false);
});

test("FIN-08 pure serialization and broker argv remain deterministic and bounded", () => {
  const digestValue = digest("deployment", "synthetic-deployment");
  assert.match(digestValue, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(canonical({ z: 1, a: [true, null], nested: { b: 2, a: "x" } }), '{"a":[true,null],"nested":{"a":"x","b":2},"z":1}');
  assert.equal(canonical({ nested: { a: "x", b: 2 }, a: [true, null], z: 1 }), '{"a":[true,null],"nested":{"a":"x","b":2},"z":1}');

  const args = buildBrokerArgs(
    "C:\\synthetic\\node.exe",
    "C:\\synthetic\\tsx.mjs",
    "C:\\synthetic\\tsconfig.json",
    "C:\\synthetic\\runner.mjs",
    "C:\\synthetic\\child.mjs",
  );
  assert.deepEqual(args.slice(0, 7), ["env", "run", "-e", "preview", "--project", "celebrate-deal-staging", "--"]);
  assert.equal(args.at(-1), "preview");
  assert.throws(() => buildBrokerArgs("relative", "C:\\synthetic\\tsx.mjs", "C:\\synthetic\\tsconfig.json", "C:\\synthetic\\runner.mjs", "C:\\synthetic\\child.mjs"), /ABSOLUTE_PATH_REQUIRED/);
});

test("FIN-08 provider transaction projection is synthetic and exact", () => {
  const transaction = buildProviderTransaction({
    transaction_id: "synthetic-transaction",
    vendor_id: "synthetic-vendor",
    provider_name: "payuni",
    provider_trade_no: "synthetic-trade",
    order_number: "synthetic-order",
    gross_amount_cents: "1250",
    transaction_status: "partially_refunded",
    refunded_amount_cents: "250",
  });
  assert.deepEqual(transaction, {
    id: "synthetic-transaction",
    vendorId: "synthetic-vendor",
    providerName: "payuni",
    providerTradeNo: "synthetic-trade",
    orderNumber: "synthetic-order",
    paymentMode: "platform",
    grossAmountCents: 1250,
    gatewayFeeCents: 0,
    platformFeeCents: 0,
    netAmountCents: 1250,
    currency: "TWD",
    status: "partially_refunded",
    refundedAmountCents: 250,
    refundReason: null,
    refundedAt: null,
    occurredAt: new Date(0),
    metadata: { synthetic: true },
    createdAt: new Date(0),
  });
});

test("FIN-08 classifiers fail closed for missing identity and malformed values", () => {
  const digestValue = `sha256:${"a".repeat(64)}`;
  assert.equal(parseInspectJson(JSON.stringify({ name: "celebrate-deal-staging", target: "preview", readyState: "READY" }), 0).deploymentIdentityPresent, false);
  assert.equal(parseInspectJson(JSON.stringify({ name: "celebrate-deal-staging", target: "preview", readyState: "READY", uid: "synthetic-uid" }), 1).ok, false);
  assert.deepEqual(classifyMarker(null, digestValue), { workPackageMatched: false, sourceDigestValid: false, sourceDigestMatched: false });

  const malformed = classifyChildEnvironment({ ...safeEnv, STAGING_DATABASE_URL: "not-a-url" });
  assert.equal(malformed.requiredPresent, true);
  assert.equal(malformed.databaseIdentity, false);
  const malformedSupabase = classifyChildEnvironment({ ...safeEnv, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" });
  assert.equal(malformedSupabase.supabaseIdentity, false);
});

test("FIN-08 receipt validation records all forbidden outcome families", () => {
  const receipt = initialReceipt();
  receipt.processIsolation.targetKeyPresenceBefore = 0;
  receipt.processIsolation.targetKeyPresenceAfter = 0;
  const cases = [
    { ...receipt, schemaVersion: "wrong-schema" },
    { ...receipt, sideEffects: { ...receipt.sideEffects, providerQueries: 2 } },
    { ...receipt, sideEffects: { ...receipt.sideEffects, payments: 1 } },
    { ...receipt, replay: { ...receipt.replay, auditWrites: 1 } },
    { ...receipt, scoreImpact: { ...receipt.scoreImpact, applied: true } },
    { ...receipt, candidate: { ...receipt.candidate, referenceDigest: "https://forbidden.example" } },
  ];
  for (const candidate of cases) assert.equal(validateReceipt(candidate).ok, false);
});

test("FIN-08 classification helpers reject every unsafe identity boundary", () => {
  const digestValue = `sha256:${"a".repeat(64)}`;
  assert.equal(classifyMarker({ workPackage: "WP-187", sourceDigest: digestValue }, `sha256:${"b".repeat(64)}`).sourceDigestMatched, false);
  assert.equal(classifyMarker({ workPackage: "WP-187" }, digestValue).sourceDigestValid, false);
  assert.equal(parseInspectJson(JSON.stringify({ name: "celebrate-deal-staging", target: "preview", status: "READY", uid: "synthetic-uid" }), 0).ok, true);
  assert.equal(parseInspectJson(JSON.stringify({ name: "celebrate-deal-staging", target: "preview", state: "READY", id: "synthetic-id" }), 0).ok, true);
  assert.equal(parseInspectJson(JSON.stringify({ name: "celebrate-deal-staging", target: "preview", readyState: "READY", id: "synthetic-id" }), 1).ok, false);
  assert.equal(parseInspectJson(JSON.stringify([]), 0).deploymentIdentityPresent, false);
  assert.equal(classifyChildEnvironment({}).requiredPresent, false);
  assert.equal(classifyChildEnvironment({ ...safeEnv, NEXT_PUBLIC_APP_URL: "https://user:pass@celebrate-deal-staging.carry-digital-nomad.in.net" }).appHostMatched, false);
  assert.equal(classifyChildEnvironment({ ...safeEnv, NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net:8443" }).appHostMatched, false);
  assert.equal(classifyChildEnvironment({ ...safeEnv, STAGING_DATABASE_URL: "postgresql://synthetic@db.projectref.supabase.co/postgres" }).databaseIdentity, true);
  assert.equal(classifyChildEnvironment({ ...safeEnv, STAGING_DATABASE_URL: "postgresql://synthetic.projectref@aws-0-us-east-1.pooler.supabase.com:6543/postgres" }).databaseIdentity, true);
});

test("FIN-08 receipt validator rejects shape, budget, side-effect and score drift", () => {
  const base = initialReceipt();
  base.processIsolation.targetKeyPresenceBefore = 0;
  base.processIsolation.targetKeyPresenceAfter = 0;
  const mutations = [
    (receipt) => { receipt.sideEffects.databaseConnections = 3; },
    (receipt) => { receipt.sideEffects.providerQueries = 2; },
    (receipt) => { receipt.sideEffects.payments = 1; },
    (receipt) => { receipt.sideEffects.deployments = 1; },
    (receipt) => { receipt.scoreImpact.applied = true; },
    (receipt) => { receipt.replay.providerQueries = 1; },
    (receipt) => { receipt.safety.environmentFileRead = true; },
    (receipt) => { receipt.processIsolation.valuesRead = true; },
    (receipt) => { receipt.provider = { orderNumber: "https://sensitive.example" }; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(base);
    mutate(candidate);
    assert.equal(validateReceipt(candidate).ok, false);
  }
});

test("FIN-08 provider sandbox adapter enforces HTTPS allowlist, redirect and attempt budgets", async () => {
  const row = {
    transaction_id: "synthetic-transaction",
    vendor_id: "synthetic-vendor",
    provider_name: "payuni",
    provider_trade_no: "synthetic-trade",
    order_number: "synthetic-order",
    gross_amount_cents: "1250",
    transaction_status: "partially_refunded",
    refunded_amount_cents: "250",
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ status: 200 });
    assert.deepEqual(await queryOfficialSandbox(row, { queryPayment: async () => { await fetch("https://sandbox-api.payuni.com.tw/api/trade/query"); return { status: "refunded" }; } }), { result: { status: "refunded" }, attempts: 1, redirects: 0 });
    await assert.rejects(() => queryOfficialSandbox(row, { queryPayment: async () => { await fetch("https://evil.example/api/trade/query"); } }), /PAYUNI_SANDBOX_ALLOWLIST_REJECTED/u);
    globalThis.fetch = async () => ({ status: 302 });
    await assert.rejects(() => queryOfficialSandbox(row, { queryPayment: async () => { await fetch("https://sandbox-api.payuni.com.tw/api/trade/query"); } }), /PAYUNI_REDIRECT_REJECTED/u);
    globalThis.fetch = async () => ({ status: 200 });
    await assert.rejects(() => queryOfficialSandbox(row, { queryPayment: async () => { await fetch("https://sandbox-api.payuni.com.tw/api/trade/query"); await fetch("https://sandbox-api.payuni.com.tw/api/trade/query"); } }), /PAYUNI_QUERY_ATTEMPT_BUDGET_EXCEEDED/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("FIN-08 cleanup and child environment gate remain local and sanitized", async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-fin08-test-"));
  assert.equal((await cleanupTemp(temp)).pass, true);
  assert.equal((await cleanupTemp(temp)).pass, true);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", "import { childRun } from './scripts/fin08-staging-payuni-reconciliation-runner.mjs'; await childRun(process.cwd());"], { cwd: process.cwd(), env: { Path: process.env.Path, SystemRoot: process.env.SystemRoot }, encoding: "utf8", shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 4096 });
  assert.equal(child.status, 2);
  assert.match(String(child.stdout), /FIN08_CHILD_RESULT:/u);
  assert.doesNotMatch(`${String(child.stdout)}${String(child.stderr)}`, /synthetic|postgres(?:ql)?:\/\/|Bearer\s+/iu);
});

test("FIN-08 candidate query is one read-only bounded transaction with sanitized projection", async () => {
  const statements = [];
  const fakeDb = {
    $transaction: async (callback) => callback({
      $executeRawUnsafe: async (statement) => { statements.push(String(statement)); },
      $queryRaw: async () => [{ transaction_read_only: "on", database_identity: "synthetic-database" }],
    }),
  };
  const result = await querySyntheticCandidate(fakeDb);
  assert.deepEqual(result.rows, [{ transaction_read_only: "on", database_identity: "synthetic-database" }]);
  assert.equal(result.transactionReadOnly, "on");
  assert.equal(result.databaseIdentity, "synthetic-database");
  assert.deepEqual(statements, ["SET TRANSACTION READ ONLY"]);
  const empty = await querySyntheticCandidate({
    $transaction: async (callback) => callback({
      $executeRawUnsafe: async () => {},
      $queryRaw: async () => [],
    }),
  });
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.transactionReadOnly, "");
  assert.equal(empty.databaseIdentity, "");
});
