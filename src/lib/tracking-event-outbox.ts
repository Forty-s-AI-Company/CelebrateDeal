import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { protectTrackingBrowserContext, type TrackingBrowserContext } from "@/lib/tracking-browser-context";

type Transaction = {
  trackingSetting: Pick<Prisma.TransactionClient["trackingSetting"], "findUnique">;
  trackingDelivery: Pick<Prisma.TransactionClient["trackingDelivery"], "createMany" | "findUnique">;
  formSubmission?: Pick<Prisma.TransactionClient["formSubmission"], "findFirst">;
  analyticsEvent?: Pick<Prisma.TransactionClient["analyticsEvent"], "findFirst">;
  consultationBooking?: { findFirst: (args: Prisma.ConsultationBookingFindFirstArgs) => Promise<{ id: string } | null> };
};
export type TrackingEventName = "Purchase" | "Lead" | "ViewContent" | "Schedule";

export function trackingEventEnabled(setting: { enablePurchaseEvent: boolean; enablePageView: boolean; enableLeadEvent: boolean }, eventName: string) {
  if (eventName === "Purchase") return setting.enablePurchaseEvent;
  if (eventName === "ViewContent") return setting.enablePageView;
  return (eventName === "Lead" || eventName === "Schedule") && setting.enableLeadEvent;
}

/** 只接 domain transaction；來源、租戶與可信狀態再次由資料庫解析。 */
export async function enqueueAuthoritativeTrackingEvent(tx: Transaction, input: {
  vendorId: string;
  eventName: Exclude<TrackingEventName, "Purchase">;
  sourceId: string;
  context: TrackingBrowserContext;
}) {
  const setting = await tx.trackingSetting.findUnique({ where: { vendorId: input.vendorId } });
  if (!setting || !trackingEventEnabled(setting, input.eventName) || !setting.facebookPixelId || !setting.facebookAccessTokenEncrypted) return null;
  let eventId: string, source: { formId?: string; submissionId?: string; analyticsEventId?: string; bookingId?: string };
  if (input.eventName === "Lead") {
    if (!tx.formSubmission) throw new TypeError("Missing tracking source delegate.");
    const submission = await tx.formSubmission.findFirst({
      where: { id: input.sourceId, verificationStatus: "VERIFIED", verifiedAt: { not: null }, form: { vendorId: input.vendorId, isActive: true } },
      select: { id: true, formId: true },
    });
    if (!submission) return null;
    eventId = `lead:${submission.id}`; source = { formId: submission.formId, submissionId: submission.id };
  } else if (input.eventName === "ViewContent") {
    if (!tx.analyticsEvent) throw new TypeError("Missing tracking source delegate.");
    const event = await tx.analyticsEvent.findFirst({
      where: { id: input.sourceId, vendorId: input.vendorId, trustLevel: "ADMITTED_LIVE_SESSION", eventType: { in: ["page_view", "product_click"] }, live: { vendorId: input.vendorId } },
      select: { id: true, liveId: true, visitorId: true, eventType: true, payload: true },
    });
    if (!event?.liveId) return null;
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload : {};
    const productId = event.eventType === "product_click" && typeof payload.productId === "string" ? payload.productId : "";
    if (event.eventType === "product_click" && !productId) return null;
    // 一個已驗證觀看 session 對同一頁/商品只送一次，HTTP retry 不新增轉換。
    eventId = `view:${createHash("sha256").update(JSON.stringify([input.vendorId, event.liveId, event.visitorId, event.eventType, productId])).digest("hex")}`;
    source = { analyticsEventId: event.id };
  } else {
    if (!tx.consultationBooking) throw new TypeError("Missing tracking source delegate.");
    const booking = await tx.consultationBooking.findFirst({
      where: { id: input.sourceId, vendorId: input.vendorId, status: "scheduled", event: { vendorId: input.vendorId, isActive: true } }, select: { id: true },
    });
    if (!booking) return null;
    eventId = `schedule:${booking.id}`; source = { bookingId: booking.id };
  }
  // INSERT ON CONFLICT DO NOTHING 不會讓 domain transaction 因 HTTP retry
  // 進入 aborted 狀態；不能在 PostgreSQL P2002 後繼續使用同一 transaction。
  await tx.trackingDelivery.createMany({
    data: { vendorId: input.vendorId, eventName: input.eventName, eventId, ...source,
      credentialRevision: setting.credentialRevision, pixelId: setting.facebookPixelId, testEventCode: setting.facebookTestEventCode,
      contextEncrypted: protectTrackingBrowserContext(input.vendorId, input.sourceId, input.context) },
    skipDuplicates: true,
  });
  return tx.trackingDelivery.findUnique({
    where: { vendorId_eventId: { vendorId: input.vendorId, eventId } },
  });
}
