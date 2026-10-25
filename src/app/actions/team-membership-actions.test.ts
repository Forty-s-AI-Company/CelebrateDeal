import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorOwner: vi.fn(),
  getDb: vi.fn(),
  transaction: vi.fn(),
  salesTeamCreate: vi.fn(),
  teamMembershipCreate: vi.fn(),
  teamMembershipFindMany: vi.fn(),
  teamMembershipFindFirst: vi.fn(),
  teamMembershipFindUnique: vi.fn(),
  teamMembershipUpdate: vi.fn(),
  teamMembershipRelationshipFindMany: vi.fn(),
  teamMembershipRelationshipUpdateMany: vi.fn(),
  teamMembershipRelationshipCreate: vi.fn(),
  vendorMemberFindFirst: vi.fn(),
  salesTeamFindFirst: vi.fn(),
  auditSnapshot: vi.fn((value: unknown) => value),
  writeAuditLog: vi.fn(),
  requestAuditMeta: vi.fn(async () => ({ ipAddress: null, userAgent: null })),
  teamMembershipUpdateMany: vi.fn(),
  affiliateFindFirst: vi.fn(),
  auditLogCreate: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ requireVendorOwner: mocks.requireVendorOwner }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: mocks.auditSnapshot, requestAuditMeta: mocks.requestAuditMeta, writeAuditLog: mocks.writeAuditLog }));

import {
  addTeamMemberAction,
  createSalesTeamAction,
  deactivateTeamMembershipAction,
  setTeamMembershipAffiliateAction,
  setTeamUplineAction,
  transferTeamMemberAction,
} from "./team-membership-actions";

const auth = {
  user: { id: "user-owner" },
  vendor: { id: "vendor-1" },
  member: { id: "member-owner", role: "owner" },
};

function formData(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.requireVendorOwner.mockResolvedValue(auth);
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  mocks.salesTeamCreate.mockResolvedValue({ id: "team-1", name: "北區夥伴", slug: "north-partners" });
  mocks.teamMembershipCreate.mockResolvedValue({ id: "membership-1", status: "ACTIVE" });
  mocks.teamMembershipUpdate.mockResolvedValue({ id: "membership-1", status: "ACTIVE", leftAt: null });
  mocks.teamMembershipRelationshipUpdateMany.mockResolvedValue({ count: 1 });
  mocks.teamMembershipRelationshipCreate.mockResolvedValue({ id: "relationship-1" });
  mocks.salesTeamFindFirst.mockResolvedValue({ id: "team-2" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    salesTeam: { create: mocks.salesTeamCreate, findFirst: mocks.salesTeamFindFirst },
    teamMembership: {
      create: mocks.teamMembershipCreate,
      findMany: mocks.teamMembershipFindMany,
      findFirst: mocks.teamMembershipFindFirst,
      findUnique: mocks.teamMembershipFindUnique,
      update: mocks.teamMembershipUpdate,
      updateMany: mocks.teamMembershipUpdateMany,
    },
    affiliate: { findFirst: mocks.affiliateFindFirst },
    auditLog: { create: mocks.auditLogCreate },
    teamMembershipRelationship: {
      findMany: mocks.teamMembershipRelationshipFindMany,
      updateMany: mocks.teamMembershipRelationshipUpdateMany,
      create: mocks.teamMembershipRelationshipCreate,
    },
    vendorMember: { findFirst: mocks.vendorMemberFindFirst },
  }));
  mocks.getDb.mockReturnValue({ $transaction: mocks.transaction });
});

describe("team membership actions", () => {
  it("creates a team and atomically adds the owner", async () => {
    await expect(createSalesTeamAction(formData({ name: "北區夥伴", slug: "north partners" }))).rejects.toThrow(
      "redirect:/settings/team?updated=team_created",
    );

    expect(mocks.salesTeamCreate).toHaveBeenCalledWith({
      data: { vendorId: "vendor-1", name: "北區夥伴", slug: "north-partners" },
    });
    expect(mocks.teamMembershipCreate).toHaveBeenCalledWith({
      data: { vendorId: "vendor-1", teamId: "team-1", vendorMemberId: "member-owner" },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "create_sales_team", targetId: "team-1" }));
  });

  it("maps duplicate team slugs to a safe conflict state", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2002" });

    await expect(createSalesTeamAction(formData({ name: "重複團隊" }))).rejects.toThrow(
      "redirect:/settings/team?error=team_conflict",
    );
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("reactivates an existing inactive membership without creating a duplicate", async () => {
    mocks.salesTeamCreate.mockResolvedValue(undefined);
    const teamFindFirst = vi.fn().mockResolvedValue({ id: "team-1" });
    const existingFindUnique = mocks.teamMembershipFindUnique.mockResolvedValue({ id: "membership-1", status: "INACTIVE" });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      salesTeam: { findFirst: teamFindFirst },
      teamMembership: { findUnique: existingFindUnique, update: mocks.teamMembershipUpdate, create: mocks.teamMembershipCreate },
      vendorMember: { findFirst: mocks.vendorMemberFindFirst.mockResolvedValue({ id: "member-2" }) },
    }));

    await expect(addTeamMemberAction(formData({ teamId: "team-1", vendorMemberId: "member-2" }))).rejects.toThrow(
      "redirect:/settings/team?updated=member_added",
    );
    expect(mocks.teamMembershipUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "membership-1" },
      data: expect.objectContaining({ status: "ACTIVE", leftAt: null }),
    }));
    expect(mocks.teamMembershipCreate).not.toHaveBeenCalled();
  });

  it("updates a direct upline and rejects a cycle", async () => {
    mocks.teamMembershipFindMany.mockResolvedValue([{ id: "membership-a" }, { id: "membership-b" }, { id: "membership-c" }]);
    mocks.teamMembershipRelationshipFindMany.mockResolvedValue([
      { id: "relationship-ab", uplineMembershipId: "membership-a", downlineMembershipId: "membership-b" },
    ]);

    await expect(setTeamUplineAction(formData({
      teamId: "team-1", downlineMembershipId: "membership-c", uplineMembershipId: "membership-b",
    }))).rejects.toThrow("redirect:/settings/team?updated=relationship_saved");
    expect(mocks.teamMembershipRelationshipUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: "team-1", downlineMembershipId: "membership-c", endedAt: null },
    }));
    expect(mocks.teamMembershipRelationshipCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: "team-1", uplineMembershipId: "membership-b", downlineMembershipId: "membership-c" }),
    }));

    mocks.teamMembershipRelationshipFindMany.mockResolvedValue([
      { id: "relationship-ab", uplineMembershipId: "membership-a", downlineMembershipId: "membership-b" },
      { id: "relationship-bc", uplineMembershipId: "membership-b", downlineMembershipId: "membership-c" },
    ]);
    await expect(setTeamUplineAction(formData({
      teamId: "team-1", downlineMembershipId: "membership-a", uplineMembershipId: "membership-c",
    }))).rejects.toThrow("redirect:/settings/team?error=upline_cycle");
    expect(mocks.teamMembershipRelationshipCreate).toHaveBeenCalledTimes(1);
  });

  it("moves an active member atomically and ends source-team relationships", async () => {
    mocks.teamMembershipFindFirst.mockResolvedValue({ id: "membership-2", vendorMemberId: "member-2" });
    mocks.teamMembershipFindUnique.mockResolvedValue(null);
    mocks.vendorMemberFindFirst.mockResolvedValue({ id: "member-2" });
    mocks.teamMembershipCreate.mockResolvedValue({ id: "membership-target", status: "ACTIVE" });

    await expect(transferTeamMemberAction(formData({
      sourceTeamId: "team-1", targetTeamId: "team-2", membershipId: "membership-2",
    }))).rejects.toThrow("redirect:/settings/team?updated=member_transferred");

    expect(mocks.teamMembershipRelationshipUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ teamId: "team-1", endedAt: null }),
      data: { endedAt: expect.any(Date) },
    }));
    expect(mocks.teamMembershipUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "membership-2" },
      data: expect.objectContaining({ status: "INACTIVE", leftAt: expect.any(Date) }),
    }));
    expect(mocks.teamMembershipCreate).toHaveBeenCalledWith({
      data: { vendorId: "vendor-1", teamId: "team-2", vendorMemberId: "member-2" },
    });
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ vendorId: "vendor-1", action: "transfer_team_member", targetId: "membership-target" }) });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects moving into a team where the member is already active", async () => {
    mocks.teamMembershipFindFirst.mockResolvedValue({ id: "membership-2", vendorMemberId: "member-2" });
    mocks.teamMembershipFindUnique.mockResolvedValue({ id: "membership-target", status: "ACTIVE" });
    mocks.vendorMemberFindFirst.mockResolvedValue({ id: "member-2" });

    await expect(transferTeamMemberAction(formData({
      sourceTeamId: "team-1", targetTeamId: "team-2", membershipId: "membership-2",
    }))).rejects.toThrow("redirect:/settings/team?error=team_move_conflict");
    expect(mocks.teamMembershipRelationshipUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("ends relationships before deactivating a member", async () => {
    mocks.teamMembershipFindFirst.mockResolvedValue({ id: "membership-2", vendorMemberId: "member-2" });

    await expect(deactivateTeamMembershipAction(formData({ teamId: "team-1", membershipId: "membership-2" }))).rejects.toThrow(
      "redirect:/settings/team?updated=member_deactivated",
    );
    expect(mocks.teamMembershipRelationshipUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ teamId: "team-1", endedAt: null }),
      data: expect.objectContaining({ endedAt: expect.any(Date) }),
    }));
    expect(mocks.teamMembershipUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "membership-2" },
      data: expect.objectContaining({ status: "INACTIVE", leftAt: expect.any(Date) }),
    }));
  });

  it("carries the affiliate binding to the target membership when moving a member", async () => {
    mocks.teamMembershipFindFirst.mockResolvedValue({ id: "membership-2", vendorMemberId: "member-2", affiliateId: "affiliate-2" });
    mocks.teamMembershipFindUnique.mockResolvedValue({ id: "membership-target", status: "INACTIVE", affiliateId: "affiliate-stale" });
    mocks.teamMembershipUpdate
      .mockResolvedValueOnce({ id: "membership-2", status: "INACTIVE" })
      .mockResolvedValueOnce({ id: "membership-target", status: "ACTIVE" });
    mocks.vendorMemberFindFirst.mockResolvedValue({ id: "member-2" });
    mocks.teamMembershipCreate.mockResolvedValue({ id: "membership-target", status: "ACTIVE" });

    await expect(transferTeamMemberAction(formData({
      sourceTeamId: "team-1", targetTeamId: "team-2", membershipId: "membership-2",
    }))).rejects.toThrow("redirect:/settings/team?updated=member_transferred");

    expect(mocks.teamMembershipUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "membership-2" },
      data: expect.objectContaining({ status: "INACTIVE", affiliateId: null }),
    }));
    expect(mocks.teamMembershipUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: "membership-target" },
      data: expect.objectContaining({ status: "ACTIVE", affiliateId: "affiliate-2" }),
    });
    expect(mocks.teamMembershipCreate).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "transfer_team_member",
      before: { sourceMembershipId: "membership-2", sourceAffiliateId: "affiliate-2", targetMembershipId: "membership-target", targetAffiliateId: "affiliate-stale" },
      after: expect.objectContaining({ sourceMembershipId: "membership-2", targetMembershipId: "membership-target", affiliateId: "affiliate-2" }),
    }) });
  });

  it("releases the affiliate binding when a member is deactivated", async () => {
    mocks.teamMembershipFindFirst.mockResolvedValue({ id: "membership-2", vendorMemberId: "member-2", affiliateId: "affiliate-2" });

    await expect(deactivateTeamMembershipAction(formData({ teamId: "team-1", membershipId: "membership-2" }))).rejects.toThrow(
      "redirect:/settings/team?updated=member_deactivated",
    );
    expect(mocks.teamMembershipUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "INACTIVE", affiliateId: null }),
    }));
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "deactivate_team_membership",
      targetId: "membership-1",
      before: expect.objectContaining({ affiliateId: "affiliate-2" }),
      after: expect.objectContaining({ status: "ACTIVE", affiliateId: null }),
    }) });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("binds with a tenant-bound compare-and-set write and an audit row in the same transaction", async () => {
    mocks.teamMembershipFindFirst
      .mockResolvedValueOnce({ id: "membership-2", teamId: "team-1", affiliateId: null, status: "ACTIVE", leftAt: null })
      .mockResolvedValueOnce(null);
    mocks.affiliateFindFirst.mockResolvedValue({ id: "affiliate-2", isActive: true });
    mocks.teamMembershipUpdateMany.mockResolvedValue({ count: 1 });

    await expect(setTeamMembershipAffiliateAction(formData({ membershipId: "membership-2", affiliateId: "affiliate-2" }))).rejects.toThrow(
      "redirect:/settings/team?updated=affiliate_bound",
    );
    expect(mocks.teamMembershipFindFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "membership-2", vendorId: "vendor-1" },
    }));
    expect(mocks.affiliateFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "affiliate-2", vendorId: "vendor-1" } }));
    expect(mocks.teamMembershipUpdateMany).toHaveBeenCalledWith({
      where: { id: "membership-2", vendorId: "vendor-1", status: "ACTIVE", leftAt: null, affiliateId: null },
      data: { affiliateId: "affiliate-2" },
    });
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      vendorId: "vendor-1",
      action: "bind_team_membership_affiliate",
      targetId: "membership-2",
      before: { membershipId: "membership-2", teamId: "team-1", membershipStatus: "ACTIVE", affiliateId: null },
      after: { membershipId: "membership-2", teamId: "team-1", membershipStatus: "ACTIVE", affiliateId: "affiliate-2" },
    }) });
  });

  it("reports a unique-index race as an existing binding instead of taking it over", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2002" });
    await expect(setTeamMembershipAffiliateAction(formData({ membershipId: "membership-2", affiliateId: "affiliate-2" }))).rejects.toThrow(
      "redirect:/settings/team?error=affiliate_taken",
    );
    mocks.transaction.mockRejectedValueOnce({ code: "P2034" });
    await expect(setTeamMembershipAffiliateAction(formData({ membershipId: "membership-2", affiliateId: "affiliate-2" }))).rejects.toThrow(
      "redirect:/settings/team?error=affiliate_binding_conflict",
    );
    await expect(setTeamMembershipAffiliateAction(formData({ membershipId: "" }))).rejects.toThrow(
      "redirect:/settings/team?error=affiliate_binding_invalid",
    );
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("rejects a compare-and-set miss when the binding changed after it was read", async () => {
    mocks.teamMembershipFindFirst.mockResolvedValueOnce({ id: "membership-2", teamId: "team-1", affiliateId: "affiliate-old", status: "ACTIVE", leftAt: null });
    mocks.teamMembershipUpdateMany.mockResolvedValue({ count: 0 });

    await expect(setTeamMembershipAffiliateAction(formData({ membershipId: "membership-2", affiliateId: "" }))).rejects.toThrow(
      "redirect:/settings/team?error=affiliate_binding_conflict",
    );
    expect(mocks.teamMembershipUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "membership-2", vendorId: "vendor-1", affiliateId: "affiliate-old" }),
      data: { affiliateId: null },
    }));
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("rejects a failed CSRF check and a non-owner before any database access", async () => {
    mocks.assertServerActionSecurity.mockRejectedValueOnce(new Error("csrf_rejected"));
    await expect(setTeamMembershipAffiliateAction(formData({ membershipId: "membership-2", affiliateId: "affiliate-2" }))).rejects.toThrow("csrf_rejected");
    expect(mocks.requireVendorOwner).not.toHaveBeenCalled();

    mocks.requireVendorOwner.mockRejectedValueOnce(new Error("redirect:/settings/security?error=owner_required"));
    await expect(setTeamMembershipAffiliateAction(formData({ membershipId: "membership-2", affiliateId: "affiliate-2" }))).rejects.toThrow(
      "redirect:/settings/security?error=owner_required",
    );

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.teamMembershipFindFirst).not.toHaveBeenCalled();
    expect(mocks.teamMembershipUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("only releases, never binds, an inactive membership record", async () => {
    const inactive = { id: "membership-old", teamId: "team-1", affiliateId: "affiliate-2", status: "INACTIVE", leftAt: new Date("2026-10-01T00:00:00Z") };
    mocks.teamMembershipFindFirst.mockResolvedValueOnce({ ...inactive, affiliateId: null });
    await expect(setTeamMembershipAffiliateAction(formData({ membershipId: "membership-old", affiliateId: "affiliate-3" }))).rejects.toThrow(
      "redirect:/settings/team?error=membership_invalid",
    );
    expect(mocks.teamMembershipUpdateMany).not.toHaveBeenCalled();

    mocks.teamMembershipFindFirst.mockResolvedValueOnce(inactive);
    mocks.teamMembershipUpdateMany.mockResolvedValue({ count: 1 });
    await expect(setTeamMembershipAffiliateAction(formData({ membershipId: "membership-old", affiliateId: "" }))).rejects.toThrow(
      "redirect:/settings/team?updated=affiliate_unbound",
    );
    expect(mocks.teamMembershipUpdateMany).toHaveBeenCalledWith({
      where: { id: "membership-old", vendorId: "vendor-1", affiliateId: "affiliate-2" },
      data: { affiliateId: null },
    });
  });

  it("tells the owner when the affiliate is held by an inactive membership record", async () => {
    mocks.teamMembershipFindFirst
      .mockResolvedValueOnce({ id: "membership-2", teamId: "team-1", affiliateId: null, status: "ACTIVE", leftAt: null })
      .mockResolvedValueOnce({ id: "membership-old", status: "INACTIVE", leftAt: new Date("2026-10-01T00:00:00Z") });
    mocks.affiliateFindFirst.mockResolvedValue({ id: "affiliate-2", isActive: true });

    await expect(setTeamMembershipAffiliateAction(formData({ membershipId: "membership-2", affiliateId: "affiliate-2" }))).rejects.toThrow(
      "redirect:/settings/team?error=affiliate_taken_inactive",
    );
    expect(mocks.teamMembershipUpdateMany).not.toHaveBeenCalled();
  });
});
