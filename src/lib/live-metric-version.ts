import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { MetricIngestError, type MetricIngestIdentity } from "./live-metric-ingestion";
import type { MetricSessionContext } from "./live-metric-session";
import { resolveLiveRuntimeWindow } from "./live-runtime-state";
import { parseSafeExternalHttpUrl } from "./external-url";
import { isExistingLiveVideoReady } from "./live-video-readiness";

type MetricVideoContent = {
  id: string; vendorId: string; sourceType: string; videoUrl: string; durationSec: number;
  cloudflareStreamUid: string | null; cloudflareLiveInputUid: string | null; cloudflarePlaybackId: string | null;
};

/** Content identifiers only: no titles, signed viewer credentials or stream keys.
 * This identifies the stored source configuration, not a hash of remote bytes.
 * Provisioning and lookup must share this exact versioned serialization.
 */
export function metricVideoFingerprint(video: MetricVideoContent): string {
  return createHash("sha256").update(JSON.stringify(["metric-video-v1", video.vendorId, video.id,
    video.sourceType, video.videoUrl, video.durationSec, video.cloudflareStreamUid,
    video.cloudflareLiveInputUid, video.cloudflarePlaybackId])).digest("hex");
}

/** Called inside issuance after Live/submission/admission locks. The Video lock
 * precedes metric version locks. Never read secrets or enable/create a version.
 */
export async function resolveMetricSessionContext(tx: Prisma.TransactionClient, identity: MetricIngestIdentity): Promise<MetricSessionContext> {
  const context = await resolveMetricPlaybackContext(tx, identity);
  if (!context) throw new MetricIngestError("not_authorized");
  const visitorId = await resolveMetricRegistrationVisitor(tx, identity, context.versionId);
  return { ...context, visitorId };
}

/** Shared server-selected content identity for session issuance and playback
 * intake. Caller owns Live/admission authorization and locks. No version is
 * created or enabled here. null means unconfigured collection, never coverage.
 */
export async function resolveMetricPlaybackContext(tx: Prisma.TransactionClient,
  identity: Pick<MetricIngestIdentity, "vendorId" | "liveId">): Promise<Omit<MetricSessionContext, "visitorId"> | null> {
  const reference = await tx.live.findFirst({ where: { id: identity.liveId, vendorId: identity.vendorId }, select: { videoId: true } });
  if (!reference?.videoId) throw new MetricIngestError("not_authorized");
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Video" WHERE id=${reference.videoId} AND "vendorId"=${identity.vendorId} FOR SHARE`);
  const live = await tx.live.findFirst({
    where: { id: identity.liveId, vendorId: identity.vendorId },
    select: {
      streamMode: true, scheduledAt: true, status: true, startedAt: true, endedAt: true,
      replayAvailableUntil: true, replayEnabled: true,
      video: { select: { id: true, vendorId: true, sourceType: true, videoUrl: true, durationSec: true,
        cloudflareStreamUid: true, cloudflareLiveInputUid: true, cloudflarePlaybackId: true,
        status: true, cloudflareReadyToStream: true, liveInputStatus: true } },
    },
  });
  if (!live?.video || live.video.vendorId !== identity.vendorId || !isExistingLiveVideoReady(live.video)) throw new MetricIngestError("not_authorized");
  if (!Number.isSafeInteger(live.video.durationSec) || live.video.durationSec < 0
    || (live.video.sourceType !== "browser_live" && !parseSafeExternalHttpUrl(live.video.videoUrl))) throw new MetricIngestError("not_authorized");
  const [{ now }] = await tx.$queryRaw<{ now: Date }[]>(Prisma.sql`SELECT clock_timestamp() AS now`);
  const runtime = resolveLiveRuntimeWindow(live, now);
  if (runtime.state !== "playing" && runtime.state !== "replay") throw new MetricIngestError("not_authorized");
  const mode = runtime.state === "replay" ? "replay" : "live";
  const durationMs = live.video.durationSec > 0 ? live.video.durationSec * 1000 : null;
  if (durationMs !== null && (!Number.isSafeInteger(durationMs) || durationMs > 2147483647)) throw new MetricIngestError("not_authorized");
  const fingerprint = metricVideoFingerprint(live.video);
  const versions = await tx.$queryRaw<{ id: string; expiresAt: Date; durationMs: number | null;
    collectionEnabled: boolean; collectionStartedAt: Date | null }[]>(Prisma.sql`
    SELECT id,"expiresAt","durationMs","collectionEnabled","collectionStartedAt" FROM "LiveMetricVersion"
    WHERE "vendorId"=${identity.vendorId} AND "liveId"=${identity.liveId} AND "videoId"=${live.video.id}
      AND mode=${mode} AND fingerprint=${fingerprint} FOR SHARE`);
  if (versions.length === 0) return null;
  if (versions.length !== 1 || versions[0].durationMs !== durationMs) throw new MetricIngestError("not_authorized");
  // Lock disabled versions too: collection enablement cannot race an untracked
  // source response. Recheck DB time/runtime after any version-row lock wait.
  const [{ now: checkedAt }] = await tx.$queryRaw<{ now: Date }[]>(Prisma.sql`SELECT clock_timestamp() AS now`);
  const checkedRuntime = resolveLiveRuntimeWindow(live, checkedAt);
  if (checkedRuntime.state !== runtime.state) return null;
  const version = versions[0];
  if (!version.collectionEnabled || !version.collectionStartedAt || version.collectionStartedAt > checkedAt || version.expiresAt <= checkedAt) return null;
  return { versionId: version.id, expiresAt: new Date(Math.min(+version.expiresAt, checkedRuntime.endsAt ? +checkedRuntime.endsAt : Infinity)) };
}

/** Reuse only the immutable first-registration binding for the same verified
 * epoch. Current viewing cookies/IP/admission credentials cannot establish the
 * historical registration source. Before projection commits, immutable first-
 * submission capture may provide the source; an existing registration (even
 * unknown or from another verified epoch) always prevents that fallback.
 */
export async function resolveMetricRegistrationVisitor(tx: Prisma.TransactionClient,
  identity: MetricIngestIdentity, versionId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ visitorId: string }[]>(Prisma.sql`
    SELECT r."visitorId" FROM "LiveMetricRegistration" r
    JOIN "FormSubmission" f ON f.id=r."submissionId" AND f."liveId"=r."liveId"
    JOIN "RegistrationForm" form ON form.id=f."formId" AND form."vendorId"=r."vendorId"
    JOIN "Live" l ON l.id=r."liveId" AND l."vendorId"=r."vendorId" AND l."formId"=f."formId"
    JOIN "LiveMetricVisitor" v ON v.id=r."visitorId" AND v."vendorId"=r."vendorId"
      AND v."liveId"=r."liveId" AND v."versionId"=r."versionId"
    WHERE r."vendorId"=${identity.vendorId} AND r."liveId"=${identity.liveId}
      AND r."versionId"=${versionId} AND r."submissionId"=${identity.submissionId}
      AND f."verificationStatus"='VERIFIED' AND f."verifiedAt" IS NOT NULL
      AND r."verifiedAt"=f."verifiedAt" AT TIME ZONE 'UTC'
    UNION ALL
    SELECT c."visitorId" FROM "LiveMetricRegistrationCapture" c
    JOIN "FormSubmission" f ON f.id=c."submissionId" AND f."liveId"=c."liveId"
    JOIN "RegistrationForm" form ON form.id=f."formId" AND form."vendorId"=c."vendorId"
    JOIN "Live" l ON l.id=c."liveId" AND l."vendorId"=c."vendorId" AND l."formId"=f."formId"
    JOIN "LiveMetricVisitor" v ON v.id=c."visitorId" AND v."vendorId"=c."vendorId"
      AND v."liveId"=c."liveId" AND v."versionId"=c."versionId"
    JOIN "LiveMetricVersion" version ON version.id=c."versionId" AND version."vendorId"=c."vendorId" AND version."liveId"=c."liveId"
    WHERE c."vendorId"=${identity.vendorId} AND c."liveId"=${identity.liveId}
      AND c."versionId"=${versionId} AND c."submissionId"=${identity.submissionId}
      AND f."verificationStatus"='VERIFIED' AND f."verifiedAt" IS NOT NULL
      AND (f."verifiedAt" AT TIME ZONE 'UTC')>=c."capturedAt"
      AND (f."verifiedAt" AT TIME ZONE 'UTC')<version."expiresAt"
      AND (f."verifiedAt" AT TIME ZONE 'UTC')<=clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM "LiveMetricRegistration" existing
        WHERE existing."vendorId"=c."vendorId" AND existing."liveId"=c."liveId"
          AND existing."versionId"=c."versionId" AND existing."submissionId"=c."submissionId")`);
  return rows.length === 1 ? rows[0].visitorId : null;
}
