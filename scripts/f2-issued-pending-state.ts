import { Prisma, PrismaClient } from "@prisma/client";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reference } from "./payuni-sandbox-payment-handoff.mjs";
import { wp4HistoricalBuyerWhere } from "../src/lib/wp4-buyer-recovery";
import { qaFinanceDatabaseUrl, QA_FINANCE_CA_FILE, verifyQaFinanceCertificate, qaFinanceFailureCategory } from "../src/lib/staging-qa-finance-bootstrap";

// This is the original pending F2 attempt, never the completed Q1 transaction.
export const FIXED_PENDING = Object.freeze({ runId: 38097819821,
  source: "3bbd0ff30b820b0c8a8288f106fd74932f4507f2",
  transactionRef: "ac730f8d290e", orderRef: "dc8bb5058d44", amountCents: 100 });
const APP = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const closed = (value: unknown, allowed: readonly string[]) => allowed.find(x => x === value) ?? "OTHER";
const reject = (): never => { throw new Error("Fixed pending F2 state rejected."); };

/** Database-enforced read-only snapshot. Only a unique fixed-catalog record
 * matching BOTH hashes may reach the signed Sandbox query adapter.
 * Raw identifiers remain in process memory, and there is no payment/refund API.
 */
export async function readIssuedPendingState(db: Pick<PrismaClient, "$transaction">,
  query: (order: string) => Promise<unknown>) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const rows = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(FIXED_PENDING.source), take: 2,
      select: { id: true, orderNumber: true, providerTradeNo: true, grossAmountCents: true, currency: true,
        status: true, refundedAmountCents: true, refunds: { select: { status: true } } } });
    if (rows.length !== 1) reject();
    const row = rows[0]!;
    const orderNumber = row.orderNumber;
    if (reference(row.id) !== FIXED_PENDING.transactionRef || !orderNumber
      || reference(orderNumber) !== FIXED_PENDING.orderRef || !/^[A-Za-z0-9_-]{1,25}$/.test(orderNumber)
      || row.grossAmountCents !== 100 || row.currency !== "TWD") reject();
    const local = { paymentState: closed(row.status, ["pending", "processing", "paid", "failed", "expired", "refunded", "partially_refunded"]),
      refundedAmountMatchesFull: row.refundedAmountCents === 100, localRefundAbsent: row.refundedAmountCents === 0 && row.refunds.length === 0,
      singleProcessedRefund: row.refunds.length === 1 && row.refunds[0]!.status === "processed",
      originalProviderTradeKnown: Boolean(row.providerTradeNo) };
    try {
      const result = await query(orderNumber);
      if (!result || typeof result !== "object" || Array.isArray(result)) reject();
      const p = result as Record<string, unknown>;
      if (p.MerTradeNo !== orderNumber || String(p.TradeAmt) !== "1"
        || typeof p.TradeNo !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(p.TradeNo)
        || (row.providerTradeNo !== null && p.TradeNo !== row.providerTradeNo)) reject();
      const state = closed(String(p.TradeStatus), ["0", "1", "2", "3", "4", "8", "9"]);
      const creditPaid = state === "1" && p.DataSource === "A" && String(p.PaymentType) === "1";
      return { ...local, providerQuery: "OBSERVED", providerTradeState: state,
        originalProviderTradeMatches: row.providerTradeNo === null ? null : true,
        outcome: creditPaid ? "PAID_REFUND_RECONCILIATION_REQUIRED"
          : ["2", "3", "4"].includes(state) ? "TERMINAL_UNPAID"
          : ["0", "9"].includes(state) ? "ISSUED_UNPAID" : state === "8" ? "PROCESSING" : "UNCONFIRMED" };
    } catch (error) {
      const { PayUniQueryFailure } = await import("./payuni-sandbox-external-qa.mjs");
      return { ...local, providerQuery: "UNCONFIRMED", outcome: "UNCONFIRMED",
        ...(error instanceof PayUniQueryFailure ? { failureStage: closed(error.failureStage,
          ["request-configuration", "network-request", "http-response", "response-envelope", "signature-decryption", "provider-result", "order-validation"]),
          providerDisposition: closed(error.providerDisposition,
            ["terminal-authentication", "terminal-invalid-request", "retryable-not-found", "retryable-processing", "retryable-provider", "unknown"]) } : {}) };
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}

async function report(result: Record<string, unknown>) {
  const receipt = { schemaVersion: "celebratedeal-f2-issued-pending-state/v1", ...result,
    originalRunId: FIXED_PENDING.runId, sourceCommit: FIXED_PENDING.source,
    transactionRef: FIXED_PENDING.transactionRef, orderRef: FIXED_PENDING.orderRef,
    productionOperations: false, databaseWrites: false, paymentSubmitted: false, refundSubmitted: false,
    pendingCleared: false, applicationRecoveryAccepted: false };
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF === "refs/heads/master"
    && process.env.GITHUB_REF_PROTECTED === "true" && process.env.RUNNER_TEMP) {
    const directory = resolve(process.env.RUNNER_TEMP, "f2-issued-pending-state");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "completion.json"), `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  }
  console.log(JSON.stringify(receipt));
}

export async function main() {
  let db: PrismaClient | undefined;
  let stage = "configuration";
  try {
    const env = process.env;
    if (process.argv.length !== 2 || env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/master"
      || env.GITHUB_REF_PROTECTED !== "true" || env.PAYUNI_ENV !== "sandbox" || !env.JOB_SECRET
      || env.CELEBRATEDEAL_SOURCE_SHA !== FIXED_PENDING.source
      || ["PAYUNI_SANDBOX_MERCHANT_ID", "PAYUNI_SANDBOX_HASH_KEY", "PAYUNI_SANDBOX_HASH_IV"].some(name => !env[name])) reject();
    const databaseUrl = qaFinanceDatabaseUrl(env.STAGING_DATABASE_URL ?? "");
    verifyQaFinanceCertificate(await readFile(resolve("prisma", QA_FINANCE_CA_FILE)));
    stage = "deployment-lineage";
    const { verifyMvpPayUniLineage } = await import("./mvp-payuni-sandbox-e2e.mjs");
    if (!await verifyMvpPayUniLineage({ NODE_ENV: "test", CELEBRATEDEAL_SOURCE_SHA: FIXED_PENDING.source,
      CELEBRATEDEAL_DEPLOYMENT_HOST: env.CELEBRATEDEAL_DEPLOYMENT_HOST, GITHUB_TOKEN: env.GITHUB_TOKEN })) reject();
    stage = "sandbox-readonly-boundary";
    const response = await fetch(`${APP}/api/admin/ops/payuni/wp4-preflight`, { method: "POST", redirect: "error",
      signal: AbortSignal.timeout(10000), headers: { authorization: `Bearer ${env.JOB_SECRET}`,
        "x-celebratedeal-source-sha": FIXED_PENDING.source, "x-celebratedeal-wp4-preflight-scope": "buyer_order" } });
    const body = await response.text(); if (body.length > 16384) reject();
    const proof = JSON.parse(body);
    if (response.status !== 200 || proof.ready !== true || proof.buyerOrder !== true || proof.scope !== "buyer_order") reject();
    stage = "fixed-pending-readonly-query";
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const { queryTransaction } = await import("./payuni-sandbox-external-qa.mjs");
    await report({ status: "READ_ONLY_OBSERVED", stage, ...await readIssuedPendingState(db,
      order => queryTransaction(order, { signal: AbortSignal.timeout(5000) })) });
  } catch (error) {
    await report({ status: "BLOCKED_OR_FAILED", stage, failureCategory: qaFinanceFailureCategory(error) });
    process.exitCode = 1;
  } finally {
    try { await db?.$disconnect(); }
    catch { await report({ status: "BLOCKED_OR_FAILED", stage: "database-disconnect", failureCategory: "DATABASE_DISCONNECT" }); process.exitCode = 1; }
  }
}
