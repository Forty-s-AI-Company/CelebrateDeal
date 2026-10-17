import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Run = z.object({ vendorId: id, liveId: id, versionId: id, runId: z.string().uuid() }).strict();
type Seal = { sealedAt: Date; frameCount: number; pageCount: number; playbackCount: number };

/** Freeze page/intake INSERTs only. The caller must stop/drain ingress first.
 * Missing sources remain missing; neither sealing nor its counters prove visits,
 * media delivery, a complete request universe or a covered metric window.
 */
export async function sealMetricIngressSources(db: Pick<PrismaClient, '$transaction'>, value: z.infer<typeof Run>) {
  const run = Run.parse(value);
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
    // Same order as source writers. UPDATE waits for every run SHARE holder;
    // the trigger repeats these checks for direct trusted SQL callers too.
    const versions = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "LiveMetricVersion"
      WHERE id=${run.versionId} AND "vendorId"=${run.vendorId} AND "liveId"=${run.liveId} FOR SHARE`);
    if (versions.length !== 1) throw new Error('Metric source seal scope unavailable');
    const rows = await tx.$queryRaw<{ stoppedAt: Date | null }[]>(Prisma.sql`SELECT "stoppedAt" FROM "LiveMetricIngressRun"
      WHERE id=${run.runId} AND "vendorId"=${run.vendorId} AND "liveId"=${run.liveId} AND "versionId"=${run.versionId} FOR UPDATE`);
    if (rows.length !== 1 || rows[0].stoppedAt === null) throw new Error('Metric source seal requires stopped run');
    const existing = await tx.$queryRaw<Seal[]>(Prisma.sql`SELECT "sealedAt","frameCount","pageCount","playbackCount"
      FROM "LiveMetricIngressSeal" WHERE "runId"=${run.runId} AND "vendorId"=${run.vendorId} AND "liveId"=${run.liveId} AND "versionId"=${run.versionId}`);
    if (existing.length === 1) return existing[0];
    const [seal] = await tx.$queryRaw<Seal[]>(Prisma.sql`INSERT INTO "LiveMetricIngressSeal" ("runId","vendorId","liveId","versionId")
      VALUES (${run.runId},${run.vendorId},${run.liveId},${run.versionId}) RETURNING "sealedAt","frameCount","pageCount","playbackCount"`);
    if (!seal) throw new Error('Metric source seal unavailable');
    return seal;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
}
