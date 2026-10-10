import { Prisma, PrismaClient } from "@prisma/client";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { PaymentWebhookPayload } from "../src/lib/payment-webhooks";
import { wp4HistoricalBuyerWhere } from "../src/lib/wp4-buyer-recovery";
import { qaFinanceDatabaseUrl, QA_FINANCE_CA_FILE, verifyQaFinanceCertificate } from "../src/lib/staging-qa-finance-bootstrap";
import { readExactSyntheticState, EXACT_SOURCE } from "./q1-exact-state-details";
import { fetchQ1Downstream } from "./q1-downstream-runtime";

export const SCHEMA_RECOVERY_SOURCE = "e54f6eaffe1d57311fd04452264c47aa4114e019";
const ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const WINDOW = new Date("2026-10-10T06:43:34Z");
type CheckDb = Pick<PrismaClient, "$transaction">;

/** References remain private. A newly signed Sandbox response must agree with
 * the original stored callback, never a latest order or a replacement trade. */
export function originalProviderMatches(row: Record<string, unknown>, orderNumber: string, tradeNo: string) {
  const references = [row.TradeNo, row.TradeNoRef].filter(value => value !== undefined && value !== null && value !== "");
  return row.MerTradeNo === orderNumber && String(row.TradeStatus) === "1" && Number(row.TradeAmt) === 1
    && references.length > 0 && references.every(value => typeof value === "string" && value === tradeNo);
}
async function verifyOriginalProvider(db: CheckDb) {
  const original = await db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const payments = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(EXACT_SOURCE), take: 2 });
    if (payments.length !== 1 || !payments[0]!.orderNumber) throw new Error();
    const payment = payments[0]!;
    const orderNumber = payment.orderNumber;
    if (!orderNumber) throw new Error();
    const events = await tx.webhookEvent.findMany({ where: { provider: "payuni", eventType: "paid",
      payload: { path: ["normalized", "orderNumber"], equals: orderNumber } }, take: 2 });
    if (events.length !== 1) throw new Error();
    const envelope = events[0]!.payload;
    const parsed = PaymentWebhookPayload.safeParse(envelope && typeof envelope === "object" && !Array.isArray(envelope) ? envelope.normalized : null);
    if (!parsed.success || !parsed.data.providerTradeNo || parsed.data.orderNumber !== payment.orderNumber
      || parsed.data.eventId !== events[0]!.eventId || parsed.data.provider !== "payuni" || parsed.data.eventType !== "paid"
      || parsed.data.grossAmountCents !== 100 || (payment.providerTradeNo !== null && payment.providerTradeNo !== parsed.data.providerTradeNo)) throw new Error();
    return { orderNumber, tradeNo: parsed.data.providerTradeNo };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
  const { queryTransaction } = await import("./payuni-sandbox-external-qa.mjs");
  const row = await queryTransaction(original.orderNumber, { signal: AbortSignal.timeout(10000) });
  if (!originalProviderMatches(row, original.orderNumber, original.tradeNo)) throw new Error();
}

/** Read actual counts, including the distinct new fixed actor. Transport's
 * conservative attempted count is never proof of a database attempt. */
export async function readSchemaRecoveryAudit(db: CheckDb) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const payments = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(EXACT_SOURCE), take: 2,
      select: { id: true, orderNumber: true, metadata: true } });
    if (payments.length !== 1 || !payments[0]!.orderNumber) throw new Error();
    const payment = payments[0]!;
    const orderNumber = payment.orderNumber;
    if (!orderNumber) throw new Error();
    const events = await tx.webhookEvent.findMany({ where: { provider: "payuni", eventType: "paid",
      payload: { path: ["normalized", "orderNumber"], equals: orderNumber } }, take: 2,
      select: { id: true, retryCount: true, maxRetries: true } });
    if (events.length !== 1) throw new Error();
    const counts = await tx.$queryRaw<{ total: number; fixed: number; recovery: number; scheduler: number }[]>(Prisma.sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE "actorLabel"='wp4_sandbox_fixed_callback_retry')::int AS fixed,
        count(*) FILTER (WHERE "actorLabel"='q1_sandbox_schema_recovery')::int AS recovery,
        count(*) FILTER (WHERE "actorLabel"='job:webhook-retry')::int AS scheduler
      FROM "AuditLog" WHERE "targetType"='WebhookEvent' AND "targetId"=${events[0]!.id} AND "createdAt">=${WINDOW}`);
    if (counts.length !== 1) throw new Error();
    const metadata = payment.metadata;
    return { ...counts[0]!, retryCount: events[0]!.retryCount, maxRetries: events[0]!.maxRetries,
      recoveryReserved: !!metadata && typeof metadata === "object" && !Array.isArray(metadata) && metadata.q1SchemaRecoveryReserved === true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}

async function persist(receipt: Record<string, unknown>) {
  if (process.env.RUNNER_TEMP && process.env.GITHUB_REF === "refs/heads/master" && process.env.GITHUB_REF_PROTECTED === "true") {
    const directory = resolve(process.env.RUNNER_TEMP, "q1-schema-recovery");
    await mkdir(directory, { recursive: true });
    const temporary = resolve(directory, "completion.json.tmp");
    await writeFile(temporary, JSON.stringify(receipt) + "\n", { mode: 0o600 });
    await rename(temporary, resolve(directory, "completion.json"));
  }
}
export async function postSchemaRecovery(jobSecret: string, request: typeof fetch = fetch, beforePost: () => Promise<void> = async () => {}) {
  if (!jobSecret) throw new Error();
  await beforePost();
  const response = await request(`${ORIGIN}/api/admin/ops/payuni/q1-original-schema-recovery`, { method: "POST", redirect: "error",
    signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${jobSecret}`, "x-celebratedeal-source-sha": SCHEMA_RECOVERY_SOURCE } });
  const text = await response.text();
  if (response.status !== 200 || text.length > 512) throw new Error();
  const body = JSON.parse(text);
  if (Object.keys(body ?? {}).sort().join(",") !== "failureCode,retryAttempts,status" || body.status !== "PROCESSED"
    || body.retryAttempts !== 1 || body.failureCode !== "NONE") throw new Error();
}
export async function main() {
  let db: PrismaClient | undefined, stage = "configuration";
  const receipt: Record<string, unknown> = { schemaVersion: "celebratedeal-q1-schema-recovery/v1", status: "BLOCKED",
    executionSource: SCHEMA_RECOVERY_SOURCE, originalTransactionSource: EXACT_SOURCE, callbackPosts: 0, possibleDatabaseWrites: false,
    paymentSubmitted: false, refundSubmitted: false, productionOperations: false, genericSchedulerCalled: false };
  try {
    const env = process.env;
    if (process.argv.length !== 2 || env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/master"
      || env.GITHUB_REF_PROTECTED !== "true" || env.GITHUB_REPOSITORY !== "Forty-s-AI-Company/CelebrateDeal"
      || env.GITHUB_WORKFLOW_REF?.split("@")[0] !== "Forty-s-AI-Company/CelebrateDeal/.github/workflows/q1-schema-recovery.yml"
      || env.PAYUNI_ENV !== "sandbox" || env.CELEBRATEDEAL_SOURCE_SHA !== SCHEMA_RECOVERY_SOURCE || !env.JOB_SECRET) throw new Error();
    const databaseUrl = qaFinanceDatabaseUrl(env.STAGING_DATABASE_URL ?? "");
    verifyQaFinanceCertificate(await readFile(resolve("prisma", QA_FINANCE_CA_FILE)));
    stage = "deployment-lineage";
    const { verifyMvpPayUniLineage } = await import("./mvp-payuni-sandbox-e2e.mjs");
    if (!await verifyMvpPayUniLineage({ NODE_ENV: "test", CELEBRATEDEAL_SOURCE_SHA: SCHEMA_RECOVERY_SOURCE,
      CELEBRATEDEAL_DEPLOYMENT_HOST: env.CELEBRATEDEAL_DEPLOYMENT_HOST, GITHUB_TOKEN: env.GITHUB_TOKEN })) throw new Error();
    stage = "deployed-schema-and-crypto";
    const probe = await fetchQ1Downstream(env.JOB_SECRET, SCHEMA_RECOVERY_SOURCE);
    if (probe.classification !== "DOWNSTREAM_OBSERVED" || probe.decrypt !== "OK" || probe.protect !== "OK") throw new Error();
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    stage = "original-readonly-before";
    const before = await readExactSyntheticState(db), audit = await readSchemaRecoveryAudit(db);
    receipt.before = before; receipt.auditBefore = audit;
    if (!("paymentState" in before) || before.paymentState !== "pending" || before.paymentSubmissionReserved !== true
      || before.callbackRetryReserved !== true || before.callback?.callbackState !== "failed"
      || audit.total !== 1 || audit.fixed !== 1 || audit.scheduler !== 0 || audit.recovery !== 0
      || audit.recoveryReserved || audit.retryCount !== 3 || audit.maxRetries !== 5) throw new Error();
    stage = "fresh-signed-original-provider-query";
    await verifyOriginalProvider(db); receipt.providerPaidQueryMatched = true;
    stage = "single-original-schema-recovery";
    receipt.transportObserved = false;
    try {
      await postSchemaRecovery(env.JOB_SECRET, fetch, async () => {
        // Persist possible effects before POST. A lost response never permits a rerun.
        Object.assign(receipt, { callbackPosts: 1, possibleDatabaseWrites: true, stage }); await persist(receipt);
      });
      receipt.transportObserved = true;
    } catch { /* Still inspect exact state; never retry an uncertain POST. */ }
    stage = "original-readonly-after";
    const after = await readExactSyntheticState(db), auditAfter = await readSchemaRecoveryAudit(db);
    receipt.after = after; receipt.auditAfter = auditAfter;
    if (!("paymentState" in after) || after.paymentState !== "paid" || after.callback?.callbackState !== "processed"
      || after.callback.callbackTenantState !== "MATCHED" || after.callbackRetryReserved !== true
      || after.paidEventCount !== 1 || after.orderState !== "paid" || after.orderPaidAmountMatches !== true
      || after.providerTradeNumberPresent !== true || after.reservationState !== "committed" || after.reservationProductMatches !== true
      || auditAfter.total !== 2 || auditAfter.fixed !== 1 || auditAfter.recovery !== 1 || auditAfter.scheduler !== 0
      || !auditAfter.recoveryReserved || auditAfter.retryCount !== 4 || auditAfter.maxRetries !== 5) throw new Error();
    receipt.status = "ORIGINAL_SCHEMA_RECOVERY_VERIFIED";
  } catch { receipt.status = "BLOCKED"; receipt.stage = stage; process.exitCode = 1; }
  finally {
    try { await db?.$disconnect(); } catch { receipt.status = "BLOCKED"; receipt.stage = "disconnect"; process.exitCode = 1; }
    await persist(receipt); console.log(JSON.stringify(receipt));
  }
}
