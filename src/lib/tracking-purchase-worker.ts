import { resolveTrackingExecutorMode, type TrackingDeliveryMode } from "@/lib/tracking-executor-binding";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { decideTrackingDelivery } from "@/lib/tracking-delivery-policy";
import { getDb } from "@/lib/db";
import { captureOperationalError } from "@/lib/monitoring";
import { resolveAuthoritativeTrackingPayload } from "@/lib/tracking-event-payload";
import { trackingEventEnabled } from "@/lib/tracking-event-outbox";
import { unprotectFacebookAccessToken } from "@/lib/tracking-credentials";
import { sendMetaTrackingEvent } from "@/lib/tracking-meta-transport";

const LEASE_MS = 120_000;
/** 金鑰設定失敗時延後重試，不消耗 attempt；設定修復後自然恢復。 */
const CONFIG_RETRY_MS = 5 * 60_000;
/** Meta 不接受超過 7 天的事件；正式模式下逾期的 test-coded row 不再保留。 */
const STALE_TEST_ROW_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** 正式模式必須由平台明確啟用；批次呼叫不能自行提升權限。 */
function resolveBatchMode(requested?: TrackingDeliveryMode): TrackingDeliveryMode {
  const mode = requested ?? "test";
  if (!["test", "live"].includes(mode) || resolveTrackingExecutorMode(process.env) !== mode) {
    throw new TypeError("Tracking execution is disabled.");
  }
  return mode;
}

/** 僅明確暫時 Prisma 連線/逾時錯誤可重試；損毀 envelope 仍拒絕。 */
function transientSourceFailure(error: unknown): boolean {
  const known = error instanceof Prisma.PrismaClientKnownRequestError ? error.code
    : error instanceof Prisma.PrismaClientInitializationError ? error.errorCode : undefined;
  return known !== undefined && ["P1001", "P1002", "P1008", "P1017", "P2024", "P2034"].includes(known);
}


/** 憑證解密失敗代表部署金鑰設定（CSRF_SECRET 輪替或缺漏），以固定訊息記錄後回傳 null。 */
function readTrackingToken(vendorId: string, encryptedAccessToken: string): string | null {
  try {
    return unprotectFacebookAccessToken(vendorId, encryptedAccessToken);
  } catch {
    // 固定訊息；憑證、金鑰與密文都不進入診斷。
    captureOperationalError(new Error("Tracking credential configuration unavailable."), { source: "tracking-worker", operation: "credential-decrypt" });
    return null;
  }
}

/** 正式模式永不傳送 test-coded row。商家清除或更換 Test Event Code 後（credentialRevision
 * 必然遞增），或超過事件時間窗後，這些列無法再被任何模式送出，以 cancelled 終止而非永久待傳送。
 * credentialRevision 只增不減，因此比較不會誤取消讀取設定之後才建立的新列。 */
async function cancelStaleTestRows(db: ReturnType<typeof getDb>, vendorId: string, now: Date, limit: number, summary: { cancelled: number; staleTestCancelled: number }) {
  const setting = await db.trackingSetting.findUnique({ where: { vendorId }, select: { credentialRevision: true, facebookTestEventCode: true } });
  const staleWhen: Prisma.TrackingDeliveryWhereInput[] = [{ createdAt: { lte: new Date(now.getTime() - STALE_TEST_ROW_MAX_AGE_MS) } }];
  if (setting) {
    staleWhen.push({ credentialRevision: { lt: setting.credentialRevision } });
    staleWhen.push(setting.facebookTestEventCode === null
      ? { credentialRevision: setting.credentialRevision }
      : { credentialRevision: setting.credentialRevision, testEventCode: { not: setting.facebookTestEventCode } });
  }
  const where: Prisma.TrackingDeliveryWhereInput = {
    vendorId, testEventCode: { not: null },
    OR: [{ status: "queued" }, { status: "processing", leaseExpiresAt: { lte: now } }],
    // 設定列不存在時，所有 test-coded row 都已無對應設定。
    ...(setting ? { AND: [{ OR: staleWhen }] } : {}),
  };
  const stale = await db.trackingDelivery.findMany({ where, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit });
  if (!stale.length) return;
  const changed = await db.trackingDelivery.updateMany({
    where: { ...where, id: { in: stale.map(row => row.id) } },
    data: { status: "cancelled", leaseToken: null, leaseExpiresAt: null },
  });
  summary.cancelled += changed.count;
  summary.staleTestCancelled += changed.count;
}

/** 四種事件共用有界 tenant batch；provider request 不佔用 DB transaction。
 * 保留既有函式入口以相容已交付的 job/test 契約。 */
export async function runPurchaseTrackingBatch(input: { vendorId: string; apiVersion: string; limit?: number; now?: Date; deliveryMode?: TrackingDeliveryMode }) {
  const now = input.now ?? new Date(), limit = input.limit ?? 10;
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.vendorId) || !/^v\d{1,3}\.0$/u.test(input.apiVersion) ||
      !Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isFinite(now.getTime())) throw new TypeError("Invalid tracking batch.");
  const deliveryMode = resolveBatchMode(input.deliveryMode);
  const modeScope = { testEventCode: deliveryMode === "test" ? { not: null } : null };
  const db = getDb();
  const summary = { claimed: 0, accepted: 0, retried: 0, rejected: 0, cancelled: 0, staleTestCancelled: 0, configDeferred: 0 };
  // A crashed last attempt reaches a terminal state rather than remaining
  // leased forever. Earlier crashed attempts reuse the stable event ID.
  const exhausted = await db.trackingDelivery.updateMany({
    where: { vendorId: input.vendorId, status: "processing", attemptCount: 8, ...modeScope, leaseExpiresAt: { lte: now } },
    data: { status: "rejected", leaseToken: null, leaseExpiresAt: null },
  });
  summary.rejected += exhausted.count;
  if (deliveryMode === "live") await cancelStaleTestRows(db, input.vendorId, now, limit, summary);
  const due = { OR: [
    { status: "queued", nextAttemptAt: { lte: now } },
    { status: "processing", leaseExpiresAt: { lte: now } },
  ] };
  const candidates = await db.trackingDelivery.findMany({
    where: { vendorId: input.vendorId, attemptCount: { lt: 8 }, ...modeScope, ...due },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }], take: limit,
  });
  for (const candidate of candidates) {
    const leaseToken = randomUUID();
    // A batch can take longer than one lease. Start each lease at its actual
    // claim time rather than the batch's original timestamp.
    const claimTime = new Date(Math.max(now.getTime(), Date.now()));
    const claimed = await db.trackingDelivery.updateMany({
      where: { id: candidate.id, vendorId: input.vendorId, attemptCount: candidate.attemptCount, ...modeScope, ...due },
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
        !setting.facebookAccessTokenEncrypted) {
      await terminal("cancelled"); continue;
    }
    const token = readTrackingToken(input.vendorId, setting.facebookAccessTokenEncrypted);
    if (token === null) {
      // 金鑰輪替或缺漏屬於部署設定問題，不是此事件的終局失敗：退回本次 attempt、
      // 釋放 lease 並延後重試。同批其他列會以相同原因失敗，因此停止本批次。
      const changed = await db.trackingDelivery.updateMany({ where: lease, data: {
        status: "queued", attemptCount: candidate.attemptCount, nextAttemptAt: new Date(claimTime.getTime() + CONFIG_RETRY_MS),
        leaseToken: null, leaseExpiresAt: null,
      } });
      summary.configDeferred += changed.count;
      break;
    }
    let event;
    try {
      event = await resolveAuthoritativeTrackingPayload(db, candidate, deliveryMode);
    } catch (error) {
      if (!transientSourceFailure(error)) { await terminal("rejected"); continue; }
      const retry = decideTrackingDelivery({ attempt: candidate.attemptCount + 1, now: claimTime, status: null, acceptedEvents: null });
      if (retry.outcome !== "retry") { await terminal("rejected"); continue; }
      const changed = await db.trackingDelivery.updateMany({ where: lease, data: { status: "queued", nextAttemptAt: retry.retryAt, leaseToken: null, leaseExpiresAt: null } });
      if (changed.count) summary.retried++;
      continue;
    }
    if (!event) { await terminal("cancelled"); continue; }
    const decision = await sendMetaTrackingEvent({
      pixelId: candidate.pixelId, apiVersion: input.apiVersion, token, testEventCode: candidate.testEventCode, deliveryMode,
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
