import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { resolveMetricVisitContext } from "./live-metric-visit-context";
import type { createMetricVisitorProofService } from "./live-metric-visitor-proof";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Identity = z.object({ vendorId: id, liveId: id, submissionId: id }).strict();
const CaptureIdentity = Identity.extend({ versionId: id }).strict();
type Proofs = ReturnType<typeof createMetricVisitorProofService>;
export class MetricRegistrationError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "SCOPE_UNAVAILABLE" | "IDENTITY_CONFLICT" | "PERSISTENCE_UNAVAILABLE") {
    super("Metric registration unavailable"); this.name = "MetricRegistrationError";
  }
}

/** Isolate optional metrics SQL from the business submission transaction.
 * The caller still owns commit/rollback. Unavailable capture is an evidence gap,
 * never evidence that collection was complete. A dead connection/expired outer
 * transaction cannot be rescued; failed rollback is therefore propagated.
 */
export async function captureMetricRegistration(tx: Prisma.TransactionClient,
  value: z.infer<typeof CaptureIdentity>, proofs: Proofs, proof: unknown = null) {
  const parsed = CaptureIdentity.safeParse(value);
  if (!parsed.success) throw new MetricRegistrationError("INVALID_INPUT");
  return withCaptureBoundary(tx, () => captureMetricRegistrationInner(tx, parsed.data, proofs, proof));
}

/** Public form entry resolves current scope within the same failure boundary;
 * even a context lookup failure cannot poison the business transaction. */
export async function capturePublicMetricRegistration(tx: Prisma.TransactionClient,
  value: z.infer<typeof Identity>, proofs: Proofs, proof: unknown = null) {
  const parsed = Identity.safeParse(value);
  if (!parsed.success) throw new MetricRegistrationError("INVALID_INPUT");
  return withCaptureBoundary(tx, async () => {
    const input = parsed.data;
    const context = await resolveMetricVisitContext(tx, { vendorId: input.vendorId, liveId: input.liveId });
    return captureMetricRegistrationInner(tx, { ...input, versionId: context.versionId }, proofs, proof);
  });
}

async function withCaptureBoundary(tx: Prisma.TransactionClient, action: () => Promise<{ visitorId: string | null }>) {
  // The identifier is generated internally, never interpolated from user data.
  const savepoint = Prisma.raw(`metric_capture_${randomUUID().replaceAll("-", "")}`);
  try { await tx.$executeRaw(Prisma.sql`SAVEPOINT ${savepoint}`); }
  catch { throw new MetricRegistrationError("PERSISTENCE_UNAVAILABLE"); }
  try {
    const [settings] = await tx.$queryRaw<{ statement: string; lock: string }[]>(Prisma.sql`
      SELECT current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock`);
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','1000',true),set_config('lock_timeout','500',true)`);
    const result = await action();
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout',${settings.statement},true),set_config('lock_timeout',${settings.lock},true)`);
    await tx.$executeRaw(Prisma.sql`RELEASE SAVEPOINT ${savepoint}`);
    return { status: "captured" as const, ...result };
  } catch (error) {
    try {
      // PostgreSQL permits this even after a constraint/statement timeout error.
      // It also restores SET LOCAL values and releases locks acquired since SAVEPOINT.
      await tx.$executeRaw(Prisma.sql`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await tx.$executeRaw(Prisma.sql`RELEASE SAVEPOINT ${savepoint}`);
    } catch { throw new MetricRegistrationError("PERSISTENCE_UNAVAILABLE"); }
    return { status: "unavailable" as const,
      code: error instanceof MetricRegistrationError ? error.code : "PERSISTENCE_UNAVAILABLE" as const };
  }
}

/** Internal only: the caller resolves version from public server context and
 * calls this in the FIRST submission creation transaction, never on duplicate
 * form submissions. Missing/invalid proofs preserve unknown attribution.
 * A current cookie is never accepted later to repair an unknown capture.
 */
async function captureMetricRegistrationInner(tx: Prisma.TransactionClient,
  value: z.infer<typeof CaptureIdentity>, proofs: Proofs, proof: unknown = null) {
  const parsed = CaptureIdentity.safeParse(value);
  if (!parsed.success) throw new MetricRegistrationError("INVALID_INPUT");
  const input = parsed.data;
  try {
    // Existing provenance is independent of current verification/collection
    // state. Return it before INSERT's guards run; never replace it on retries.
    const existing = await tx.$queryRaw<{ vendorId: string; liveId: string; versionId: string; visitorId: string | null }[]>(Prisma.sql`
      SELECT "vendorId","liveId","versionId","visitorId" FROM "LiveMetricRegistrationCapture" WHERE "submissionId"=${input.submissionId}`);
    if (existing.length === 1) {
      const row = existing[0];
      if (row.vendorId !== input.vendorId || row.liveId !== input.liveId || row.versionId !== input.versionId)
        throw new MetricRegistrationError("IDENTITY_CONFLICT");
      return { visitorId: row.visitorId };
    }
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "LiveMetricVersion" WHERE id=${input.versionId}
      AND "vendorId"=${input.vendorId} AND "liveId"=${input.liveId} FOR SHARE`);
    const [version] = await tx.$queryRaw<{ nowAt: Date }[]>(Prisma.sql`
      SELECT date_trunc('milliseconds',clock_timestamp()) AS "nowAt" FROM "LiveMetricVersion"
      WHERE id=${input.versionId} AND "vendorId"=${input.vendorId} AND "liveId"=${input.liveId}
        AND "collectionEnabled" AND "collectionStartedAt"<=clock_timestamp() AND "expiresAt">clock_timestamp()`);
    if (!version) throw new MetricRegistrationError("SCOPE_UNAVAILABLE");
    const scope = { vendorId: input.vendorId, liveId: input.liveId, versionId: input.versionId };
    const verifiedVisitor = proofs.verify(proof, scope, +version.nowAt);
    let visitorId: string | null = null;
    if (verifiedVisitor !== null) {
      const visitors = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM "LiveMetricVisitor" WHERE id=${verifiedVisitor} AND "vendorId"=${input.vendorId}
          AND "liveId"=${input.liveId} AND "versionId"=${input.versionId} FOR KEY SHARE`);
      visitorId = visitors.length === 1 ? visitors[0].id : null;
    }
    await tx.$executeRaw(Prisma.sql`INSERT INTO "LiveMetricRegistrationCapture"
      ("submissionId","vendorId","liveId","versionId","visitorId")
      VALUES (${input.submissionId},${input.vendorId},${input.liveId},${input.versionId},${visitorId})
      ON CONFLICT ("submissionId") DO NOTHING`);
    const rows = await tx.$queryRaw<{ visitorId: string | null }[]>(Prisma.sql`
      SELECT "visitorId" FROM "LiveMetricRegistrationCapture" WHERE "submissionId"=${input.submissionId}
        AND "vendorId"=${input.vendorId} AND "liveId"=${input.liveId} AND "versionId"=${input.versionId}`);
    if (rows.length !== 1) throw new MetricRegistrationError("IDENTITY_CONFLICT");
    return { visitorId: rows[0].visitorId };
  } catch (error) {
    if (error instanceof MetricRegistrationError) throw error;
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.code : undefined;
    if (code === "23514" || code === "23503") throw new MetricRegistrationError("SCOPE_UNAVAILABLE");
    throw new MetricRegistrationError("PERSISTENCE_UNAVAILABLE");
  }
}

/** Replayable projection after verification commits. Verification keeps its
 * Serializable protection; metric writes retain their ReadCommitted guard.
 * The persisted capture is the retry source, so no browser is required.
 * Callers must schedule reconciliation and keep coverage unknown until drained.
 */
export async function materializeMetricRegistration(db: Pick<PrismaClient, "$transaction">,
  value: z.infer<typeof Identity>, expectedVersionId?: string) {
  const parsed = Identity.safeParse(value);
  if (!parsed.success || (expectedVersionId !== undefined && !id.safeParse(expectedVersionId).success)) throw new MetricRegistrationError("INVALID_INPUT");
  const input = parsed.data;
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
      const references = await tx.$queryRaw<{ versionId: string }[]>(Prisma.sql`
        SELECT "versionId" FROM "LiveMetricRegistrationCapture" WHERE "submissionId"=${input.submissionId}
          AND "vendorId"=${input.vendorId} AND "liveId"=${input.liveId}
          ${expectedVersionId === undefined ? Prisma.empty : Prisma.sql`AND "versionId"=${expectedVersionId}`}`);
      if (references.length !== 1) return { status: "missing_capture" as const, retryable: false };
      const versionId = references[0].versionId;
      // Match source mutation and registration guards: Live -> submission -> version.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Live" WHERE id=${input.liveId} AND "vendorId"=${input.vendorId} FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "FormSubmission" WHERE id=${input.submissionId} FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "LiveMetricVersion" WHERE id=${versionId}
        AND "vendorId"=${input.vendorId} AND "liveId"=${input.liveId} FOR SHARE`);
      // Keep timestamp precision and timezone conversion in PostgreSQL. The
      // classifier separates retryable sources from terminal evidence gaps;
      // neither terminal nor pending means coverage is complete.
      const source = Prisma.sql`FROM "LiveMetricRegistrationCapture" c
        LEFT JOIN "FormSubmission" f ON f.id=c."submissionId"
        LEFT JOIN "RegistrationForm" form ON form.id=f."formId"
        LEFT JOIN "Live" l ON l.id=c."liveId" AND l."vendorId"=c."vendorId"
        LEFT JOIN "LiveMetricVersion" v ON v.id=c."versionId" AND v."vendorId"=c."vendorId" AND v."liveId"=c."liveId"
        WHERE c."submissionId"=${input.submissionId} AND c."vendorId"=${input.vendorId}
          AND c."liveId"=${input.liveId} AND c."versionId"=${versionId}`;
      type State = "eligible" | "scope_changed" | "pending_verification" | "missing_verified_time"
        | "clock_order_conflict" | "outside_retention" | "pending_clock";
      const [eligibility] = await tx.$queryRaw<{ state: State }[]>(Prisma.sql`SELECT CASE
        WHEN f.id IS NULL OR l.id IS NULL OR v.id IS NULL OR form."vendorId" IS DISTINCT FROM c."vendorId"
          OR f."liveId" IS DISTINCT FROM c."liveId" OR f."formId" IS DISTINCT FROM l."formId" THEN 'scope_changed'
        WHEN f."verificationStatus"='UNVERIFIED' THEN 'pending_verification'
        WHEN f."verifiedAt" IS NULL THEN 'missing_verified_time'
        WHEN (f."verifiedAt" AT TIME ZONE 'UTC')<c."capturedAt" THEN 'clock_order_conflict'
        WHEN (f."verifiedAt" AT TIME ZONE 'UTC')>=v."expiresAt" THEN 'outside_retention'
        WHEN (f."verifiedAt" AT TIME ZONE 'UTC')>clock_timestamp() THEN 'pending_clock'
        ELSE 'eligible' END AS state ${source}`);
      if (!eligibility) return { status: "missing_capture" as const, retryable: false };
      if (eligibility.state !== "eligible") return {
        status: eligibility.state,
        retryable: eligibility.state === "pending_verification" || eligibility.state === "pending_clock",
      };
      await tx.$executeRaw(Prisma.sql`INSERT INTO "LiveMetricRegistration"
        (id,"vendorId","liveId","versionId","submissionId","visitorId","verifiedAt")
        SELECT ${randomUUID()},c."vendorId",c."liveId",c."versionId",c."submissionId",c."visitorId",
          f."verifiedAt" AT TIME ZONE 'UTC' ${source}
        ON CONFLICT ("vendorId","liveId","versionId","submissionId") DO NOTHING`);
      const registrations = await tx.$queryRaw<{ id: string; identityMatches: boolean }[]>(Prisma.sql`
        SELECT g.id, (g."visitorId" IS NOT DISTINCT FROM c."visitorId"
          AND g."verifiedAt"=(f."verifiedAt" AT TIME ZONE 'UTC')) AS "identityMatches"
        FROM "LiveMetricRegistration" g
        JOIN "LiveMetricRegistrationCapture" c ON c."submissionId"=g."submissionId"
          AND c."vendorId"=g."vendorId" AND c."liveId"=g."liveId" AND c."versionId"=g."versionId"
        JOIN "FormSubmission" f ON f.id=g."submissionId"
        WHERE g."vendorId"=${input.vendorId} AND g."liveId"=${input.liveId}
          AND g."versionId"=${versionId} AND g."submissionId"=${input.submissionId}`);
      if (registrations.length !== 1 || !registrations[0].identityMatches)
        return { status: "identity_conflict" as const, retryable: false };
      return { status: "recorded" as const, retryable: false, registrationId: registrations[0].id, versionId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
  } catch (error) {
    if (error instanceof MetricRegistrationError) throw error;
    throw new MetricRegistrationError("PERSISTENCE_UNAVAILABLE");
  }
}
