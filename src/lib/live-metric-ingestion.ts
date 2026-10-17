import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { playbackSegment } from "./live-viewing-evidence";

const MAX_INT = 2_147_483_647;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const offset = z.number().int().min(0).max(MAX_INT);
const SegmentSchema = z.object({
  sequence: offset,
  startElapsedMs: offset,
  endElapsedMs: offset,
  mediaStartMs: offset,
  mediaEndMs: offset,
  rate: z.number().min(0.25).max(4),
}).strict();
const BatchSchema = z.object({ sessionId: id, segments: z.array(SegmentSchema).min(1).max(20) }).strict();
const IdentitySchema = z.object({ vendorId: id, liveId: id, submissionId: id, admissionId: id }).strict();

/** Construct only from authenticated server-side claims and an active admission;
 * never copy identity fields out of a request body. The database rechecks scope.
 */
export type MetricIngestIdentity = z.infer<typeof IdentitySchema>;
/** HTTP authorizers must be repeatable: resolve scope first, then revalidate
 * current credentials/moderation after every potentially blocking source lock.
 * Direct identities are reserved for trusted internal callers and DB fixtures.
 */
export type MetricIngestAuthorization = MetricIngestIdentity | ((tx: Prisma.TransactionClient, phase: "resolve" | "revalidate") => Promise<MetricIngestIdentity>);
export type MetricIngestBatch = z.infer<typeof BatchSchema>;
export type MetricIngestCode = "invalid_payload" | "not_authorized" | "invalid_segment" | "sequence_conflict" | "session_closed" | "evidence_rejected" | "retryable_conflict";
export class MetricIngestError extends Error {
  constructor(readonly code: MetricIngestCode) { super(code); this.name = "MetricIngestError"; }
}
export type PreparedMetricInterval = {
  sequence: number; payloadHash: string; wallStartAt: Date; wallEndAt: Date;
  mediaStartMs: number; mediaEndMs: number; endElapsedMs: number;
};
export type MetricIngestState = {
  anchorAt: Date; durationMs: number | null; lastSequence: number;
  lastElapsedMs: number; closedAt: Date | null; complete: boolean;
};
type StoredInterval = { sequence: number; payloadHash: string };
export type MetricIngestReceipt = { accepted: number; replayed: number; lastSequence: number };

export function parseMetricIngestBatch(value: unknown): MetricIngestBatch {
  const parsed = BatchSchema.safeParse(value);
  if (!parsed.success) throw new MetricIngestError("invalid_payload");
  return parsed.data;
}

/** Share the playback sampler's rate/seek rules; anchor elapsed offsets to the
 * saved server timestamp instead of accepting a client-provided wall clock.
 */
export function prepareMetricIntervals(batch: MetricIngestBatch, state: MetricIngestState, now: Date): PreparedMetricInterval[] {
  const anchor = +state.anchorAt;
  if (!Number.isSafeInteger(anchor) || anchor < 0 || !Number.isSafeInteger(+now)) throw new MetricIngestError("invalid_segment");
  let previousSequence: number | null = null;
  let previousEnd = 0;
  return batch.segments.map((row) => {
    const segment = playbackSegment(
      { elapsedMs: row.startElapsedMs, mediaMs: row.mediaStartMs, rate: row.rate, playing: true },
      { elapsedMs: row.endElapsedMs, mediaMs: row.mediaEndMs, rate: row.rate, playing: true },
    );
    const wallStart = anchor + row.startElapsedMs, wallEnd = anchor + row.endElapsedMs;
    if (!segment || !Number.isSafeInteger(wallEnd) || wallEnd > +now
      || (state.durationMs !== null && row.mediaEndMs > state.durationMs)
      || (previousSequence !== null && (row.sequence !== previousSequence + 1 || row.startElapsedMs < previousEnd))) {
      throw new MetricIngestError("invalid_segment");
    }
    previousSequence = row.sequence; previousEnd = row.endElapsedMs;
    const payloadHash = createHash("sha256").update(JSON.stringify([
      batch.sessionId, row.sequence, row.startElapsedMs, row.endElapsedMs,
      row.mediaStartMs, row.mediaEndMs, row.rate,
    ])).digest("hex");
    return { sequence: row.sequence, payloadHash, wallStartAt: new Date(wallStart), wallEndAt: new Date(wallEnd), mediaStartMs: row.mediaStartMs, mediaEndMs: row.mediaEndMs, endElapsedMs: row.endElapsedMs };
  });
}

/** Run only while holding the metric session row lock. Replays are identified
 * by both sequence and canonical payload; a conflicting retry is never ignored.
 */
export function planMetricIntervalWrites(rows: readonly PreparedMetricInterval[], state: MetricIngestState, stored: readonly StoredInterval[]) {
  const hashes = new Map(stored.map((row) => [row.sequence, row.payloadHash]));
  const append: PreparedMetricInterval[] = [];
  let replayed = 0, lastSequence = state.lastSequence, lastEnd = +state.anchorAt + state.lastElapsedMs;
  for (const row of rows) {
    const oldHash = hashes.get(row.sequence);
    if (oldHash !== undefined) {
      if (oldHash !== row.payloadHash || row.sequence > state.lastSequence) throw new MetricIngestError("sequence_conflict");
      replayed++; continue;
    }
    if (state.closedAt || state.complete) throw new MetricIngestError("session_closed");
    if (row.sequence !== lastSequence + 1 || +row.wallStartAt < lastEnd) throw new MetricIngestError("sequence_conflict");
    append.push(row); lastSequence = row.sequence; lastEnd = +row.wallEndAt;
  }
  return { append, receipt: { accepted: append.length, replayed, lastSequence } satisfies MetricIngestReceipt };
}

/** Trusted server callback used by HTTP ingestion to select the current
 * content/mode inside the source-lock transaction. Internal DB fixtures may omit it. */
export type MetricVersionResolver = (tx: Prisma.TransactionClient, identity: MetricIngestIdentity) => Promise<{ versionId: string; expiresAt: Date }>;
export type LockedMetricSession = MetricIngestState & { versionId: string; expiresAt: Date; finalSequence: number | null };

/** Shared locking/authentication boundary. Close can acknowledge already stored
 * historical evidence after session expiry; it never appends new evidence or
 * bypasses current admission, verification, version lifetime or collection gates. */
export async function withLockedMetricSession<T>(
  db: Pick<PrismaClient, "$transaction">, authorization: MetricIngestAuthorization,
  sessionId: string, purpose: "append" | "close",
  operation: (tx: Prisma.TransactionClient, identity: MetricIngestIdentity, session: LockedMetricSession, now: Date, effectiveExpiresAt: Date) => Promise<T>,
  resolveVersion?: MetricVersionResolver,
): Promise<T> {
  if (!id.safeParse(sessionId).success) throw new MetricIngestError("invalid_payload");
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    // HTTP callers resolve signed viewer claims inside this same transaction.
    const identity = typeof authorization === "function" ? await authorization(tx, "resolve") : authorization;
    if (!IdentitySchema.safeParse(identity).success) throw new MetricIngestError("not_authorized");
    // Match the database guard's source-first order; locking the session first
    // would race/deadlock with revocation and source deletion.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Live" WHERE id=${identity.liveId} AND "vendorId"=${identity.vendorId} FOR SHARE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "FormSubmission" WHERE id=${identity.submissionId} FOR SHARE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "LiveViewerSession" WHERE id=${identity.admissionId} FOR SHARE`);
    const selectCurrentVersion = async () => {
      try { return resolveVersion ? await resolveVersion(tx, identity) : null; }
      catch (error) {
        // Closing old evidence is allowed when current playback is unavailable;
        // infrastructure failures still propagate and must not invent a terminal state.
        if (purpose === "close" && error instanceof MetricIngestError && error.code === "not_authorized") return null;
        throw error;
      }
    };
    const selected = await selectCurrentVersion();
    const versions = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT v.id FROM "LiveMetricVersion" v JOIN "LiveMetricSession" s ON s."versionId"=v.id
      WHERE s.id=${sessionId} AND s."vendorId"=${identity.vendorId} AND s."liveId"=${identity.liveId}
      FOR SHARE OF v`);
    if (versions.length !== 1 || (purpose === "append" && selected && selected.versionId !== versions[0].id)) throw new MetricIngestError("not_authorized");
    const sessions = await tx.$queryRaw<LockedMetricSession[]>(Prisma.sql`
      SELECT s."anchorAt",s."lastSequence",s."lastElapsedMs",s."closedAt",s.complete,s."versionId",v."durationMs",s."expiresAt",s."finalSequence"
      FROM "LiveMetricSession" s
      JOIN "LiveMetricVersion" v ON v.id=s."versionId" AND v."vendorId"=s."vendorId" AND v."liveId"=s."liveId"
      JOIN "LiveMetricRegistration" r ON r.id=s."registrationId" AND r."versionId"=v.id
      JOIN "FormSubmission" f ON f.id=r."submissionId" AND f."liveId"=s."liveId"
      JOIN "Live" l ON l.id=s."liveId" AND l."vendorId"=s."vendorId" AND l."formId"=f."formId"
      JOIN "LiveViewerSession" a ON a.id=s."admissionSessionId" AND a."vendorId"=s."vendorId" AND a."liveId"=s."liveId"
      WHERE s.id=${sessionId} AND s."vendorId"=${identity.vendorId} AND s."liveId"=${identity.liveId}
        AND r."submissionId"=${identity.submissionId} AND a.id=${identity.admissionId}
        AND f."verificationStatus"='VERIFIED' AND f."verifiedAt"=(r."verifiedAt" AT TIME ZONE 'UTC')
        AND (${purpose === "close"} OR l."videoId" IS NOT DISTINCT FROM v."videoId") AND v."collectionEnabled"
        AND v."expiresAt">clock_timestamp() AND (${purpose === "close"} OR s."expiresAt">clock_timestamp())
        AND a."expiresAt"> (clock_timestamp() AT TIME ZONE 'UTC')
      FOR UPDATE OF s`);
    if (sessions.length !== 1) throw new MetricIngestError("not_authorized");
    let effectiveExpiresAt = sessions[0].expiresAt;
    if (resolveVersion) {
      const current = await selectCurrentVersion();
      if (!current || current.versionId !== sessions[0].versionId) {
        if (purpose === "append") throw new MetricIngestError("not_authorized");
        effectiveExpiresAt = new Date(0); // Current content cannot accept missing events.
      } else {
        effectiveExpiresAt = new Date(Math.min(+effectiveExpiresAt, +current.expiresAt));
      }
    }
    if (typeof authorization === "function") {
      const current = await authorization(tx, "revalidate");
      if (!IdentitySchema.safeParse(current).success
        || current.vendorId !== identity.vendorId || current.liveId !== identity.liveId
        || current.submissionId !== identity.submissionId || current.admissionId !== identity.admissionId) {
        throw new MetricIngestError("not_authorized");
      }
    }
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>(Prisma.sql`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`);
    return operation(tx, identity, sessions[0], now, effectiveExpiresAt);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 }).catch((error: unknown) => {
    if (error instanceof MetricIngestError) throw error;
    const parsed = z.object({ code: z.string().optional(), meta: z.object({ code: z.string().optional() }).passthrough().optional() }).passthrough().safeParse(error);
    const sqlState = parsed.success ? parsed.data.meta?.code : undefined;
    const code = parsed.success ? parsed.data.code : undefined;
    // Match stable SQLSTATEs only; never copy SQL/constraint details into a
    // public error. The route must render unknown failures as a generic 500.
    if (sqlState === "23514") throw new MetricIngestError("evidence_rejected");
    if (sqlState === "23505" || code === "P2002") throw new MetricIngestError("sequence_conflict");
    if (sqlState === "40P01" || sqlState === "40001" || ["P2034", "P2028", "P2024"].includes(code ?? "")) throw new MetricIngestError("retryable_conflict");
    throw error;
  });
}

/** Atomic append and exact replay, with current content selection for HTTP.
 * Released/expired admission credentials cannot acknowledge old writes. */
export async function ingestMetricIntervals(
  db: Pick<PrismaClient, "$transaction">, authorization: MetricIngestAuthorization,
  value: unknown, resolveVersion?: MetricVersionResolver,
): Promise<MetricIngestReceipt> {
  const batch = parseMetricIngestBatch(value);
  return withLockedMetricSession(db, authorization, batch.sessionId, "append", async (tx, identity, session, now, expiresAt) => {
    const prepared = prepareMetricIntervals(batch, session, now);
    if (prepared.some((row) => +row.wallEndAt > +expiresAt)) throw new MetricIngestError("invalid_segment");
    const stored = await tx.$queryRaw<StoredInterval[]>(Prisma.sql`
      SELECT sequence,"payloadHash" FROM "LiveMetricInterval" WHERE "sessionId"=${batch.sessionId}
        AND sequence>=${prepared[0].sequence} AND sequence<=${prepared[prepared.length - 1].sequence}`);
    const { append, receipt } = planMetricIntervalWrites(prepared, session, stored);
    for (const row of append) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "LiveMetricInterval"
        (id,"vendorId","liveId","versionId","sessionId",sequence,"payloadHash","wallStartAt","wallEndAt","mediaStartMs","mediaEndMs")
        VALUES (${randomUUID()},${identity.vendorId},${identity.liveId},${session.versionId},${batch.sessionId},${row.sequence},${row.payloadHash},${row.wallStartAt},${row.wallEndAt},${row.mediaStartMs},${row.mediaEndMs})`);
    }
    return receipt;
  }, resolveVersion);
}
