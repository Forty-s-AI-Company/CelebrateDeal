import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendor: vi.fn(),
  requireAuth: vi.fn(),
  membershipFindMany: vi.fn(),
  pageFindMany: vi.fn(),
  getCsrfToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendor: mocks.requireVendor, requireAuth: mocks.requireAuth }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    teamMembership: { findMany: mocks.membershipFindMany },
    partnerFunnelPage: { findMany: mocks.pageFindMany },
  }),
}));
vi.mock("@/components/team-live-share-manager", () => ({
  TeamLiveShareManager: ({ pages }: { pages: Array<{ id: string }> }) => <div data-testid="live-share-manager">Live shares: {pages.map((page) => page.id).join(",")}</div>,
}));
vi.mock("@/components/ui", () => ({
  ButtonLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  EmptyState: ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => <div data-testid="empty-state"><h2>{title}</h2><p>{description}</p>{action}</div>,
  PageHeader: ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => <header><h1>{title}</h1><p>{description}</p>{action}</header>,
}));

import PartnerPagesPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
  mocks.requireAuth.mockResolvedValue({ member: { id: "member-1" } });
  mocks.getCsrfToken.mockResolvedValue("csrf-test-token");
  mocks.membershipFindMany.mockResolvedValue([{
    id: "membership-1",
    teamId: "team-1",
    team: {
      memberships: [{
        id: "membership-1",
        teamId: "team-1",
        vendorMemberId: "member-1",
        vendorMember: { user: { name: "Owner", email: "owner@example.com" } },
        downlineRelationships: [],
      }],
    },
  }]);
  mocks.pageFindMany.mockResolvedValue([
    {
      id: "page-1",
      teamId: "team-1",
      slug: "summer-offer",
      headline: "夏季優惠",
      promoterMembershipId: "membership-1",
      contentOwnerMembershipId: "membership-1",
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      sharing: { accessMode: "PUBLIC", isEnabled: true },
      templateVersion: { version: 4, template: { name: "夏季模板" } },
      live: { id: "live-1", title: "八月直播", status: "live", replayEnabled: true, seminarOwnerMembershipId: "membership-1" },
      liveShares: [],
    },
    {
      id: "page-2",
      teamId: "team-1",
      slug: "draft-offer",
      headline: "草稿",
      promoterMembershipId: "membership-1",
      contentOwnerMembershipId: "membership-1",
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      sharing: { accessMode: "PRIVATE", isEnabled: false },
      templateVersion: { version: 2, template: { name: "草稿模板" } },
      live: null,
      liveShares: [],
    },
  ]);
});

describe("/partner-pages route", () => {
  it("scopes memberships and renders published and draft page states", async () => {
    const html = renderToStaticMarkup(await PartnerPagesPage());

    expect(mocks.requireVendor).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.requireAuth).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.membershipFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1", vendorMemberId: "member-1", status: "ACTIVE", leftAt: null },
      include: expect.objectContaining({ team: expect.any(Object) }),
    }));
    expect(mocks.pageFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1", promoterMembershipId: { in: ["membership-1"] } },
      orderBy: { updatedAt: "desc" },
      select: expect.objectContaining({ liveShares: expect.any(Object), live: expect.any(Object) }),
    }));
    expect(html).toContain("我的夥伴頁");
    expect(html).toContain("/summer-offer");
    expect(html).toContain("已發布");
    expect(html).toContain("八月直播");
    expect(html).toContain("/partner-pages/page-1/edit");
    expect(html).toContain("/p/summer-offer");
    expect(html).toContain("/draft-offer");
    expect(html).toContain("未發布");
    expect(html).toContain("未綁定研討會");
    expect(html).not.toContain("/p/draft-offer");
    expect(html).toContain("Live shares: page-1");
  });

  it("renders the empty state and avoids page query without active memberships", async () => {
    mocks.membershipFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await PartnerPagesPage());

    expect(mocks.pageFindMany).not.toHaveBeenCalled();
    expect(html).toContain("還沒有夥伴頁");
    expect(html).toContain("使用團隊提供的安全分享連結");
    expect(html).toContain("/team-template");
  });

  it("does not query partner pages when authentication has no member", async () => {
    mocks.requireAuth.mockResolvedValue({ member: null });

    const html = renderToStaticMarkup(await PartnerPagesPage());

    expect(mocks.membershipFindMany).not.toHaveBeenCalled();
    expect(mocks.pageFindMany).not.toHaveBeenCalled();
    expect(html).toContain("還沒有夥伴頁");
  });
});
