import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  saveAction: vi.fn(),
  publishAction: vi.fn(),
  requireVendor: vi.fn(),
  requireAuth: vi.fn(),
  getCsrfToken: vi.fn(),
  membershipFindMany: vi.fn(),
  pageFindFirst: vi.fn(),
  productFindMany: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/app/actions/team-funnel-partner-actions", () => ({ savePartnerPageAction: mocks.saveAction, setPartnerPagePublishAction: mocks.publishAction }));
vi.mock("@/lib/auth", () => ({ requireVendor: mocks.requireVendor, requireAuth: mocks.requireAuth }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    teamMembership: { findMany: mocks.membershipFindMany },
    partnerFunnelPage: { findFirst: mocks.pageFindFirst },
    product: { findMany: mocks.productFindMany },
  }),
}));
vi.mock("@/components/ui", () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header>,
}));
vi.mock("@/components/partner-page-editor", () => ({
  PartnerPageEditor: ({ page, products, csrfToken, saveAction, publishAction }: { page: { id: string; slug: string; isPublished: boolean; slots: Array<{ key: string; available: boolean; productId: string | null; overrideUrl: string | null }>; source: { name: string; ownerName: string; version: number; webinar: string | null }; partner: { name: string; email: string } }; products: Array<{ id: string; name: string }>; csrfToken: string; saveAction: unknown; publishAction: unknown }) => <div data-testid="partner-editor">{JSON.stringify({ page, products, csrfToken, saveAction: saveAction === mocks.saveAction, publishAction: publishAction === mocks.publishAction })}</div>,
}));

import EditPartnerPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
  mocks.requireAuth.mockResolvedValue({ member: { id: "member-1" } });
  mocks.getCsrfToken.mockResolvedValue("csrf-token");
  mocks.membershipFindMany.mockResolvedValue([{ id: "membership-1" }]);
  mocks.pageFindFirst.mockResolvedValue({
    id: "page-1", teamId: "team-1", slug: "summer-offer", headline: "夏季優惠", subheadline: null, body: "內容", ctaLabel: "立即報名", ctaUrl: null,
    sharing: { accessMode: "PUBLIC", isEnabled: true },
    promoter: { vendorMember: { user: { name: "合作夥伴", email: "partner@example.com" } } },
    live: { title: "八月直播" },
    templateVersion: {
      version: 4,
      template: { name: "夏季模板" },
      contentOwner: { vendorMember: { user: { name: "團隊隊長" } } },
      fieldLocks: [{ field: "HEADLINE" }],
      productSlots: [{ id: "slot-1", slotKey: "main_product" }, { id: "slot-2", slotKey: "bundle_product" }],
    },
    productOverrides: [{ productSlotId: "slot-1", productId: "product-1", overrideUrl: null }, { productSlotId: "unknown", productId: "ignored", overrideUrl: "https://ignored.test" }],
  });
  mocks.productFindMany.mockResolvedValue([{ id: "product-1", name: "主打課程" }]);
});

describe("/partner-pages/[id]/edit route", () => {
  it("scopes the page to active membership and maps slots without leaking unrelated overrides", async () => {
    const html = renderToStaticMarkup(await EditPartnerPage({ params: Promise.resolve({ id: "page-1" }) }));

    expect(mocks.membershipFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", vendorMemberId: "member-1", status: "ACTIVE", leftAt: null },
      select: { id: true },
    });
    expect(mocks.pageFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "page-1", vendorId: "vendor-1", promoterMembershipId: { in: ["membership-1"] } },
    }));
    expect(mocks.productFindMany).toHaveBeenCalledWith({ where: { vendorId: "vendor-1", isActive: true, fulfillmentTypeConfirmed: true }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } });
    expect(html).toContain("編輯夥伴頁");
    expect(html).toContain("summer-offer");
    expect(html).toContain("csrf-token");
    expect(html).toContain("&quot;isPublished&quot;:true");
    expect(html).toContain("&quot;productId&quot;:&quot;product-1&quot;");
    expect(html).toContain("&quot;productId&quot;:null");
    expect(html).toContain("&quot;available&quot;:false");
    expect(html).toContain("&quot;saveAction&quot;:true");
    expect(html).toContain("&quot;publishAction&quot;:true");
  });

  it("uses empty membership scope and calls notFound when the page is not visible", async () => {
    mocks.requireAuth.mockResolvedValue({ member: null });
    mocks.pageFindFirst.mockResolvedValue(null);

    await expect(EditPartnerPage({ params: Promise.resolve({ id: "hidden-page" }) })).rejects.toThrow("NOT_FOUND");

    expect(mocks.membershipFindMany).not.toHaveBeenCalled();
    expect(mocks.pageFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "hidden-page", vendorId: "vendor-1", promoterMembershipId: { in: [] } },
    }));
    expect(mocks.productFindMany).not.toHaveBeenCalled();
    expect(mocks.notFound).toHaveBeenCalledExactlyOnceWith();
  });
});
