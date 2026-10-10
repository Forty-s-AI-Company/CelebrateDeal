import { Prisma, PrismaClient } from "@prisma/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Q1DownstreamReceipt, Q1_ORIGINAL_SOURCE } from "../src/lib/q1-downstream-readonly";
import { wp4HistoricalBuyerWhere } from "../src/lib/wp4-buyer-recovery";
import { WP4_SANDBOX_FIXTURE } from "../src/lib/wp4-sandbox-fixture";
import { readOriginalRetryAudit } from "./q1-original-retry-audit";
import { qaFinanceDatabaseUrl, QA_FINANCE_CA_FILE, verifyQaFinanceCertificate } from "../src/lib/staging-qa-finance-bootstrap";
const ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const SHA = /^[a-f0-9]{40}$/u;

/** Current runtime source is separate from the immutable original transaction source. */
export async function fetchQ1Downstream(jobSecret: string, runtimeSource: string, request: typeof fetch = fetch) {
  if (!jobSecret || !SHA.test(runtimeSource)) throw new Error("Configuration rejected.");
  const response = await request(`${ORIGIN}/api/admin/ops/payuni/q1-downstream-readonly`, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${jobSecret}`, "x-celebratedeal-source-sha": runtimeSource },
  });
  const text = await response.text();
  if (response.status !== 200 || text.length > 16000) throw new Error("Readonly response rejected.");
  return Q1DownstreamReceipt.parse(JSON.parse(text));
}

/** Private fence stays only in memory. No IDs, timestamps or metadata values
 * leave the runner; equality is the only recorded observation. */
export async function readQ1DiagnosticFence(db: Pick<PrismaClient, "$transaction">) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return readQ1FenceState(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}

/** Shared fixed-state reader; the caller controls read-only mode or DDL locks. */
export async function readQ1FenceState(tx: Prisma.TransactionClient) {
    const rows = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(Q1_ORIGINAL_SOURCE), take: 2,
      select: { id: true, orderNumber: true, status: true } });
    if (rows.length !== 1 || !rows[0]!.orderNumber) throw new Error("Fixture unavailable.");
    const payment = rows[0]!;
    const orderNumber = payment.orderNumber;
    if (!orderNumber) throw new Error("Reference unavailable.");
    const events = await tx.webhookEvent.findMany({ where: { provider: "payuni", eventType: "paid",
      payload: { path: ["normalized", "orderNumber"], equals: orderNumber } }, take: 2,
      select: { id: true, vendorId: true, retryCount: true, maxRetries: true, updatedAt: true, status: true } });
    if (events.length !== 1 || (events[0]!.vendorId !== null && events[0]!.vendorId !== WP4_SANDBOX_FIXTURE.vendorId)) throw new Error("Event unavailable.");
    const marker = await tx.$queryRaw<{ reserved: boolean }[]>(Prisma.sql`
      SELECT "metadata"->'wp4CallbackRetryReserved' = 'true'::jsonb AS reserved
      FROM "PaymentTransaction" WHERE "id" = ${payment.id} AND "vendorId" = ${WP4_SANDBOX_FIXTURE.vendorId}`);
    if (marker.length !== 1 || marker[0]!.reserved !== true || events[0]!.retryCount !== 3 || events[0]!.maxRetries !== 5
      || events[0]!.status !== "failed" || payment.status !== "pending") throw new Error("Original state changed.");
    return JSON.stringify({ payment, event: events[0], marker: true });
}

export async function main() {
  let db: PrismaClient | undefined;
  let stage = "configuration";
  const receipt: Record<string, unknown> = { schemaVersion: "celebratedeal-q1-downstream-runtime/v1", status: "BLOCKED",
    originalTransactionSource: Q1_ORIGINAL_SOURCE, databaseWrites: false, callbackPosts: 0, callbackReplayAuthorized: false,
    paymentSubmitted: false, refundSubmitted: false, productionOperations: false };
  try {
    const env = process.env, runtimeSource = env.CELEBRATEDEAL_SOURCE_SHA ?? "";
    if (process.argv.length !== 2 || env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/master"
      || env.GITHUB_REF_PROTECTED !== "true" || env.PAYUNI_ENV !== "sandbox" || !env.JOB_SECRET || !SHA.test(runtimeSource)) throw new Error();
    const databaseUrl = qaFinanceDatabaseUrl(env.STAGING_DATABASE_URL ?? "");
    verifyQaFinanceCertificate(await readFile(resolve("prisma", QA_FINANCE_CA_FILE)));
    stage = "deployment-lineage";
    const { verifyMvpPayUniLineage } = await import("./mvp-payuni-sandbox-e2e.mjs");
    if (!await verifyMvpPayUniLineage({ NODE_ENV: "test", CELEBRATEDEAL_SOURCE_SHA: runtimeSource,
      CELEBRATEDEAL_DEPLOYMENT_HOST: env.CELEBRATEDEAL_DEPLOYMENT_HOST, GITHUB_TOKEN: env.GITHUB_TOKEN })) throw new Error();
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    stage = "original-readonly-fence";
    const before = await readQ1DiagnosticFence(db), auditBefore = await readOriginalRetryAudit(db);
    if (!("schedulerCount" in auditBefore) || auditBefore.schedulerCount !== 0 || auditBefore.retryCount !== 3) throw new Error();
    stage = "deployed-process-readonly-probe";
    const downstream = await fetchQ1Downstream(env.JOB_SECRET, runtimeSource);
    stage = "original-readonly-after";
    const after = await readQ1DiagnosticFence(db), auditAfter = await readOriginalRetryAudit(db);
    if (before !== after || !("schedulerCount" in auditAfter) || auditAfter.schedulerCount !== 0
      || auditAfter.retryCount !== 3 || auditAfter.fixedActorCount !== auditBefore.fixedActorCount) throw new Error();
    Object.assign(receipt, { status: "READ_ONLY_DIAGNOSTIC", executionSource: runtimeSource, downstream,
      originalStateUnchanged: true, schedulerCount: 0, retryCount: 3 });
  } catch { receipt.status = "BLOCKED"; receipt.stage = stage; process.exitCode = 1; }
  finally {
    try { await db?.$disconnect(); } catch { receipt.status = "BLOCKED"; receipt.stage = "database-disconnect"; process.exitCode = 1; }
    if (process.env.RUNNER_TEMP && process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF === "refs/heads/master"
      && process.env.GITHUB_REF_PROTECTED === "true") {
      const directory = resolve(process.env.RUNNER_TEMP, "q1-downstream-runtime");
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, "completion.json"), `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
    }
    console.log(JSON.stringify(receipt));
  }
}
