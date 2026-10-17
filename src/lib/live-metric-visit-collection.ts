import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { resolveMetricVisitContext } from "./live-metric-visit-context";
import { provisionMetricVisitor, MetricVisitorError } from "./live-metric-visitor";
import { recordMetricVisit } from "./live-metric-visit";
import type { createMetricVisitorProofService } from "./live-metric-visitor-proof";
import { prepareMetricVisitIntent, requireMetricVisitIntent, MetricVisitIntentError } from "./live-metric-visit-intent";
import { requireMetricVisitPage } from "./live-metric-visit-page";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Scope = z.object({ vendorId: id, liveId: id }).strict();
const Event = z.object({ eventId: z.string().uuid().transform(value => value.toLowerCase()) }).strict();
type Proofs = ReturnType<typeof createMetricVisitorProofService>;

/** Preparation commits identity and, for the new HTTP protocol, its event
 * expectation, never a counted visit. Browser must
 * retain/acknowledge this proof before sending its first event. Losing this
 * response leaves an unused identity/unmatched intent, never a counted visit.
 */
export async function prepareMetricVisit(db: Pick<PrismaClient, "$transaction">,
  proofs: Proofs, inputScope: z.infer<typeof Scope>, existingProof: unknown = null, event?: unknown, requirePage = false) {
  const scope = Scope.safeParse(inputScope);
  if (!scope.success) throw new MetricVisitorError("SCOPE_UNAVAILABLE");
  const checked = event === undefined ? null : Event.safeParse(event);
  if (checked && !checked.success) throw new MetricVisitorError("SCOPE_UNAVAILABLE");
  const request = checked?.data ?? null;
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
      const context = await resolveMetricVisitContext(tx, scope.data);
      if (requirePage) {
        if (!request) throw new MetricVisitIntentError();
        await requireMetricVisitPage(tx, { ...scope.data, versionId: context.versionId, ...request });
      }
      const bound = { $transaction: async <T>(callback: (client: Prisma.TransactionClient) => Promise<T>) => {
        if (typeof callback !== "function") throw new MetricVisitorError("PERSISTENCE_UNAVAILABLE");
        return callback(tx);
      } } as Pick<PrismaClient, "$transaction">;
      let retained = existingProof;
      if (existingProof !== null) {
        const [{ now }] = await tx.$queryRaw<{ now: Date }[]>(Prisma.sql`SELECT clock_timestamp() AS now`);
        const oldVersion = proofs.versionForLive(existingProof, scope.data, +now);
        if (!oldVersion) throw new MetricVisitorError("PROOF_INVALID");
        // A new content version owns a separate metric cohort. Preparation may
        // allocate its identity, but never records or replays an event across it.
        if (oldVersion !== context.versionId) retained = null;
      }
      const visitor = await provisionMetricVisitor(bound, proofs, context, retained);
      if (request) await prepareMetricVisitIntent(tx, { ...scope.data, versionId: context.versionId, visitorId: visitor.visitorId, ...request });
      return { ...visitor, versionId: context.versionId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
  } catch (error) {
    if (error instanceof MetricVisitIntentError) throw new MetricVisitorError("SCOPE_UNAVAILABLE");
    if (error instanceof MetricVisitorError) throw error;
    throw new MetricVisitorError("PERSISTENCE_UNAVAILABLE");
  }
}

/** New public preparation cannot silently use the event-optional legacy path. */
export async function prepareTrackedMetricVisit(db: Pick<PrismaClient, "$transaction">,
  proofs: Proofs, scope: z.infer<typeof Scope>, existingProof: unknown, event: unknown) {
  const checked = Event.safeParse(event);
  if (!checked.success) throw new MetricVisitorError("SCOPE_UNAVAILABLE");
  return prepareMetricVisit(db, proofs, scope, existingProof, checked.data, true);
}

/** Internal collector composition. The HTTP boundary must enforce origin,
 * bounded input, rate limits and first-browser issuance coordination. Event IDs
 * provide replay protection only AFTER a browser identity has been established.
 * This operation does not certify complete collection coverage.
 */
export async function collectMetricVisit(db: Pick<PrismaClient, "$transaction">,
  proofs: Proofs, inputScope: z.infer<typeof Scope>, event: unknown, existingProof: unknown = null, requirePreparation = false) {
  const scope = Scope.safeParse(inputScope);
  const request = Event.safeParse(event);
  if (!scope.success || !request.success) throw new MetricVisitorError("SCOPE_UNAVAILABLE");
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
      const context = await resolveMetricVisitContext(tx, scope.data);
      // These two existing services use callback transactions only. Bind them
      // to this transaction, never start/commit nested independent transactions.
      // The adapter stays private; reject array/batch calls rather than emulate.
      const transaction = async <T>(callback: (client: Prisma.TransactionClient) => Promise<T>) => {
        if (typeof callback !== "function") throw new MetricVisitorError("PERSISTENCE_UNAVAILABLE");
        return callback(tx);
      };
      const bound = { $transaction: transaction } as Pick<PrismaClient, "$transaction">;
      const visitor = await provisionMetricVisitor(bound, proofs, context, existingProof);
      if (requirePreparation) await requireMetricVisitIntent(tx, { ...scope.data, versionId: context.versionId, visitorId: visitor.visitorId, ...request.data });
      const receipt = await recordMetricVisit(bound, { vendorId: context.vendorId, liveId: context.liveId,
        versionId: context.versionId, visitorId: visitor.visitorId }, request.data);
      return { ...visitor, ...receipt, versionId: context.versionId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
  } catch (error) {
    if (error instanceof MetricVisitIntentError) throw new MetricVisitorError("SCOPE_UNAVAILABLE");
    if (error instanceof MetricVisitorError) throw error;
    throw new MetricVisitorError("PERSISTENCE_UNAVAILABLE");
  }
}

/** Public collection entry after preparation; never silently allocate identity
 * while recording an event. HTTP callers must use this boundary.
 */
export async function collectPreparedMetricVisit(db: Pick<PrismaClient, "$transaction">,
  proofs: Proofs, scope: z.infer<typeof Scope>, event: unknown, existingProof: unknown) {
  if (typeof existingProof !== "string" || !existingProof || existingProof.length > 2048) throw new MetricVisitorError("PROOF_INVALID");
  return collectMetricVisit(db, proofs, scope, event, existingProof, true);
}
