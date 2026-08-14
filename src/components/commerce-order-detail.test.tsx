import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/support-case-actions", () => ({ createSupportCaseAction: vi.fn() }));
vi.mock("@/app/actions/commerce-order-actions", () => ({
  grantCommerceEntitlementAction: vi.fn(),
  transitionServiceFulfillmentAction: vi.fn(),
  transitionShippingFulfillmentAction: vi.fn(),
}));
vi.mock("@/components/csrf-field", () => ({
  CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" />,
}));
vi.mock("@/components/form-submit-button", () => ({
  FormSubmitButton: ({ children, pendingChildren, pendingMessage, className }: {
    children: React.ReactNode; pendingChildren?: React.ReactNode; pendingMessage?: string; className?: string;
  }) => <button type="submit" className={className} data-pending-label={String(pendingChildren)} data-pending-message={pendingMessage}>{children}</button>,
}));

import { CommerceOrderDetail } from "@/components/commerce-order-detail";
import type { CommerceOrderDetailRecord } from "@/lib/commerce-order-read-model";

function order(overrides: Partial<CommerceOrderDetailRecord> = {}) {
  return {
    id: "order-1", vendorId: "vendor-1", orderNumber: "CD-100", status: "paid",
    currency: "TWD", totalAmountCents: 10_000, refundedAmountCents: 0,
    buyerMaskedName: "王＊明", buyerMaskedEmail: "w***@example.test", buyerMaskedPhone: null,
    shippingMaskedSummary: null, createdAt: new Date("2026-08-08T00:00:00.000Z"),
    items: [], events: [], refunds: [], supportCases: [],
    ...overrides,
  } as unknown as CommerceOrderDetailRecord;
}

describe("CommerceOrderDetail support workflow", () => {
  it("renders an encrypted case intake with pending feedback instead of a URL-only escape hatch", () => {
    const html = renderToStaticMarkup(<CommerceOrderDetail order={order()} pii={null} />);

    expect(html).toContain("客服案件");
    expect(html).toContain('name="category"');
    expect(html).toContain('name="priority"');
    expect(html).toContain('name="summary"');
    expect(html).toContain('name="intakeKey"');
    expect(html).toContain('data-pending-label="建立中…"');
    expect(html).toContain("退款請求只會交給平台財務，不會直接呼叫付款服務");
  });

  it("links an existing case using only its persisted tenant projection", () => {
    const html = renderToStaticMarkup(<CommerceOrderDetail order={order({
      supportCases: [{
        id: "case-1", caseNumber: "SC-20260808-A1B2C3D4", category: "access", priority: "p1",
        status: "in_progress", assignedMember: { user: { name: "客服一號" } }, refundHandoff: null,
      }] as CommerceOrderDetailRecord["supportCases"],
    })} pii={null} />);

    expect(html).toContain('href="/support-cases/case-1"');
    expect(html).toContain("SC-20260808-A1B2C3D4");
    expect(html).toContain("客服一號");
  });

  it("keeps a refunded shipped parcel actionable until the merchant records its real outcome", () => {
    const html = renderToStaticMarkup(<CommerceOrderDetail order={order({
      status: "refunded",
      refundedAmountCents: 10_000,
      items: [{
        id: "item-1",
        productName: "實體商品",
        quantity: 1,
        unitPriceCents: 10_000,
        fulfillmentType: "physical",
        shippingFulfillment: {
          id: "shipping-1",
          status: "refund_review",
          revision: 4,
          carrierName: "測試物流",
          trackingNumber: "TRACK-1234",
          trackingUrl: null,
        },
        entitlement: null,
        serviceFulfillment: null,
      }] as unknown as CommerceOrderDetailRecord["items"],
    })} pii={null} />);

    expect(html).toContain("退款後待物流確認");
    expect(html).toContain("這筆訂單已全額退款，但包裹先前已出貨");
    expect(html).toContain('name="nextStatus" value="returned"');
    expect(html).toContain('name="nextStatus" value="delivered"');
    expect(html).toContain("標記包裹已退回");
    expect(html).toContain("標記仍已送達");
    expect(html).toContain('data-pending-label="結案中…"');
    expect(html).toContain("正在記錄包裹退回結果，請勿重複送出");
  });
});
