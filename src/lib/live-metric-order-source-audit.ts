import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";
import { readMetricOrderAuditPage, withMetricOrderAuditContext } from "./live-metric-order-audit";
type Scope = Omit<Parameters<typeof readMetricOrderAuditPage>[1], "afterId" | "take">;
/** Internal enumeration only. Tenant and scoped revisions describe this snapshot;
 * even a fully matched result is NOT permission to publish coverage without
 * a separate writer that revalidates these revisions.
 */
export async function auditMetricOrderSources(db: Pick<PrismaClient, "$transaction">, value: Scope,
  limits = { rows: 1_000_000, pages: 2000 }) {
  if (!Number.isSafeInteger(limits.rows) || limits.rows < 1 || limits.rows > 1_000_000
    || !Number.isSafeInteger(limits.pages) || limits.pages < 1 || limits.pages > 2000) throw new Error("Invalid order audit limits");
  const scope = { vendorId: value.vendorId, liveId: value.liveId, versionId: value.versionId,
    startAt: new Date(value.startAt), endAt: new Date(value.endAt) };
  try {
  return await db.$transaction(async rawTx => {
    await rawTx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
    await rawTx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','2000',true)`);
    const started = performance.now();
    return withMetricOrderAuditContext(rawTx, scope, async tx => {
    const digest = createHash("sha256").update(JSON.stringify({ format: "order-source-audit-window-v2", ...scope }));
    const outcomes = { missing_payment: 0, missing_attribution: 0, other_purpose: 0, other_live: 0,
      invalid_source: 0, outside_cohort: 0, missing_registration: 0, identity_mismatch: 0, matched: 0 };
    let count = 0, cursor: string | null = null, revisions: string | undefined;
    for (let index = 0; index < limits.pages; index++) {
      // Context was read once; retain a conservative margin for DB/transaction overhead.
      if (performance.now() - started >= 20000) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
      const page = await readMetricOrderAuditPage(tx, { ...scope, afterId: cursor, take: 500 });
      if (page.status !== "available") return page;
      const current = JSON.stringify([page.sourceRevision.toString(), page.orderRevision.toString(), page.registrationRevision.toString(), page.tenantRevision.toString()]);
      // Defensive page-contract check, NOT a fresh database revision check:
      // the facade captured these revisions once in the read-only RR snapshot.
      // A future coverage writer must independently revalidate before publishing.
      if (revisions !== undefined && current !== revisions) throw new Error("Order audit snapshot revision changed");
      revisions = current;
      count += page.rows.length;
      if (count > limits.rows) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
      for (const row of page.rows) {
        outcomes[row.outcome]++;
        digest.update(JSON.stringify([row.orderId, row.outcome]) + "\n");
      }
      if (!page.hasMore) return { status: "enumerated" as const, coverage: "unknown" as const,
        count, outcomes, sourceRevision: page.sourceRevision, orderRevision: page.orderRevision,
        registrationRevision: page.registrationRevision, tenantRevision: page.tenantRevision, digest: digest.update(current).digest("hex") };
      if (page.rows.length === 0 || page.nextId === null || page.nextId === cursor) throw new Error("Order audit cursor did not advance");
      cursor = page.nextId;
    }
    return { status: "unavailable" as const, reason: "limit_exceeded" as const };
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000, maxWait: 5000 });
  } catch (error) {
    // SQLSTATE 57014 covers statement timeout AND explicit query cancellation.
    // Discard the whole snapshot, including any partial count/digest; never expose DB text.
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2010" && error.meta?.code === "57014") {
        return { status: "unavailable" as const, reason: "query_cancelled" as const };
      }
      // P2028 also covers non-timeout transaction failures; do not hide those.
      if (error.code === "P2028" && typeof error.meta?.error === "string"
        && error.meta.error.includes("expired transaction")) {
        return { status: "unavailable" as const, reason: "transaction_expired" as const };
      }
    }
    throw error;
  }
}
