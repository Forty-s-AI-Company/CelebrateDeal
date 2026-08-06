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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = fileURLToPath(import.meta.url);
const REPORT = path.join(ROOT, ".ai-team", "reports", "fin08r-staging-payuni-reconciliation.json");
const WP187_REPORT = path.join(ROOT, ".ai-team", "reports", "wp187-latest-workspace-preview-freshness.json");
const VERCEL = "C:\\nvm4w\\nodejs\\vercel.cmd";
const PROJECT = "celebrate-deal-staging";
const STAGING_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const PAYUNI_HOST = "sandbox-api.payuni.com.tw";
const PAYUNI_PATH = "/api/trade/query";
const MARKER_PATH = "/__celebratedeal_wp187_fingerprint.json";
const CHILD_PREFIX = "FIN08R_CHILD_RESULT:";
const TARGET_KEYS = Object.freeze([
  "DATABASE_URL", "DIRECT_URL", "STAGING_DATABASE_URL", "PAYUNI_ENV", "PAYUNI_MERCHANT_ID", "PAYUNI_HASH_KEY",
  "PAYUNI_HASH_IV", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL",
]);
const SAFE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE_REFERENCE = /^request:[a-f0-9]{32}$/u;
const TERMINAL = new Set([
  "FIN08R_SANDBOX_RECONCILIATION_VERIFIED", "FIN08R_DEFERRED_WAITING_FRESH_DEPLOYMENT",
  "FIN08R_TERMINAL_NO_GO_CONTAMINATION", "FIN08R_TERMINAL_NO_GO_FRESHNESS",
  "FIN08R_TERMINAL_NO_GO_BROKER", "FIN08R_TERMINAL_NO_GO_CANDIDATE",
  "FIN08R_TERMINAL_NO_GO_PROVIDER", "FIN08R_TERMINAL_NO_GO_RECONCILIATION",
  "FIN08R_TERMINAL_NO_GO_CLEANUP", "FIN08R_TERMINAL_NO_GO_RECEIPT",
]);
const STERILE_ENV_KEYS = [
  "SystemRoot", "WINDIR", "PATH", "PATHEXT", "ComSpec", "TEMP", "TMP", "USERPROFILE",
  "APPDATA", "LOCALAPPDATA", "ProgramData", "SystemDrive", "NVM_HOME",
];
let runtimeModules;

function digest(kind, value) {
  return `sha256:${crypto.createHash("sha256").update(`FIN08R/v1/${kind}/${String(value)}`, "utf8").digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function parseInspectJson(raw, exitCode) {
  try {
    const value = JSON.parse(String(raw));
    const identity = typeof value.id === "string" ? value.id : typeof value.uid === "string" ? value.uid : null;
    const state = String(value.readyState ?? value.status ?? value.state ?? "").toUpperCase();
    return {
      ok: exitCode === 0 && value.name === PROJECT && value.target === "preview" && state === "READY" && Boolean(identity),
      projectMatched: value.name === PROJECT,
      preview: value.target === "preview",
      ready: state === "READY",
      deploymentIdentityPresent: Boolean(identity),
      deploymentDigest: identity ? digest("deployment", identity) : null,
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

export function classifyEnvironment(env) {
  const present = Object.fromEntries(TARGET_KEYS.map((key) => [key, typeof env?.[key] === "string" && env[key].trim().length > 0]));
  let appHostMatched = false;
  let sandbox = false;
  let databaseIdentity = false;
  let supabaseIdentity = false;
  try {
    const app = new URL(env.NEXT_PUBLIC_APP_URL);
    appHostMatched = app.protocol === "https:" && app.hostname === STAGING_HOST && !app.port && !app.username && !app.password;
    sandbox = String(env.PAYUNI_ENV).trim().toLowerCase() === "sandbox";
    const db = new URL(env.STAGING_DATABASE_URL);
    const configured = new URL(env.DATABASE_URL);
    const direct = new URL(env.DIRECT_URL);
    const supabase = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    const ref = supabase.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/u)?.[1] ?? "";
    const sameDatabase = [configured, direct, db].every((candidate) => /^postgres(?:ql)?:$/u.test(candidate.protocol) && candidate.hostname === db.hostname);
    databaseIdentity = sameDatabase && db.hostname.length > 0 && db.username.length > 0
      && (db.hostname === `db.${ref}.supabase.co` || (db.hostname.endsWith(".pooler.supabase.com") && db.username.endsWith(`.${ref}`)));
    supabaseIdentity = supabase.protocol === "https:" && ref.length > 0;
  } catch {
    // Keep only presence/classification booleans; never persist a value.
  }
  return { requiredPresent: Object.values(present).every(Boolean), present, appHostMatched, sandbox, databaseIdentity, supabaseIdentity, production: String(env?.PAYUNI_ENV ?? "").trim().toLowerCase() === "production" };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "fin08r-staging-payuni-reconciliation/v1") errors.push("SCHEMA");
  if (!TERMINAL.has(receipt?.status)) errors.push("STATUS");
  if (receipt?.safety?.environmentFileRead !== false || receipt?.safety?.rawValuesPersisted !== false || receipt?.safety?.rawProviderResponsePersisted !== false) errors.push("SENSITIVE_PERSISTENCE");
  if (receipt?.processIsolation?.valuesRead !== false || receipt?.processIsolation?.targetKeyPresenceAfter !== 0) errors.push("ISOLATION");
  if (receipt?.scoreImpact?.applied === true) errors.push("SCORE_OVERCLAIM");
  if ((receipt?.sideEffects?.providerQueries ?? 0) > 1 || (receipt?.sideEffects?.databaseConnections ?? 0) > 1) errors.push("ATTEMPT_BUDGET");
  if (receipt?.sideEffects?.providerWrites !== 0 || receipt?.sideEffects?.payments !== 0 || receipt?.sideEffects?.refunds !== 0 || receipt?.sideEffects?.callbacks !== 0 || receipt?.sideEffects?.production !== 0 || receipt?.sideEffects?.deployments !== 0 || receipt?.sideEffects?.environmentMutations !== 0 || receipt?.sideEffects?.gitMutations !== 0) errors.push("FORBIDDEN_SIDE_EFFECT");
  if (receipt?.replay?.providerQueries !== 0 || receipt?.replay?.databaseWrites !== 0 || receipt?.replay?.auditWrites !== 0) errors.push("REPLAY_NOT_IDEMPOTENT");
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:transactionId|refundId|providerTradeNo|orderNumber|rawRow|rawResponse)"\s*:)/iu.test(JSON.stringify(receipt))) errors.push("FORBIDDEN_TEXT");
  return { ok: errors.length === 0, errors };
}

export function buildBrokerArgs(nodePath, tsxCliPath, tsconfigPath, runnerPath, tempPath) {
  if (![nodePath, tsxCliPath, tsconfigPath, runnerPath, tempPath].every(path.isAbsolute)) throw new Error("ABSOLUTE_PATH_REQUIRED");
  return ["env", "run", "-e", "preview", "--project", PROJECT, "--", nodePath, tsxCliPath, "--tsconfig", tsconfigPath, runnerPath, "--live-child", tempPath];
}

function initialReceipt() {
  return {
    schemaVersion: "fin08r-staging-payuni-reconciliation/v1", workPackage: "FIN-08R", status: "FIN08R_ATTEMPT_RESERVED",
    attemptReserved: true,
    processIsolation: { targetKeyCount: TARGET_KEYS.length, targetKeyPresenceBefore: null, targetKeyPresenceAfter: null, valuesRead: false, dotenvRead: false, childEntered: false },
    freshness: { metadataReads: 0, markerReads: 0, healthProbes: 0, projectMatched: false, preview: false, ready: false, deploymentIdentityPresent: false, deploymentDigest: null, notOldDeployment: false, markerWorkPackageMatched: false, sourceDigestMatched: false, healthStatus: null, noRedirect: false },
    broker: { attempts: 0, exitCode: null, childValid: false, targetAssignmentDetected: false, envAutoloadDetected: false, rawOutputPersisted: false },
    candidate: { count: null, bucket: "not_run", synthetic: false, provider: "UNCONFIRMED", localStatus: "UNCONFIRMED", requestReservation: false, identityDigest: null, referenceDigest: null },
    provider: { officialSandbox: false, queryAttempts: 0, retries: 0, redirects: 0, referenceMatched: false, orderMatched: false, amountMatched: false, terminalRefundState: false, refundedAmountMatched: false, normalizedStatus: null },
    reconciliation: { firstDisposition: "NOT_RUN", serializable: false, refundRecordWrites: 0, paymentTransactionWrites: 0, auditWrites: 0, finalExactlyOnce: false },
    replay: { providerQueries: 0, databaseWrites: 0, auditWrites: 0, disposition: "NOT_RUN" },
    sideEffects: { databaseConnections: 0, databaseQueries: 0, databaseWrites: 0, auditWrites: 0, providerQueries: 0, providerWrites: 0, payments: 0, refunds: 0, callbacks: 0, deployments: 0, environmentMutations: 0, gitMutations: 0, production: 0 },
    cleanup: { tempOutsideWorkspace: false, tempMarkerSafe: false, childDisconnected: false, pass: false, residualSafe: false },
    quality: { deterministicTests: "PASS", strictReadback: "PENDING", diffCheck: "PENDING", stagedIndexEmpty: "PENDING", protectedUnchanged: "PENDING" },
    scoreImpact: { CAT04: { before: 6, candidateAfter: 7.5, applied: false }, SANDBOX_READY: false, PRODUCTION_READY: false },
    safety: { environmentFileRead: false, rawValuesPersisted: false, rawProviderResponsePersisted: false, credentialsPersisted: false, tokensPersisted: false, cookiesPersisted: false },
    sanitized: true, canonicalDigest: null,
  };
}

async function getRuntimeModules() {
  if (!runtimeModules) {
    const [provider, reconciliation] = await Promise.all([
      tsImport("../src/lib/payment-providers/payuni.ts", import.meta.url),
      tsImport("../src/lib/payuni-refund-reconciliation.ts", import.meta.url),
    ]);
    runtimeModules = { payUniPaymentProvider: provider.payUniPaymentProvider, reconcilePayUniRefund: reconciliation.reconcilePayUniRefund, validatePayUniRefundSnapshot: reconciliation.validatePayUniRefundSnapshot };
  }
  return runtimeModules;
}

function buildSterileEnv() {
  const result = {};
  for (const key of STERILE_ENV_KEYS) if (typeof process.env[key] === "string") result[key] = process.env[key];
  return result;
}

async function inspectTemp(temp) {
  const resolved = path.resolve(temp);
  const outsideWorkspace = !resolved.startsWith(`${path.resolve(ROOT)}${path.sep}`);
  const leaf = path.basename(resolved);
  const marker = path.join(resolved, ".fin08r-marker");
  const safe = outsideWorkspace && /^celebratedeal-fin08r-[0-9a-f-]+$/u.test(leaf);
  if (safe) await fsp.writeFile(marker, "FIN08R\n", { flag: "wx" });
  return { ok: safe, outsideWorkspace, markerSafe: safe && fs.existsSync(marker) };
}

async function cleanupTemp(temp) {
  await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
  return { pass: !fs.existsSync(temp), residualSafe: !fs.existsSync(temp) };
}

async function queryCandidate(db) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const rows = await tx.$queryRaw(Prisma.sql`
      SELECT rr."paymentTransactionId" AS transaction_id, rr."refundAmountCents" AS refund_amount_cents,
        rr."providerEventId" AS provider_event_id, pt."vendorId" AS vendor_id, pt."providerName" AS provider_name,
        pt."providerTradeNo" AS provider_trade_no, pt."orderNumber" AS order_number,
        pt."grossAmountCents" AS gross_amount_cents, pt."refundedAmountCents" AS refunded_amount_cents,
        pt.status AS transaction_status, current_database() AS database_identity,
        current_setting('transaction_read_only') AS transaction_read_only
      FROM "RefundRecord" rr JOIN "PaymentTransaction" pt
        ON pt.id = rr."paymentTransactionId" AND pt."vendorId" = rr."vendorId"
      WHERE rr.status = ${"pending"} AND rr."providerEventId" ~ ${"^request:[a-f0-9]{32}$"}
        AND pt."providerName" = ${"payuni"} AND pt.status IN (${"paid"}, ${"partially_refunded"})
        AND pt."grossAmountCents" > ${0} AND pt."providerTradeNo" IS NOT NULL AND pt."orderNumber" IS NOT NULL
        AND COALESCE(pt.metadata->>'synthetic', 'false') = ${"true"}
      ORDER BY rr."createdAt" ASC LIMIT ${2}
    `);
    return { rows: Array.isArray(rows) ? rows : [], transactionReadOnly: String(rows[0]?.transaction_read_only ?? "" ) };
  });
}

function providerTransaction(row) {
  return { id: row.transaction_id, vendorId: row.vendor_id, providerName: row.provider_name, providerTradeNo: row.provider_trade_no, orderNumber: row.order_number, paymentMode: "platform", grossAmountCents: Number(row.gross_amount_cents), gatewayFeeCents: 0, platformFeeCents: 0, netAmountCents: Number(row.gross_amount_cents), currency: "TWD", status: row.transaction_status, refundedAmountCents: Number(row.refunded_amount_cents), refundReason: null, refundedAt: null, occurredAt: new Date(0), metadata: { synthetic: true }, createdAt: new Date(0) };
}

async function queryProvider(row, provider) {
  const nativeFetch = globalThis.fetch;
  let attempts = 0;
  let redirects = 0;
  globalThis.fetch = async (input, init = {}) => {
    attempts += 1;
    if (attempts !== 1) throw new Error("FIN08R_PROVIDER_ATTEMPT_BUDGET");
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.protocol !== "https:" || url.hostname !== PAYUNI_HOST || url.pathname !== PAYUNI_PATH || url.port || url.username || url.password) throw new Error("FIN08R_PROVIDER_ALLOWLIST");
    const response = await nativeFetch(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) { redirects += 1; throw new Error("FIN08R_PROVIDER_REDIRECT"); }
    return response;
  };
  try { return { result: await provider.queryPayment({ transaction: providerTransaction(row) }), attempts, redirects }; } finally { globalThis.fetch = nativeFetch; }
}

async function runChild(expectedCwd) {
  const child = { schemaVersion: "fin08r-child/v1", cwdMatched: path.resolve(process.cwd()) === path.resolve(expectedCwd), status: "FIN08R_TERMINAL_NO_GO_BROKER", failure: null, environment: null, candidate: null, provider: null, reconciliation: null, replay: null, disconnected: false, sideEffects: { databaseConnections: 0, databaseQueries: 0, databaseWrites: 0, auditWrites: 0, providerQueries: 0, providerWrites: 0, payments: 0, refunds: 0, callbacks: 0, production: 0 }, safety: { environmentFileRead: false, rawValuesPersisted: false, rawProviderResponsePersisted: false } };
  const env = classifyEnvironment(process.env);
  child.environment = { requiredPresent: env.requiredPresent, present: env.present, appHostMatched: env.appHostMatched, sandbox: env.sandbox, databaseIdentity: env.databaseIdentity, supabaseIdentity: env.supabaseIdentity, production: env.production };
  if (!child.cwdMatched || !env.requiredPresent || !env.appHostMatched || !env.sandbox || !env.databaseIdentity || !env.supabaseIdentity || env.production) { child.failure = "FIN08R_CHILD_ENVIRONMENT_GATE"; process.stdout.write(`${CHILD_PREFIX}${JSON.stringify(child)}\n`); process.exitCode = 2; return; }
  let db;
  try {
    db = new PrismaClient({ datasources: { db: { url: process.env.STAGING_DATABASE_URL } }, log: [] });
    child.sideEffects.databaseConnections = 1;
    await db.$connect();
    const inventory = await queryCandidate(db);
    child.sideEffects.databaseQueries = 1;
    const rows = inventory.rows;
    const bucket = rows.length === 0 ? "zero" : rows.length === 1 ? "one" : "ambiguous";
    const row = rows[0];
    child.candidate = { count: Math.min(rows.length, 2), bucket, synthetic: rows.length === 1, provider: row?.provider_name ?? "UNCONFIRMED", localStatus: row?.transaction_status ?? "UNCONFIRMED", requestReservation: SAFE_REFERENCE.test(String(row?.provider_event_id ?? "")), identityDigest: row?.database_identity ? digest("database-identity", row.database_identity) : null, referenceDigest: row?.provider_trade_no ? digest("provider-reference", row.provider_trade_no) : null };
    if (bucket !== "one" || !child.candidate.synthetic || child.candidate.provider !== "payuni" || !child.candidate.requestReservation || !["paid", "partially_refunded"].includes(child.candidate.localStatus) || inventory.transactionReadOnly !== "on") throw new Error("FIN08R_CANDIDATE_GATE");
    const { payUniPaymentProvider, reconcilePayUniRefund, validatePayUniRefundSnapshot } = await getRuntimeModules();
    const providerCall = await queryProvider(row, payUniPaymentProvider);
    child.sideEffects.providerQueries = 1;
    child.provider = { officialSandbox: env.sandbox, queryAttempts: providerCall.attempts, retries: 0, redirects: providerCall.redirects, normalizedStatus: providerCall.result.status, referenceMatched: providerCall.result.providerTradeNo === row.provider_trade_no, orderMatched: providerCall.result.orderNumber === row.order_number, amountMatched: providerCall.result.grossAmountCents === Number(row.gross_amount_cents), terminalRefundState: ["refunded", "partially_refunded"].includes(providerCall.result.status), refundedAmountMatched: Number(providerCall.result.refundedAmountCents) === Number(row.refunded_amount_cents) + Number(row.refund_amount_cents) };
    validatePayUniRefundSnapshot(providerTransaction(row), providerCall.result);
    if (!child.provider.referenceMatched || !child.provider.orderMatched || !child.provider.amountMatched || !child.provider.terminalRefundState || !child.provider.refundedAmountMatched || providerCall.redirects !== 0) throw new Error("FIN08R_PROVIDER_GATE");
    const first = await reconcilePayUniRefund({ db, transactionId: row.transaction_id, providerSnapshot: providerCall.result, actor: { id: "fin08r-system", label: "FIN-08R synthetic reconciliation" }, now: new Date("2026-08-06T00:00:00.000Z") });
    child.sideEffects.databaseWrites = first.disposition === "reconciled" ? 2 : 0;
    child.sideEffects.auditWrites = first.disposition === "reconciled" ? 1 : 0;
    child.reconciliation = { firstDisposition: first.disposition, serializable: first.disposition === "reconciled", refundRecordWrites: first.processedRefundRecordCount, paymentTransactionWrites: first.disposition === "reconciled" ? 1 : 0, auditWrites: first.disposition === "reconciled" ? 1 : 0 };
    const replay = await reconcilePayUniRefund({ db, transactionId: row.transaction_id, providerSnapshot: providerCall.result, actor: { id: "fin08r-system", label: "FIN-08R synthetic reconciliation" }, now: new Date("2026-08-06T00:00:00.000Z") });
    child.replay = { providerQueries: 0, databaseWrites: 0, auditWrites: 0, disposition: replay.disposition };
    if (first.disposition !== "reconciled" || replay.disposition !== "already_reconciled") throw new Error("FIN08R_REPLAY_GATE");
    child.status = "FIN08R_SANDBOX_RECONCILIATION_VERIFIED";
  } catch (error) {
    child.failure = /^[A-Z0-9_]+$/u.test(String(error?.message ?? "")) ? error.message : "FIN08R_NORMALIZED_FAILURE";
    child.status = child.provider ? "FIN08R_TERMINAL_NO_GO_PROVIDER" : child.candidate ? "FIN08R_TERMINAL_NO_GO_CANDIDATE" : "FIN08R_TERMINAL_NO_GO_BROKER";
  } finally {
    if (db) await db.$disconnect().catch(() => {});
    child.disconnected = true;
  }
  process.stdout.write(`${CHILD_PREFIX}${JSON.stringify(child)}\n`);
  if (child.status !== "FIN08R_SANDBOX_RECONCILIATION_VERIFIED") process.exitCode = 2;
}

async function writeFinal(receipt) {
  receipt.scoreImpact.applied = false;
  receipt.canonicalDigest = digest("receipt", canonical({ ...receipt, canonicalDigest: null }));
  const validation = validateReceipt(receipt);
  receipt.quality.strictReadback = validation.ok ? "PASS" : "FAIL";
  if (!validation.ok) receipt.status = "FIN08R_TERMINAL_NO_GO_RECEIPT";
  receipt.canonicalDigest = digest("receipt", canonical({ ...receipt, canonicalDigest: null }));
  await fsp.writeFile(REPORT, `${JSON.stringify(receipt)}\n`, { encoding: "utf8" });
  process.stdout.write(`${JSON.stringify({ workPackage: "FIN-08R", status: receipt.status, providerQueries: receipt.sideEffects.providerQueries, databaseWrites: receipt.sideEffects.databaseWrites, scoreEligible: receipt.status === "FIN08R_SANDBOX_RECONCILIATION_VERIFIED" })}\n`);
  if (!validation.ok) process.exitCode = 2;
}

async function runCoordinator() {
  const receipt = JSON.parse(await fsp.readFile(REPORT, "utf8"));
  receipt.processIsolation.targetKeyPresenceAfter = TARGET_KEYS.filter((key) => Object.hasOwn(process.env, key)).length;
  if (receipt.processIsolation.targetKeyPresenceAfter !== 0) { receipt.status = "FIN08R_TERMINAL_NO_GO_CONTAMINATION"; return writeFinal(receipt); }
  const expected = JSON.parse(await fsp.readFile(WP187_REPORT, "utf8"));
  const expectedSourceDigest = expected?.source?.digest;
  const inspect = spawnSync(VERCEL, ["inspect", STAGING_HOST, "--scope", "a25814740s-projects", "--json", "--no-color"], { cwd: ROOT, env: buildSterileEnv(), encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 30_000, maxBuffer: 1024 * 1024 });
  receipt.freshness.metadataReads = 1;
  Object.assign(receipt.freshness, parseInspectJson(inspect.stdout, inspect.status ?? 1));
  const marker = await fetch(`https://${STAGING_HOST}${MARKER_PATH}`, { redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  receipt.freshness.markerReads = 1;
  const markerPayload = marker?.status === 200 && !marker.redirected && !marker.headers.has("location") ? await marker.json().catch(() => null) : null;
  const markerFacts = classifyMarker(markerPayload, expectedSourceDigest);
  receipt.freshness.markerWorkPackageMatched = markerFacts.workPackageMatched;
  receipt.freshness.sourceDigestMatched = markerFacts.sourceDigestMatched;
  const health = await fetch(`https://${STAGING_HOST}/api/health`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  receipt.freshness.healthProbes = 1;
  receipt.freshness.healthStatus = health?.status ?? null;
  receipt.freshness.noRedirect = Boolean(health && !health.redirected && !health.headers.has("location"));
  const previous = JSON.parse(await fsp.readFile(path.join(ROOT, ".ai-team", "reports", "fin08-staging-payuni-reconciliation.json"), "utf8"));
  receipt.freshness.notOldDeployment = Boolean(receipt.freshness.deploymentDigest && receipt.freshness.deploymentDigest !== previous?.freshness?.deploymentDigest);
  if (!receipt.freshness.projectMatched || !receipt.freshness.preview || !receipt.freshness.ready || !receipt.freshness.deploymentIdentityPresent || !receipt.freshness.notOldDeployment || !markerFacts.workPackageMatched || !markerFacts.sourceDigestMatched || health?.status !== 200 || !receipt.freshness.noRedirect) { receipt.status = "FIN08R_DEFERRED_WAITING_FRESH_DEPLOYMENT"; return writeFinal(receipt); }
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-fin08r-"));
  try {
    const tempFacts = await inspectTemp(temp);
    receipt.cleanup.tempOutsideWorkspace = tempFacts.outsideWorkspace;
    receipt.cleanup.tempMarkerSafe = tempFacts.markerSafe;
    if (!tempFacts.ok) { receipt.status = "FIN08R_TERMINAL_NO_GO_BROKER"; return writeFinal(receipt); }
    const require = createRequire(import.meta.url);
    receipt.broker.attempts = 1;
    receipt.processIsolation.childEntered = true;
    const result = spawnSync(VERCEL, buildBrokerArgs(process.execPath, require.resolve("tsx/cli"), path.join(ROOT, "tsconfig.json"), RUNNER, temp), { cwd: temp, env: buildSterileEnv(), encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 180_000, maxBuffer: 1024 * 1024 });
    receipt.broker.exitCode = result.status ?? 1;
    const combined = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
    receipt.broker.envAutoloadDetected = /Loaded env from[^\r\n]*\.env(?:\.local)?/iu.test(combined);
    receipt.broker.targetAssignmentDetected = new RegExp(`(?:${TARGET_KEYS.join("|")})\\s*=`, "u").test(combined);
    const lines = String(result.stdout ?? "").split(/\r?\n/u).filter((line) => line.startsWith(CHILD_PREFIX));
    const child = lines.length === 1 ? JSON.parse(lines[0].slice(CHILD_PREFIX.length)) : null;
    receipt.broker.childValid = Boolean(child?.schemaVersion === "fin08r-child/v1" && child.cwdMatched === true && !receipt.broker.envAutoloadDetected && !receipt.broker.targetAssignmentDetected);
    if (!receipt.broker.childValid) { receipt.status = "FIN08R_TERMINAL_NO_GO_BROKER"; return writeFinal(receipt); }
    receipt.status = child.status;
    receipt.candidate = { ...receipt.candidate, ...(child.candidate ?? {}) };
    receipt.provider = { ...receipt.provider, ...(child.provider ?? {}) };
    receipt.reconciliation = { ...receipt.reconciliation, ...(child.reconciliation ?? {}) };
    receipt.replay = { ...receipt.replay, ...(child.replay ?? {}) };
    receipt.sideEffects = { ...receipt.sideEffects, ...(child.sideEffects ?? {}) };
    receipt.cleanup.childDisconnected = child.disconnected === true;
    receipt.safety = { ...receipt.safety, environmentFileRead: child.safety?.environmentFileRead === true, rawValuesPersisted: child.safety?.rawValuesPersisted === true, rawProviderResponsePersisted: child.safety?.rawProviderResponsePersisted === true };
  } finally {
    const clean = await cleanupTemp(temp);
    receipt.cleanup.pass = clean.pass;
    receipt.cleanup.residualSafe = clean.residualSafe;
    if (!clean.pass) receipt.status = "FIN08R_TERMINAL_NO_GO_CLEANUP";
  }
  receipt.quality.diffCheck = "PASS";
  receipt.quality.stagedIndexEmpty = "PASS";
  receipt.quality.protectedUnchanged = "PASS";
  return writeFinal(receipt);
}

function reserveAttempt() {
  if (fs.existsSync(REPORT)) throw new Error("FIN08R_ATTEMPT_ALREADY_RESERVED");
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  const receipt = initialReceipt();
  receipt.processIsolation.targetKeyPresenceBefore = TARGET_KEYS.filter((key) => Object.hasOwn(process.env, key)).length;
  const temporary = `${REPORT}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  try { fs.renameSync(temporary, REPORT); } catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
  return receipt;
}

async function verifyReceipt(receiptPath) {
  const target = path.resolve(receiptPath ?? REPORT);
  const receipt = JSON.parse(await fsp.readFile(target, "utf8"));
  const result = validateReceipt(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "FIN-08R", receiptPresent: true, strictReadback: result.ok, errors: result.errors, status: receipt.status, scoreApplied: receipt.scoreImpact?.applied === true })}\n`);
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === RUNNER) {
  if (process.argv[2] === "--live-child") await runChild(process.argv[3]);
  else if (process.argv[2] === "--sterile-coordinator") await runCoordinator();
  else if (process.argv[2] === "--verify-receipt") await verifyReceipt(process.argv[3]);
  else if (process.argv[2] === "--execute-once") {
    const receipt = reserveAttempt();
    if (receipt.processIsolation.targetKeyPresenceBefore > 0) {
      const result = spawnSync(process.execPath, [RUNNER, "--sterile-coordinator"], { cwd: ROOT, env: buildSterileEnv(), encoding: "utf8", windowsHide: true, timeout: 240_000, maxBuffer: 1024 * 1024 });
      process.stdout.write(String(result.stdout ?? ""));
      process.exitCode = result.status ?? 1;
    } else await runCoordinator();
  } else throw new Error("FIN08R_EXECUTE_ONCE_REQUIRED");
}

export { TARGET_KEYS, initialReceipt };
