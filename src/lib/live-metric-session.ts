import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { MetricIngestError, type MetricIngestAuthorization, type MetricIngestIdentity } from "./live-metric-ingestion";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const IdentitySchema = z.object({ vendorId: id, liveId: id, submissionId: id, admissionId: id }).strict();
const RequestSchema = z.object({ requestId: z.string().uuid() }).strict();
const ContextSchema = z.object({ versionId: id, expiresAt: z.date(), visitorId: id.nullable().optional() }).strict();
export type MetricSessionContext = z.infer<typeof ContextSchema>;
export type MetricSessionContextResolver = (tx: Prisma.TransactionClient, identity: MetricIngestIdentity) => Promise<MetricSessionContext>;
export type MetricSessionAuthorizer = Exclude<MetricIngestAuthorization, MetricIngestIdentity>;
export type MetricSessionReceipt = {
  sessionId: string; versionId: string; anchorAtMs: number; expiresAtMs: number;
  durationMs: number | null; lastSequence: number; lastElapsedMs: number;
};
// Resource bounds, not analytics denominators or a data-retention policy.
export const METRIC_SESSION_LIMITS = { openPerAdmission: 16, totalPerAdmission: 64, totalPerRegistration: 256 } as const;
export class MetricSessionLimitError extends Error {
  constructor(readonly reason: "open" | "admission_total" | "registration_total" = "open") { super("Metric session limit reached"); this.name = "MetricSessionLimitError"; }
}
type SessionRow = { id: string; anchorAt: Date; expiresAt: Date; lastSequence: number; lastElapsedMs: number; closedAt: Date | null; intakeId: string | null };

/** Only an idempotency key comes from the browser. Version, lifetime and any
 * proven first-party visitor association belong to the server context.
 */
export function parseMetricSessionRequest(value: unknown) {
  const parsed = RequestSchema.safeParse(value);
  if (!parsed.success) throw new MetricIngestError("invalid_payload");
  return parsed.data;
}

function assertIdentity(value: unknown): asserts value is MetricIngestIdentity {
  if (!IdentitySchema.safeParse(value).success) throw new MetricIngestError("not_authorized");
}

type PlaybackLeaseOptions = { requirePlaybackIntake?: boolean; renewPlaybackIntake?: boolean };
type PlaybackLeaseInput = {
  identity: MetricIngestIdentity; versionId: string; requestId: string;
  session: SessionRow | undefined; source: { expiresAt: Date }; now: Date; options: PlaybackLeaseOptions;
};

/** One bounded intake lease, under the caller's existing source/session locks.
 * It never issues a new nonce or changes identity when an old lease expires.
 */
async function bindPlaybackLease(tx: Prisma.TransactionClient, input: PlaybackLeaseInput) {
  const { identity, versionId, requestId, session, source, now, options } = input;
  let intakeId: string | null = null;
  // Never resurrect a closed or expired session, even if its admission has
  // since been renewed. This check precedes any intake extension.
  if (session?.closedAt) throw new MetricIngestError("session_closed");
  if (session && +session.expiresAt <= +now) throw new MetricIngestError("not_authorized");
  if (options.requirePlaybackIntake) {
    const [intake] = await tx.$queryRaw<{ id: string; expiresAt: Date }[]>(Prisma.sql`SELECT id,"expiresAt" FROM "LiveMetricPlaybackIntake"
      WHERE id=${requestId.toLowerCase()} AND "vendorId"=${identity.vendorId} AND "liveId"=${identity.liveId}
        AND "versionId"=${versionId} AND "admissionSessionId"=${identity.admissionId}
        AND "issuedAt"<=${now} AND "expiresAt">${now} FOR UPDATE`);
    if (!intake) throw new MetricIngestError("not_authorized");
    intakeId = intake.id;
    if (session && session.intakeId !== intakeId) throw new MetricIngestError("not_authorized");
    if (session && +session.expiresAt > +intake.expiresAt) throw new MetricIngestError("not_authorized");
    if (session && options.renewPlaybackIntake && +source.expiresAt > +intake.expiresAt) {
      // The database rechecks its clock after all lock waits, increments the
      // durable revision and caps the lease to the current admission/version.
      await tx.$executeRaw(Prisma.sql`UPDATE "LiveMetricPlaybackIntake" SET "expiresAt"=${source.expiresAt} WHERE id=${intakeId}`);
      intake.expiresAt = source.expiresAt;
    }
    source.expiresAt = new Date(Math.min(+source.expiresAt, +intake.expiresAt));
  }
  if (+source.expiresAt <= +now) throw new MetricIngestError("not_authorized");
  return intakeId;
}

/** Provision only against an already-enabled version. No defaults enable
 * collection or decide retention. Caller supplies the isolated provisioning
 * lifetime; the effective session also cannot outlive its version/admission.
 */
export async function issueMetricSession(
  db: Pick<PrismaClient, "$transaction">,
  authorize: MetricSessionAuthorizer,
  contextSource: MetricSessionContext | MetricSessionContextResolver,
  value: unknown,
  options: PlaybackLeaseOptions = {},
): Promise<MetricSessionReceipt> {
  const request = parseMetricSessionRequest(value);
  if (options.renewPlaybackIntake && !options.requirePlaybackIntake) throw new MetricIngestError("invalid_payload");
  if (typeof contextSource !== "function" && !ContextSchema.safeParse(contextSource).success) throw new MetricIngestError("invalid_payload");
  return db.$transaction(async (tx) => {
    const identity = await authorize(tx, "resolve");
    assertIdentity(identity);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Live" WHERE id=${identity.liveId} AND "vendorId"=${identity.vendorId} FOR SHARE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "FormSubmission" WHERE id=${identity.submissionId} FOR NO KEY UPDATE`);
    // Serialize issuance for one admission without upgrading a later version
    // lock. Interval ingestion takes these same source locks in the same order.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "LiveViewerSession" WHERE id=${identity.admissionId} FOR NO KEY UPDATE`);
    const context = typeof contextSource === "function" ? await contextSource(tx, identity) : contextSource;
    if (!ContextSchema.safeParse(context).success) throw new MetricIngestError("invalid_payload");
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "LiveMetricVersion" WHERE id=${context.versionId} AND "vendorId"=${identity.vendorId} AND "liveId"=${identity.liveId} FOR SHARE`);
    const sources = await tx.$queryRaw<{ verifiedAt: Date; durationMs: number | null; expiresAt: Date }[]>(Prisma.sql`
      SELECT f."verifiedAt" AT TIME ZONE 'UTC' AS "verifiedAt", v."durationMs",
        LEAST(v."expiresAt", a."expiresAt" AT TIME ZONE 'UTC', ${context.expiresAt}::timestamptz) AS "expiresAt"
      FROM "Live" l
      JOIN "FormSubmission" f ON f."liveId"=l.id AND f."formId"=l."formId"
      JOIN "RegistrationForm" rf ON rf.id=f."formId" AND rf."vendorId"=l."vendorId"
      JOIN "LiveViewerSession" a ON a."liveId"=l.id AND a."vendorId"=l."vendorId"
      JOIN "LiveMetricVersion" v ON v."liveId"=l.id AND v."vendorId"=l."vendorId" AND v."videoId" IS NOT DISTINCT FROM l."videoId"
      WHERE l.id=${identity.liveId} AND l."vendorId"=${identity.vendorId}
        AND f.id=${identity.submissionId} AND a.id=${identity.admissionId} AND v.id=${context.versionId}
        AND f."verificationStatus"='VERIFIED' AND f."verifiedAt" IS NOT NULL
        AND f."verifiedAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
        AND a."createdAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
        AND v."collectionEnabled" AND v."collectionStartedAt"<=clock_timestamp()
        AND v."expiresAt">clock_timestamp() AND a."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
        AND ${context.expiresAt}::timestamptz>clock_timestamp()`);
    if (sources.length !== 1) throw new MetricIngestError("not_authorized");
    const source = sources[0];
    if (context.visitorId != null) {
      const visitors = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "LiveMetricVisitor"
        WHERE id=${context.visitorId} AND "vendorId"=${identity.vendorId} AND "liveId"=${identity.liveId} AND "versionId"=${context.versionId}`);
      if (visitors.length !== 1) throw new MetricIngestError("not_authorized");
    }
    await tx.$executeRaw(Prisma.sql`INSERT INTO "LiveMetricRegistration"
      (id,"vendorId","liveId","versionId","submissionId","visitorId","verifiedAt")
      VALUES (${randomUUID()},${identity.vendorId},${identity.liveId},${context.versionId},${identity.submissionId},${context.visitorId ?? null},${source.verifiedAt})
      ON CONFLICT ("vendorId","liveId","versionId","submissionId") DO NOTHING`);
    const registrations = await tx.$queryRaw<{ id: string; verifiedAt: Date; visitorId: string | null }[]>(Prisma.sql`
      SELECT id,"verifiedAt","visitorId" FROM "LiveMetricRegistration" WHERE "vendorId"=${identity.vendorId}
        AND "liveId"=${identity.liveId} AND "versionId"=${context.versionId} AND "submissionId"=${identity.submissionId}`);
    const registration = registrations[0];
    // This is first-registration attribution, not a device access restriction.
    // Later devices (or initially unknown attribution) never rewrite history.
    // A changed verification epoch remains fail-closed: it is not the same
    // immutable cohort fact and must not silently inherit old viewing evidence.
    if (!registration || +registration.verifiedAt !== +source.verifiedAt) throw new MetricIngestError("not_authorized");
    // Binding the key to all server identities prevents cross-tenant/key replay.
    const sessionId = `ms_${createHash("sha256").update(JSON.stringify([identity.vendorId, identity.liveId, context.versionId, identity.submissionId, identity.admissionId, request.requestId.toLowerCase()])).digest("hex")}`;
    const existing = await tx.$queryRaw<SessionRow[]>(Prisma.sql`SELECT id,"anchorAt","expiresAt","lastSequence","lastElapsedMs","closedAt","intakeId"
      FROM "LiveMetricSession" WHERE id=${sessionId} AND "registrationId"=${registration.id}
        AND "admissionSessionId"=${identity.admissionId} AND "versionId"=${context.versionId} FOR UPDATE`);
    // All blocking source/registration/session work precedes the final
    // moderation decision, matching interval ingestion's revalidation contract.
    if (typeof contextSource === "function") {
      // A lock wait may cross a playback/replay boundary even though no source
      // row changed. Re-resolve server context before the final auth decision.
      const refreshed = await contextSource(tx, identity);
      if (!ContextSchema.safeParse(refreshed).success || refreshed.versionId !== context.versionId
        || +refreshed.expiresAt < +source.expiresAt) throw new MetricIngestError("not_authorized");
    }
    const current = await authorize(tx, "revalidate");
    assertIdentity(current);
    if (current.vendorId !== identity.vendorId || current.liveId !== identity.liveId
      || current.submissionId !== identity.submissionId || current.admissionId !== identity.admissionId) throw new MetricIngestError("not_authorized");
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>(Prisma.sql`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`);
    const session = existing[0];
    const intakeId = await bindPlaybackLease(tx, { identity, versionId: context.versionId,
      requestId: request.requestId, session, source, now, options });
    if (session) {
      if (options.requirePlaybackIntake && session.intakeId !== intakeId) throw new MetricIngestError("not_authorized");
      if (session.closedAt) throw new MetricIngestError("session_closed");
      if (+session.expiresAt <= +now || +session.expiresAt > +source.expiresAt) throw new MetricIngestError("not_authorized");
      if (options.renewPlaybackIntake && +source.expiresAt > +session.expiresAt) {
        // Guard the final decision with a fresh DB clock. Failure rolls back
        // both writes; the original anchor and sequence are never rewritten.
        const changed = await tx.$executeRaw(Prisma.sql`UPDATE "LiveMetricSession" SET "expiresAt"=${source.expiresAt}
          WHERE id=${session.id} AND "closedAt" IS NULL AND "expiresAt">clock_timestamp()`);
        if (changed !== 1) throw new MetricIngestError("not_authorized");
        session.expiresAt = source.expiresAt;
      }
    } else {
      // Source NO KEY UPDATE locks serialize issuance, while allowing FK key-share reads.
      // The admissionSessionId index bounds lookup to one credential's history.
      // Existing-key retries bypass quota without creating any extra row.
      const [usage] = await tx.$queryRaw<{ total: number; open: number }[]>(Prisma.sql`
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE "closedAt" IS NULL AND "expiresAt">clock_timestamp())::int AS open
        FROM "LiveMetricSession" WHERE "admissionSessionId"=${identity.admissionId}
          AND "vendorId"=${identity.vendorId} AND "liveId"=${identity.liveId}`);
      if (usage.total >= METRIC_SESSION_LIMITS.totalPerAdmission) throw new MetricSessionLimitError("admission_total");
      if (usage.open >= METRIC_SESSION_LIMITS.openPerAdmission) throw new MetricSessionLimitError("open");
      const [history] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total
        FROM "LiveMetricSession" WHERE "vendorId"=${identity.vendorId} AND "liveId"=${identity.liveId}
          AND "versionId"=${context.versionId} AND "registrationId"=${registration.id}`);
      if (history.total >= METRIC_SESSION_LIMITS.totalPerRegistration) throw new MetricSessionLimitError("registration_total");
      await tx.$executeRaw(Prisma.sql`INSERT INTO "LiveMetricSession"
        (id,"vendorId","liveId","versionId","registrationId","admissionSessionId","anchorAt","expiresAt","intakeId")
        VALUES (${sessionId},${identity.vendorId},${identity.liveId},${context.versionId},${registration.id},${identity.admissionId},${now},${source.expiresAt},${intakeId})`);
      return { sessionId, versionId: context.versionId, anchorAtMs: +now, expiresAtMs: +source.expiresAt,
        durationMs: source.durationMs, lastSequence: -1, lastElapsedMs: 0 };
    }
    return { sessionId: session.id, versionId: context.versionId, anchorAtMs: +session.anchorAt, expiresAtMs: +session.expiresAt,
      durationMs: source.durationMs, lastSequence: session.lastSequence, lastElapsedMs: session.lastElapsedMs };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 }).catch((error: unknown) => {
    if (error instanceof MetricIngestError || error instanceof MetricSessionLimitError) throw error;
    const parsed = z.object({ code: z.string().optional(), meta: z.object({ code: z.string().optional() }).passthrough().optional() }).passthrough().safeParse(error);
    const code = parsed.success ? parsed.data.code : undefined;
    const sqlState = parsed.success ? parsed.data.meta?.code : undefined;
    if (sqlState === "23514" || sqlState === "23503") throw new MetricIngestError("evidence_rejected");
    if (sqlState === "23505" || code === "P2002") throw new MetricIngestError("sequence_conflict");
    if (sqlState === "40P01" || sqlState === "40001" || ["P2034", "P2028", "P2024"].includes(code ?? "")) throw new MetricIngestError("retryable_conflict");
    throw error;
  });
}
