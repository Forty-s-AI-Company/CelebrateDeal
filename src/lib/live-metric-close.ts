import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { MetricIngestError, withLockedMetricSession, type LockedMetricSession, type MetricIngestAuthorization, type MetricVersionResolver } from "./live-metric-ingestion";

const CloseSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  finalSequence: z.number().int().min(-1).max(2147483647),
}).strict();
export type MetricCloseReceipt = {
  sessionId: string; finalSequence: number; lastSequence: number;
  deliveryComplete: boolean; appendOpen: boolean; closedAtMs: number | null;
};
export function parseMetricClose(value: unknown) {
  const parsed = CloseSchema.safeParse(value);
  if (!parsed.success) throw new MetricIngestError("invalid_payload");
  return parsed.data;
}

/** Completion means all declared event sequences were delivered, NOT that the
 * viewer watched the whole video. Pending close seals the final sequence while
 * permitting only missing earlier sequences to arrive. Nothing is fabricated.
 */
export function planMetricClose(session: LockedMetricSession, finalSequence: number, now: Date, effectiveExpiresAt = session.expiresAt) {
  if ((session.finalSequence !== null && session.finalSequence !== finalSequence) || finalSequence < session.lastSequence) throw new MetricIngestError("sequence_conflict");
  if (session.closedAt) {
    if (session.finalSequence !== finalSequence) throw new MetricIngestError("session_closed");
    return { complete: session.complete, closedAt: session.closedAt };
  }
  if (finalSequence > session.lastSequence && +now < +effectiveExpiresAt) return { complete: false, closedAt: null };
  const closedAt = new Date(Math.min(+now, +session.expiresAt));
  if (+closedAt < +session.anchorAt + session.lastElapsedMs) throw new MetricIngestError("retryable_conflict");
  return { complete: finalSequence === session.lastSequence, closedAt };
}

export async function closeMetricSession(db: Pick<PrismaClient, "$transaction">, authorization: MetricIngestAuthorization, value: unknown, resolveVersion?: MetricVersionResolver): Promise<MetricCloseReceipt> {
  const input = parseMetricClose(value);
  return withLockedMetricSession(db, authorization, input.sessionId, "close", async (tx, _identity, session, now, effectiveExpiresAt) => {
    const plan = planMetricClose(session, input.finalSequence, now, effectiveExpiresAt);
    if (session.finalSequence !== input.finalSequence || session.complete !== plan.complete || session.closedAt?.getTime() !== plan.closedAt?.getTime()) {
      await tx.$executeRaw(Prisma.sql`UPDATE "LiveMetricSession" SET "finalSequence"=${input.finalSequence},
        "closedAt"=${plan.closedAt},complete=${plan.complete} WHERE id=${input.sessionId}`);
    }
    return { sessionId: input.sessionId, finalSequence: input.finalSequence, lastSequence: session.lastSequence,
      deliveryComplete: plan.complete, appendOpen: plan.closedAt === null && +now < +effectiveExpiresAt, closedAtMs: plan.closedAt ? +plan.closedAt : null };
  }, resolveVersion);
}
