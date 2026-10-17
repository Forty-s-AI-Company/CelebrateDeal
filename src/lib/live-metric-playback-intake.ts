import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { hashLiveViewerToken } from "./live-quota-admission";
import { resolveLivePlaybackSource } from "./live-playback-source";
import { resolveMetricPlaybackContext } from "./live-metric-version";
import { MetricIngestError } from "./live-metric-ingestion";
import type { MetricIngressBinding } from './live-metric-ingress-proof';
import { canBindMetricIngressSource } from './live-metric-ingress-source';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Input = z.object({ vendorId: id, liveId: id, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

/** Playback authorization stays canonical. An enabled collection version gets
 * a durable expectation BEFORE the URL leaves the server. Lost replies remain
 * unmatched intake; no retry fabricates acknowledgement or positive coverage.
 * Never persist the admission credential, URL or viewer personal information.
 */
export async function resolveTrackedLivePlaybackSource(db: Pick<PrismaClient, "$transaction">, value: z.infer<typeof Input>, binding?: MetricIngressBinding) {
  const input = Input.parse(value);
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Live" WHERE id=${input.liveId} AND "vendorId"=${input.vendorId} FOR SHARE`);
    const [admission] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM "LiveViewerSession" WHERE "tokenHash"=${hashLiveViewerToken(input.token)}
        AND "vendorId"=${input.vendorId} AND "liveId"=${input.liveId}
        AND "expiresAt">clock_timestamp() AT TIME ZONE 'UTC' FOR NO KEY UPDATE`);
    if (!admission) return null;
    const assertActive = async (expiresAt: Date | null) => {
      const [state] = await tx.$queryRaw<{ active: boolean }[]>(Prisma.sql`SELECT EXISTS (
        SELECT 1 FROM "LiveViewerSession" WHERE id=${admission.id} AND "vendorId"=${input.vendorId} AND "liveId"=${input.liveId}
          AND "expiresAt">clock_timestamp() AT TIME ZONE 'UTC'
          AND (${expiresAt}::timestamptz IS NULL OR ${expiresAt}::timestamptz>clock_timestamp())) AS active`);
      if (!state?.active) throw new MetricIngestError("not_authorized");
    };
    // Locks and version selection use the same order as session issuance.
    const context = await resolveMetricPlaybackContext(tx, input);
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>(Prisma.sql`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`);
    const source = await resolveLivePlaybackSource(tx, { ...input, now });
    if (!source) return null;
    // Re-resolve after source reads, including runtime boundaries that can pass
    // without a row mutation. No stale version/source response may be released.
    const current = await resolveMetricPlaybackContext(tx, input);
    // An expired collection binding is a source/context race, not a change to
    // the viewer's admission. Preserve the same null as other context races.
    if (!context && !current) { if(binding)return null;await assertActive(null); return source; }
    if (!context) return null;
    if (!current || current.versionId !== context.versionId) return null;
    if(!await canBindMetricIngressSource(tx,binding,{vendorId:input.vendorId,liveId:input.liveId,versionId:current.versionId},'playback'))return null;
    const [usage] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total FROM "LiveMetricPlaybackIntake"
      WHERE "vendorId"=${input.vendorId} AND "liveId"=${input.liveId} AND "versionId"=${current.versionId} AND "admissionSessionId"=${admission.id}`);
    if (usage.total >= 64) {
      // Preserve playback at the bound, but persist a permanent gap before
      // returning an untracked URL. Later coverage cannot call this complete.
      const [gap] = await tx.$queryRaw<{ id: string; lossAt: Date | null }[]>(Prisma.sql`SELECT id,"lossAt" FROM "LiveMetricPlaybackIntake"
        WHERE "vendorId"=${input.vendorId} AND "liveId"=${input.liveId} AND "versionId"=${current.versionId} AND "admissionSessionId"=${admission.id}
        ORDER BY "issuedAt",id LIMIT 1 FOR UPDATE`);
      if (!gap) throw new Error("Playback intake unavailable");
      if (!gap.lossAt) await tx.$executeRaw(Prisma.sql`UPDATE "LiveMetricPlaybackIntake" SET "lossAt"=clock_timestamp() WHERE id=${gap.id}`);
      await assertActive(current.expiresAt);
      return source;
    }
    const metricRequestId = randomUUID();
    await tx.$executeRaw(Prisma.sql`INSERT INTO "LiveMetricPlaybackIntake"
      (id,"vendorId","liveId","versionId","admissionSessionId","expiresAt","ingressFrameId")
      SELECT ${metricRequestId},${input.vendorId},${input.liveId},${current.versionId},${admission.id},
        LEAST(${current.expiresAt}::timestamptz,a."expiresAt" AT TIME ZONE 'UTC'),${binding?.frameId??null}
      FROM "LiveViewerSession" a WHERE a.id=${admission.id} AND a."vendorId"=${input.vendorId} AND a."liveId"=${input.liveId}
        AND a."expiresAt">clock_timestamp() AT TIME ZONE 'UTC'`);
    // INSERT ... SELECT must not silently return a URL with no expectation.
    const [stored] = await tx.$queryRaw<{ id: string; issuedAt: Date; expiresAt: Date }[]>(Prisma.sql`SELECT id,"issuedAt","expiresAt" FROM "LiveMetricPlaybackIntake" WHERE id=${metricRequestId}`);
    if (!stored) throw new Error("Playback intake unavailable");
    await assertActive(stored.expiresAt);
    return { ...source, metricRequestId, metricIssuedAtMs: +stored.issuedAt, metricExpiresAtMs: +stored.expiresAt };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
}
