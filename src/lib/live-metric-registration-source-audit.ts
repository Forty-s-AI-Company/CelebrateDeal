import { createHash, type Hash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";
import { readRegistrationAuditPage, readRegistrationProjectionAuditPage, type RegistrationAuditRequest } from "./live-metric-registration-audit";

type Scope = Omit<RegistrationAuditRequest, "take" | "afterSubmissionId">;
/** A bounded source enumeration, not permission to issue covered certificates.
 * The digest identifies this observation; source-insert revision fencing and
 * durable proof publication are separate requirements still enforced by callers.
 */
export async function auditMetricRegistrationSources(db: Pick<PrismaClient, "$transaction">, scope: Scope,
  limits = { rows: 1_000_000, pages: 2000 }) {
  if (!Number.isSafeInteger(limits.rows) || limits.rows < 1 || limits.rows > 1_000_000
    || !Number.isSafeInteger(limits.pages) || limits.pages < 1 || limits.pages > 2000) throw new Error("Invalid audit limits");
  return db.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
    const started = performance.now();
    const digest = createHash("sha256").update(JSON.stringify({ format: "registration-source-audit-v2", vendorId: scope.vendorId, liveId: scope.liveId,
      versionId: scope.versionId, startAt: scope.startAt.toISOString(), endAt: scope.endAt.toISOString() }));
    const outcomes = { form_mismatch: 0, matched: 0, missing_capture: 0, missing_registration: 0, identity_mismatch: 0, other_version: 0 };
    let cursor: string | null = null, count = 0;
    let sourceRevision: bigint | undefined;
    let registrationRevision: bigint | undefined;
    for (let pageNumber = 0; pageNumber < limits.pages; pageNumber++) {
      if (performance.now() - started >= 23000) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
      const page = await readRegistrationAuditPage(tx, { ...scope, take: 500, afterSubmissionId: cursor });
      if (page.status !== "available") return page;
      if (sourceRevision !== undefined && sourceRevision !== page.sourceRevision) throw new Error("Audit snapshot revision changed");
      if (registrationRevision !== undefined && registrationRevision !== page.registrationRevision) throw new Error("Audit registration revision changed");
      sourceRevision = page.sourceRevision;
      registrationRevision = page.registrationRevision;
      count += page.rows.length;
      if (count > limits.rows) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
      for (const row of page.rows) {
        outcomes[row.outcome]++;
        digest.update(JSON.stringify([row.submissionId, row.outcome]) + "\n");
      }
      if (!page.hasMore) {
        const reverse = await scanProjections(tx, scope, { rows: limits.rows - count, pages: limits.pages - pageNumber - 1 },
          { sourceRevision, registrationRevision, started }, digest);
        if (reverse.status !== "available") return reverse;
        return { status: "enumerated" as const, coverage: "unknown" as const, sourceRevision, registrationRevision,
          count, outcomes, projectionCount: reverse.count, projectionOutcomes: reverse.outcomes,
          digest: digest.update(JSON.stringify([sourceRevision.toString(), registrationRevision.toString()])).digest("hex") };
      }
      if (page.rows.length === 0 || page.nextSubmissionId === null || page.nextSubmissionId === cursor) throw new Error("Audit cursor did not advance");
      cursor = page.nextSubmissionId;
    }
    return { status: "unavailable" as const, reason: "limit_exceeded" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000, maxWait: 5000 });
}

async function scanProjections(tx: Pick<Prisma.TransactionClient, "$queryRaw">, scope: Scope,
  budget: { rows: number; pages: number }, expected: { sourceRevision: bigint; registrationRevision: bigint; started: number }, digest: Hash) {
  const outcomes = { matched: 0, invalid_source: 0, registration_without_capture: 0, capture_mismatch: 0 };
  let cursor: string | null = null, count = 0;
  // Distinguish directions so equal identifiers cannot produce ambiguous digests.
  digest.update("reverse-projections\n");
  for (let pageNumber = 0; pageNumber < budget.pages; pageNumber++) {
    if (performance.now() - expected.started >= 23000) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
    const page = await readRegistrationProjectionAuditPage(tx, { ...scope, take: 500, afterSubmissionId: cursor });
    if (page.status !== "available") return page;
    if (page.sourceRevision !== expected.sourceRevision || page.registrationRevision !== expected.registrationRevision)
      throw new Error("Audit reverse snapshot revision changed");
    count += page.rows.length;
    if (count > budget.rows) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
    for (const row of page.rows) {
      outcomes[row.outcome]++;
      digest.update(JSON.stringify([row.registrationId, row.outcome]) + "\n");
    }
    if (!page.hasMore) return { status: "available" as const, count, outcomes };
    if (page.rows.length === 0 || page.nextRegistrationId === null || page.nextRegistrationId === cursor) throw new Error("Audit reverse cursor did not advance");
    cursor = page.nextRegistrationId;
  }
  return { status: "unavailable" as const, reason: "limit_exceeded" as const };
}
