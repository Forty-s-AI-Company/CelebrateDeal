import { Prisma, PrismaClient } from "@prisma/client";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WP4_SANDBOX_FIXTURE } from "../src/lib/wp4-sandbox-fixture";
import { wp4PayUniPurposeFromMetadata, wp4SourceCommitFromMetadata } from "../src/lib/wp4-payuni-sandbox-reconciliation";
import { qaFinanceDatabaseUrl, QA_FINANCE_CA_FILE, verifyQaFinanceCertificate, qaFinanceFailureCategory } from "../src/lib/staging-qa-finance-bootstrap";

// Diagnose the already-issued transaction only; this is not a new checkout selector.
export const EXACT_SOURCE = "9acfe8d2dba62430e950cff2c0387841ab91f44b";
const ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const closedState = (value: unknown, values: readonly string[]) => values.find((state) => state === value) ?? "OTHER";

export async function readExactSyntheticState(db: Pick<PrismaClient, "$transaction">) {
  return db.$transaction(async (tx) => {
    // PostgreSQL rejects writes even if a future refactor accidentally adds one.
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const rows = await tx.paymentTransaction.findMany({
      where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni",
        AND: [{ metadata: { path: ["wp4SourceCommit"], equals: EXACT_SOURCE } },
          { metadata: { path: ["billingPurpose"], equals: "buyer_order" } },
          { metadata: { path: ["productId"], equals: WP4_SANDBOX_FIXTURE.productId } }] }, take: 2,
      select: { id: true, status: true, metadata: true, providerTradeNo: true, grossAmountCents: true, currency: true, refundedAmountCents: true },
    });
    const candidates = rows.filter((row) => wp4SourceCommitFromMetadata(row.metadata) === EXACT_SOURCE
      && wp4PayUniPurposeFromMetadata(row.metadata) === "buyer_order"
      && row.metadata !== null && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      && row.metadata.productId === WP4_SANDBOX_FIXTURE.productId);
    if (candidates.length !== 1) return { category: candidates.length ? "EXACT_FIXTURE_AMBIGUOUS" : "EXACT_FIXTURE_ABSENT" };
    const payment = candidates[0]!;
    const [orders, reservations] = await Promise.all([
      tx.commerceOrder.findMany({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, primaryPaymentTransactionId: payment.id },
        select: { id: true, status: true, paidAmountCents: true } }),
      tx.inventoryReservation.findMany({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, paymentTransactionId: payment.id },
        select: { status: true, releaseReason: true, productId: true, quantity: true } }),
    ]);
    const paidEventCount = orders.length === 1 ? await tx.commerceOrderEvent.count({
      where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderId: orders[0]!.id, eventType: "payment.paid" },
    }) : null;
    return { category: "EXACT_SYNTHETIC_STATE_OBSERVED",
      paymentState: closedState(payment.status, ["pending", "paid", "failed", "expired", "refunded", "partially_refunded"]),
      providerTradeNumberPresent: Boolean(payment.providerTradeNo), fixedAmountMatches: payment.grossAmountCents === 100 && payment.currency === "TWD",
      refundState: payment.refundedAmountCents === 0 ? "NONE" : payment.refundedAmountCents > 0 ? "PRESENT" : "INVALID",
      orderCount: orders.length, orderState: orders.length === 1 ? closedState(orders[0]!.status, ["draft", "pending_payment", "paid", "payment_failed", "expired", "cancelled", "partially_refunded", "refunded"]) : "NOT_UNIQUE",
      orderPaidAmountMatches: orders.length === 1 && orders[0]!.paidAmountCents === 100,
      reservationCount: reservations.length, reservationState: reservations.length === 1 ? closedState(reservations[0]!.status, ["reserved", "committed", "released", "expired"]) : "NOT_UNIQUE",
      reservationProductMatches: reservations.length === 1 && reservations[0]!.productId === WP4_SANDBOX_FIXTURE.productId && reservations[0]!.quantity === 1,
      reservationReleaseCategory: reservations.length === 1 ? closedState(reservations[0]!.releaseReason, ["payment_failed", "expired", "provider_checkout_failed", "checkout_metadata_failed", "refund"]) : "NOT_UNIQUE",
      paidEventCount };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}

async function report(result: Record<string, unknown>) {
  const receipt = { schemaVersion: "celebratedeal-q1-exact-state-details/v1", ...result,
    sourceCommit: EXACT_SOURCE, productionOperations: false, databaseWrites: false, paymentSubmitted: false, refundSubmitted: false };
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF === "refs/heads/master"
    && process.env.GITHUB_REF_PROTECTED === "true" && process.env.RUNNER_TEMP) {
    const directory = resolve(process.env.RUNNER_TEMP, "q1-exact-state-details");
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
      || env.CELEBRATEDEAL_SOURCE_SHA !== EXACT_SOURCE) throw new Error();
    const databaseUrl = qaFinanceDatabaseUrl(env.STAGING_DATABASE_URL ?? "");
    verifyQaFinanceCertificate(await readFile(resolve("prisma", QA_FINANCE_CA_FILE)));
    stage = "deployment-lineage";
    const { verifyMvpPayUniLineage } = await import("./mvp-payuni-sandbox-e2e.mjs");
    if (!await verifyMvpPayUniLineage({ NODE_ENV: "test", CELEBRATEDEAL_SOURCE_SHA: EXACT_SOURCE,
      CELEBRATEDEAL_DEPLOYMENT_HOST: env.CELEBRATEDEAL_DEPLOYMENT_HOST, GITHUB_TOKEN: env.GITHUB_TOKEN })) throw new Error();
    stage = "sandbox-readonly-boundary";
    const response = await fetch(`${ORIGIN}/api/admin/ops/payuni/wp4-buyer-order-proof`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${env.JOB_SECRET}`, "x-celebratedeal-source-sha": EXACT_SOURCE },
    });
    const proof = await response.json();
    const expected: Record<string, number> = { VERIFIED: 200, FIXTURE_UNAVAILABLE: 404, CANDIDATE_AMBIGUOUS: 409, STATE_MISMATCH: 409 };
    if (!Object.hasOwn(expected, proof?.status ?? "") || expected[proof.status] !== response.status) throw new Error();
    stage = "fixed-synthetic-readonly-snapshot";
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await report({ status: "READ_ONLY_DIAGNOSTIC", ...await readExactSyntheticState(db) });
  } catch (error) {
    await report({ status: "BLOCKED_OR_FAILED", stage, failureCategory: qaFinanceFailureCategory(error) });
    process.exitCode = 1;
  } finally {
    try { await db?.$disconnect(); }
    catch { await report({ status: "BLOCKED_OR_FAILED", stage: "database-disconnect", failureCategory: "DATABASE_DISCONNECT" }); process.exitCode = 1; }
  }
}
