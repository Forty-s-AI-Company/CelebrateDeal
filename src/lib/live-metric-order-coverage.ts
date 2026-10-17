import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { auditMetricOrderSources } from "./live-metric-order-source-audit";
type Scope = Parameters<typeof auditMetricOrderSources>[1];
/** Private backend producer. Never accepts caller-supplied counts, proof or
 * completeness. Only an internally completed, tenant inventory audit with explicit exclusions
 * can publish; current revisions are checked again in the write transaction.
 */
export async function publishOrderCoverage(db: Pick<PrismaClient, "$transaction">, value: Scope) {
  const scope = { vendorId: value.vendorId, liveId: value.liveId, versionId: value.versionId,
    startAt: new Date(value.startAt), endAt: new Date(value.endAt) };
  const audit = await auditMetricOrderSources(db, scope);
  if (audit.status !== "enumerated") return { status: "unavailable" as const };
  // Exclude only positively classified out-of-scope orders. Missing or invalid
  // attribution/projections cannot silently disappear from the denominator.
  const accepted = audit.outcomes.matched + audit.outcomes.other_purpose
    + audit.outcomes.other_live + audit.outcomes.outside_cohort;
  if (accepted !== audit.count) return { status: "incomplete" as const };
  const proofId = createHash("sha256").update(JSON.stringify({ format: "order-coverage-window-v3", kind: "orders", ...scope, digest: audit.digest })).digest("hex");
  try {
  return await db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true),set_config('lock_timeout','2000',true)`);
    const [version] = await tx.$queryRaw<{ sourceRevision: bigint }[]>(Prisma.sql`
      SELECT "sourceRevision" FROM "LiveMetricVersion" WHERE id=${scope.versionId}
        AND "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} FOR SHARE`);
    if (!version || version.sourceRevision !== audit.sourceRevision) return { status: "source_changed" as const };
    const [source] = await tx.$queryRaw<{ registration: bigint; orders: bigint; tenant: bigint }[]>(Prisma.sql`
      SELECT public.wp20_metric_registration_revision(${scope.vendorId},${scope.liveId}) AS registration,
        public.wp20_metric_order_window_revision(${scope.vendorId},${scope.startAt},${scope.endAt}) AS orders,
        public.wp20_metric_order_window_revision(${scope.vendorId},${scope.startAt},${scope.endAt}) AS tenant`);
    if (!source || source.registration !== audit.registrationRevision
      || source.orders !== audit.orderRevision || source.tenant !== audit.tenantRevision) return { status: "source_changed" as const };
    await tx.$queryRaw(Prisma.sql`
      INSERT INTO "LiveMetricCoverageAudit" (id,"vendorId","liveId","versionId",kind,status,"startAt","endAt",
        "sourceRevision","orderRevision","orderTenantRevision","orderRegistrationRevision","orderCount","auditDigest","orderProofVersion")
      VALUES (${proofId},${scope.vendorId},${scope.liveId},${scope.versionId},'orders','covered',${scope.startAt},${scope.endAt},
        ${audit.sourceRevision},${audit.orderRevision},${audit.tenantRevision},${audit.registrationRevision},${audit.count},${audit.digest},2) ON CONFLICT (id) DO NOTHING`);
    // A conflicting ID is only an idempotent success if the entire stored proof
    // matches. Never report recorded merely because ON CONFLICT did nothing.
    const [stored] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM "LiveMetricCoverageAudit" WHERE id=${proofId}
        AND "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} AND "versionId"=${scope.versionId}
        AND kind='orders' AND status='covered' AND "orderProofVersion"=2 AND "startAt"=${scope.startAt} AND "endAt"=${scope.endAt}
        AND "sourceRevision"=${audit.sourceRevision} AND "orderRevision"=${audit.orderRevision}
        AND "orderTenantRevision"=${audit.tenantRevision} AND "orderRegistrationRevision"=${audit.registrationRevision}
        AND "orderCount"=${audit.count} AND "auditDigest"=${audit.digest}`);
    if (!stored) return { status: "conflict" as const };
    return { status: "recorded" as const, proofId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
  } catch (error) {
    // A source commit may land after the explicit revision read. Only the
    // dedicated DB guard is a stale-proof result; other database errors propagate.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010"
      && error.meta?.code === "23514"
      && typeof error.meta?.message === "string"
      && error.meta.message.includes("order coverage source mismatch")) {
      return { status: "source_changed" as const };
    }
    throw error;
  }
}
