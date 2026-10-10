import type { TrackingDeliveryMode } from "@/lib/tracking-executor-binding";
import { createHash } from "node:crypto";
import type { PrismaClient, TrackingDelivery } from "@prisma/client";
import { revealCommerceOrderPii } from "@/lib/commerce-order-pii";
import { revealTrackingBrowserContext } from "@/lib/tracking-browser-context";
import type { MetaEvent } from "@/lib/tracking-meta-transport";

/** 正式 Purchase 必須排除合成測試訂單。 */
const purchaseModeScope = (mode: TrackingDeliveryMode) => mode === "live" ? { isTestOrder: false } : {};

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const validEmail = (value: string) => value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);

/** 商品點擊必須仍綁定同租戶有效商品；頁面觀看沿用已驗證 session。 */
async function validViewedProduct(db: PrismaClient, vendorId: string, event: { eventType: string; liveId: string | null; payload: unknown }): Promise<boolean> {
  if (event.eventType !== "product_click") return true;
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {};
  if (typeof payload.productId !== "string" || !event.liveId) return false;
  return Boolean(await db.liveProduct.findFirst({ where: {
    liveId: event.liveId, productId: payload.productId, product: { vendorId, isActive: true },
  }, select: { id: true } }));
}

/** claim 後重新讀取來源；退款、撤銷、刪除及跨租戶不能成為 provider payload。 */
export async function resolveAuthoritativeTrackingPayload(db: PrismaClient, row: TrackingDelivery, mode: TrackingDeliveryMode): Promise<MetaEvent | null> {
  let occurredAt: Date, sourceId: string, contextEncrypted: string | null;
  let email: string | undefined, externalId: string;
  let customData: { currency: string; value: number } | undefined;
  if (row.eventName === "Purchase" && row.orderId) {
    const order = await db.commerceOrder.findFirst({ where: {
      id: row.orderId, vendorId: row.vendorId, status: "paid", refundedAmountCents: 0,
      ...purchaseModeScope(mode),
      primaryPaymentTransaction: { vendorId: row.vendorId, status: "paid" },
    } });
    if (!order?.paidAt || order.totalAmountCents <= 0 || order.paidAmountCents !== order.totalAmountCents || !/^[A-Z]{3}$/u.test(order.currency)) return null;
    email = revealCommerceOrderPii({ buyerEncrypted: order.buyerEncryptedEnvelope, shippingEncrypted: null }, { vendorId: row.vendorId, orderId: order.id }).buyer.email;
    occurredAt = order.paidAt; sourceId = order.id; contextEncrypted = order.trackingContextEncrypted;
    externalId = order.automationCustomerKeyHash ?? order.id;
    customData = { currency: order.currency, value: order.paidAmountCents / 100 };
  } else if (row.eventName === "Lead" && row.submissionId && row.formId) {
    const submission = await db.formSubmission.findFirst({ where: {
      id: row.submissionId, formId: row.formId, verificationStatus: "VERIFIED", verifiedAt: { not: null },
      form: { vendorId: row.vendorId, isActive: true },
    } });
    if (!submission?.verifiedAt) return null;
    occurredAt = submission.verifiedAt; sourceId = submission.id; contextEncrypted = row.contextEncrypted;
    email = submission.email; externalId = submission.customerKeyHash ?? submission.id;
  } else if (row.eventName === "ViewContent" && row.analyticsEventId) {
    const event = await db.analyticsEvent.findFirst({ where: {
      id: row.analyticsEventId, vendorId: row.vendorId, trustLevel: "ADMITTED_LIVE_SESSION",
      eventType: { in: ["page_view", "product_click"] }, live: { vendorId: row.vendorId },
    } });
    if (!event?.liveId || !/^[a-f0-9]{64}$/u.test(event.visitorId)) return null;
    if (!await validViewedProduct(db, row.vendorId, event)) return null;
    occurredAt = event.createdAt; sourceId = event.id; contextEncrypted = row.contextEncrypted; externalId = event.visitorId;
  } else if (row.eventName === "Schedule" && row.bookingId) {
    const booking = await db.consultationBooking.findFirst({ where: {
      id: row.bookingId, vendorId: row.vendorId, status: { in: ["scheduled", "completed"] }, event: { vendorId: row.vendorId, isActive: true },
    } });
    if (!booking) return null;
    occurredAt = booking.createdAt; sourceId = booking.id; contextEncrypted = row.contextEncrypted;
    email = booking.clientEmail; externalId = booking.customerKeyHash ?? booking.id;
  } else return null;
  if (!contextEncrypted || (email !== undefined && !validEmail(email.trim()))) return null;
  const context = revealTrackingBrowserContext(row.vendorId, sourceId, contextEncrypted);
  return {
    event_name: row.eventName as MetaEvent["event_name"], event_id: row.eventId, event_time: Math.floor(occurredAt.getTime() / 1000),
    action_source: "website", event_source_url: context.sourceUrl,
    user_data: { ...(email ? { em: [hash(email.trim().toLowerCase())] } : {}), external_id: [hash(`${row.vendorId}:${externalId}`)], client_user_agent: context.userAgent },
    ...(customData ? { custom_data: customData } : {}),
  };
}
