import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), dashboard: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/student-portal-auth", () => ({ requireStudentPortalSession: mocks.requireSession }));
vi.mock("@/lib/student-portal", () => ({ getStudentPortalDashboard: mocks.dashboard }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="csrf" /> }));
vi.mock("@/components/language-switcher", () => ({ LanguageSwitcher: () => <div aria-label="語言切換" /> }));
vi.mock("@/app/actions/student-portal-actions", () => ({ logoutStudentPortalAction: vi.fn() }));

import StudentPortalPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockReturnValue({});
  mocks.requireSession.mockResolvedValue({ session: { vendorId: "vendor-1", customerKeyHash: "customer-hash" }, vendor: { id: "vendor-1", slug: "teacher", name: "老師品牌", logoUrl: null, primaryColor: "#2563eb" } });
  mocks.dashboard.mockResolvedValue({
    maskedEmail: "s***@example.test",
    courses: [{ id: "item-1", productId: "product-1", fulfillmentType: "course", title: "成交實戰課", imageUrl: null, accessStatus: "active", destinationUrl: "https://learn.example.test/", deliveryKind: "course_portal", deliveryTitle: "課程入口", instructions: "從第一章開始" }],
    consultations: [{ id: "booking-1", startTime: new Date("2026-09-20T02:00:00Z"), status: "scheduled", meetingUrl: "https://meet.google.com/abc", googleCalendarUrl: "https://calendar.google.com/calendar/render", event: { title: "策略諮詢", timezone: "Asia/Taipei" } }],
    vouchers: [{ id: "voucher-1", discountType: "percentage", discountValue: 10, currency: "TWD", expiresAt: new Date("2026-09-30T00:00:00Z"), product: { name: "成交實戰課" } }],
    orders: [{ id: "order-1", orderNumber: "CD-001", status: "paid", currency: "TWD", totalAmountCents: 120000, paidAt: new Date("2026-09-01Z"), createdAt: new Date("2026-09-01Z"), paymentMethod: "payuni", items: [{ name: "成交實戰課" }], invoice: { invoiceNumber: "AB12345678", invoiceType: "mobile_carrier", buyerDisplay: "/A••••23" } }],
  });
});

describe("student portal page", () => {
  it("renders all four deliverable modules from a tenant-bound session", async () => {
    const html = renderToStaticMarkup(await StudentPortalPage({ params: Promise.resolve({ vendorSlug: "teacher" }) }));
    expect(mocks.requireSession).toHaveBeenCalledWith("teacher");
    expect(mocks.dashboard).toHaveBeenCalledWith(expect.anything(), { vendorId: "vendor-1", customerKeyHash: "customer-hash" });
    for (const copy of ["我的課程", "1 對 1 諮詢", "專屬優惠券", "訂單與發票", "AB12345678"]) expect(html).toContain(copy);
    expect(html).toContain("s***@example.test");
    expect(html).not.toContain("customer-hash");
    expect(html).toContain("/portal/teacher/learn/product-1");
  });
});
