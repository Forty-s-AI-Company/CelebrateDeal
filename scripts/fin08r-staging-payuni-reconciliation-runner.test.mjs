import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  TARGET_KEYS,
  buildSterileEnv,
  buildBrokerArgs,
  canonical,
  classifyEnvironment,
  classifyMarker,
  cleanupTemp,
  digest,
  initialReceipt,
  inspectTemp,
  parseInspectJson,
  providerTransaction,
  queryCandidate,
  queryProvider,
  validateReceipt,
} from "./fin08r-staging-payuni-reconciliation-runner.mjs";

const env = {
  DATABASE_URL: "postgresql://synthetic@db.projectref.supabase.co:5432/postgres",
  DIRECT_URL: "postgresql://synthetic@db.projectref.supabase.co:5432/postgres",
  STAGING_DATABASE_URL: "postgresql://synthetic@db.projectref.supabase.co:5432/postgres",
  PAYUNI_ENV: "sandbox",
  PAYUNI_MERCHANT_ID: "synthetic-merchant",
  PAYUNI_HASH_KEY: "x".repeat(32),
  PAYUNI_HASH_IV: "y".repeat(16),
  NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
  NEXT_PUBLIC_SUPABASE_URL: "https://projectref.supabase.co",
};

test("FIN-08R accepts only READY Preview identity", () => {
  const ready = JSON.stringify({ name: "celebrate-deal-staging", target: "preview", readyState: "READY", id: "synthetic-deployment" });
  assert.equal(parseInspectJson(ready, 0).ok, true);
  assert.equal(parseInspectJson(ready.replace("preview", "production"), 0).ok, false);
  assert.equal(parseInspectJson(ready.replace("READY", "ERROR"), 0).ok, false);
  assert.equal(parseInspectJson("not-json", 0).ok, false);
});

test("FIN-08R requires WP-187 marker and exact digest", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  assert.deepEqual(classifyMarker({ workPackage: "WP-187", sourceDigest: digest }, digest), { workPackageMatched: true, sourceDigestValid: true, sourceDigestMatched: true });
  assert.equal(classifyMarker({ workPackage: "WP-196", sourceDigest: digest }, digest).workPackageMatched, false);
  assert.equal(classifyMarker({ workPackage: "WP-187", sourceDigest: "raw" }, digest).sourceDigestValid, false);
});

test("FIN-08R classifies all nine bindings without exposing values", () => {
  const facts = classifyEnvironment(env);
  assert.equal(TARGET_KEYS.length, 9);
  assert.equal(facts.requiredPresent, true);
  assert.equal(facts.appHostMatched, true);
  assert.equal(facts.sandbox, true);
  assert.equal(facts.databaseIdentity, true);
  assert.equal(facts.supabaseIdentity, true);
  assert.equal(facts.production, false);
  assert.equal(classifyEnvironment({ ...env, DIRECT_URL: "postgresql://other@other.example.test/db" }).databaseIdentity, false);
  assert.equal(classifyEnvironment({ ...env, PAYUNI_ENV: "production" }).sandbox, false);
});

test("FIN-08R reserves once and rejects unsafe receipt states", () => {
  const receipt = initialReceipt();
  receipt.processIsolation.targetKeyPresenceBefore = 0;
  receipt.processIsolation.targetKeyPresenceAfter = 0;
  assert.equal(receipt.status, "FIN08R_ATTEMPT_RESERVED");
  assert.equal(validateReceipt(receipt).ok, false);
  assert.equal(validateReceipt({ ...receipt, status: "FIN08R_SANDBOX_RECONCILIATION_VERIFIED" }).ok, true);
  assert.equal(validateReceipt({ ...receipt, status: "FIN08R_SANDBOX_RECONCILIATION_VERIFIED", debugUrl: "https://sensitive.example.test" }).ok, false);
  assert.equal(validateReceipt({ ...receipt, status: "FIN08R_SANDBOX_RECONCILIATION_VERIFIED", replay: { providerQueries: 1, databaseWrites: 0, auditWrites: 0 } }).ok, false);
});

test("FIN-08R broker command requires absolute paths", () => {
  assert.throws(() => buildBrokerArgs("node", "tsx", "tsconfig", "runner", "temp"), /ABSOLUTE_PATH_REQUIRED/u);
  const args = buildBrokerArgs("C:\\node.exe", "C:\\tsx.mjs", "C:\\tsconfig.json", "C:\\runner.mjs", "C:\\temp");
  assert.deepEqual(args.slice(0, 7), ["env", "run", "-e", "preview", "--project", "celebrate-deal-staging", "--"]);
});

test("FIN-08R canonical and digest helpers remain deterministic", () => {
  const value = { z: 1, nested: { b: 2, a: [true, null] }, a: "x" };
  assert.equal(canonical(value), '{"a":"x","nested":{"a":[true,null],"b":2},"z":1}');
  assert.equal(canonical({ a: "x", nested: { a: [true, null], b: 2 }, z: 1 }), canonical(value));
  assert.match(digest("receipt", canonical(value)), /^sha256:[a-f0-9]{64}$/u);
});

test("FIN-08R inspect and marker parsers reject malformed identity and digest families", () => {
  const readyByUid = JSON.stringify({ name: "celebrate-deal-staging", target: "preview", state: "READY", uid: "synthetic-uid" });
  assert.equal(parseInspectJson(readyByUid, 0).ok, true);
  assert.equal(parseInspectJson(JSON.stringify({ name: "celebrate-deal-staging", target: "preview", status: "READY" }), 0).deploymentIdentityPresent, false);
  assert.equal(parseInspectJson(readyByUid, 1).ok, false);
  assert.equal(parseInspectJson(JSON.stringify({ name: "other", target: "preview", readyState: "READY", id: "synthetic-id" }), 0).projectMatched, false);

  const expected = `sha256:${"a".repeat(64)}`;
  assert.deepEqual(classifyMarker({ workPackage: "WP-187", sourceDigest: expected }, expected), { workPackageMatched: true, sourceDigestValid: true, sourceDigestMatched: true });
  assert.equal(classifyMarker({ workPackage: "WP-187", sourceDigest: `sha256:${"b".repeat(64)}` }, expected).sourceDigestMatched, false);
  assert.equal(classifyMarker({ workPackage: "WP-187", sourceDigest: "sha256:bad" }, expected).sourceDigestValid, false);
  assert.equal(classifyMarker(null, expected).workPackageMatched, false);
});

test("FIN-08R environment classification fails closed for malformed and production identities", () => {
  const cases = [
    { ...env, NEXT_PUBLIC_APP_URL: "https://user:pass@celebrate-deal-staging.carry-digital-nomad.in.net" },
    { ...env, STAGING_DATABASE_URL: "mysql://synthetic@db.projectref.supabase.co/db" },
    { ...env, DATABASE_URL: "postgresql://synthetic@other.example.test/db" },
    { ...env, NEXT_PUBLIC_SUPABASE_URL: "https://not-supabase.example" },
    { ...env, NEXT_PUBLIC_APP_URL: "not-a-url" },
    { ...env, PAYUNI_ENV: "production" },
    {},
  ];
  const facts = cases.map((candidateEnv) => classifyEnvironment(candidateEnv));
  assert.equal(facts[0].appHostMatched, false);
  assert.equal(facts[1].databaseIdentity, false);
  assert.equal(facts[2].databaseIdentity, false);
  assert.equal(facts[3].supabaseIdentity, false);
  assert.equal(facts[4].appHostMatched, false);
  assert.equal(facts[5].production, true);
  assert.equal(facts[6].requiredPresent, false);
  assert.equal(facts[6].databaseIdentity, false);
});

test("FIN-08R receipt safety rejects every forbidden outcome family without score overclaim", () => {
  const base = { ...initialReceipt(), status: "FIN08R_TERMINAL_NO_GO_CANDIDATE" };
  base.processIsolation.targetKeyPresenceBefore = 0;
  base.processIsolation.targetKeyPresenceAfter = 0;
  assert.equal(validateReceipt(base).ok, true);
  const mutations = [
    (receipt) => { receipt.safety.environmentFileRead = true; },
    (receipt) => { receipt.safety.rawValuesPersisted = true; },
    (receipt) => { receipt.processIsolation.valuesRead = true; },
    (receipt) => { receipt.processIsolation.targetKeyPresenceAfter = 1; },
    (receipt) => { receipt.scoreImpact.applied = true; },
    (receipt) => { receipt.sideEffects.providerQueries = 2; },
    (receipt) => { receipt.sideEffects.refunds = 1; },
    (receipt) => { receipt.replay.auditWrites = 1; },
    (receipt) => { receipt.provider = { rawResponse: "https://forbidden.example" }; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(base);
    mutate(invalid);
    assert.equal(validateReceipt(invalid).ok, false);
  }
});

test("FIN-08R provider transaction projection and allowlist stay synthetic and bounded", async () => {
  const row = {
    transaction_id: "synthetic-transaction",
    vendor_id: "synthetic-vendor",
    provider_name: "payuni",
    provider_trade_no: "synthetic-reference",
    order_number: "synthetic-order",
    gross_amount_cents: "1250",
    transaction_status: "partially_refunded",
    refunded_amount_cents: "250",
  };
  assert.deepEqual(providerTransaction(row), {
    id: "synthetic-transaction",
    vendorId: "synthetic-vendor",
    providerName: "payuni",
    providerTradeNo: "synthetic-reference",
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

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ status: 200 });
    const safe = await queryProvider(row, { queryPayment: async () => { await fetch("https://sandbox-api.payuni.com.tw/api/trade/query"); return { status: "refunded" }; } });
    assert.deepEqual(safe, { result: { status: "refunded" }, attempts: 1, redirects: 0 });
    await assert.rejects(() => queryProvider(row, { queryPayment: async () => { await fetch("https://evil.example/api/trade/query"); } }), /FIN08R_PROVIDER_ALLOWLIST/u);
    globalThis.fetch = async () => ({ status: 302 });
    await assert.rejects(() => queryProvider(row, { queryPayment: async () => { await fetch("https://sandbox-api.payuni.com.tw/api/trade/query"); } }), /FIN08R_PROVIDER_REDIRECT/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("FIN-08R temporary marker cleanup remains bounded and idempotent", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-fin08r-test-"));
  const temp = path.join(root, `celebratedeal-fin08r-${"a".repeat(8)}`);
  await fsp.mkdir(temp, { recursive: true });
  try {
    const facts = await inspectTemp(temp);
    assert.equal(facts.ok, true);
    assert.equal(facts.markerSafe, true);
    assert.equal(await cleanupTemp(temp).then((result) => result.pass), true);
  } finally {
    assert.equal((await cleanupTemp(temp)).pass, true);
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("FIN-08R temp boundary rejects workspace and unsafe leaves without writing markers", async () => {
  const inside = path.join(process.cwd(), `celebratedeal-fin08r-${"a".repeat(8)}`);
  const insideFacts = await inspectTemp(inside);
  assert.equal(insideFacts.ok, false);
  assert.equal(insideFacts.outsideWorkspace, false);
  assert.equal(insideFacts.markerSafe, false);
  const unsafe = path.join(os.tmpdir(), "celebratedeal-fin08r-unsafe-value");
  const unsafeFacts = await inspectTemp(unsafe);
  assert.equal(unsafeFacts.ok, false);
  assert.equal(unsafeFacts.outsideWorkspace, true);
  assert.equal(unsafeFacts.markerSafe, false);
  assert.equal((await cleanupTemp(inside)).pass, true);
  assert.equal((await cleanupTemp(unsafe)).pass, true);
});

test("FIN-08R candidate query is one read-only transaction with a bounded empty projection", async () => {
  const statements = [];
  const result = await queryCandidate({
    $transaction: async (callback) => callback({
      $executeRawUnsafe: async (statement) => { statements.push(String(statement)); },
      $queryRaw: async () => [],
    }),
  });
  assert.deepEqual(result.rows, []);
  assert.equal(result.transactionReadOnly, "");
  assert.deepEqual(statements, ["SET TRANSACTION READ ONLY"]);
});

test("FIN-08R sterile environment and child gate never expose inherited application values", () => {
  const sterile = buildSterileEnv();
  assert.equal(Object.keys(sterile).some((key) => TARGET_KEYS.includes(key)), false);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", "import { runChild } from './scripts/fin08r-staging-payuni-reconciliation-runner.mjs'; await runChild(process.cwd());"], { cwd: process.cwd(), env: { Path: process.env.Path, SystemRoot: process.env.SystemRoot }, encoding: "utf8", shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 4096 });
  assert.equal(child.status, 2);
  assert.match(String(child.stdout), /FIN08R_CHILD_RESULT:/u);
  assert.doesNotMatch(`${String(child.stdout)}${String(child.stderr)}`, /synthetic|postgres(?:ql)?:\/\/|Bearer\s+/iu);
});
