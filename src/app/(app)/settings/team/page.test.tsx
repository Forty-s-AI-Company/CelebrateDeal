import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorOwner: vi.fn(),
  salesTeamFindMany: vi.fn(),
  vendorMemberFindMany: vi.fn(),
  affiliateFindMany: vi.fn(),
  teamMembershipFindMany: vi.fn(),
  setTeamMembershipAffiliateAction: vi.fn(),
  createSalesTeamAction: vi.fn(),
  addTeamMemberAction: vi.fn(),
  setTeamUplineAction: vi.fn(),
  deactivateTeamMembershipAction: vi.fn(),
  transferTeamMemberAction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorOwner: mocks.requireVendorOwner }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  salesTeam: { findMany: mocks.salesTeamFindMany },
  vendorMember: { findMany: mocks.vendorMemberFindMany },
  affiliate: { findMany: mocks.affiliateFindMany },
  teamMembership: { findMany: mocks.teamMembershipFindMany },
}) }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="csrf-test-token" /> }));
vi.mock("@/app/actions/team-membership-actions", () => ({
  createSalesTeamAction: mocks.createSalesTeamAction,
  addTeamMemberAction: mocks.addTeamMemberAction,
  setTeamUplineAction: mocks.setTeamUplineAction,
  deactivateTeamMembershipAction: mocks.deactivateTeamMembershipAction,
  transferTeamMemberAction: mocks.transferTeamMemberAction,
  setTeamMembershipAffiliateAction: mocks.setTeamMembershipAffiliateAction,
}));

import TeamSettingsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorOwner.mockResolvedValue({
    user: { id: "user-owner" },
    vendor: { id: "vendor-1" },
    member: { id: "member-owner", role: "owner" },
  });
  mocks.salesTeamFindMany.mockResolvedValue([{
    id: "team-1",
    name: "北區夥伴",
    slug: "north-partners",
    memberships: [{
      id: "membership-owner",
      vendorMemberId: "member-owner",
      vendorMember: { user: { name: "Owner", email: "owner@example.com" } },
      uplineRelationships: [],
      affiliate: null,
    }],
  }, {
    id: "team-2",
    name: "南區夥伴",
    slug: "south-partners",
    memberships: [],
  }]);
  mocks.vendorMemberFindMany.mockResolvedValue([
    { id: "member-owner", user: { name: "Owner", email: "owner@example.com" } },
    { id: "member-2", user: { name: "Partner", email: "partner@example.com" } },
  ]);
  mocks.affiliateFindMany.mockResolvedValue([]);
  mocks.teamMembershipFindMany.mockResolvedValue([]);
});

function teamWith(memberships: unknown[]) {
  return [{ id: "team-1", name: "北區夥伴", slug: "north-partners", memberships }];
}

function holderRow(id: string, affiliateId: string, status = "ACTIVE") {
  return {
    id,
    affiliateId,
    status,
    leftAt: status === "ACTIVE" ? null : new Date("2026-10-01T00:00:00Z"),
    team: { name: "北區夥伴" },
    vendorMember: { user: { name: `name-${id}`, email: `${id}@example.com` } },
    affiliate: { name: `aff-${affiliateId}`, code: affiliateId.toUpperCase() },
  };
}

function membership(id: string, email: string, affiliate: unknown = null) {
  return { id, vendorMemberId: `member-${id}`, vendorMember: { user: { name: id, email } }, uplineRelationships: [], affiliate };
}

describe("TeamSettingsPage", () => {
  it("renders scoped team membership management controls", async () => {
    const html = renderToStaticMarkup(await TeamSettingsPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.requireVendorOwner).toHaveBeenCalledOnce();
    expect(mocks.salesTeamFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1" } }));
    expect(mocks.vendorMemberFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", status: "active" } }));
    expect(html).toContain("團隊管理");
    expect(html).toContain("北區夥伴");
    expect(html).toContain("加入既有商家成員");
    expect(html).toContain("無直接上線");
    expect(html).toContain("轉移成員");
    expect(html).toContain("南區夥伴");
    expect(html).toContain('name="_csrf" value="csrf-test-token"');
    expect(html).toContain("推廣夥伴（團隊佣金受益人）");
    expect(html).toContain("（不綁定）");
    expect(mocks.affiliateFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", isActive: true } }));
    expect(mocks.teamMembershipFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", affiliateId: { not: null } } }));
  });

  it("offers a one-click binding only for one unbound affiliate whose email matches after trim and case folding", async () => {
    mocks.salesTeamFindMany.mockResolvedValue(teamWith([membership("alice", "Alice@Example.com")]));
    mocks.affiliateFindMany.mockResolvedValue([
      { id: "affiliate-alice", name: "Alice 推廣", code: "ALICE", contactEmail: "  alice@example.COM " },
      { id: "affiliate-other", name: "Other", code: "OTHER", contactEmail: "other@example.com" },
    ]);

    const html = renderToStaticMarkup(await TeamSettingsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("一鍵綁定");
    expect(html).toContain("推廣夥伴「Alice 推廣」（ALICE）的聯絡 Email 與這位成員相同（依推廣夥伴的聯絡 Email 比對，未驗證）。");
    expect(html).toContain('name="affiliateId" value="affiliate-alice"');
    expect(html).not.toContain('name="affiliateId" value="affiliate-other"');
    // The suggestion is a separate explicit form; the dropdown still defaults to unbound.
    expect(mocks.setTeamMembershipAffiliateAction).not.toHaveBeenCalled();
  });

  it("does not suggest an affiliate that is already bound, or when the member is already bound", async () => {
    mocks.salesTeamFindMany.mockResolvedValue(teamWith([
      membership("alice", "alice@example.com"),
      membership("bob", "bob@example.com", { id: "affiliate-bob-old", name: "Bob 舊碼", code: "BOBOLD", isActive: false }),
    ]));
    mocks.affiliateFindMany.mockResolvedValue([
      { id: "affiliate-alice", name: "Alice 推廣", code: "ALICE", contactEmail: "alice@example.com" },
      { id: "affiliate-bob", name: "Bob 推廣", code: "BOB", contactEmail: "bob@example.com" },
    ]);
    mocks.teamMembershipFindMany.mockResolvedValue([
      holderRow("membership-elsewhere", "affiliate-alice"),
      holderRow("bob", "affiliate-bob-old"),
    ]);

    const html = renderToStaticMarkup(await TeamSettingsPage({ searchParams: Promise.resolve({}) }));

    expect(html).not.toContain("一鍵綁定");
    expect(html).toContain("目前綁定：");
    expect(html).toContain("Bob 舊碼");
    expect(html).toContain("此推廣夥伴已停用，該層上線佣金不會發放。");
    expect(html).toMatch(/<option value="affiliate-alice" disabled="">Alice 推廣（ALICE）・已綁定其他成員<\/option>/);
    expect(html).not.toContain("已停用成員紀錄上的綁定");
  });

  it("asks the owner to choose when several unbound affiliates share the member email", async () => {
    mocks.salesTeamFindMany.mockResolvedValue(teamWith([membership("alice", "alice@example.com")]));
    mocks.affiliateFindMany.mockResolvedValue([
      { id: "affiliate-a", name: "A", code: "A1", contactEmail: "alice@example.com" },
      { id: "affiliate-b", name: "B", code: "B1", contactEmail: "ALICE@example.com" },
    ]);

    const html = renderToStaticMarkup(await TeamSettingsPage({ searchParams: Promise.resolve({}) }));

    expect(html).not.toContain("一鍵綁定");
    expect(html).toContain("有 2 位未綁定的推廣夥伴使用與這位成員相同的 Email");
  });

  it("renders safe error and updated states without exposing internal details", async () => {
    const html = renderToStaticMarkup(await TeamSettingsPage({ searchParams: Promise.resolve({ error: "upline_cycle", updated: "relationship_saved" }) }));

    expect(html).toContain("這個指定會形成循環上下線關係，已拒絕儲存。");
    expect(html).toContain("上下線關係已更新，歷史關係已保留。");
    expect(html).not.toContain("Prisma");
  });

  it("renders friendly affiliate binding outcomes", async () => {
    const taken = renderToStaticMarkup(await TeamSettingsPage({ searchParams: Promise.resolve({ error: "affiliate_taken" }) }));
    expect(taken).toContain("這位推廣夥伴已綁定其他團隊成員，請先解除原本的綁定。");
    const bound = renderToStaticMarkup(await TeamSettingsPage({ searchParams: Promise.resolve({ updated: "affiliate_bound" }) }));
    expect(bound).toContain("推廣夥伴已綁定");
  });

  it("lists a binding left on an inactive membership record with a release control and blocks rebinding it", async () => {
    mocks.salesTeamFindMany.mockResolvedValue(teamWith([membership("alice", "alice@example.com")]));
    mocks.affiliateFindMany.mockResolvedValue([
      { id: "affiliate-alice", name: "Alice 推廣", code: "ALICE", contactEmail: "alice@example.com" },
    ]);
    mocks.teamMembershipFindMany.mockResolvedValue([holderRow("membership-old", "affiliate-alice", "INACTIVE")]);

    const html = renderToStaticMarkup(await TeamSettingsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("已停用成員紀錄上的綁定");
    expect(html).toContain("綁定在已停用的成員紀錄上：name-membership-old・北區夥伴");
    expect(html).toMatch(/name="membershipId" value="membership-old"\/><input type="hidden" name="affiliateId" value=""\/>/);
    expect(html).toContain("解除綁定");
    expect(html).toMatch(/<option value="affiliate-alice" disabled="">Alice 推廣（ALICE）・綁定在已停用的成員紀錄上<\/option>/);
    // An affiliate held by any record is never offered for one-click binding.
    expect(html).not.toContain("一鍵綁定");
  });

  it("explains deactivation and transfer effects on the affiliate binding", async () => {
    const deactivated = renderToStaticMarkup(await TeamSettingsPage({ searchParams: Promise.resolve({ updated: "member_deactivated" }) }));
    expect(deactivated).toContain("並已一併解除推廣夥伴綁定");
    const takenInactive = renderToStaticMarkup(await TeamSettingsPage({ searchParams: Promise.resolve({ error: "affiliate_taken_inactive" }) }));
    expect(takenInactive).toContain("這位推廣夥伴綁定在已停用的成員紀錄上");
  });

  it("preselects each member's own active upline (B's upline is A) and leaves A without upline", async () => {
    mocks.salesTeamFindMany.mockResolvedValue([{
      id: "team-1",
      name: "北區夥伴",
      slug: "north-partners",
      memberships: [{
        id: "membership-a",
        vendorMemberId: "member-a",
        vendorMember: { user: { name: "Alice", email: "a@example.com" } },
        uplineRelationships: [],
      }, {
        id: "membership-b",
        vendorMemberId: "member-b",
        vendorMember: { user: { name: "Bob", email: "b@example.com" } },
        uplineRelationships: [{ uplineMembershipId: "membership-a" }],
      }],
    }]);

    const html = renderToStaticMarkup(await TeamSettingsPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.salesTeamFindMany).toHaveBeenCalledWith(expect.objectContaining({
      include: { memberships: expect.objectContaining({
        include: expect.objectContaining({ uplineRelationships: { where: { endedAt: null }, select: { uplineMembershipId: true } } }),
      }) },
    }));
    const forms = html.split("<form").filter((chunk) => chunk.includes('name="downlineMembershipId"'));
    const formFor = (id: string) => forms.find((chunk) => chunk.includes(`name="downlineMembershipId" value="${id}"`)) ?? "";
    // A has no upline: only the blank option is selected.
    expect(formFor("membership-a")).toMatch(/<option value="" selected="">（無直接上線）<\/option>/);
    expect(formFor("membership-a")).not.toMatch(/value="membership-b" selected/);
    // B's upline is A: A is preselected and the blank option is not.
    expect(formFor("membership-b")).toMatch(/<option value="membership-a" selected="">Alice<\/option>/);
    expect(formFor("membership-b")).not.toMatch(/<option value="" selected/);
  });

  it("remounts the upline and affiliate selects when the server-side value changes", async () => {
    type El = { type?: unknown; key?: string | null; props?: { name?: string; defaultValue?: string; children?: unknown } };
    const findSelects = (node: unknown, name: string, out: El[] = []): El[] => {
      if (Array.isArray(node)) { node.forEach((child) => findSelects(child, name, out)); return out; }
      if (!node || typeof node !== "object") return out;
      const el = node as El;
      if (el.type === "select" && el.props?.name === name) out.push(el);
      findSelects(el.props?.children, name, out);
      return out;
    };
    const render = async (affiliate: unknown, upline: string | null) => {
      mocks.salesTeamFindMany.mockResolvedValue(teamWith([
        { ...membership("alice", "alice@example.com", affiliate), uplineRelationships: upline ? [{ uplineMembershipId: upline }] : [] },
        membership("bob", "bob@example.com"),
      ]));
      const tree = await TeamSettingsPage({ searchParams: Promise.resolve({ updated: "affiliate_bound" }) });
      return {
        affiliate: findSelects(tree, "affiliateId")[0]!,
        upline: findSelects(tree, "uplineMembershipId")[0]!,
      };
    };

    const before = await render(null, null);
    const after = await render({ id: "affiliate-alice", name: "Alice 推廣", code: "ALICE", isActive: true }, "bob");

    expect(before.affiliate.key).toBe("alice:");
    expect(after.affiliate.key).toBe("alice:affiliate-alice");
    expect(after.affiliate.props?.defaultValue).toBe("affiliate-alice");
    expect(before.upline.key).toBe("alice:");
    expect(after.upline.key).toBe("alice:bob");
    expect(after.upline.props?.defaultValue).toBe("bob");
    expect(after.affiliate.key).not.toBe(before.affiliate.key);
    expect(after.upline.key).not.toBe(before.upline.key);
  });
});
