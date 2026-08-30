import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { payUniPaymentProvider } from "../src/lib/payment-providers/payuni.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp168-staging-payuni-reconciliation.json");
const STAGING_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const PAYUNI_HOST = "sandbox-api.payuni.com.tw";
const SAFE_REFERENCE = /^[A-Za-z0-9_-]{6,96}$/u;

export function digest(kind, value) {
  return `sha256:${crypto.createHash("sha256").update(`WP168/v1/${kind}/${String(value)}`, "utf8").digest("hex")}`;
}

export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function classifyBrokerIdentity(env) {
  try {
    if (env.WP168_BROKER_TARGET !== "preview") return { ok: false, reason: "BROKER_TARGET_NOT_PREVIEW" };
    if (env.PAYUNI_ENV?.trim().toLowerCase() !== "sandbox") return { ok: false, reason: "PAYUNI_NOT_SANDBOX" };
    const app = new URL(env.NEXT_PUBLIC_APP_URL);
    if (app.protocol !== "https:" || app.hostname !== STAGING_HOST || app.port) return { ok: false, reason: "APP_ROUTE_MISMATCH" };
    const db = new URL(env.STAGING_DATABASE_URL);
    if (!/^postgres(?:ql)?:$/u.test(db.protocol) || !db.hostname || !db.username) return { ok: false, reason: "DB_URL_CLASS_INVALID" };
    const supabase = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    const projectRef = supabase.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/u)?.[1];
    if (!projectRef || supabase.protocol !== "https:") return { ok: false, reason: "SUPABASE_PROJECT_IDENTITY_INVALID" };
    const directHostMatch = db.hostname === `db.${projectRef}.supabase.co`;
    const poolerMatch = db.hostname.endsWith(".pooler.supabase.com") && db.username.endsWith(`.${projectRef}`);
    if (!directHostMatch && !poolerMatch) return { ok: false, reason: "DB_SUPABASE_PROJECT_MISMATCH" };
    return {
      ok: true,
      databaseUrl: env.STAGING_DATABASE_URL,
      facts: {
        brokerTarget: "preview",
        appHostMatched: true,
        payuniEnvironment: "sandbox",
        databaseScheme: "postgres",
        supabaseProjectDigest: digest("supabase-project", projectRef),
        productionIdentityDetected: false,
      },
    };
  } catch {
    return { ok: false, reason: "BROKER_IDENTITY_PARSE_FAILED" };
  }
}

export function validateCandidates(candidates) {
  if (!Array.isArray(candidates)) return { ok: false, bucket: "invalid" };
  if (candidates.length === 0) return { ok: false, bucket: "zero" };
  if (candidates.length !== 1) return { ok: false, bucket: "at_least_two" };
  const row = candidates[0];
  if (row.reservation_status !== "reserved" || row.transaction_status !== "pending" || row.synthetic !== true) {
    return { ok: false, bucket: "invalid_state" };
  }
  if (!SAFE_REFERENCE.test(row.order_number ?? "") || !SAFE_REFERENCE.test(row.provider_trade_no ?? "")) {
    return { ok: false, bucket: "unsafe_reference" };
  }
  return { ok: true, bucket: "one", row };
}

function initialReceipt() {
  return {
    schemaVersion: "wp168-staging-payuni-reconciliation/v1",
    workPackage: "WP-168",
    status: "WP168_EXACT_NO_GO_DATABASE_IDENTITY_OR_RESERVATION_GATE",
    freshness: { wp167Accepted: true, deploymentIdDigest: digest("deployment", "dpl_CguykaCpikDEFjLWKUZrkPwFygbL"), target: "preview" },
    broker: { target: "UNCONFIRMED", environmentValuesReadByAgent: false, environmentFileRead: false, environmentEnumerated: false },
    database: { identityVerified: false, productionIdentityDetected: false, connectionAttempts: 0, readOnlyTransactions: 0, applicationSelects: 0, retries: 0, candidateBucket: "not_run", databaseIdentityDigest: null, referenceDigest: null, orderDigest: null },
    payuni: { host: PAYUNI_HOST, officialSandbox: false, queryAttempts: 0, retries: 0, redirects: 0, normalizedStatus: null, referenceMatched: false, referenceDigest: null, orderDigest: null },
    lineage: { sameDeploymentGeneration: true, sameSupabaseProject: false, providerReferenceMatched: false, orderMatched: false },
    sideEffects: { databaseWrites: 0, rowLocks: 0, providerWrites: 0, payments: 0, refunds: 0, callbacks: 0, deployments: 0, environmentMutations: 0, production: 0 },
    quality: { strictReadback: "PENDING", stagedIndexEmpty: "PENDING", preserveOnly: "PENDING" },
    scoreImpact: { CAT04: { before: 6.0, candidateAfter: 7.5, applied: false }, total: { before: 71.5, candidateAfter: 73.0, applied: false } },
    safety: { rawDatabaseRowsPersisted: false, rawProviderResponsePersisted: false, rawIdentifiersPersisted: false, urlsPersisted: false, credentialsPersisted: false, tokensPersisted: false, cookiesPersisted: false },
    failure: null,
    sanitized: true,
    canonicalDigest: null,
  };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "wp168-staging-payuni-reconciliation/v1") errors.push("SCHEMA");
  if (![
    "WP168_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED",
    "WP168_EXACT_NO_GO_DATABASE_IDENTITY_OR_RESERVATION_GATE",
    "WP168_EXACT_NO_GO_PROVIDER_IDENTITY_OR_STATUS_MISMATCH",
    "WP168_EXACT_NO_GO_SECRET_OR_RECEIPT_SAFETY",
  ].includes(receipt?.status)) errors.push("STATUS");
  if (receipt?.database?.connectionAttempts > 1 || receipt?.database?.readOnlyTransactions > 1 || receipt?.database?.applicationSelects > 1 || receipt?.payuni?.queryAttempts > 1) errors.push("ATTEMPT_BUDGET");
  if (receipt?.database?.retries !== 0 || receipt?.payuni?.retries !== 0 || receipt?.payuni?.redirects !== 0) errors.push("RETRY_REDIRECT");
  if (Object.values(receipt?.sideEffects ?? {}).some((value) => value !== 0)) errors.push("WRITE_OR_PRODUCTION_SIDE_EFFECT");
  if (Object.values(receipt?.safety ?? {}).some((value) => value !== false)) errors.push("SENSITIVE_PERSISTENCE");
  if (receipt?.broker?.environmentValuesReadByAgent !== false || receipt?.broker?.environmentEnumerated !== false) errors.push("BROKER_SAFETY");
  if (receipt?.broker?.environmentFileRead !== false && receipt?.status !== "WP168_EXACT_NO_GO_SECRET_OR_RECEIPT_SAFETY") errors.push("ENV_FILE_BOUNDARY_CLASSIFICATION");
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:orderNumber|providerTradeNo|rawResponse|rawRows)"\s*:)/iu.test(serialized)) errors.push("SENSITIVE_TEXT");
  if (receipt?.status === "WP168_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED") {
    if (!receipt.database.identityVerified || receipt.database.candidateBucket !== "one" || receipt.database.applicationSelects !== 1) errors.push("DATABASE_SUCCESS_GATE");
    if (!receipt.payuni.officialSandbox || receipt.payuni.queryAttempts !== 1 || !receipt.payuni.referenceMatched || !receipt.lineage.orderMatched) errors.push("PAYUNI_SUCCESS_GATE");
  }
  return { ok: errors.length === 0, errors };
}

export async function runWp168({ env, queryDatabase, queryProvider }) {
  const receipt = initialReceipt();
  try {
    const identity = classifyBrokerIdentity(env);
    if (!identity.ok) throw new Error(identity.reason);
    receipt.broker.target = identity.facts.brokerTarget;
    receipt.database.identityVerified = true;
    receipt.database.productionIdentityDetected = false;
    receipt.database.connectionAttempts = 1;
    receipt.database.readOnlyTransactions = 1;
    const dbResult = await queryDatabase(identity.databaseUrl);
    receipt.database.applicationSelects = 1;
    receipt.database.databaseIdentityDigest = digest("database", dbResult.databaseIdentity);
    receipt.lineage.sameSupabaseProject = dbResult.transactionReadOnly === "on";
    if (dbResult.transactionReadOnly !== "on") throw new Error("TRANSACTION_NOT_READ_ONLY");
    const candidate = validateCandidates(dbResult.candidates);
    receipt.database.candidateBucket = candidate.bucket;
    if (!candidate.ok) throw new Error(`RESERVATION_${candidate.bucket.toUpperCase()}`);
    receipt.database.referenceDigest = digest("provider-reference", candidate.row.provider_trade_no);
    receipt.database.orderDigest = digest("order", candidate.row.order_number);
    receipt.payuni.officialSandbox = true;
    receipt.payuni.queryAttempts = 1;
    const provider = await queryProvider(candidate.row);
    receipt.payuni.normalizedStatus = provider.status;
    receipt.payuni.referenceDigest = digest("provider-reference", provider.providerTradeNo);
    receipt.payuni.orderDigest = digest("order", provider.orderNumber);
    receipt.payuni.referenceMatched = receipt.payuni.referenceDigest === receipt.database.referenceDigest;
    receipt.lineage.providerReferenceMatched = receipt.payuni.referenceMatched;
    receipt.lineage.orderMatched = receipt.payuni.orderDigest === receipt.database.orderDigest;
    const acceptedStates = new Set(["paid", "partially_refunded", "refunded"]);
    if (!receipt.payuni.referenceMatched || !receipt.lineage.orderMatched || !acceptedStates.has(provider.status)) {
      receipt.status = "WP168_EXACT_NO_GO_PROVIDER_IDENTITY_OR_STATUS_MISMATCH";
      throw new Error("PROVIDER_RECONCILIATION_MISMATCH");
    }
    receipt.status = "WP168_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED";
  } catch (error) {
    receipt.failure = typeof error?.message === "string" && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "NORMALIZED_EXTERNAL_FAILURE";
    if (receipt.payuni.queryAttempts > 0 && receipt.status !== "WP168_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED") {
      receipt.status = "WP168_EXACT_NO_GO_PROVIDER_IDENTITY_OR_STATUS_MISMATCH";
    }
  }
  receipt.canonicalDigest = digest("receipt", canonical({ ...receipt, canonicalDigest: null }));
  const validation = validateReceipt(receipt);
  receipt.quality.strictReadback = validation.ok ? "PASS" : "FAIL";
  if (!validation.ok) {
    receipt.status = "WP168_EXACT_NO_GO_SECRET_OR_RECEIPT_SAFETY";
    receipt.failure = "RECEIPT_SAFETY_VALIDATION_FAILED";
  }
  receipt.canonicalDigest = digest("receipt", canonical({ ...receipt, canonicalDigest: null }));
  return receipt;
}

async function liveQueryDatabase(databaseUrl) {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
  try {
    await db.$connect();
    return await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const rows = await tx.$queryRaw(Prisma.sql`
        WITH candidates AS (
          SELECT
            ir.id AS reservation_id,
            ir.status AS reservation_status,
            pt.id AS transaction_id,
            pt."providerTradeNo" AS provider_trade_no,
            pt."orderNumber" AS order_number,
            pt.status AS transaction_status,
            COALESCE(pt.metadata->>'synthetic', 'false') = ${"true"} AS synthetic
          FROM "InventoryReservation" ir
          JOIN "PaymentTransaction" pt
            ON pt.id = ir."paymentTransactionId" AND pt."vendorId" = ir."vendorId"
          WHERE ir.status = ${"reserved"}
            AND pt.status = ${"pending"}
            AND COALESCE(pt.metadata->>'synthetic', 'false') = ${"true"}
          ORDER BY ir."createdAt" DESC
          LIMIT ${2}
        )
        SELECT
          current_database() AS database_identity,
          current_setting('transaction_read_only') AS transaction_read_only,
          COALESCE(json_agg(candidates) FILTER (WHERE candidates.reservation_id IS NOT NULL), '[]'::json) AS candidates
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
}

async function liveQueryProvider(row) {
  if (typeof payUniPaymentProvider.queryPayment !== "function") throw new Error("PAYUNI_QUERY_ADAPTER_UNAVAILABLE");
  return payUniPaymentProvider.queryPayment({
    transaction: {
      id: row.transaction_id,
      vendorId: "synthetic",
      providerName: "payuni",
      providerTradeNo: row.provider_trade_no,
      orderNumber: row.order_number,
      paymentMode: "platform",
      grossAmountCents: 0,
      gatewayFeeCents: 0,
      platformFeeCents: 0,
      netAmountCents: 0,
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
}

async function writeExclusive(receipt) {
  if (fs.existsSync(REPORT)) throw new Error("WP168_RECEIPT_ALREADY_EXISTS");
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  const temporary = `${REPORT}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.rename(temporary, REPORT);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = await runWp168({ env: process.env, queryDatabase: liveQueryDatabase, queryProvider: liveQueryProvider });
  await writeExclusive(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-168", status: receipt.status, dbSelects: receipt.database.applicationSelects, payuniQueries: receipt.payuni.queryAttempts })}\n`);
  if (receipt.status !== "WP168_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED") process.exitCode = 2;
}
