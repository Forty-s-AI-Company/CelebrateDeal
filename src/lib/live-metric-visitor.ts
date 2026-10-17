import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createMetricVisitorProofService } from "./live-metric-visitor-proof";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Context = z.object({ vendorId: id, liveId: id, versionId: id, expiresAt: z.date() }).strict();
type Context = z.infer<typeof Context>;
export class MetricVisitorError extends Error {
  constructor(readonly code: "PROOF_INVALID" | "PROOF_EXPIRED" | "PROOF_NOT_YET_VALID" | "PROOF_UNKNOWN_KEY" | "SCOPE_UNAVAILABLE" | "VISITOR_MISSING" | "LIFETIME_UNAVAILABLE" | "PERSISTENCE_UNAVAILABLE") {
    super(code.startsWith("PROOF_") ? "Metric visitor proof unavailable" : code === "LIFETIME_UNAVAILABLE" ? "Metric visitor lifetime unavailable" : code === "PERSISTENCE_UNAVAILABLE" ? "Metric visitor persistence unavailable" : "Metric visitor scope unavailable"); this.name = "MetricVisitorError";
  }
}
type ProofService = ReturnType<typeof createMetricVisitorProofService>;

/** Internal server boundary. Resolve context from an authorized public content
 * lookup, never a request body. HTTP callers still need origin/rate-limit guards.
 * No proof means a new browser identity; invalid proof must not silently rotate
 * identities and inflate visits. No collection or retention defaults are set.
 */
export async function provisionMetricVisitor(db: Pick<PrismaClient, "$transaction">,
  proofs: ProofService, trustedContext: Context, existingProof: unknown = null) {
  const parsed = Context.safeParse(trustedContext);
  if (!parsed.success) throw new MetricVisitorError("SCOPE_UNAVAILABLE");
  const context = parsed.data;
  const { vendorId, liveId, versionId } = context;
  const scope = { vendorId, liveId, versionId };
  try {
    return await db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "LiveMetricVersion" WHERE id=${versionId}
      AND "vendorId"=${vendorId} AND "liveId"=${liveId} FOR SHARE`);
    // Read clock after the lock wait. Floor matches the existing visitor guard,
    // which compares against the database's unrounded current timestamp.
    const [version] = await tx.$queryRaw<{ nowAt: Date; expiresAt: Date }[]>(Prisma.sql`
      SELECT to_timestamp(floor(extract(epoch FROM clock_timestamp())*1000)/1000) AS "nowAt", "expiresAt"
      FROM "LiveMetricVersion" WHERE id=${versionId} AND "vendorId"=${vendorId} AND "liveId"=${liveId}
        AND "collectionEnabled" AND "collectionStartedAt"<=clock_timestamp() AND "expiresAt">clock_timestamp()`);
    if (!version) throw new MetricVisitorError("SCOPE_UNAVAILABLE");
    const nowMs = version.nowAt.getTime();
    // Cookie retention permits authenticated recovery after a shorter content
    // lifetime. It cannot outlive the already-authorized version retention.
    const cookieExpiresAtMs = version.expiresAt.getTime();
    const expiresAtMs = Math.min(context.expiresAt.getTime(), version.expiresAt.getTime());
    if (expiresAtMs <= nowMs) throw new MetricVisitorError("LIFETIME_UNAVAILABLE");
    if (existingProof !== null) {
      const checked = proofs.inspect(existingProof, scope, nowMs);
      if (checked.status !== "valid" && checked.status !== "expired") throw new MetricVisitorError(checked.status === "not_yet_valid" ? "PROOF_NOT_YET_VALID" : checked.status === "unknown_key" ? "PROOF_UNKNOWN_KEY" : "PROOF_INVALID");
      // Explicit narrowing: only a string can have passed proof verification.
      if (typeof existingProof !== "string") throw new MetricVisitorError("PROOF_INVALID");
      const visitorId = checked.visitorId;
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM "LiveMetricVisitor" WHERE id=${visitorId} AND "vendorId"=${vendorId}
          AND "liveId"=${liveId} AND "versionId"=${versionId} FOR KEY SHARE`);
      if (rows.length !== 1) throw new MetricVisitorError("VISITOR_MISSING");
      if (checked.status === "expired") {
        // Recovery preserves the existing browser identity and its historical
        // facts. It grants no admission and never changes version retention.
        const recovered = proofs.recover(existingProof, scope, nowMs, expiresAtMs);
        if (!recovered) throw new MetricVisitorError("PROOF_INVALID");
        return { ...recovered, expiresAtMs, cookieExpiresAtMs, created: false };
      }
      // A still-valid revisit does not extend its existing proof lifetime.
      return { visitorId, proof: existingProof, expiresAtMs: Math.min(checked.expiresAtMs, expiresAtMs), cookieExpiresAtMs, created: false };
    }
    const issued = proofs.issue(scope, nowMs, expiresAtMs);
    // This is a digest of a random first-party ID, not a device fingerprint.
    const browserHash = createHash("sha256").update(JSON.stringify([vendorId, liveId, versionId, issued.visitorId])).digest("hex");
    await tx.$executeRaw(Prisma.sql`INSERT INTO "LiveMetricVisitor"
      (id,"vendorId","liveId","versionId","browserHash","firstVisitedAt")
      VALUES (${issued.visitorId},${vendorId},${liveId},${versionId},${browserHash},${version.nowAt})`);
    return { ...issued, expiresAtMs, cookieExpiresAtMs, created: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
  } catch (error) {
    if (error instanceof MetricVisitorError) throw error;
    // Never expose Prisma messages, SQL, parameters, or nested causes.
    throw new MetricVisitorError("PERSISTENCE_UNAVAILABLE");
  }
}
