import { beforeEach, describe, expect, it, vi } from "vitest";

const reveal = vi.hoisted(() => vi.fn(() => ({ destinationUrl: "https://learn.example.test/course", instructions: "從第一章開始" })));
vi.mock("@/lib/product-delivery", () => ({ revealOrderItemDeliverySnapshot: reveal, parsePublicHttpsDeliveryUrl: (value: string) => ({ url: value, hostname: "learn.example.test", pathPrefix: "/course" }) }));

import { getStudentPortalDashboard } from "@/lib/student-portal";

function dbFixture() {
  return {
    commerceOrder: { findMany: vi.fn(async () => [{
      id: "order-1", orderNumber: "CD-1", status: "paid", currency: "TWD", totalAmountCents: 120000,
      paidAmountCents: 120000, refundedAmountCents: 0, buyerMaskedEmail: "s***@example.test", paidAt: new Date("2026-09-01Z"), createdAt: new Date("2026-09-01Z"),
      items: [{ id: "item-1", productId: "product-1", productName: "成交實戰課", productSlug: "sales", fulfillmentType: "course", imageUrl: "https://cdn.example.test/course.jpg", quantity: 1, entitlement: { status: "granted", revokedAt: null, expiresAt: null } }],
      deliverySnapshots: [{ id: "snapshot-1", vendorId: "vendor-a", orderId: "order-1", orderItemId: "item-1", title: "課程入口", deliveryKind: "course_portal", destinationEncryptedEnvelope: "encrypted", instructionsEncryptedEnvelope: "encrypted", destinationMaskedSummary: "safe", instructionsMaskedSummary: "safe", allowlistSnapshot: { hostname: "learn.example.test", pathPrefix: "/course", allowQuery: false } }],
      electronicInvoice: { invoiceNumber: "AB12345678", invoiceType: "mobile_carrier", buyerDisplay: "/ABC+123", status: "issued", issuedAt: new Date("2026-09-01Z") },
      primaryPaymentTransaction: { providerName: "payuni", paymentMode: "platform" },
    }]) },
    consultationBooking: { findMany: vi.fn(async () => [{ id: "booking-1", startTime: new Date("2026-09-20T02:00:00Z"), endTime: new Date("2026-09-20T03:00:00Z"), status: "scheduled", meetingUrl: "https://meet.google.com/abc-defg-hij", event: { title: "策略諮詢", description: "準備問題", timezone: "Asia/Taipei" } }]) },
    automationVoucherGrant: { findMany: vi.fn(async () => [{ id: "voucher-1", discountType: "percentage", discountValue: 10, currency: "TWD", expiresAt: new Date("2026-09-30Z"), product: { id: "product-1", name: "成交實戰課" } }]) },
  };
}

describe("student portal aggregation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates purchased delivery, consultation, voucher, order and invoice", async () => {
    const db = dbFixture();
    const result = await getStudentPortalDashboard(db as never, { vendorId: "vendor-a", customerKeyHash: "hash-a" }, new Date("2026-09-09Z"));
    expect(result.maskedEmail).toBe("s***@example.test");
    expect(result.courses[0]).toMatchObject({ title: "成交實戰課", accessStatus: "active", destinationUrl: "https://learn.example.test/course" });
    expect(result.consultations[0]).toMatchObject({ id: "booking-1", meetingUrl: "https://meet.google.com/abc-defg-hij" });
    expect(result.consultations[0]?.googleCalendarUrl).toContain("calendar.google.com");
    expect(result.vouchers[0]).toMatchObject({ discountValue: 10, useUrl: "/portal/vouchers/voucher-1/use" });
    expect(result.orders[0]?.invoice?.invoiceNumber).toBe("AB12345678");
    expect(result.orders[0]?.invoice?.buyerDisplay).toBe("/A••••23");
  });

  it("forces vendor and customer key constraints on every query", async () => {
    const db = dbFixture();
    const now = new Date("2026-09-09Z");
    await getStudentPortalDashboard(db as never, { vendorId: "vendor-a", customerKeyHash: "hash-a" }, now);
    expect(db.commerceOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-a", automationCustomerKeyHash: "hash-a" }) }));
    expect(db.consultationBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-a", customerKeyHash: "hash-a" } }));
    expect(db.automationVoucherGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-a", customerKeyHash: "hash-a" }) }));
  });

  it("does not reveal delivery when entitlement or immutable host allowlist is invalid", async () => {
    const db = dbFixture();
    const rows = await db.commerceOrder.findMany();
    rows[0]!.items[0]!.entitlement.status = "revoked";
    db.commerceOrder.findMany.mockResolvedValue(rows);
    const result = await getStudentPortalDashboard(db as never, { vendorId: "vendor-a", customerKeyHash: "hash-a" }, new Date("2026-09-09Z"));
    expect(result.courses[0]).toMatchObject({ accessStatus: "unavailable", destinationUrl: null, instructions: null });
    expect(reveal).not.toHaveBeenCalled();
  });

  it("rejects incomplete tenant scope before querying", async () => {
    const db = dbFixture();
    await expect(getStudentPortalDashboard(db as never, { vendorId: "", customerKeyHash: "hash" })).rejects.toThrow(/Tenant-qualified/u);
    expect(db.commerceOrder.findMany).not.toHaveBeenCalled();
  });
});
