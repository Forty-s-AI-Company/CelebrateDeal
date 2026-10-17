import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { auditMetricRegistrationSources } from "./live-metric-registration-source-audit";
type Scope = Parameters<typeof auditMetricRegistrationSources>[1];
/** Private backend producer. Never accepts caller-supplied counts, proof or
 * completeness. Only an internally completed, bidirectionally matched audit
 * can publish; current revisions are checked again in the write transaction.
 */
export async function publishRegistrationCoverage(db: Pick<PrismaClient, "$transaction">, value: Scope) {
  const scope = { vendorId: value.vendorId, liveId: value.liveId, versionId: value.versionId,
    startAt: new Date(value.startAt), endAt: new Date(value.endAt) };
  const audit = await auditMetricRegistrationSources(db, scope);
  if (audit.status !== "enumerated") return { status: "unavailable" as const };
  if (audit.count !== audit.projectionCount || audit.outcomes.matched !== audit.count
    || audit.projectionOutcomes.matched !== audit.projectionCount) return { status: "incomplete" as const };
  const proofId = createHash("sha256").update("registration-coverage-v1:" + audit.digest).digest("hex");
  try {
  return await db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true),set_config('lock_timeout','2000',true)`);
    const [version] = await tx.$queryRaw<{ sourceRevision: bigint }[]>(Prisma.sql`
      SELECT "sourceRevision" FROM "LiveMetricVersion" WHERE id=${scope.versionId}
        AND "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} FOR SHARE`);
    if (!version || version.sourceRevision !== audit.sourceRevision) return { status: "source_changed" as const };
    const [source] = await tx.$queryRaw<{ revision: bigint }[]>(Prisma.sql`
      SELECT public.wp20_metric_registration_revision(${scope.vendorId},${scope.liveId}) AS revision`);
    if (source.revision !== audit.registrationRevision) return { status: "source_changed" as const };
    await tx.$queryRaw(Prisma.sql`
      INSERT INTO "LiveMetricCoverageAudit" (id,"vendorId","liveId","versionId",kind,status,"startAt","endAt",
        "sourceRevision","registrationRevision","registrationCount","auditDigest")
      VALUES (${proofId},${scope.vendorId},${scope.liveId},${scope.versionId},'registrations','covered',${scope.startAt},${scope.endAt},
        ${audit.sourceRevision},${audit.registrationRevision},${audit.count},${audit.digest}) ON CONFLICT (id) DO NOTHING`);
    return { status: "recorded" as const, proofId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
  } catch (error) {
    // A source commit may land after the explicit revision read. Only the
    // dedicated DB guard is a stale-proof result; other database errors propagate.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010"
      && error.meta?.code === "23514"
      && typeof error.meta?.message === "string"
      && error.meta.message.includes("registration coverage source mismatch")) {
      return { status: "source_changed" as const };
    }
    throw error;
  }
}
