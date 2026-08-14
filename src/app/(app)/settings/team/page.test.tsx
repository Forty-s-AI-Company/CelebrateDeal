import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorOwner: vi.fn(),
  salesTeamFindMany: vi.fn(),
  vendorMemberFindMany: vi.fn(),
  createSalesTeamAction: vi.fn(),
  addTeamMemberAction: vi.fn(),
  setTeamUplineAction: vi.fn(),
  deactivateTeamMembershipAction: vi.fn(),
  transferTeamMemberAction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorOwner: mocks.requireVendorOwner }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ salesTeam: { findMany: mocks.salesTeamFindMany }, vendorMember: { findMany: mocks.vendorMemberFindMany } }) }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="csrf-test-token" /> }));
vi.mock("@/app/actions/team-membership-actions", () => ({
  createSalesTeamAction: mocks.createSalesTeamAction,
  addTeamMemberAction: mocks.addTeamMemberAction,
  setTeamUplineAction: mocks.setTeamUplineAction,
  deactivateTeamMembershipAction: mocks.deactivateTeamMembershipAction,
  transferTeamMemberAction: mocks.transferTeamMemberAction,
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
      downlineRelationships: [],
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
});

describe("TeamSettingsPage", () => {
  it("renders scoped team membership management controls", async () => {
    const html = renderToStaticMarkup(await TeamSettingsPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.requireVendorOwner).toHaveBeenCalledOnce();
    expect(mocks.salesTeamFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1" } }));
    expect(mocks.vendorMemberFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", status: "active" } }));
    expect(html).toContain("團隊與上下線");
    expect(html).toContain("北區夥伴");
    expect(html).toContain("加入既有商家成員");
    expect(html).toContain("無直接上線");
    expect(html).toContain("轉移成員");
    expect(html).toContain("南區夥伴");
    expect(html).toContain('name="_csrf" value="csrf-test-token"');
  });

  it("renders safe error and updated states without exposing internal details", async () => {
    const html = renderToStaticMarkup(await TeamSettingsPage({ searchParams: Promise.resolve({ error: "upline_cycle", updated: "relationship_saved" }) }));

    expect(html).toContain("這個指定會形成循環上下線關係，已拒絕儲存。");
    expect(html).toContain("上下線關係已更新，歷史關係已保留。");
    expect(html).not.toContain("Prisma");
  });
});
