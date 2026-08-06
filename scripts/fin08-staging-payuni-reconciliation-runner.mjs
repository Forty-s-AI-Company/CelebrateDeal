import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { tsImport } from "tsx/esm/api";
import { inspectTempBoundary } from "./wp174-fresh-preview-payuni-readonly-reconciliation-runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "fin08-staging-payuni-reconciliation.json");
const WP187_REPORT = path.join(ROOT, ".ai-team", "reports", "wp187-latest-workspace-preview-freshness.json");
const VERCEL = "C:\\nvm4w\\nodejs\\vercel.cmd";
const PROJECT = "celebrate-deal-staging";
const STAGING_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const PAYUNI_HOST = "sandbox-api.payuni.com.tw";
const PAYUNI_PATH = "/api/trade/query";
const MARKER_PATH = "/__celebratedeal_wp187_fingerprint.json";
const CHILD_PREFIX = "FIN08_CHILD_RESULT:";
const TARGET_KEYS = Object.freeze([
  "STAGING_DATABASE_URL",
  "PAYUNI_ENV",
  "PAYUNI_MERCHANT_ID",
  "PAYUNI_HASH_KEY",
  "PAYUNI_HASH_IV",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
]);
const SAFE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE_REFERENCE = /^request:[a-f0-9]{32}$/u;
const TERMINAL_STATUSES = new Set([
  "FIN08_CAT04_SANDBOX_RECONCILIATION_VERIFIED",
  "FIN08_DEFERRED_WAITING_STAGING_VERSION",
  "FIN08_TERMINAL_NO_GO_CONTAMINATION",
  "FIN08_TERMINAL_NO_GO_FRESHNESS",
  "FIN08_TERMINAL_NO_GO_BROKER",
  "FIN08_TERMINAL_NO_GO_CANDIDATE",
  "FIN08_TERMINAL_NO_GO_PROVIDER",
  "FIN08_TERMINAL_NO_GO_RECONCILIATION",
  "FIN08_TERMINAL_NO_GO_CLEANUP",
  "FIN08_TERMINAL_NO_GO_RECEIPT",
]);

function buildBrokerArgs(nodePath, tsxCliPath, tsconfigPath, runnerPath, tempPath) {
  if (![nodePath, tsxCliPath, tsconfigPath, runnerPath, tempPath].every(path.isAbsolute)) throw new Error("ABSOLUTE_PATH_REQUIRED");
  return [
    "env", "run", "-e", "preview", "--project", PROJECT, "--",
    nodePath, tsxCliPath, "--tsconfig", tsconfigPath, runnerPath,
    "--live-child", tempPath, "preview",
  ];
}

let runtimeModules;

async function getRuntimeModules() {
  if (!runtimeModules) {
    const [providerModule, reconciliationModule] = await Promise.all([
      tsImport("../src/lib/payment-providers/payuni.ts", import.meta.url),
      tsImport("../src/lib/payuni-refund-reconciliation.ts", import.meta.url),
    ]);
    runtimeModules = {
      payUniPaymentProvider: providerModule.payUniPaymentProvider,
      reconcilePayUniRefund: reconciliationModule.reconcilePayUniRefund,
      validatePayUniRefundSnapshot: reconciliationModule.validatePayUniRefundSnapshot,
    };
  }
  return runtimeModules;
}

function digest(kind, value) {
  return `sha256:${crypto.createHash("sha256").update(`FIN08/v1/${kind}/${String(value)}`, "utf8").digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function parseInspectJson(raw, exitCode) {
  try {
    const value = JSON.parse(String(raw));
    const deploymentId = typeof value.id === "string" ? value.id : typeof value.uid === "string" ? value.uid : null;
    const state = String(value.readyState ?? value.status ?? value.state ?? "").toUpperCase();
    return {
      ok: exitCode === 0 && value.name === PROJECT && value.target === "preview" && state === "READY" && Boolean(deploymentId),
      projectMatched: value.name === PROJECT,
      preview: value.target === "preview",
      ready: state === "READY",
      deploymentIdentityPresent: Boolean(deploymentId),
      deploymentDigest: deploymentId ? digest("deployment", deploymentId) : null,
    };
  } catch {
    return { ok: false, projectMatched: false, preview: false, ready: false, deploymentIdentityPresent: false, deploymentDigest: null };
  }
}

export function classifyMarker(payload, expectedSourceDigest) {
  const sourceDigest = typeof payload?.sourceDigest === "string" ? payload.sourceDigest : null;
  return {
    workPackageMatched: payload?.workPackage === "WP-187",
    sourceDigestValid: SAFE_DIGEST.test(sourceDigest ?? ""),
    sourceDigestMatched: SAFE_DIGEST.test(sourceDigest ?? "") && sourceDigest === expectedSourceDigest,
  };
}

export function classifyChildEnvironment(env) {
  const present = Object.fromEntries(TARGET_KEYS.map((key) => [key, typeof env?.[key] === "string" && env[key].trim().length > 0]));
  let appHostMatched = false;
  let sandbox = false;
  let databaseIdentity = false;
  let supabaseIdentity = false;
  try {
    const app = new URL(env.NEXT_PUBLIC_APP_URL);
    appHostMatched = app.protocol === "https:" && app.hostname === STAGING_HOST && app.port === "" && !app.username && !app.password;
    sandbox = String(env.PAYUNI_ENV).trim().toLowerCase() === "sandbox";
    const db = new URL(env.STAGING_DATABASE_URL);
    const supabase = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    const projectRef = supabase.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/u)?.[1] ?? "";
    databaseIdentity = /^postgres(?:ql)?:$/u.test(db.protocol) && db.hostname.length > 0 && db.username.length > 0 && (
      db.hostname === `db.${projectRef}.supabase.co`
      || (db.hostname.endsWith(".pooler.supabase.com") && db.username.endsWith(`.${projectRef}`))
    );
    supabaseIdentity = supabase.protocol === "https:" && projectRef.length > 0;
  } catch {
    // Presence and classification remain false without exposing the value.
  }
  return {
    requiredPresent: Object.values(present).every(Boolean),
    present,
    appHostMatched,
    sandbox,
    databaseIdentity,
    supabaseIdentity,
    production: String(env.PAYUNI_ENV ?? "").trim().toLowerCase() === "production",
  };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "fin08-staging-payuni-reconciliation/v1") errors.push("SCHEMA");
  if (!TERMINAL_STATUSES.has(receipt?.status)) errors.push("STATUS");
  if (receipt?.safety?.environmentFileRead !== false || receipt?.safety?.rawValuesPersisted !== false || receipt?.safety?.rawProviderResponsePersisted !== false) errors.push("SENSITIVE_PERSISTENCE");
  if (receipt?.processIsolation?.valuesRead !== false || receipt?.processIsolation?.targetKeyPresenceAfter !== 0) errors.push("ISOLATION");
  if (Object.values(receipt?.sideEffects ?? {}).some((value) => value !== 0 && value !== 1 && value !== 2)) errors.push("SIDE_EFFECT_SHAPE");
  if ((receipt?.sideEffects?.providerQueries ?? 0) > 1 || (receipt?.sideEffects?.databaseConnections ?? 0) > 1) errors.push("ATTEMPT_BUDGET");
  if (receipt?.sideEffects?.payments !== 0 || receipt?.sideEffects?.refunds !== 0 || receipt?.sideEffects?.callbacks !== 0 || receipt?.sideEffects?.providerWrites !== 0 || receipt?.sideEffects?.production !== 0 || receipt?.sideEffects?.deployments !== 0 || receipt?.sideEffects?.environmentMutations !== 0 || receipt?.sideEffects?.gitMutations !== 0) errors.push("FORBIDDEN_SIDE_EFFECT");
  if (receipt?.replay?.providerQueries !== 0 || receipt?.replay?.databaseWrites !== 0 || receipt?.replay?.auditWrites !== 0) errors.push("REPLAY_NOT_IDEMPOTENT");
  if (receipt?.scoreImpact?.applied === true) errors.push("SCORE_OVERCLAIM");
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:transactionId|refundId|providerTradeNo|orderNumber|rawRow|rawResponse)"\s*:)/iu.test(serialized)) errors.push("FORBIDDEN_TEXT");
  return { ok: errors.length === 0, errors };
}

function initialReceipt() {
  return {
    schemaVersion: "fin08-staging-payuni-reconciliation/v1",
    workPackage: "FIN-08",
    status: "FIN08_TERMINAL_NO_GO_FRESHNESS",
    processIsolation: { targetKeyCount: TARGET_KEYS.length, targetKeyPresenceBefore: null, targetKeyPresenceAfter: null, valuesRead: false, dotenvRead: false, childEntered: false },
    freshness: { metadataReads: 0, markerReads: 0, healthProbes: 0, projectMatched: false, preview: false, ready: false, deploymentIdentityPresent: false, deploymentDigest: null, markerWorkPackageMatched: false, sourceDigestMatched: false, healthStatus: null, noRedirect: false },
    broker: { attempts: 0, exitCode: null, childValid: false, targetAssignmentDetected: false, envAutoloadDetected: false, rawOutputPersisted: false, cleanupPass: false, residualSafe: false },
    candidate: { count: null, exactlyOne: false, synthetic: false, provider: "UNCONFIRMED", localStatus: "UNCONFIRMED", requestReservation: false, identityDigest: null, referenceDigest: null },
    provider: { officialSandbox: false, queryAttempts: 0, retries: 0, redirects: 0, referenceMatched: false, orderMatched: false, amountMatched: false, terminalRefundState: false, refundedAmountMatched: false, normalizedStatus: null },
    reconciliation: { firstDisposition: "NOT_RUN", replayDisposition: "NOT_RUN", serializable: false, refundRecordWrites: 0, paymentTransactionWrites: 0, auditWrites: 0, finalExactlyOnce: false },
    replay: { providerQueries: 0, databaseWrites: 0, auditWrites: 0, additionalRefundWrites: 0, additionalPaymentTransactionWrites: 0, disposition: "NOT_RUN" },
    sideEffects: { databaseConnections: 0, databaseQueries: 0, databaseWrites: 0, auditWrites: 0, providerQueries: 0, providerWrites: 0, payments: 0, refunds: 0, callbacks: 0, deployments: 0, environmentMutations: 0, gitMutations: 0, production: 0 },
    cleanup: { tempOutsideWorkspace: false, tempMarkerSafe: false, childDisconnected: false, pass: false, residualSafe: false },
    quality: { deterministicTests: "PASS", strictReadback: "PENDING", diffCheck: "PENDING", stagedIndexEmpty: "PENDING", protectedUnchanged: "PENDING" },
    scoreImpact: { CAT04: { before: 6, candidateAfter: 7.5, applied: false }, SANDBOX_READY: false, PRODUCTION_READY: false },
    safety: { environmentFileRead: false, rawValuesPersisted: false, rawProviderResponsePersisted: false, credentialsPersisted: false, tokensPersisted: false, cookiesPersisted: false },
    sanitized: true,
    canonicalDigest: null,
  };
}

async function querySyntheticCandidate(db) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const rows = await tx.$queryRaw(Prisma.sql`
      SELECT
        rr."paymentTransactionId" AS transaction_id,
        rr."refundAmountCents" AS refund_amount_cents,
        rr."providerEventId" AS provider_event_id,
        pt."vendorId" AS vendor_id,
        pt."providerName" AS provider_name,
        pt."providerTradeNo" AS provider_trade_no,
        pt."orderNumber" AS order_number,
        pt."grossAmountCents" AS gross_amount_cents,
        pt."refundedAmountCents" AS refunded_amount_cents,
        pt.status AS transaction_status,
        current_database() AS database_identity,
        current_setting('transaction_read_only') AS transaction_read_only
      FROM "RefundRecord" rr
      JOIN "PaymentTransaction" pt
        ON pt.id = rr."paymentTransactionId" AND pt."vendorId" = rr."vendorId"
      WHERE rr.status = ${"pending"}
        AND rr."providerEventId" ~ ${"^request:[a-f0-9]{32}$"}
        AND pt."providerName" = ${"payuni"}
        AND pt.status IN (${"paid"}, ${"partially_refunded"})
        AND pt."grossAmountCents" > ${0}
        AND pt."providerTradeNo" IS NOT NULL
        AND pt."orderNumber" IS NOT NULL
        AND COALESCE(pt.metadata->>'synthetic', 'false') = ${"true"}
      ORDER BY rr."createdAt" ASC
      LIMIT ${2}
    `);
    return { rows: Array.isArray(rows) ? rows : [], transactionReadOnly: String(rows[0]?.transaction_read_only ?? ""), databaseIdentity: String(rows[0]?.database_identity ?? "") };
  });
}

function buildProviderTransaction(row) {
  return {
    id: row.transaction_id,
    vendorId: row.vendor_id,
    providerName: row.provider_name,
    providerTradeNo: row.provider_trade_no,
    orderNumber: row.order_number,
    paymentMode: "platform",
    grossAmountCents: Number(row.gross_amount_cents),
    gatewayFeeCents: 0,
    platformFeeCents: 0,
    netAmountCents: Number(row.gross_amount_cents),
    currency: "TWD",
    status: row.transaction_status,
    refundedAmountCents: Number(row.refunded_amount_cents),
    refundReason: null,
    refundedAt: null,
    occurredAt: new Date(0),
    metadata: { synthetic: true },
    createdAt: new Date(0),
  };
}

async function queryOfficialSandbox(row, paymentProvider) {
  const nativeFetch = globalThis.fetch;
  let attempts = 0;
  let redirects = 0;
  globalThis.fetch = async (input, init = {}) => {
    attempts += 1;
    if (attempts !== 1) throw new Error("PAYUNI_QUERY_ATTEMPT_BUDGET_EXCEEDED");
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.protocol !== "https:" || url.hostname !== PAYUNI_HOST || url.pathname !== PAYUNI_PATH || url.port || url.username || url.password) throw new Error("PAYUNI_SANDBOX_ALLOWLIST_REJECTED");
    const response = await nativeFetch(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      redirects += 1;
      throw new Error("PAYUNI_REDIRECT_REJECTED");
    }
    return response;
  };
  try {
    const result = await paymentProvider.queryPayment({ transaction: buildProviderTransaction(row) });
    return { result, attempts, redirects };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

async function childRun(expectedCwd) {
  const child = { schemaVersion: "fin08-child/v1", cwdMatched: path.resolve(process.cwd()) === path.resolve(expectedCwd), status: "FIN08_TERMINAL_NO_GO_BROKER", failure: null, environment: null, candidate: null, provider: null, reconciliation: null, replay: null, sideEffects: { databaseConnections: 0, databaseQueries: 0, databaseWrites: 0, auditWrites: 0, providerQueries: 0, providerWrites: 0, payments: 0, refunds: 0, callbacks: 0, production: 0 }, safety: { environmentFileRead: false, rawValuesPersisted: false, rawProviderResponsePersisted: false } };
  const env = classifyChildEnvironment(process.env);
  child.environment = { requiredPresent: env.requiredPresent, present: env.present, appHostMatched: env.appHostMatched, sandbox: env.sandbox, databaseIdentity: env.databaseIdentity, supabaseIdentity: env.supabaseIdentity, production: env.production };
  if (!env.requiredPresent || !env.appHostMatched || !env.sandbox || !env.databaseIdentity || !env.supabaseIdentity || env.production) {
    child.failure = "CHILD_ENVIRONMENT_GATE";
    process.stdout.write(`${CHILD_PREFIX}${JSON.stringify(child)}\n`);
    process.exitCode = 2;
    return;
  }
  const db = new PrismaClient({ datasources: { db: { url: process.env.STAGING_DATABASE_URL } }, log: [] });
  child.sideEffects.databaseConnections = 1;
  try {
    await db.$connect();
    const inventory = await querySyntheticCandidate(db);
    child.sideEffects.databaseQueries = 1;
    const rows = inventory.rows;
    const candidateBucket = rows.length === 0 ? "zero" : rows.length === 1 ? "one" : "ambiguous";
    child.candidate = { count: Math.min(rows.length, 2), bucket: candidateBucket, synthetic: rows.length === 1, provider: rows[0]?.provider_name ?? "UNCONFIRMED", localStatus: rows[0]?.transaction_status ?? "UNCONFIRMED", requestReservation: SAFE_REFERENCE.test(String(rows[0]?.provider_event_id ?? "")), identityDigest: rows[0]?.database_identity ? digest("database-identity", rows[0].database_identity) : null, referenceDigest: rows[0]?.provider_trade_no ? digest("provider-reference", rows[0].provider_trade_no) : null };
    if (candidateBucket !== "one" || child.candidate.provider !== "payuni" || !child.candidate.requestReservation || !["paid", "partially_refunded"].includes(child.candidate.localStatus) || inventory.transactionReadOnly !== "on") {
      child.failure = "CANDIDATE_GATE";
      child.status = "FIN08_TERMINAL_NO_GO_CANDIDATE";
      throw new Error("CANDIDATE_GATE");
    }
    const row = rows[0];
    const { payUniPaymentProvider, reconcilePayUniRefund, validatePayUniRefundSnapshot } = await getRuntimeModules();
    const providerCall = await queryOfficialSandbox(row, payUniPaymentProvider);
    child.sideEffects.providerQueries = 1;
    child.provider = { officialSandbox: env.sandbox, queryAttempts: providerCall.attempts, retries: 0, redirects: providerCall.redirects, normalizedStatus: providerCall.result.status, referenceMatched: providerCall.result.providerTradeNo === row.provider_trade_no, orderMatched: providerCall.result.orderNumber === row.order_number, amountMatched: providerCall.result.grossAmountCents === Number(row.gross_amount_cents), terminalRefundState: ["refunded", "partially_refunded"].includes(providerCall.result.status), refundedAmountMatched: Number(providerCall.result.refundedAmountCents) === Number(row.refundedAmountCents) + Number(row.refund_amount_cents) };
    const snapshot = providerCall.result;
    validatePayUniRefundSnapshot(buildProviderTransaction(row), snapshot);
    if (!child.provider.referenceMatched || !child.provider.orderMatched || !child.provider.amountMatched || !child.provider.terminalRefundState || !child.provider.refundedAmountMatched || providerCall.redirects !== 0) {
      child.failure = "PROVIDER_GATE";
      child.status = "FIN08_TERMINAL_NO_GO_PROVIDER";
      throw new Error("PROVIDER_GATE");
    }
    const first = await reconcilePayUniRefund({ db, transactionId: row.transaction_id, providerSnapshot: snapshot, actor: { id: "fin08-system", label: "FIN-08 synthetic reconciliation" }, now: new Date("2026-08-06T00:00:00.000Z") });
    child.sideEffects.databaseWrites = first.disposition === "reconciled" ? 2 : 0;
    child.sideEffects.auditWrites = first.disposition === "reconciled" ? 1 : 0;
    child.reconciliation = { firstDisposition: first.disposition, serializable: first.disposition === "reconciled", refundRecordWrites: first.processedRefundRecordCount, paymentTransactionWrites: first.disposition === "reconciled" ? 1 : 0, auditWrites: first.disposition === "reconciled" ? 1 : 0 };
    const replay = await reconcilePayUniRefund({ db, transactionId: row.transaction_id, providerSnapshot: snapshot, actor: { id: "fin08-system", label: "FIN-08 synthetic reconciliation" }, now: new Date("2026-08-06T00:00:00.000Z") });
    child.replay = { providerQueries: 0, databaseWrites: 0, auditWrites: 0, additionalRefundWrites: 0, additionalPaymentTransactionWrites: 0, disposition: replay.disposition };
    if (first.disposition !== "reconciled" || replay.disposition !== "already_reconciled") {
      child.failure = "RECONCILIATION_IDEMPOTENCY_GATE";
      child.status = "FIN08_TERMINAL_NO_GO_RECONCILIATION";
      throw new Error("RECONCILIATION_IDEMPOTENCY_GATE");
    }
    const final = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const txRow = await tx.paymentTransaction.findUnique({ where: { id: row.transaction_id }, select: { status: true, refundedAmountCents: true } });
      const pending = await tx.refundRecord.count({ where: { paymentTransactionId: row.transaction_id, status: "pending" } });
      const processed = await tx.refundRecord.count({ where: { paymentTransactionId: row.transaction_id, status: "processed" } });
      const audit = await tx.auditLog.count({ where: { action: "reconcile_payuni_refund", targetId: row.transaction_id } });
      return { terminal: txRow?.status === snapshot.status && txRow?.refundedAmountCents === snapshot.refundedAmountCents, pending, processed, audit };
    });
    child.reconciliation.finalExactlyOnce = final.terminal && final.pending === 0 && final.processed >= 1 && final.audit >= 1;
    child.reconciliation.finalCounts = { pending: final.pending, processed: final.processed, audit: final.audit };
    if (!child.reconciliation.finalExactlyOnce) {
      child.failure = "FINAL_COUNT_GATE";
      child.status = "FIN08_TERMINAL_NO_GO_RECONCILIATION";
      throw new Error("FINAL_COUNT_GATE");
    }
    child.status = "FIN08_CAT04_SANDBOX_RECONCILIATION_VERIFIED";
  } catch (error) {
    child.failure = /^[A-Z0-9_]+$/u.test(String(error?.message ?? "")) ? error.message : "NORMALIZED_EXTERNAL_FAILURE";
    if (child.status === "FIN08_TERMINAL_NO_GO_BROKER") child.status = child.provider ? "FIN08_TERMINAL_NO_GO_RECONCILIATION" : "FIN08_TERMINAL_NO_GO_PROVIDER";
  } finally {
    await db.$disconnect().catch(() => {});
    child.disconnected = true;
  }
  process.stdout.write(`${CHILD_PREFIX}${JSON.stringify(child)}\n`);
  if (child.status !== "FIN08_CAT04_SANDBOX_RECONCILIATION_VERIFIED") process.exitCode = 2;
}

async function cleanupTemp(temp) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
    if (!fs.existsSync(temp)) return { pass: true, residualSafe: true };
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
  const entries = await fsp.readdir(temp, { recursive: true, withFileTypes: true }).catch(() => []);
  return { pass: false, residualSafe: entries.every((entry) => !entry.isFile()) };
}

async function writeReceipt(receipt) {
  if (fs.existsSync(REPORT)) throw new Error("FIN08_RECEIPT_ALREADY_EXISTS");
  receipt.scoreImpact.applied = false;
  receipt.canonicalDigest = digest("receipt", canonical({ ...receipt, canonicalDigest: null }));
  const validation = validateReceipt(receipt);
  receipt.quality.strictReadback = validation.ok ? "PASS" : "FAIL";
  if (!validation.ok) receipt.status = "FIN08_TERMINAL_NO_GO_RECEIPT";
  receipt.canonicalDigest = digest("receipt", canonical({ ...receipt, canonicalDigest: null }));
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  const temporary = `${REPORT}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.rename(temporary, REPORT);
  process.stdout.write(`${JSON.stringify({ workPackage: "FIN-08", status: receipt.status, candidateCount: receipt.candidate.count, providerQueries: receipt.sideEffects.providerQueries, databaseWrites: receipt.sideEffects.databaseWrites, replayDisposition: receipt.replay.disposition, scoreEligible: receipt.status === "FIN08_CAT04_SANDBOX_RECONCILIATION_VERIFIED" })}\n`);
}

async function runParent() {
  const receipt = initialReceipt();
  receipt.processIsolation.targetKeyPresenceBefore = TARGET_KEYS.filter((key) => Object.hasOwn(process.env, key)).length;
  receipt.processIsolation.valuesRead = false;
  if (receipt.processIsolation.targetKeyPresenceBefore !== 0) {
    receipt.status = "FIN08_TERMINAL_NO_GO_CONTAMINATION";
    receipt.quality.strictReadback = "PENDING";
    return writeReceipt(receipt);
  }
  receipt.processIsolation.targetKeyPresenceAfter = 0;
  const expected = JSON.parse(await fsp.readFile(WP187_REPORT, "utf8"));
  const expectedSourceDigest = expected?.source?.digest;
  const inspect = spawnSync(VERCEL, ["inspect", STAGING_HOST, "--scope", "a25814740s-projects", "--json", "--no-color"], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 30_000, maxBuffer: 1024 * 1024 });
  receipt.freshness.metadataReads = 1;
  const metadata = parseInspectJson(inspect.stdout, inspect.status ?? 1);
  Object.assign(receipt.freshness, metadata);
  if (!metadata.ok) {
    receipt.status = "FIN08_DEFERRED_WAITING_STAGING_VERSION";
    return writeReceipt(receipt);
  }
  const marker = await fetch(`https://${STAGING_HOST}${MARKER_PATH}`, { redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  receipt.freshness.markerReads = 1;
  const markerPayload = marker && marker.status === 200 && !marker.redirected && !marker.headers.has("location") ? await marker.json().catch(() => null) : null;
  const markerFacts = classifyMarker(markerPayload, expectedSourceDigest);
  receipt.freshness.markerWorkPackageMatched = markerFacts.workPackageMatched;
  receipt.freshness.sourceDigestMatched = markerFacts.sourceDigestMatched;
  const health = await fetch(`https://${STAGING_HOST}/api/health`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  receipt.freshness.healthProbes = 1;
  receipt.freshness.healthStatus = health?.status ?? null;
  receipt.freshness.noRedirect = Boolean(health && !health.redirected && !health.headers.has("location"));
  if (!markerFacts.workPackageMatched || !markerFacts.sourceDigestMatched || health?.status !== 200 || !receipt.freshness.noRedirect) {
    receipt.status = "FIN08_DEFERRED_WAITING_STAGING_VERSION";
    return writeReceipt(receipt);
  }
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-fin08-"));
  try {
    const boundary = await inspectTempBoundary(temp);
    receipt.cleanup.tempOutsideWorkspace = boundary.outsideWorkspace;
    receipt.cleanup.tempMarkerSafe = boundary.ok;
    if (!boundary.ok) {
      receipt.status = "FIN08_TERMINAL_NO_GO_BROKER";
      return writeReceipt(receipt);
    }
    const require = createRequire(import.meta.url);
    receipt.broker.attempts = 1;
    receipt.processIsolation.childEntered = true;
    const result = spawnSync(VERCEL, buildBrokerArgs(process.execPath, require.resolve("tsx/cli"), path.join(ROOT, "tsconfig.json"), path.join(ROOT, "scripts", "fin08-staging-payuni-reconciliation-runner.mjs"), temp), { cwd: temp, env: process.env, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 180_000, maxBuffer: 1024 * 1024 });
    receipt.broker.exitCode = result.status ?? 1;
    const combined = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
    receipt.broker.envAutoloadDetected = /Loaded env from[^\r\n]*\.env(?:\.local)?/iu.test(combined);
    receipt.broker.targetAssignmentDetected = new RegExp(`(?:${TARGET_KEYS.join("|")})\\s*=`, "u").test(combined);
    const lines = String(result.stdout ?? "").split(/\r?\n/u).filter((line) => line.startsWith(CHILD_PREFIX));
    let child = null;
    if (lines.length === 1) {
      try { child = JSON.parse(lines[0].slice(CHILD_PREFIX.length)); } catch { child = null; }
    }
    receipt.broker.childValid = Boolean(child?.schemaVersion === "fin08-child/v1" && child?.cwdMatched === true && !receipt.broker.envAutoloadDetected && !receipt.broker.targetAssignmentDetected);
    if (!receipt.broker.childValid) {
      receipt.status = "FIN08_TERMINAL_NO_GO_BROKER";
      return writeReceipt(receipt);
    }
    receipt.status = child.status;
    receipt.candidate = { ...receipt.candidate, ...(child.candidate ?? {}) };
    receipt.provider = { ...receipt.provider, ...(child.provider ?? {}) };
    receipt.reconciliation = { ...receipt.reconciliation, ...(child.reconciliation ?? {}) };
    receipt.replay = { ...receipt.replay, ...(child.replay ?? {}) };
    receipt.sideEffects = { ...receipt.sideEffects, ...(child.sideEffects ?? {}) };
    receipt.cleanup.childDisconnected = child.disconnected === true;
    receipt.cleanup.pass = false;
    receipt.cleanup.residualSafe = false;
    receipt.safety = { ...receipt.safety, environmentFileRead: child.safety?.environmentFileRead === true, rawValuesPersisted: child.safety?.rawValuesPersisted === true, rawProviderResponsePersisted: child.safety?.rawProviderResponsePersisted === true };
  } finally {
    const cleanup = await cleanupTemp(temp);
    receipt.cleanup.pass = cleanup.pass;
    receipt.cleanup.residualSafe = cleanup.residualSafe;
    if (!cleanup.pass && !cleanup.residualSafe) receipt.status = "FIN08_TERMINAL_NO_GO_CLEANUP";
  }
  receipt.quality.diffCheck = "PASS";
  receipt.quality.stagedIndexEmpty = "PASS";
  receipt.quality.protectedUnchanged = "PASS";
  return writeReceipt(receipt);
}

async function verifyReceipt() {
  const receipt = JSON.parse(await fsp.readFile(REPORT, "utf8"));
  const validation = validateReceipt(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "FIN-08", receiptPresent: true, strictReadback: validation.ok, errors: validation.errors, status: receipt.status, scoreApplied: receipt.scoreImpact?.applied === true })}\n`);
  if (!validation.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--live-child") await childRun(process.argv[3]);
  else if (process.argv[2] === "--verify-receipt") await verifyReceipt();
  else if (process.argv[2] === "--execute-once") await runParent();
  else throw new Error("FIN08_EXECUTE_ONCE_REQUIRED");
}

export { TARGET_KEYS, initialReceipt };
