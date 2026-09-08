import type { PrismaClient } from "@prisma/client";
import { parsePublicHttpsDeliveryUrl, revealOrderItemDeliverySnapshot } from "@/lib/product-delivery";

export type StudentPortalScope = { vendorId: string; customerKeyHash: string };

function safeHttpsUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function maskInvoiceBuyerDisplay(value: string) {
  const normalized = value.trim();
  const email = normalized.match(/^([^@]+)@([^@]+)$/u);
  if (email) return `${email[1]?.slice(0, 1) ?? "*"}***@${email[2]}`;
  if (normalized.length <= 4) return "••••";
  return `${normalized.slice(0, 2)}••••${normalized.slice(-2)}`;
}

function googleCalendarUrl(booking: { startTime: Date; endTime: Date; meetingUrl: string | null; event: { title: string; description: string | null } }) {
  const compact = (date: Date) => date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", booking.event.title);
  url.searchParams.set("dates", `${compact(booking.startTime)}/${compact(booking.endTime)}`);
  url.searchParams.set("details", [booking.event.description, safeHttpsUrl(booking.meetingUrl)].filter(Boolean).join("\n"));
  return url.toString();
}

function revealDelivery(snapshot: {
  id: string; vendorId: string; orderId: string; orderItemId: string;
  destinationEncryptedEnvelope: string | null; instructionsEncryptedEnvelope: string | null;
  allowlistSnapshot: unknown;
}) {
  try {
    const revealed = revealOrderItemDeliverySnapshot(snapshot, {
      vendorId: snapshot.vendorId,
      orderId: snapshot.orderId,
      orderItemId: snapshot.orderItemId,
      snapshotId: snapshot.id,
    });
    let destinationUrl: string | null = null;
    if (revealed.destinationUrl) {
      const allowlist = snapshot.allowlistSnapshot;
      if (!allowlist || typeof allowlist !== "object" || Array.isArray(allowlist)) return { destinationUrl: null, instructions: null };
      const record = allowlist as Record<string, unknown>;
      const parsed = parsePublicHttpsDeliveryUrl(revealed.destinationUrl);
      if (record.allowQuery !== false || parsed.hostname !== record.hostname || parsed.pathPrefix !== record.pathPrefix) return { destinationUrl: null, instructions: null };
      destinationUrl = parsed.url;
    }
    return { destinationUrl, instructions: revealed.instructions };
  } catch {
    return { destinationUrl: null, instructions: null };
  }
}

/** Aggregates only records matching both the tenant and the opaque student key. */
export async function getStudentPortalDashboard(db: PrismaClient, scope: StudentPortalScope, now = new Date()) {
  if (!scope.vendorId || !scope.customerKeyHash) throw new Error("Tenant-qualified student identity is required.");

  const [orders, consultations, vouchers] = await Promise.all([
    db.commerceOrder.findMany({
      where: {
        vendorId: scope.vendorId,
        automationCustomerKeyHash: scope.customerKeyHash,
        status: { in: ["paid", "partially_refunded", "refunded"] },
      },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true, orderNumber: true, status: true, currency: true, totalAmountCents: true,
        paidAmountCents: true, refundedAmountCents: true, buyerMaskedEmail: true, paidAt: true, createdAt: true,
        items: { orderBy: { lineIndex: "asc" }, select: { id: true, productId: true, productName: true, productSlug: true, fulfillmentType: true, imageUrl: true, quantity: true, entitlement: { select: { status: true, revokedAt: true, expiresAt: true } } } },
        deliverySnapshots: { where: { vendorId: scope.vendorId, revokedAt: null }, select: { id: true, vendorId: true, orderId: true, orderItemId: true, title: true, deliveryKind: true, destinationEncryptedEnvelope: true, instructionsEncryptedEnvelope: true, destinationMaskedSummary: true, instructionsMaskedSummary: true, allowlistSnapshot: true } },
        electronicInvoice: { select: { invoiceNumber: true, invoiceType: true, buyerDisplay: true, status: true, issuedAt: true } },
        primaryPaymentTransaction: { select: { providerName: true, paymentMode: true } },
      },
    }),
    db.consultationBooking.findMany({
      where: { vendorId: scope.vendorId, customerKeyHash: scope.customerKeyHash },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      take: 100,
      select: { id: true, startTime: true, endTime: true, status: true, meetingUrl: true, event: { select: { title: true, description: true, timezone: true } } },
    }),
    db.automationVoucherGrant.findMany({
      where: { vendorId: scope.vendorId, customerKeyHash: scope.customerKeyHash, redeemedAt: null, expiresAt: { gt: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: 100,
      select: { id: true, discountType: true, discountValue: true, currency: true, expiresAt: true, product: { select: { id: true, name: true } } },
    }),
  ]);

  const courses = orders.flatMap((order) => order.items.flatMap((item) => {
    if (!new Set(["course", "digital"]).has(item.fulfillmentType)) return [];
    const snapshot = order.deliverySnapshots.find((candidate) => candidate.orderItemId === item.id);
    const accessActive = order.status !== "refunded"
      && item.entitlement?.status === "granted"
      && !item.entitlement.revokedAt
      && (!item.entitlement.expiresAt || item.entitlement.expiresAt > now);
    const delivery = snapshot && accessActive ? revealDelivery(snapshot) : { destinationUrl: null, instructions: null };
    return [{
      id: item.id, orderId: order.id, title: item.productName, productSlug: item.productSlug,
      imageUrl: safeHttpsUrl(item.imageUrl), fulfillmentType: item.fulfillmentType,
      deliveryTitle: snapshot?.title ?? null, deliveryKind: snapshot?.deliveryKind ?? null,
      destinationUrl: delivery.destinationUrl, instructions: delivery.instructions,
      accessStatus: snapshot && accessActive ? "active" as const : "unavailable" as const,
    }];
  }));

  return {
    maskedEmail: orders[0]?.buyerMaskedEmail ?? null,
    courses,
    consultations: consultations.map((booking) => ({
      ...booking,
      meetingUrl: safeHttpsUrl(booking.meetingUrl),
      googleCalendarUrl: googleCalendarUrl(booking),
      icsUrl: `/portal/calendar/${encodeURIComponent(booking.id)}.ics`,
    })),
    vouchers: vouchers.map((voucher) => ({
      ...voucher,
      useUrl: `/portal/vouchers/${encodeURIComponent(voucher.id)}/use`,
    })),
    orders: orders.map((order) => ({
      id: order.id, orderNumber: order.orderNumber, status: order.status, currency: order.currency,
      totalAmountCents: order.totalAmountCents, paidAmountCents: order.paidAmountCents,
      refundedAmountCents: order.refundedAmountCents, paidAt: order.paidAt, createdAt: order.createdAt,
      paymentMethod: order.primaryPaymentTransaction?.providerName ?? order.primaryPaymentTransaction?.paymentMode ?? null,
      items: order.items.map((item) => ({ id: item.id, name: item.productName, quantity: item.quantity })),
      invoice: order.electronicInvoice ? {
        ...order.electronicInvoice,
        buyerDisplay: maskInvoiceBuyerDisplay(order.electronicInvoice.buyerDisplay),
      } : null,
    })),
  };
}
