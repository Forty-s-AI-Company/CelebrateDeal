import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getRuntimeLivePublishReadiness } from "./live-runtime-readiness";
import { resolveLiveRuntimeWindow } from "./live-runtime-state";
import { publicLiveAvailabilityWhere } from "./sellable-live";
import { metricVideoFingerprint } from "./live-metric-version";
import { MetricVisitorError } from "./live-metric-visitor";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Scope = z.object({ vendorId: id, liveId: id }).strict();

/** Anonymous visits include the waiting page. Do not reuse the admitted-viewer
 * resolver, which intentionally permits only playing/replay. This lookup never
 * creates/enables a version and must run in the collector's write transaction.
 * Only fields needed by canonical readiness/fingerprinting are selected.
 */
export async function resolveMetricVisitContext(tx: Prisma.TransactionClient, input: z.infer<typeof Scope>) {
  const parsed = Scope.safeParse(input);
  if (!parsed.success) throw new MetricVisitorError("SCOPE_UNAVAILABLE");
  const scope = parsed.data;
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Live" WHERE id=${scope.liveId} AND "vendorId"=${scope.vendorId} FOR SHARE`);
  const reference = await tx.live.findFirst({ where: { id: scope.liveId, vendorId: scope.vendorId }, select: { videoId: true } });
  if (!reference?.videoId) throw new MetricVisitorError("SCOPE_UNAVAILABLE");
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Video" WHERE id=${reference.videoId} AND "vendorId"=${scope.vendorId} FOR SHARE`);
  const live = await tx.live.findFirst({
    where: { id: scope.liveId, vendorId: scope.vendorId, ...publicLiveAvailabilityWhere() },
    select: {
      vendorId: true, status: true, scheduledAt: true, startedAt: true, endedAt: true,
      streamMode: true, replayEnabled: true, replayAvailableUntil: true,
      video: { select: { id: true, vendorId: true, sourceType: true, videoUrl: true, durationSec: true,
        cloudflareStreamUid: true, cloudflarePlaybackId: true, cloudflareLiveInputUid: true,
        status: true, cloudflareReadyToStream: true, liveInputStatus: true } },
      form: { select: { vendorId: true, isActive: true, fields: true } },
      messageTemplate: { select: { vendorId: true, channel: true, trigger: true, isActive: true, subject: true, body: true } },
      interactionScript: { select: { vendorId: true, status: true } },
      products: { select: { vendorId: true, product: { select: { vendorId: true, isActive: true, fulfillmentTypeConfirmed: true } } } },
    },
  });
  if (!live?.video || !getRuntimeLivePublishReadiness(live).ready) throw new MetricVisitorError("SCOPE_UNAVAILABLE");
  const [{ now }] = await tx.$queryRaw<{ now: Date }[]>(Prisma.sql`SELECT clock_timestamp() AS now`);
  const runtime = resolveLiveRuntimeWindow(live, now);
  if (runtime.state === "unavailable") throw new MetricVisitorError("SCOPE_UNAVAILABLE");
  const mode = runtime.state === "replay" ? "replay" : "live";
  const durationMs = live.video.durationSec > 0 ? live.video.durationSec * 1000 : null;
  if (!Number.isSafeInteger(live.video.durationSec) || live.video.durationSec < 0
    || (durationMs !== null && (!Number.isSafeInteger(durationMs) || durationMs > 2147483647))) throw new MetricVisitorError("SCOPE_UNAVAILABLE");
  const fingerprint = metricVideoFingerprint(live.video);
  const versions = await tx.$queryRaw<{ id: string; durationMs: number | null; expiresAt: Date }[]>(Prisma.sql`
    SELECT id,"durationMs","expiresAt" FROM "LiveMetricVersion"
    WHERE "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} AND "videoId"=${live.video.id}
      AND mode=${mode} AND fingerprint=${fingerprint} AND "collectionEnabled"
      AND "collectionStartedAt"<=clock_timestamp() AND "expiresAt">clock_timestamp() FOR SHARE`);
  if (versions.length !== 1 || versions[0].durationMs !== durationMs) throw new MetricVisitorError("SCOPE_UNAVAILABLE");
  const expiresAt = new Date(Math.min(+versions[0].expiresAt, runtime.endsAt ? +runtime.endsAt : Infinity));
  if (+expiresAt <= +now) throw new MetricVisitorError("LIFETIME_UNAVAILABLE");
  return { ...scope, versionId: versions[0].id, expiresAt };
}
