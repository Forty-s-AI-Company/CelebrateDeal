import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Scope = z.object({ vendorId: id, liveId: id, versionId: id }).strict();
const Run = Scope.extend({ runId: z.string().uuid() });
const Frame = Run.extend({ frameId: z.string().uuid() });
export const MetricIngressRoute = z.enum(['form', 'landing', 'landing_step', 'viewer', 'playback']);
type Database = Pick<PrismaClient, '$transaction'>;

/** Private owned-disposable ingress census. Caller must await commit BEFORE
 * forwarding. No URL, request/response body, identity or credentials are stored.
 * Stopping admission does not seal sources and NEVER certifies coverage.
 */
export async function openMetricIngressRun(db: Database, value: z.infer<typeof Scope>, manifestHash: string, admissionLimit = 10000) {
  const scope = Scope.parse(value);
  const manifest = z.string().regex(/^[a-f0-9]{64}$/).parse(manifestHash);
  const limit = z.number().int().min(1).max(10000).parse(admissionLimit);
  const runId = randomUUID();
  return transaction(db, async tx => {
    const [row] = await tx.$queryRaw<{ openedAt: Date }[]>(Prisma.sql`
      INSERT INTO "LiveMetricIngressRun" (id,"vendorId","liveId","versionId","manifestHash","admissionLimit")
      VALUES (${runId},${scope.vendorId},${scope.liveId},${scope.versionId},${manifest},${limit}) RETURNING "openedAt"`);
    return { ...scope, runId, openedAt: row.openedAt };
  });
}

export async function admitMetricIngress(db: Database, value: z.infer<typeof Run>, routeKind: z.infer<typeof MetricIngressRoute>) {
  const scope = Run.parse(value), route = MetricIngressRoute.parse(routeKind), frameId = randomUUID();
  return transaction(db, async tx => {
    const [row] = await tx.$queryRaw<{ admittedAt: Date }[]>(Prisma.sql`
      INSERT INTO "LiveMetricIngressFrame" (id,"vendorId","liveId","versionId","runId","routeKind")
      VALUES (${frameId},${scope.vendorId},${scope.liveId},${scope.versionId},${scope.runId},${route}) RETURNING "admittedAt"`);
    return { ...scope, frameId, admittedAt: row.admittedAt };
  });
}

const Settlement = z.union([
  z.object({ outcome: z.literal('responded'), httpStatus: z.number().int().min(200).max(599) }).strict(),
  z.object({ outcome: z.literal('interrupted') }).strict(),
]);
export async function settleMetricIngress(db: Database, value: z.infer<typeof Frame>, settlement: z.infer<typeof Settlement>) {
  const scope = Frame.parse(value), result = Settlement.parse(settlement);
  return transaction(db, async tx => {
    const rows = await tx.$queryRaw<{ settledAt: Date }[]>(Prisma.sql`
      UPDATE "LiveMetricIngressFrame" SET outcome=${result.outcome},"httpStatus"=${'httpStatus' in result ? result.httpStatus : null}
      WHERE id=${scope.frameId} AND "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId}
        AND "versionId"=${scope.versionId} AND "runId"=${scope.runId} AND outcome='pending' RETURNING "settledAt"`);
    if (rows.length !== 1) throw new Error('Metric ingress settlement unavailable');
    return { settledAt: rows[0].settledAt };
  });
}

/** Stop is idempotent and serializes against admission. Pending frames survive;
 * late response settlement is allowed, but new admissions never reopen.
 */
export async function stopMetricIngressRun(db: Database, value: z.infer<typeof Run>) {
  const scope = Run.parse(value);
  return transaction(db, async tx => {
    const rows = await tx.$queryRaw<{ stoppedAt: Date | null }[]>(Prisma.sql`
      SELECT "stoppedAt" FROM "LiveMetricIngressRun" WHERE id=${scope.runId} AND "vendorId"=${scope.vendorId}
       AND "liveId"=${scope.liveId} AND "versionId"=${scope.versionId} FOR UPDATE`);
    if (rows.length !== 1) throw new Error('Metric ingress run unavailable');
    if (rows[0].stoppedAt !== null) return { stoppedAt: rows[0].stoppedAt };
    const [row] = await tx.$queryRaw<{ stoppedAt: Date }[]>(Prisma.sql`
      UPDATE "LiveMetricIngressRun" SET "stoppedAt"=clock_timestamp() WHERE id=${scope.runId} RETURNING "stoppedAt"`);
    return { stoppedAt: row.stoppedAt };
  });
}

async function transaction<T>(db: Database, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
    return work(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
}
