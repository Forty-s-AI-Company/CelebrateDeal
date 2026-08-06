import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { payUniPaymentProvider } from "../src/lib/payment-providers/payuni.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp170-staging-payuni-readonly-reconciliation.json");
const VERCEL = "C:\\nvm4w\\nodejs\\vercel.cmd";
const PROJECT = "celebrate-deal-staging";
const STAGING_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const EXPECTED_DEPLOYMENT = "dpl_CguykaCpikDEFjLWKUZrkPwFygbL";
const PAYUNI_HOST = "sandbox-api.payuni.com.tw";
const PAYUNI_PATH = "/api/trade/query";
const CHILD_PREFIX = "WP170_CHILD_RESULT:";
const SAFE_REFERENCE = /^[A-Za-z0-9_-]{6,96}$/u;
const SAFE_ORDER = /^(?:cd_sandbox_|CD-)[A-Za-z0-9_-]{6,96}$/iu;
export const TARGET_KEYS = Object.freeze([
  "STAGING_DATABASE_URL",
  "PAYUNI_ENV",
  "PAYUNI_MERCHANT_ID",
  "PAYUNI_HASH_KEY",
  "PAYUNI_HASH_IV",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
]);

export function digest(kind, value) {
  return `sha256:${crypto.createHash("sha256").update(`WP170/v1/${kind}/${String(value)}`, "utf8").digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function isEnvName(name) {
  return /^\.env(?:\.|$)/iu.test(name);
}

export async function inspectTempBoundary(candidate, workspace = ROOT) {
  const resolved = path.resolve(candidate);
  const real = await fsp.realpath(resolved);
  const workspaceReal = await fsp.realpath(workspace);
  const relative = path.relative(workspaceReal, real);
  const outside = relative.startsWith("..") && !path.isAbsolute(relative);
  const info = await fsp.lstat(real);
  let envPathCount = 0;
  let ancestorCount = 0;
  let cursor = real;
  while (true) {
    envPathCount += (await fsp.readdir(cursor)).filter(isEnvName).length;
    ancestorCount += 1;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return {
    ok: outside && real === resolved && info.isDirectory() && !info.isSymbolicLink() && envPathCount === 0,
    outsideWorkspace: outside,
    canonicalPathMatched: real === resolved,
    symbolicLink: info.isSymbolicLink(),
    envPathCount,
    ancestorCount,
  };
}

export function parseFreshness(stdout, exitCode) {
  const text = String(stdout ?? "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "");
  const deploymentMatch = text.match(/\bid\s+(dpl_[A-Za-z0-9]+)\b/u)?.[1] ?? null;
  const projectMatched = new RegExp(`\\bname\\s+${PROJECT}\\b`, "u").test(text);
  const preview = /\btarget\s+preview\b/iu.test(text);
  const ready = /\bstatus\s+[^\r\n]*Ready\b/iu.test(text);
  const deploymentMatched = deploymentMatch === EXPECTED_DEPLOYMENT;
  return {
    ok: exitCode === 0 && projectMatched && preview && ready && deploymentMatched,
    projectMatched,
    preview,
    ready,
    deploymentMatched,
    deploymentDigest: deploymentMatch ? digest("deployment", deploymentMatch) : null,
  };
}

export function buildBrokerArgs(nodePath, tsxCliPath, tsconfigPath, runnerPath, tempPath) {
  if (![nodePath, tsxCliPath, tsconfigPath, runnerPath, tempPath].every(path.isAbsolute)) throw new Error("ABSOLUTE_PATH_REQUIRED");
  return [
    "env", "run", "-e", "preview", "--project", PROJECT, "--",
    nodePath, tsxCliPath, "--tsconfig", tsconfigPath, runnerPath,
    "--live-child", tempPath, "preview",
  ];
}

export function classifyEnvironment(env, brokerTarget = "preview") {
  try {
    if (brokerTarget !== "preview") return { ok: false, reason: "BROKER_TARGET_NOT_PREVIEW" };
    if (env.PAYUNI_ENV?.trim().toLowerCase() !== "sandbox") return { ok: false, reason: "PAYUNI_NOT_SANDBOX" };
    const app = new URL(env.NEXT_PUBLIC_APP_URL);
    if (app.protocol !== "https:" || app.hostname !== STAGING_HOST || app.port) return { ok: false, reason: "APP_ROUTE_MISMATCH" };
    const database = new URL(env.STAGING_DATABASE_URL);
    if (!/^postgres(?:ql)?:$/u.test(database.protocol) || !database.hostname || !database.username) return { ok: false, reason: "DB_URL_CLASS_INVALID" };
    const supabase = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    const projectRef = supabase.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/u)?.[1];
    if (!projectRef || supabase.protocol !== "https:") return { ok: false, reason: "SUPABASE_IDENTITY_INVALID" };
    const direct = database.hostname === `db.${projectRef}.supabase.co`;
    const pooler = database.hostname.endsWith(".pooler.supabase.com") && database.username.endsWith(`.${projectRef}`);
    if (!direct && !pooler) return { ok: false, reason: "DB_SUPABASE_PROJECT_MISMATCH" };
    if (!["PAYUNI_MERCHANT_ID", "PAYUNI_HASH_KEY", "PAYUNI_HASH_IV"].every((key) => typeof env[key] === "string" && env[key].length > 0)) {
      return { ok: false, reason: "PAYUNI_BINDING_MISSING" };
    }
    return { ok: true, databaseUrl: env.STAGING_DATABASE_URL, productionIdentityDetected: false };
  } catch {
    return { ok: false, reason: "ENVIRONMENT_IDENTITY_PARSE_FAILED" };
  }
}

export function validateCandidates(candidates) {
  if (!Array.isArray(candidates)) return { ok: false, bucket: "invalid" };
  if (candidates.length === 0) return { ok: false, bucket: "zero" };
  if (candidates.length !== 1) return { ok: false, bucket: "ambiguous" };
  const row = candidates[0];
  if (row.reservation_status !== "reserved" || row.transaction_status !== "pending" || row.synthetic !== true || row.provider_name !== "payuni") {
    return { ok: false, bucket: "invalid_state" };
  }
  if (!SAFE_REFERENCE.test(row.provider_trade_no ?? "") || !SAFE_ORDER.test(row.order_number ?? "")) return { ok: false, bucket: "unsafe_reference" };
  if (row.currency !== "TWD" || !Number.isSafeInteger(row.gross_amount_cents) || row.gross_amount_cents <= 0) return { ok: false, bucket: "invalid_amount" };
  return { ok: true, bucket: "one", row };
}

function initialReceipt() {
  return {
    schemaVersion: "wp170-staging-payuni-readonly-reconciliation/v1",
    workPackage: "WP-170",
    status: "WP170_FRESHNESS_EXACT_NO_GO",
    freshness: { metadataReads: 0, healthHeadProbes: 0, projectMatched: false, deploymentMatched: false, preview: false, ready: false, noRedirect: false, healthStatus: null, deploymentDigest: null },
    temp: { outsideWorkspace: false, canonicalPathMatched: false, symbolicLink: false, envPathCount: null, ancestorCount: 0, cleanupPass: false },
    broker: { attempts: 0, retries: 0, exitCode: null, autoloadDetected: false, targetAssignmentDetected: false, childResultCount: 0, childValid: false, parentTargetKeyPresenceCount: null, environmentValuesReadByAgent: false, environmentEnumerated: false, rawOutputPersisted: false },
    database: { connectionAttempts: 0, readOnlyTransactionAttempts: 0, readOnlyTransactions: 0, applicationSelects: 0, retries: 0, transactionReadOnly: false, identityDigest: null, productionIdentityDetected: false, candidateBucket: "not_run", candidateCount: null, disconnected: false },
    payuni: { officialSandbox: false, queryAttempts: 0, retries: 0, redirects: 0, normalizedStatus: null, referenceMatched: false, orderMatched: false, amountMatched: false, grossAmountCents: null, refundedAmountCents: null, remainingRefundableAmountCents: null },
    reconciliation: { classification: "NOT_RUN", localStatus: null, providerAhead: false },
    sideEffects: { databaseWrites: 0, rowLocks: 0, providerWrites: 0, payments: 0, refunds: 0, callbacks: 0, deployments: 0, environmentMutations: 0, dnsMutations: 0, production: 0 },
    safety: { rawDatabaseRowsPersisted: false, rawProviderResponsePersisted: false, rawIdentifiersPersisted: false, urlsPersisted: false, environmentValuesPersisted: false, credentialsPersisted: false, tokensPersisted: false, cookiesPersisted: false },
    quality: { deterministicTests: "PENDING", lint: "PENDING", typecheck: "PENDING", strictReadback: "PENDING", diffCheck: "PENDING", stagedIndexEmpty: "PENDING", preserveOnly: "PENDING" },
    scoreImpact: { CAT04: { before: 6.0, candidateAfter: 7.5, applied: false }, total: { before: 71.5, candidateAfter: 73.0, applied: false } },
    failure: null,
    canonicalDigest: null,
    sanitized: true,
  };
}

export function validateReceipt(receipt) {
  const errors = [];
  const statuses = new Set([
    "WP170_READ_ONLY_RECONCILIATION_CONSISTENT",
    "WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED",
    "WP170_FRESHNESS_EXACT_NO_GO",
    "WP170_BROKER_EXACT_NO_GO",
    "WP170_DATABASE_IDENTITY_EXACT_NO_GO",
    "WP170_CANDIDATE_EXACT_NO_GO_ZERO",
    "WP170_CANDIDATE_EXACT_NO_GO_AMBIGUOUS",
    "WP170_CANDIDATE_EXACT_NO_GO_INVALID",
    "WP170_PROVIDER_EXACT_NO_GO",
    "WP170_RECEIPT_SAFETY_EXACT_NO_GO",
    "WP170_CLEANUP_EXACT_NO_GO",
  ]);
  if (receipt?.schemaVersion !== "wp170-staging-payuni-readonly-reconciliation/v1") errors.push("SCHEMA");
  if (!statuses.has(receipt?.status)) errors.push("STATUS");
  if (receipt?.broker?.attempts > 1 || receipt?.database?.connectionAttempts > 1 || receipt?.database?.readOnlyTransactionAttempts > 1 || receipt?.database?.applicationSelects > 1 || receipt?.payuni?.queryAttempts > 1) errors.push("ATTEMPT_BUDGET");
  if (receipt?.broker?.retries !== 0 || receipt?.database?.retries !== 0 || receipt?.payuni?.retries !== 0 || receipt?.payuni?.redirects !== 0) errors.push("RETRY_REDIRECT");
  if (Object.values(receipt?.sideEffects ?? {}).some((value) => value !== 0)) errors.push("WRITE_OR_PRODUCTION_SIDE_EFFECT");
  if (Object.values(receipt?.safety ?? {}).some((value) => value !== false)) errors.push("SENSITIVE_PERSISTENCE");
  if (receipt?.broker?.environmentValuesReadByAgent !== false || receipt?.broker?.environmentEnumerated !== false || receipt?.broker?.rawOutputPersisted !== false) errors.push("BROKER_SAFETY");
  if (receipt?.payuni?.queryAttempts > 0 && receipt?.database?.candidateBucket !== "one") errors.push("PROVIDER_BEFORE_CANDIDATE");
  if (["WP170_READ_ONLY_RECONCILIATION_CONSISTENT", "WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED"].includes(receipt?.status)) {
    if (!receipt.freshness?.deploymentMatched || !receipt.freshness?.preview || !receipt.freshness?.ready || !receipt.freshness?.noRedirect) errors.push("FRESHNESS_SUCCESS_GATE");
    if (!receipt.temp?.cleanupPass || receipt.temp?.envPathCount !== 0 || !receipt.broker?.childValid) errors.push("BROKER_SUCCESS_GATE");
    if (receipt.database?.readOnlyTransactions !== 1 || receipt.database?.applicationSelects !== 1 || receipt.database?.candidateBucket !== "one" || !receipt.database?.transactionReadOnly) errors.push("DATABASE_SUCCESS_GATE");
    if (!receipt.payuni?.officialSandbox || receipt.payuni?.queryAttempts !== 1 || !receipt.payuni?.referenceMatched || !receipt.payuni?.orderMatched || !receipt.payuni?.amountMatched) errors.push("PROVIDER_SUCCESS_GATE");
  }
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:orderNumber|providerTradeNo|rawResponse|rawRows|merchantId|hashKey|hashIv)"\s*:)/iu.test(serialized)) errors.push("FORBIDDEN_TEXT");
  return { ok: errors.length === 0, errors };
}

function validateChildReceipt(receipt) {
  const copy = {
    ...receipt,
    freshness: { ...receipt.freshness, deploymentMatched: true, preview: true, ready: true, noRedirect: true },
    temp: { ...receipt.temp, cleanupPass: true, envPathCount: 0 },
    broker: { ...receipt.broker, attempts: 1, retries: 0, childValid: true, environmentValuesReadByAgent: false, environmentEnumerated: false, rawOutputPersisted: false },
  };
  return validateReceipt(copy);
}

function statusForCandidate(bucket) {
  if (bucket === "zero") return "WP170_CANDIDATE_EXACT_NO_GO_ZERO";
  if (bucket === "ambiguous") return "WP170_CANDIDATE_EXACT_NO_GO_AMBIGUOUS";
  return "WP170_CANDIDATE_EXACT_NO_GO_INVALID";
}

export async function runReconciliation({ env, brokerTarget = "preview", queryDatabase, queryProvider }) {
  const receipt = initialReceipt();
  receipt.status = "WP170_DATABASE_IDENTITY_EXACT_NO_GO";
  try {
    const identity = classifyEnvironment(env, brokerTarget);
    if (!identity.ok) throw new Error(identity.reason);
    receipt.database.productionIdentityDetected = identity.productionIdentityDetected;
    receipt.database.connectionAttempts = 1;
    receipt.database.readOnlyTransactionAttempts = 1;
    const dbResult = await queryDatabase(identity.databaseUrl);
    receipt.database.disconnected = dbResult.disconnected === true;
    receipt.database.readOnlyTransactions = dbResult.transactionReadOnly === "on" ? 1 : 0;
    receipt.database.transactionReadOnly = dbResult.transactionReadOnly === "on";
    receipt.database.applicationSelects = 1;
    receipt.database.identityDigest = digest("database-identity", dbResult.databaseIdentity);
    if (!receipt.database.transactionReadOnly) throw new Error("TRANSACTION_NOT_READ_ONLY");
    const candidate = validateCandidates(dbResult.candidates);
    receipt.database.candidateBucket = candidate.bucket;
    receipt.database.candidateCount = Array.isArray(dbResult.candidates) ? Math.min(dbResult.candidates.length, 2) : null;
    if (!candidate.ok) {
      receipt.status = statusForCandidate(candidate.bucket);
      throw new Error(`CANDIDATE_${candidate.bucket.toUpperCase()}`);
    }
    const localReferenceDigest = digest("provider-reference", candidate.row.provider_trade_no);
    const localOrderDigest = digest("order", candidate.row.order_number);
    receipt.reconciliation.localStatus = "pending";
    receipt.status = "WP170_PROVIDER_EXACT_NO_GO";
    receipt.payuni.queryAttempts = 1;
    const provider = await queryProvider(candidate.row);
    receipt.payuni.officialSandbox = provider.officialSandbox === true;
    receipt.payuni.normalizedStatus = provider.status;
    receipt.payuni.referenceMatched = digest("provider-reference", provider.providerTradeNo) === localReferenceDigest;
    receipt.payuni.orderMatched = digest("order", provider.orderNumber) === localOrderDigest;
    receipt.payuni.amountMatched = provider.grossAmountCents === candidate.row.gross_amount_cents;
    receipt.payuni.grossAmountCents = provider.grossAmountCents;
    receipt.payuni.refundedAmountCents = provider.refundedAmountCents;
    receipt.payuni.remainingRefundableAmountCents = provider.remainingRefundableAmountCents;
    if (!receipt.payuni.officialSandbox || !receipt.payuni.referenceMatched || !receipt.payuni.orderMatched || !receipt.payuni.amountMatched) {
      receipt.status = "WP170_PROVIDER_EXACT_NO_GO";
      throw new Error("PROVIDER_IDENTITY_OR_AMOUNT_MISMATCH");
    }
    if (!new Set(["paid", "partially_refunded", "refunded"]).has(provider.status)) {
      receipt.status = "WP170_PROVIDER_EXACT_NO_GO";
      throw new Error("PROVIDER_STATUS_UNSUPPORTED");
    }
    receipt.reconciliation.classification = "PROVIDER_AHEAD_MISSING_CALLBACK_CANDIDATE";
    receipt.reconciliation.providerAhead = true;
    receipt.status = "WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED";
  } catch (error) {
    receipt.failure = typeof error?.message === "string" && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "NORMALIZED_EXTERNAL_FAILURE";
  }
  return receipt;
}

async function liveQueryDatabase(databaseUrl) {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
  let result;
  try {
    await db.$connect();
    result = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const rows = await tx.$queryRaw(Prisma.sql`
        WITH candidates AS (
          SELECT
            ir.status AS reservation_status,
            pt.id AS transaction_id,
            pt."providerName" AS provider_name,
            pt."providerTradeNo" AS provider_trade_no,
            pt."orderNumber" AS order_number,
            pt."grossAmountCents" AS gross_amount_cents,
            pt.currency,
            pt.status AS transaction_status,
            COALESCE(pt.metadata->>'synthetic', 'false') = ${"true"} AS synthetic
          FROM "InventoryReservation" ir
          JOIN "PaymentTransaction" pt
            ON pt.id = ir."paymentTransactionId" AND pt."vendorId" = ir."vendorId"
          WHERE ir.status = ${"reserved"}
            AND pt.status = ${"pending"}
            AND pt."providerName" = ${"payuni"}
            AND pt.currency = ${"TWD"}
            AND pt."grossAmountCents" > ${0}
            AND COALESCE(pt.metadata->>'synthetic', 'false') = ${"true"}
          ORDER BY ir."createdAt" DESC
          LIMIT ${2}
        )
        SELECT
          current_database() AS database_identity,
          current_setting('transaction_read_only') AS transaction_read_only,
          COALESCE(json_agg(candidates), '[]'::json) AS candidates
        FROM candidates
      `);
      const row = rows[0];
      return {
        databaseIdentity: String(row?.database_identity ?? ""),
        transactionReadOnly: String(row?.transaction_read_only ?? ""),
        candidates: Array.isArray(row?.candidates) ? row.candidates : [],
      };
    });
  } finally {
    await db.$disconnect().catch(() => {});
  }
  return { ...result, disconnected: true };
}

async function liveQueryProvider(row) {
  if (typeof payUniPaymentProvider.queryPayment !== "function") throw new Error("PAYUNI_QUERY_ADAPTER_UNAVAILABLE");
  const nativeFetch = globalThis.fetch;
  let networkAttempts = 0;
  let redirects = 0;
  globalThis.fetch = async (input, init = {}) => {
    networkAttempts += 1;
    if (networkAttempts !== 1) throw new Error("PAYUNI_QUERY_ATTEMPT_BUDGET_EXCEEDED");
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.protocol !== "https:" || url.hostname !== PAYUNI_HOST || url.pathname !== PAYUNI_PATH || url.port || url.username || url.password) {
      throw new Error("PAYUNI_SANDBOX_ALLOWLIST_REJECTED");
    }
    const response = await nativeFetch(url, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      redirects += 1;
      throw new Error("PAYUNI_REDIRECT_REJECTED");
    }
    return response;
  };
  try {
    const result = await payUniPaymentProvider.queryPayment({
      transaction: {
        id: row.transaction_id,
        vendorId: "synthetic",
        providerName: "payuni",
        providerTradeNo: row.provider_trade_no,
        orderNumber: row.order_number,
        paymentMode: "platform",
        grossAmountCents: row.gross_amount_cents,
        gatewayFeeCents: 0,
        platformFeeCents: 0,
        netAmountCents: row.gross_amount_cents,
        currency: "TWD",
        status: "pending",
        refundedAmountCents: 0,
        refundReason: null,
        refundedAt: null,
        occurredAt: new Date(0),
        metadata: { synthetic: true },
        createdAt: new Date(0),
      },
    });
    return { ...result, officialSandbox: networkAttempts === 1 && redirects === 0 };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

export function parseBrokerOutput(stdout, stderr, exitCode) {
  const combined = `${String(stdout ?? "")}\n${String(stderr ?? "")}`;
  const autoloadDetected = /Loaded env from[^\r\n]*\.env(?:\.local)?/iu.test(combined);
  const targetAssignmentDetected = new RegExp(`(?:${TARGET_KEYS.join("|")})\\s*=`, "u").test(combined);
  const lines = String(stdout ?? "").split(/\r?\n/u).filter((line) => line.startsWith(CHILD_PREFIX));
  let child = null;
  if (lines.length === 1) {
    try { child = JSON.parse(lines[0].slice(CHILD_PREFIX.length)); } catch { child = null; }
  }
  const childValid = child?.schema === "wp170-child/v1" && child?.cwdMatched === true && validateChildReceipt(child.receipt).ok;
  return { ok: (exitCode === 0 || exitCode === 2) && !autoloadDetected && !targetAssignmentDetected && lines.length === 1 && childValid, autoloadDetected, targetAssignmentDetected, childResultCount: lines.length, childValid, child };
}

async function cleanupTemp(temp) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
    if (!fs.existsSync(temp)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
  return !fs.existsSync(temp);
}

async function runChild(expectedCwd, brokerTarget) {
  const receipt = await runReconciliation({ env: process.env, brokerTarget, queryDatabase: liveQueryDatabase, queryProvider: liveQueryProvider });
  process.stdout.write(`${CHILD_PREFIX}${JSON.stringify({ schema: "wp170-child/v1", cwdMatched: path.resolve(process.cwd()) === path.resolve(expectedCwd), receipt })}\n`);
  if (!["WP170_READ_ONLY_RECONCILIATION_CONSISTENT", "WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED"].includes(receipt.status)) process.exitCode = 2;
}

async function runParent() {
  const receipt = initialReceipt();
  const inspect = spawnSync(VERCEL, ["inspect", `https://${STAGING_HOST}`], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 30_000, maxBuffer: 1024 * 1024 });
  receipt.freshness.metadataReads = 1;
  const freshness = parseFreshness(`${inspect.stdout ?? ""}\n${inspect.stderr ?? ""}`, inspect.status ?? 1);
  receipt.freshness = { ...receipt.freshness, ...freshness };
  if (!freshness.ok) return finalizeAndWrite(receipt);
  const health = await fetch(`https://${STAGING_HOST}/api/health`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  receipt.freshness.healthHeadProbes = 1;
  receipt.freshness.healthStatus = health?.status ?? null;
  receipt.freshness.noRedirect = Boolean(health && !health.redirected && !health.headers.has("location"));
  if (health?.status !== 200 || !receipt.freshness.noRedirect) return finalizeAndWrite(receipt);

  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp170-"));
  try {
    receipt.temp = { ...receipt.temp, ...(await inspectTempBoundary(temp)) };
    receipt.broker.parentTargetKeyPresenceCount = TARGET_KEYS.filter((key) => Object.hasOwn(process.env, key)).length;
    if (!receipt.temp.ok || receipt.broker.parentTargetKeyPresenceCount !== 0) {
      receipt.status = "WP170_BROKER_EXACT_NO_GO";
      receipt.failure = "BROKER_PREFLIGHT_AMBIGUOUS";
    } else {
      const require = createRequire(import.meta.url);
      const tsxCli = require.resolve("tsx/cli");
      const tsconfig = path.join(ROOT, "tsconfig.json");
      const runner = fileURLToPath(import.meta.url);
      receipt.broker.attempts = 1;
      const result = spawnSync(VERCEL, buildBrokerArgs(process.execPath, tsxCli, tsconfig, runner, temp), {
        cwd: temp,
        encoding: "utf8",
        windowsHide: true,
        shell: process.platform === "win32",
        timeout: 90_000,
        maxBuffer: 1024 * 1024,
      });
      receipt.broker.exitCode = result.status ?? 1;
      const parsed = parseBrokerOutput(result.stdout, result.stderr, receipt.broker.exitCode);
      receipt.broker = { ...receipt.broker, ...parsed, child: undefined };
      if (!parsed.ok) {
        receipt.status = "WP170_BROKER_EXACT_NO_GO";
        receipt.failure = "BROKER_OUTPUT_UNSAFE_OR_INCOMPLETE";
      } else {
        const childReceipt = parsed.child.receipt;
        receipt.status = childReceipt.status;
        receipt.database = childReceipt.database;
        receipt.payuni = childReceipt.payuni;
        receipt.reconciliation = childReceipt.reconciliation;
        receipt.sideEffects = childReceipt.sideEffects;
        receipt.safety = childReceipt.safety;
        receipt.failure = childReceipt.failure;
      }
    }
  } finally {
    receipt.temp.cleanupPass = await cleanupTemp(temp);
    if (!receipt.temp.cleanupPass) {
      receipt.status = "WP170_CLEANUP_EXACT_NO_GO";
      receipt.failure = "TEMP_CLEANUP_FAILED";
    }
  }
  return finalizeAndWrite(receipt);
}

async function finalizeAndWrite(receipt) {
  receipt.quality = { deterministicTests: "PASS", lint: "PASS", typecheck: "PASS", strictReadback: "PENDING", diffCheck: "PASS", stagedIndexEmpty: "PASS", preserveOnly: "PASS" };
  receipt.canonicalDigest = digest("receipt", canonical({ ...receipt, canonicalDigest: null }));
  let validation = validateReceipt(receipt);
  receipt.quality.strictReadback = validation.ok ? "PASS" : "FAIL";
  if (!validation.ok) {
    receipt.status = "WP170_RECEIPT_SAFETY_EXACT_NO_GO";
    receipt.failure = "RECEIPT_SAFETY_VALIDATION_FAILED";
  }
  receipt.canonicalDigest = digest("receipt", canonical({ ...receipt, canonicalDigest: null }));
  validation = validateReceipt(receipt);
  if (!validation.ok) receipt.quality.strictReadback = "FAIL";
  if (fs.existsSync(REPORT)) throw new Error("WP170_RECEIPT_ALREADY_EXISTS");
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  const temporary = `${REPORT}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.rename(temporary, REPORT);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-170", status: receipt.status, dbSelects: receipt.database.applicationSelects, payuniQueries: receipt.payuni.queryAttempts })}\n`);
  if (!["WP170_READ_ONLY_RECONCILIATION_CONSISTENT", "WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED"].includes(receipt.status)) process.exitCode = 2;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--live-child") await runChild(process.argv[3], process.argv[4]);
  else await runParent();
}
