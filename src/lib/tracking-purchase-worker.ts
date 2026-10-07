import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { resolveAuthoritativeTrackingPayload } from "@/lib/tracking-event-payload";
import { trackingEventEnabled } from "@/lib/tracking-event-outbox";
import { unprotectFacebookAccessToken } from "@/lib/tracking-credentials";
import { sendMetaTrackingEvent } from "@/lib/tracking-meta-transport";

const LEASE_MS = 120_000;

/** 四種事件共用有界 tenant batch；provider request 不佔用 DB transaction。
 * 保留既有函式入口以相容已交付的 job/test 契約。 */
export async function runPurchaseTrackingBatch(input: { vendorId: string; apiVersion: string; limit?: number; now?: Date }) {
  const now = input.now ?? new Date(), limit = input.limit ?? 10;
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.vendorId) || !/^v\d{1,3}\.0$/u.test(input.apiVersion) ||
      !Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isFinite(now.getTime())) throw new TypeError("Invalid tracking batch.");
  const db = getDb();
  const summary = { claimed: 0, accepted: 0, retried: 0, rejected: 0, cancelled: 0 };
  // A crashed last attempt reaches a terminal state rather than remaining
  // leased forever. Earlier crashed attempts reuse the stable event ID.
  const exhausted = await db.trackingDelivery.updateMany({
    where: { vendorId: input.vendorId, status: "processing", attemptCount: 8, leaseExpiresAt: { lte: now } },
    data: { status: "rejected", leaseToken: null, leaseExpiresAt: null },
  });
  summary.rejected += exhausted.count;
  const due = { OR: [
    { status: "queued", nextAttemptAt: { lte: now } },
    { status: "processing", leaseExpiresAt: { lte: now } },
  ] };
  const candidates = await db.trackingDelivery.findMany({
    where: { vendorId: input.vendorId, attemptCount: { lt: 8 }, ...due },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }], take: limit,
  });
  for (const candidate of candidates) {
    const leaseToken = randomUUID();
    // A batch can take longer than one lease. Start each lease at its actual
    // claim time rather than the batch's original timestamp.
    const claimTime = new Date(Math.max(now.getTime(), Date.now()));
    const claimed = await db.trackingDelivery.updateMany({
      where: { id: candidate.id, vendorId: input.vendorId, attemptCount: candidate.attemptCount, ...due },
      data: { status: "processing", attemptCount: { increment: 1 }, leaseToken, leaseExpiresAt: new Date(claimTime.getTime() + LEASE_MS) },
    });
    if (claimed.count !== 1) continue;
    summary.claimed++;
    const lease = { id: candidate.id, vendorId: input.vendorId, status: "processing", leaseToken };
    const terminal = async (status: "cancelled" | "rejected") => {
      const changed = await db.trackingDelivery.updateMany({ where: lease, data: { status, leaseToken: null, leaseExpiresAt: null } });
      if (changed.count) summary[status]++;
    };
    const setting = await db.trackingSetting.findUnique({ where: { vendorId: input.vendorId } });
    if (!setting || !trackingEventEnabled(setting, candidate.eventName) || setting.credentialRevision !== candidate.credentialRevision ||
        setting.facebookPixelId !== candidate.pixelId || setting.facebookTestEventCode !== candidate.testEventCode ||
        !setting.facebookAccessTokenEncrypted || !candidate.testEventCode) {
      await terminal("cancelled"); continue;
    }
    let token: string, event;
    try {
      token = unprotectFacebookAccessToken(input.vendorId, setting.facebookAccessTokenEncrypted);
      event = await resolveAuthoritativeTrackingPayload(db, candidate);
    } catch { await terminal("rejected"); continue; }
    if (!event) { await terminal("cancelled"); continue; }
    const decision = await sendMetaTrackingEvent({
      pixelId: candidate.pixelId, apiVersion: input.apiVersion, token, testEventCode: candidate.testEventCode,
      attempt: candidate.attemptCount + 1, now: claimTime, event,
    }).catch(() => ({ outcome: "rejected" as const }));
    const changed = await db.trackingDelivery.updateMany({
      where: lease,
      data: {
        status: decision.outcome === "retry" ? "queued" : decision.outcome,
        ...(decision.outcome === "retry" ? { nextAttemptAt: decision.retryAt } : {}),
        ...(decision.outcome === "accepted" ? { acceptedAt: new Date() } : {}),
        leaseToken: null, leaseExpiresAt: null,
      },
    });
    if (changed.count) summary[decision.outcome === "retry" ? "retried" : decision.outcome]++;
  }
  return summary;
}
