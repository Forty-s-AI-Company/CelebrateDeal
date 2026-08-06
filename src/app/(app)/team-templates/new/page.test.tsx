import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendor: vi.fn(),
  requireAuth: vi.fn(),
  getCsrfToken: vi.fn(),
  membershipFindMany: vi.fn(),
  productFindMany: vi.fn(),
  liveFindMany: vi.fn(),
  manageAction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendor: mocks.requireVendor, requireAuth: mocks.requireAuth }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    teamMembership: { findMany: mocks.membershipFindMany },
    product: { findMany: mocks.productFindMany },
    live: { findMany: mocks.liveFindMany },
  }),
}));
vi.mock("@/app/actions/team-funnel-template-actions", () => ({ manageTeamFunnelTemplateAction: mocks.manageAction }));
vi.mock("@/components/team-template-form", () => ({
  TeamTemplateForm: ({ teams, products, webinars, csrfToken }: { teams: unknown; products: unknown; webinars: unknown; csrfToken: string }) => (
    <div data-testid="team-template-form">{JSON.stringify({ teams, products, webinars, csrfToken })}</div>
  ),
}));

import NewTeamTemplatePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
  mocks.requireAuth.mockResolvedValue({ member: { id: "member-1" } });
  mocks.getCsrfToken.mockResolvedValue("csrf-token");
  mocks.membershipFindMany.mockResolvedValue([{ id: "membership-1", teamId: "team-1", team: { name: "第一團隊" } }]);
  mocks.productFindMany.mockResolvedValue([{ id: "product-1", name: "商品一" }]);
  mocks.liveFindMany.mockResolvedValue([{ id: "live-1", title: "夏季直播", scheduledAt: new Date("2026-08-08T00:00:00.000Z") }]);
});

describe("/team-templates/new route", () => {
  it("loads member-scoped teams, active products and team webinars", async () => {
    const html = renderToStaticMarkup(await NewTeamTemplatePage());

    expect(mocks.membershipFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", vendorMemberId: "member-1", status: "ACTIVE", leftAt: null },
      include: { team: { select: { name: true } } },
    });
    expect(mocks.productFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", isActive: true },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    });
    expect(mocks.liveFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1", teamId: { in: ["team-1"] }, seminarOwnerMembershipId: { in: ["membership-1"] } },
    }));
    expect(html).toContain("team-template-form");
    expect(html).toContain("夏季直播");
    expect(html).toContain("csrf-token");
  });

  it("passes empty webinars when no active team membership exists", async () => {
    mocks.membershipFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await NewTeamTemplatePage());

    expect(mocks.liveFindMany).not.toHaveBeenCalled();
    expect(html).toContain('&quot;teams&quot;:[]');
    expect(html).toContain('&quot;webinars&quot;:[]');
  });
});
