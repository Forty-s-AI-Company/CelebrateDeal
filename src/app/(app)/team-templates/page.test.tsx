import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendor: vi.fn(),
  requireAuth: vi.fn(),
  getCsrfToken: vi.fn(),
  membershipFindMany: vi.fn(),
  templateFindMany: vi.fn(),
  manageAction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendor: mocks.requireVendor, requireAuth: mocks.requireAuth }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    teamMembership: { findMany: mocks.membershipFindMany },
    teamFunnelTemplate: { findMany: mocks.templateFindMany },
  }),
}));
vi.mock("@/app/actions/team-funnel-template-actions", () => ({ manageTeamFunnelTemplateAction: mocks.manageAction }));
vi.mock("@/components/team-template-list", () => ({
  TeamTemplateList: ({ templates, csrfToken }: { templates: unknown; csrfToken: string }) => (
    <div data-testid="team-template-list">{JSON.stringify({ templates, csrfToken })}</div>
  ),
}));

import TeamTemplatesPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
  mocks.requireAuth.mockResolvedValue({ member: { id: "member-1" } });
  mocks.getCsrfToken.mockResolvedValue("csrf-token");
  mocks.membershipFindMany.mockResolvedValue([{ id: "membership-1", teamId: "team-1", team: { name: "第一團隊" } }]);
  mocks.templateFindMany.mockResolvedValue([{
    id: "template-1",
    name: "原始模板",
    teamId: "team-1",
    status: "PUBLISHED",
    team: { name: "第一團隊" },
    versions: [{
      version: 3,
      partnerFunnelPages: [
        { id: "source-page", slug: "source-page", promoterMembershipId: "membership-1", sharing: { isEnabled: true } },
        { id: "copied-page", slug: "copied-page", promoterMembershipId: "membership-2", sharing: { isEnabled: false } },
      ],
    }],
  }]);
});

describe("/team-templates route", () => {
  it("scopes memberships and maps source/copy counts into the list boundary", async () => {
    const html = renderToStaticMarkup(await TeamTemplatesPage());

    expect(mocks.requireVendor).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.requireAuth).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.membershipFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", vendorMemberId: "member-1", status: "ACTIVE", leftAt: null },
      select: { id: true, teamId: true, team: { select: { name: true } } },
    });
    expect(mocks.templateFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1", teamId: { in: ["team-1"] } },
      orderBy: { updatedAt: "desc" },
    }));
    expect(html).toContain("原始模板");
    expect(html).toContain('&quot;latestVersion&quot;:3');
    expect(html).toContain('&quot;copiedPartnerCount&quot;:1');
    expect(html).toContain('&quot;shareEnabled&quot;:true');
    expect(html).toContain("csrf-token");
  });

  it("renders the no-team warning and avoids a template query when memberships are empty", async () => {
    mocks.membershipFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await TeamTemplatesPage());

    expect(html).toContain("沒有可管理的有效團隊");
    expect(mocks.templateFindMany).not.toHaveBeenCalled();
    expect(html).toContain('data-testid="team-template-list"');
    expect(html).toContain('&quot;templates&quot;:[]');
  });
});
