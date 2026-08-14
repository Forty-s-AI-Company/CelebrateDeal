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
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ requireVendorOwner: mocks.requireVendorOwner }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: mocks.auditSnapshot, writeAuditLog: mocks.writeAuditLog }));

import {
  addTeamMemberAction,
  createSalesTeamAction,
  deactivateTeamMembershipAction,
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
    },
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
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "transfer_team_member", targetId: "membership-target" }));
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
});
