import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";
import {
  lineUserIdHash,
  protectLineOfficialAccountCredentials,
  protectLineProfileValue,
} from "../src/lib/line-credentials.ts";

export const TASK = "line-notifications-e2e";
export const RECEIPT_NAME = `${TASK}-receipt.json`;
const SAFE_SHA = /^[a-f0-9]{40}$/u;
const SAFE_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const REQUIRED = [
  "STAGING_DATABASE_URL", "CSRF_SECRET", "CRON_SECRET",
  "LINE_STAGING_MESSAGING_CHANNEL_ID", "LINE_STAGING_MESSAGING_CHANNEL_SECRET",
  "LINE_STAGING_MESSAGING_ACCESS_TOKEN", "LINE_STAGING_USER_ID",
  "CELEBRATEDEAL_SOURCE_SHA", "CELEBRATEDEAL_DEPLOYMENT_HOST", "RUNNER_TEMP",
  "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "LINE_STAGING_DATABASE_IDENTITY_SHA256",
];
const TOP_LEVEL_KEYS = [
  "schemaVersion", "task", "result", "sourceCommit", "runRefHash", "checks",
  "sideEffects", "cleanup", "safety", "failureCode",
];

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function digest(label, value) {
  return `sha256:${crypto.createHash("sha256").update(`line-e2e/v1/${label}/${String(value)}`).digest("hex")}`;
}

function initialReceipt(source = process.env) {
  return {
    schemaVersion: "celebratedeal-line-notifications-e2e/v1",
    task: TASK,
    result: "BLOCKED",
    sourceCommit: SAFE_SHA.test(source.CELEBRATEDEAL_SOURCE_SHA ?? "") ? source.CELEBRATEDEAL_SOURCE_SHA : "unknown",
    runRefHash: digest("run", `${source.GITHUB_RUN_ID ?? "unknown"}:${source.GITHUB_RUN_ATTEMPT ?? "unknown"}`),
    checks: {
      isolatedDatabase: false,
      runtimeDatabaseBound: false,
      invalidBearerRejected: false,
      invalidBearerNoWrite: false,
      validBearerAccepted: false,
      materializedCount: 0,
      sentCount: 0,
      deliveryStatus: "not_run",
      attemptCount: 0,
      sentAtPresent: false,
      idempotencyProbePassed: false,
      tenantIsolationPassed: false,
    },
    sideEffects: { cronCalls: 0, logicalLinePushes: 0, budgetExceeded: false },
    cleanup: { attempted: false, verified: false, remainingOwnedRows: 0 },
    safety: { sanitized: true, productionOperations: 0, deployments: 0, aliasMutations: 0 },
    failureCode: null,
  };
}

export function validateInvocation(source = process.env) {
  if (REQUIRED.some((key) => typeof source[key] !== "string" || source[key].length === 0)) return { ok: false, reason: "REQUIRED_BINDING_MISSING" };
  if (!SAFE_SHA.test(source.CELEBRATEDEAL_SOURCE_SHA)) return { ok: false, reason: "SOURCE_SHA_INVALID" };
  if (!SAFE_HOST.test(source.CELEBRATEDEAL_DEPLOYMENT_HOST) || !source.CELEBRATEDEAL_DEPLOYMENT_HOST.endsWith(".vercel.app")) return { ok: false, reason: "DEPLOYMENT_HOST_INVALID" };
  try {
    const database = new URL(source.STAGING_DATABASE_URL);
    const parameters = [...database.searchParams.keys()];
    const schema = database.searchParams.get("schema") ?? "public";
    const username = decodeURIComponent(database.username);
    const port = database.port || "5432";
    const canonicalIdentity = [database.hostname, port, database.pathname, username, schema].join("\n");
    const identityHash = crypto.createHash("sha256").update(canonicalIdentity).digest("hex");
    if (!/^postgres(?:ql)?:$/u.test(database.protocol)
      || !SAFE_HOST.test(database.hostname)
      || database.pathname !== "/postgres"
      || !username
      || !/^\d{2,5}$/u.test(port)
      || schema !== "public"
      || parameters.some((key) => key !== "schema")
      || identityHash !== source.LINE_STAGING_DATABASE_IDENTITY_SHA256) return { ok: false, reason: "DATABASE_BINDING_INVALID" };
  } catch { return { ok: false, reason: "DATABASE_BINDING_INVALID" }; }
  return { ok: true, reason: null };
}

export function validateReceipt(receipt, expected = null) {
  const errors = [];
  if (!exactKeys(receipt, TOP_LEVEL_KEYS)) errors.push("SCHEMA_KEYS");
  if (!exactKeys(receipt?.checks, ["isolatedDatabase", "runtimeDatabaseBound", "invalidBearerRejected", "invalidBearerNoWrite", "validBearerAccepted", "materializedCount", "sentCount", "deliveryStatus", "attemptCount", "sentAtPresent", "idempotencyProbePassed", "tenantIsolationPassed"])) errors.push("CHECK_KEYS");
  if (!exactKeys(receipt?.sideEffects, ["cronCalls", "logicalLinePushes", "budgetExceeded"])) errors.push("SIDE_EFFECT_KEYS");
  if (!exactKeys(receipt?.cleanup, ["attempted", "verified", "remainingOwnedRows"])) errors.push("CLEANUP_KEYS");
  if (!exactKeys(receipt?.safety, ["sanitized", "productionOperations", "deployments", "aliasMutations"])) errors.push("SAFETY_KEYS");
  if (receipt?.schemaVersion !== "celebratedeal-line-notifications-e2e/v1" || receipt?.task !== TASK) errors.push("IDENTITY");
  if (!new Set(["PASS", "FAILED", "BLOCKED"]).has(receipt?.result)) errors.push("RESULT");
  if (!SAFE_SHA.test(receipt?.sourceCommit ?? "") && receipt?.sourceCommit !== "unknown") errors.push("SHA");
  if (!/^sha256:[a-f0-9]{64}$/u.test(receipt?.runRefHash ?? "")) errors.push("HASH");
  if (expected) {
    if (!SAFE_SHA.test(expected.sourceCommit ?? "") || !expected.runId || !expected.runAttempt) errors.push("EXPECTED_BINDING_MISSING");
    else if (receipt?.sourceCommit !== expected.sourceCommit || receipt?.runRefHash !== digest("run", `${expected.runId}:${expected.runAttempt}`)) errors.push("DISPATCH_BINDING_MISMATCH");
  }
  const serialized = JSON.stringify(receipt);
  if (/Bearer\s|postgres(?:ql)?:\/\/|LINE_STAGING_|[?&](?:token|code|secret)=/iu.test(serialized)) errors.push("SENSITIVE_CONTENT");
  if (receipt?.sideEffects?.logicalLinePushes > 1 || receipt?.sideEffects?.cronCalls > 3) errors.push("BUDGET");
  if (receipt?.result === "PASS") {
    const checks = receipt.checks;
    const passChecks = checks?.isolatedDatabase === true
      && checks.runtimeDatabaseBound === true
      && checks.invalidBearerRejected === true
      && checks.invalidBearerNoWrite === true
      && checks.validBearerAccepted === true
      && checks.materializedCount === 1
      && checks.sentCount === 1
      && checks.deliveryStatus === "sent"
      && checks.attemptCount === 1
      && checks.sentAtPresent === true
      && checks.idempotencyProbePassed === true
      && checks.tenantIsolationPassed === true;
    const passSideEffects = receipt.sideEffects?.cronCalls === 3
      && receipt.sideEffects.logicalLinePushes === 1
      && receipt.sideEffects.budgetExceeded === false;
    const passCleanup = receipt.cleanup?.attempted === true
      && receipt.cleanup.verified === true
      && receipt.cleanup.remainingOwnedRows === 0;
    const passSafety = receipt.safety?.sanitized === true
      && receipt.safety.productionOperations === 0
      && receipt.safety.deployments === 0
      && receipt.safety.aliasMutations === 0;
    if (!passChecks || !passSideEffects || !passCleanup || !passSafety || receipt.failureCode !== null) errors.push("PASS_INVARIANT");
  }
  return { ok: errors.length === 0, errors };
}

function safeFailure(error) {
  const code = error instanceof Error ? error.message : "UNKNOWN_FAILURE";
  return /^[A-Z0-9_]{3,80}$/u.test(code) ? code : "UNCLASSIFIED_FAILURE";
}

async function callCron(source, authorization) {
  const response = await fetch(`https://${source.CELEBRATEDEAL_DEPLOYMENT_HOST}/api/cron/line-notifications`, {
    method: "GET",
    headers: { authorization, accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status };
}

async function proveRuntimeDatabaseBinding(source, sentinelId, challenge) {
  const response = await fetch(`https://${source.CELEBRATEDEAL_DEPLOYMENT_HOST}/api/cron/line-notifications/runtime-binding`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${source.CRON_SECRET}`,
      "x-line-staging-sentinel-id": sentinelId,
      "x-line-staging-sentinel-challenge": challenge,
      accept: "application/json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 200) return false;
  const body = await response.json().catch(() => null);
  const expected = createHmac("sha256", source.CRON_SECRET).update(`line-staging-runtime-binding:v1:${sentinelId}:${challenge}`).digest("hex");
  return body?.ok === true && typeof body.proof === "string" && body.proof.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(body.proof), Buffer.from(expected));
}

async function ownedRowCount(db, ids) {
  const [vendor, decoyVendor, form, live, submission, account, decoyAccount, identity, decoyIdentity, delivery, decoyDelivery] = await Promise.all([
    db.vendor.count({ where: { id: ids.vendorId } }), db.vendor.count({ where: { id: ids.decoyVendorId } }),
    db.registrationForm.count({ where: { id: ids.formId, vendorId: ids.vendorId } }),
    db.live.count({ where: { id: ids.liveId, vendorId: ids.vendorId } }),
    db.formSubmission.count({ where: { id: ids.submissionId, form: { vendorId: ids.vendorId } } }),
    db.lineOfficialAccount.count({ where: { id: ids.accountId, vendorId: ids.vendorId } }),
    db.lineOfficialAccount.count({ where: { id: ids.decoyAccountId, vendorId: ids.decoyVendorId } }),
    db.lineUserIdentity.count({ where: { id: ids.identityId, vendorId: ids.vendorId } }),
    db.lineUserIdentity.count({ where: { id: ids.decoyIdentityId, vendorId: ids.decoyVendorId } }),
    db.lineDelivery.count({ where: { vendorId: ids.vendorId } }),
    db.lineDelivery.count({ where: { vendorId: ids.decoyVendorId } }),
  ]);
  return vendor + decoyVendor + form + live + submission + account + decoyAccount + identity + decoyIdentity + delivery + decoyDelivery;
}

async function cleanupOwned(db, ids) {
  await db.$transaction([
    db.lineDelivery.deleteMany({ where: { vendorId: ids.vendorId } }),
    db.lineDelivery.deleteMany({ where: { vendorId: ids.decoyVendorId } }),
    db.lineUserIdentity.deleteMany({ where: { id: ids.identityId, vendorId: ids.vendorId } }),
    db.lineUserIdentity.deleteMany({ where: { id: ids.decoyIdentityId, vendorId: ids.decoyVendorId } }),
    db.lineOfficialAccount.deleteMany({ where: { id: ids.accountId, vendorId: ids.vendorId } }),
    db.lineOfficialAccount.deleteMany({ where: { id: ids.decoyAccountId, vendorId: ids.decoyVendorId } }),
    db.formSubmission.deleteMany({ where: { id: ids.submissionId, form: { vendorId: ids.vendorId } } }),
    db.live.deleteMany({ where: { id: ids.liveId, vendorId: ids.vendorId } }),
    db.registrationForm.deleteMany({ where: { id: ids.formId, vendorId: ids.vendorId } }),
    db.vendor.deleteMany({ where: { id: ids.vendorId } }),
    db.vendor.deleteMany({ where: { id: ids.decoyVendorId } }),
  ]);
}

export async function runLineStagingValidation(source = process.env) {
  const receipt = initialReceipt(source);
  const invocation = validateInvocation(source);
  if (!invocation.ok) { receipt.failureCode = invocation.reason; return receipt; }
  const runKey = digest("fixture", `${source.GITHUB_RUN_ID}:${source.GITHUB_RUN_ATTEMPT}`).slice(7, 31);
  const ids = {
    vendorId: `line-e2e-v-${runKey}`, formId: `line-e2e-f-${runKey}`,
    liveId: `line-e2e-l-${runKey}`, submissionId: `line-e2e-s-${runKey}`,
    accountId: `line-e2e-a-${runKey}`, identityId: `line-e2e-i-${runKey}`,
    decoyVendorId: `line-e2e-dv-${runKey}`, decoyAccountId: `line-e2e-da-${runKey}`,
    decoyIdentityId: `line-e2e-di-${runKey}`,
  };
  const db = new PrismaClient({ datasources: { db: { url: source.STAGING_DATABASE_URL } }, log: [] });
  try {
    const [accounts, identities, deliveries] = await Promise.all([
      db.lineOfficialAccount.count(), db.lineUserIdentity.count(), db.lineDelivery.count(),
    ]);
    if (accounts !== 0 || identities !== 0 || deliveries !== 0) throw new Error("DATABASE_NOT_ISOLATED");
    receipt.checks.isolatedDatabase = true;
    const startedAt = new Date(Date.now() - 60_000);
    const credentials = protectLineOfficialAccountCredentials(ids.vendorId, {
      messagingChannelId: source.LINE_STAGING_MESSAGING_CHANNEL_ID,
      messagingChannelSecret: source.LINE_STAGING_MESSAGING_CHANNEL_SECRET,
      messagingAccessToken: source.LINE_STAGING_MESSAGING_ACCESS_TOKEN,
      loginChannelId: null, loginChannelSecret: null,
    });
    const runtimeChallenge = crypto.randomBytes(32).toString("hex");
    await db.vendor.create({ data: { id: ids.vendorId, name: "LINE staging validation", slug: `line-e2e-${runKey}`, email: `line-e2e-${runKey}@example.invalid`, passwordHash: runtimeChallenge } });
    receipt.checks.runtimeDatabaseBound = await proveRuntimeDatabaseBinding(source, ids.vendorId, runtimeChallenge);
    if (!receipt.checks.runtimeDatabaseBound) throw new Error("PREVIEW_DATABASE_BINDING_MISMATCH");
    await db.registrationForm.create({ data: { id: ids.formId, vendorId: ids.vendorId, name: "LINE staging form", slug: `line-e2e-form-${runKey}`, headline: "LINE staging", fields: [] } });
    await db.live.create({ data: { id: ids.liveId, vendorId: ids.vendorId, formId: ids.formId, title: "LINE staging 開播驗證", slug: `line-e2e-live-${runKey}`, scheduledAt: startedAt, startedAt, status: "live" } });
    await db.formSubmission.create({ data: { id: ids.submissionId, formId: ids.formId, liveId: ids.liveId, name: "LINE staging recipient", email: `line-recipient-${runKey}@example.invalid`, verificationStatus: "VERIFIED", verifiedAt: startedAt } });
    await db.lineOfficialAccount.create({ data: { id: ids.accountId, vendorId: ids.vendorId, ...credentials, status: "active" } });
    await db.lineUserIdentity.create({ data: { id: ids.identityId, vendorId: ids.vendorId, subjectType: "buyer_registration", subjectId: ids.submissionId, lineUserIdHash: lineUserIdHash(ids.vendorId, source.LINE_STAGING_USER_ID), lineUserIdEncrypted: protectLineProfileValue(ids.vendorId, "userId", source.LINE_STAGING_USER_ID) } });
    await db.vendor.create({ data: { id: ids.decoyVendorId, name: "LINE tenant isolation decoy", slug: `line-e2e-decoy-${runKey}`, email: `line-decoy-${runKey}@example.invalid`, passwordHash: "staging-only-no-login" } });
    const decoyCredentials = protectLineOfficialAccountCredentials(ids.decoyVendorId, {
      messagingChannelId: source.LINE_STAGING_MESSAGING_CHANNEL_ID,
      messagingChannelSecret: source.LINE_STAGING_MESSAGING_CHANNEL_SECRET,
      messagingAccessToken: source.LINE_STAGING_MESSAGING_ACCESS_TOKEN,
      loginChannelId: null, loginChannelSecret: null,
    });
    await db.lineOfficialAccount.create({ data: { id: ids.decoyAccountId, vendorId: ids.decoyVendorId, ...decoyCredentials, status: "active" } });
    // Deliberately point the decoy tenant at the primary tenant submission. A
    // correct materializer must reject this cross-tenant subject join.
    await db.lineUserIdentity.create({ data: { id: ids.decoyIdentityId, vendorId: ids.decoyVendorId, subjectType: "buyer_registration", subjectId: ids.submissionId, lineUserIdHash: lineUserIdHash(ids.decoyVendorId, source.LINE_STAGING_USER_ID), lineUserIdEncrypted: protectLineProfileValue(ids.decoyVendorId, "userId", source.LINE_STAGING_USER_ID) } });

    const beforeInvalid = await db.lineDelivery.count({ where: { vendorId: ids.vendorId } });
    const invalid = await callCron(source, "Bearer invalid-line-e2e-secret");
    receipt.sideEffects.cronCalls += 1;
    receipt.checks.invalidBearerRejected = invalid.status === 401;
    receipt.checks.invalidBearerNoWrite = beforeInvalid === await db.lineDelivery.count({ where: { vendorId: ids.vendorId } });
    if (!receipt.checks.invalidBearerRejected || !receipt.checks.invalidBearerNoWrite) throw new Error("CRON_AUTH_BOUNDARY_FAILED");

    const first = await callCron(source, `Bearer ${source.CRON_SECRET}`);
    receipt.sideEffects.cronCalls += 1;
    receipt.checks.validBearerAccepted = first.status === 200;
    if (!receipt.checks.validBearerAccepted) throw new Error("CRON_VALID_REQUEST_FAILED");
    let rows = await db.lineDelivery.findMany({ where: { vendorId: ids.vendorId }, select: { id: true, idempotencyKey: true, status: true, attemptCount: true, sentAt: true, providerRequestId: true, updatedAt: true } });
    const decoyAfterFirst = await db.lineDelivery.count({ where: { vendorId: ids.decoyVendorId } });
    receipt.checks.materializedCount = rows.length;
    receipt.checks.sentCount = rows.filter((row) => row.status === "sent").length;
    receipt.sideEffects.logicalLinePushes = receipt.checks.sentCount;
    if (rows.length !== 1 || rows[0].status !== "sent" || rows[0].attemptCount !== 1) throw new Error("DELIVERY_STATE_MISMATCH");
    const firstKey = rows[0].idempotencyKey;
    const firstDeliveryFingerprint = digest("delivery", JSON.stringify(rows[0]));

    const second = await callCron(source, `Bearer ${source.CRON_SECRET}`);
    receipt.sideEffects.cronCalls += 1;
    if (second.status !== 200) throw new Error("IDEMPOTENCY_PROBE_REQUEST_FAILED");
    rows = await db.lineDelivery.findMany({ where: { vendorId: ids.vendorId }, select: { id: true, idempotencyKey: true, status: true, attemptCount: true, sentAt: true, providerRequestId: true, updatedAt: true } });
    const decoyAfterSecond = await db.lineDelivery.count({ where: { vendorId: ids.decoyVendorId } });
    receipt.checks.deliveryStatus = rows[0]?.status ?? "missing";
    receipt.checks.attemptCount = rows[0]?.attemptCount ?? 0;
    receipt.checks.sentAtPresent = Boolean(rows[0]?.sentAt);
    receipt.checks.idempotencyProbePassed = rows.length === 1 && rows[0].idempotencyKey === firstKey && rows[0].attemptCount === 1 && digest("delivery", JSON.stringify(rows[0])) === firstDeliveryFingerprint;
    receipt.checks.tenantIsolationPassed = decoyAfterFirst === 0 && decoyAfterSecond === 0;
    if (!receipt.checks.idempotencyProbePassed) throw new Error("IDEMPOTENCY_VIOLATION");
    if (!receipt.checks.tenantIsolationPassed) throw new Error("TENANT_ISOLATION_VIOLATION");
    receipt.result = "PASS";
  } catch (error) {
    receipt.result = "FAILED";
    receipt.failureCode = safeFailure(error);
  } finally {
    receipt.cleanup.attempted = true;
    try {
      await cleanupOwned(db, ids);
      receipt.cleanup.remainingOwnedRows = await ownedRowCount(db, ids);
      receipt.cleanup.verified = receipt.cleanup.remainingOwnedRows === 0;
      if (!receipt.cleanup.verified) throw new Error("CLEANUP_FAILED");
    } catch {
      receipt.result = "FAILED";
      receipt.failureCode = "CLEANUP_FAILED";
    }
    await db.$disconnect().catch(() => undefined);
  }
  receipt.sideEffects.budgetExceeded = receipt.sideEffects.logicalLinePushes > 1 || receipt.sideEffects.cronCalls > 3;
  if (receipt.sideEffects.budgetExceeded) { receipt.result = "FAILED"; receipt.failureCode = "SIDE_EFFECT_BUDGET_EXCEEDED"; }
  const validation = validateReceipt(receipt, { sourceCommit: source.CELEBRATEDEAL_SOURCE_SHA, runId: source.GITHUB_RUN_ID, runAttempt: source.GITHUB_RUN_ATTEMPT });
  if (!validation.ok) { receipt.result = "BLOCKED"; receipt.failureCode = "RECEIPT_VALIDATION_FAILED"; }
  return receipt;
}

async function main() {
  const receipt = await runLineStagingValidation();
  const root = path.resolve(process.env.RUNNER_TEMP, "celebratedeal-secure-receipts");
  await fsp.mkdir(root, { recursive: true });
  const output = path.join(root, RECEIPT_NAME);
  if (fs.existsSync(output)) throw new Error("RECEIPT_ALREADY_EXISTS");
  await fsp.writeFile(output, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ task: TASK, result: receipt.result, receipt: RECEIPT_NAME })}\n`);
  if (receipt.result !== "PASS") process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
