import { beforeEach, describe, expect, it, vi } from "vitest";

const { actor, db } = vi.hoisted(() => ({
  actor: {
    id: "member-a",
    vendorId: "vendor-1",
    teamId: "team-1",
    vendorMemberId: "vendor-member-a",
    userId: "user-a",
    status: "ACTIVE",
    leftAt: null,
    vendorMemberStatus: "active",
    vendorMemberDeactivatedAt: null,
  },
  db: {
    partnerFunnelPage: { findFirst: vi.fn() },
    partnerLiveShare: { upsert: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
    paymentMethodReference: { findFirst: vi.fn(), findMany: vi.fn() },
    teamMembership: { findMany: vi.fn() },
    teamMembershipRelationship: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(), requireVendor: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/team-funnel-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team-funnel-access")>()),
  requireTeamFunnelActor: vi.fn().mockResolvedValue(actor),
}));

import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";

import {
  createTeamFunnelLiveShare,
  disableTeamFunnelLiveShare,
  hashTeamFunnelLiveShareCode,
  resolveTeamFunnelLiveShare,
  TeamFunnelLiveShareConflictError,
  TeamFunnelLiveShareUnavailableError,
} from "@/lib/team-funnel-live-sharing";

const page = {
  id: "page-a",
  vendorId: "vendor-1",
  teamId: "team-1",
  promoterMembershipId: "member-a",
  contentOwnerMembershipId: "member-a",
  live: {
    id: "live-a",
    slug: "webinar-a",
    teamId: "team-1",
    seminarOwnerMembershipId: "member-a",
    status: "live",
    replayEnabled: true,
    quotaPolicy: {},
  },
};

function membership(id: string, affiliateCode: string | null = null) {
  return {
    id,
    vendorId: "vendor-1",
    teamId: "team-1",
    vendorMemberId: id === "member-a" ? "vendor-member-a" : `vendor-${id}`,
    status: "ACTIVE",
    leftAt: null,
    vendorMember: { userId: id === "member-a" ? "user-a" : `user-${id}`, status: "active", deactivatedAt: null },
    affiliate: affiliateCode ? { code: affiliateCode, isActive: true } : null,
  };
}

function resolvedShare(overrides: Record<string, unknown> = {}) {
  return {
    vendorId: "vendor-1",
    teamId: "team-1",
    liveId: "live-a",
    sourcePageId: "page-a",
    promoterMembershipId: "member-b",
    expiresAt: null,
    isEnabled: true,
    sourcePage: { teamId: "team-1", liveId: "live-a", templateVersionId: "version-a", promoterMembershipId: "member-a", contentOwnerMembershipId: "member-a" },
    live: { teamId: "team-1", seminarOwnerMembershipId: "member-a", status: "live", replayEnabled: true },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.partnerFunnelPage.findFirst.mockResolvedValue(page);
  db.teamMembership.findMany.mockResolvedValue([membership("member-a", "A-CODE"), membership("member-b", "B-CODE")]);
  db.teamMembershipRelationship.findMany.mockResolvedValue([{
    teamId: "team-1",
    uplineMembershipId: "member-a",
    downlineMembershipId: "member-b",
    effectiveAt: new Date("2026-01-01"),
    endedAt: null,
  }]);
  db.partnerLiveShare.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({
    id: "live-share-1",
    liveId: args.create.liveId,
    promoterMembershipId: args.create.promoterMembershipId,
    expiresAt: args.create.expiresAt,
    isEnabled: true,
  }));
  db.partnerLiveShare.updateMany.mockResolvedValue({ count: 1 });
  db.paymentMethodReference.findMany.mockResolvedValue([]);
  db.paymentMethodReference.findFirst.mockResolvedValue(null);
});

describe("Partner Live share", () => {
  it("issues a target-promoter link without creating a partner page and stores only the token hash", async () => {
    const result = await createTeamFunnelLiveShare({ teamId: "team-1", pageId: "page-a", promoterMembershipId: "member-b" });

    expect(result.shareUrl).toMatch(/^\/live\/webinar-a\?share=tls1\./u);
    expect(result.shareCode).toMatch(/^tls1\.[A-Za-z0-9_-]{43}$/u);
    const create = db.partnerLiveShare.upsert.mock.calls[0]?.[0]?.create as Record<string, unknown>;
    expect(create.promoterMembershipId).toBe("member-b");
    expect(create.tokenHash).toBe(hashTeamFunnelLiveShareCode(result.shareCode));
    expect(create.tokenHash).not.toBe(result.shareCode);
    expect(db.partnerFunnelPage.findFirst).toHaveBeenCalledOnce();
  });

  it("hashes deterministically and rejects malformed bearer codes before database lookup", async () => {
    const code = "tls1.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012";
    expect(hashTeamFunnelLiveShareCode(code)).toBe(hashTeamFunnelLiveShareCode(code));
    expect(hashTeamFunnelLiveShareCode(code)).toMatch(/^[a-f0-9]{64}$/u);

    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode: "tls1.too-short" })).resolves.toBeNull();
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode: `tls1.${"a".repeat(156)}` })).resolves.toBeNull();
    expect(db.partnerLiveShare.findFirst).not.toHaveBeenCalled();
  });

  it("rejects missing pages, expired requests and invalid target members without writing", async () => {
    db.partnerFunnelPage.findFirst.mockResolvedValueOnce(null);
    await expect(createTeamFunnelLiveShare({ teamId: "team-1", pageId: "missing", promoterMembershipId: "member-b" })).rejects.toThrow("missing_resource");

    await expect(createTeamFunnelLiveShare({ teamId: "team-1", pageId: "page-a", promoterMembershipId: "member-b", expiresAt: new Date("2020-01-01") }))
      .rejects.toBeInstanceOf(TeamFunnelLiveShareConflictError);

    await expect(createTeamFunnelLiveShare({ teamId: "team-1", pageId: "page-a", promoterMembershipId: "member-missing" }))
      .rejects.toBeInstanceOf(TeamFunnelLiveShareConflictError);
    expect(db.partnerLiveShare.upsert).not.toHaveBeenCalled();
  });

  it("rejects an inactive target and a target equal to the source promoter", async () => {
    db.teamMembership.findMany.mockResolvedValueOnce([membership("member-a"), { ...membership("member-b"), status: "INACTIVE" }]);
    await expect(createTeamFunnelLiveShare({ teamId: "team-1", pageId: "page-a", promoterMembershipId: "member-b" }))
      .rejects.toBeInstanceOf(TeamFunnelLiveShareConflictError);

    await expect(createTeamFunnelLiveShare({ teamId: "team-1", pageId: "page-a", promoterMembershipId: "member-a" }))
      .rejects.toBeInstanceOf(TeamFunnelLiveShareConflictError);
    expect(db.partnerLiveShare.upsert).not.toHaveBeenCalled();
  });

  it("rejects a source page whose Live is not an available A-owned binding", async () => {
    db.partnerFunnelPage.findFirst.mockResolvedValueOnce({
      ...page,
      live: { ...page.live, seminarOwnerMembershipId: "member-other" },
    });
    await expect(createTeamFunnelLiveShare({ teamId: "team-1", pageId: "page-a", promoterMembershipId: "member-b" }))
      .rejects.toBeInstanceOf(TeamFunnelAccessDeniedError);

    db.partnerFunnelPage.findFirst.mockResolvedValueOnce({
      ...page,
      live: { ...page.live, status: "ended", replayEnabled: false },
    });
    await expect(createTeamFunnelLiveShare({ teamId: "team-1", pageId: "page-a", promoterMembershipId: "member-b" }))
      .rejects.toBeInstanceOf(TeamFunnelLiveShareConflictError);
    expect(db.partnerLiveShare.upsert).not.toHaveBeenCalled();
  });

  it("rejects a non-downline target before writing a share", async () => {
    db.teamMembershipRelationship.findMany.mockResolvedValue([]);

    await expect(createTeamFunnelLiveShare({ teamId: "team-1", pageId: "page-a", promoterMembershipId: "member-b" }))
      .rejects.toBeInstanceOf(TeamFunnelLiveShareConflictError);
    expect(db.partnerLiveShare.upsert).not.toHaveBeenCalled();
  });

  it("requires an active payment reference before enabling a quota-backed Live share", async () => {
    db.partnerFunnelPage.findFirst.mockResolvedValueOnce({
      ...page,
      live: {
        ...page.live,
        quotaPolicy: {
          quotaPayerScope: "MEMBER",
          usageAttributionMode: "CUSTOM",
          customAllocations: [{ teamId: "team-1", membershipId: "member-b", bps: 10_000 }],
        },
      },
    });

    await expect(createTeamFunnelLiveShare({ teamId: "team-1", pageId: "page-a", promoterMembershipId: "member-b" }))
      .rejects.toBeInstanceOf(TeamFunnelLiveShareConflictError);
    expect(db.paymentMethodReference.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ membershipId: { in: ["member-b"] } }),
    }));
    expect(db.partnerLiveShare.upsert).not.toHaveBeenCalled();
  });

  it("resolves the exact live share to B while retaining A content and webinar ownership", async () => {
    const shareCode = "tls1.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012";
    db.partnerLiveShare.findFirst.mockResolvedValue({
      vendorId: "vendor-1",
      teamId: "team-1",
      liveId: "live-a",
      sourcePageId: "page-a",
      promoterMembershipId: "member-b",
      tokenHash: hashTeamFunnelLiveShareCode(shareCode),
      expiresAt: null,
      isEnabled: true,
      sourcePage: { teamId: "team-1", liveId: "live-a", templateVersionId: "version-a", promoterMembershipId: "member-a", contentOwnerMembershipId: "member-a" },
      live: { teamId: "team-1", seminarOwnerMembershipId: "member-a", status: "live", replayEnabled: true },
    });

    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode }))
      .resolves.toMatchObject({
        sourcePageId: "page-a",
        promoterMembershipId: "member-b",
        contentOwnerMembershipId: "member-a",
        webinarOwnerMembershipId: "member-a",
        referralCode: "B-CODE",
        leaderMembershipId: "member-a",
        source: "REFERRAL",
      });
  });

  it("fails closed for expired, disabled, or relationship-revoked shares", async () => {
    const shareCode = "tls1.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012";
    db.partnerLiveShare.findFirst.mockResolvedValue({
      vendorId: "vendor-1", teamId: "team-1", liveId: "live-a", sourcePageId: "page-a", promoterMembershipId: "member-b",
      expiresAt: new Date("2026-01-01"), isEnabled: true,
      sourcePage: { teamId: "team-1", liveId: "live-a", templateVersionId: "version-a", promoterMembershipId: "member-a", contentOwnerMembershipId: "member-a" },
      live: { teamId: "team-1", seminarOwnerMembershipId: "member-a", status: "live", replayEnabled: true },
    });
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode, now: new Date("2026-02-01") })).resolves.toBeNull();

    db.partnerLiveShare.findFirst.mockResolvedValueOnce({
      vendorId: "vendor-1", teamId: "team-1", liveId: "live-a", sourcePageId: "page-a", promoterMembershipId: "member-b",
      expiresAt: null, isEnabled: true,
      sourcePage: { teamId: "team-1", liveId: "live-a", templateVersionId: "version-a", promoterMembershipId: "member-a", contentOwnerMembershipId: "member-a" },
      live: { teamId: "team-1", seminarOwnerMembershipId: "member-a", status: "live", replayEnabled: true },
    });
    db.teamMembershipRelationship.findMany.mockResolvedValue([]);
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode })).resolves.toBeNull();
  });

  it("fails closed for disabled, missing and cross-boundary share records", async () => {
    const shareCode = "tls1.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012";
    db.partnerLiveShare.findFirst.mockResolvedValueOnce(resolvedShare({ isEnabled: false }));
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode })).resolves.toBeNull();

    db.partnerLiveShare.findFirst.mockResolvedValueOnce(null);
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode })).resolves.toBeNull();

    db.partnerLiveShare.findFirst.mockResolvedValueOnce(resolvedShare({ liveId: "live-other" }));
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode })).resolves.toBeNull();

    db.partnerLiveShare.findFirst.mockResolvedValueOnce(resolvedShare({ sourcePage: { ...resolvedShare().sourcePage, teamId: "team-other" } }));
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode })).resolves.toBeNull();

    db.partnerLiveShare.findFirst.mockResolvedValueOnce(resolvedShare({ live: { ...resolvedShare().live, teamId: "team-other" } }));
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode })).resolves.toBeNull();
  });

  it("accepts ended replay shares but rejects non-public lifecycle states", async () => {
    const shareCode = "tls1.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012";
    db.partnerLiveShare.findFirst.mockResolvedValueOnce(resolvedShare({ live: { ...resolvedShare().live, status: "ended", replayEnabled: true } }));
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode })).resolves.toMatchObject({ source: "REFERRAL" });

    db.partnerLiveShare.findFirst.mockResolvedValueOnce(resolvedShare({ live: { ...resolvedShare().live, status: "ended", replayEnabled: false } }));
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode })).resolves.toBeNull();

    db.partnerLiveShare.findFirst.mockResolvedValueOnce(resolvedShare({ live: { ...resolvedShare().live, status: "draft", replayEnabled: true } }));
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode })).resolves.toBeNull();
  });

  it("rejects revoked membership facts and inactive webinar owners", async () => {
    const shareCode = "tls1.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012";
    db.partnerLiveShare.findFirst.mockResolvedValueOnce(resolvedShare());
    db.teamMembership.findMany.mockResolvedValueOnce([membership("member-a"), { ...membership("member-b"), status: "INACTIVE" }]);
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode })).resolves.toBeNull();

    db.partnerLiveShare.findFirst.mockResolvedValueOnce(resolvedShare({ live: { ...resolvedShare().live, seminarOwnerMembershipId: "member-c" } }));
    db.teamMembership.findMany.mockResolvedValueOnce([membership("member-a"), membership("member-b")]);
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode })).resolves.toBeNull();

    db.partnerLiveShare.findFirst.mockResolvedValueOnce(resolvedShare());
    db.teamMembershipRelationship.findMany.mockResolvedValueOnce([]);
    await expect(resolveTeamFunnelLiveShare({ vendorId: "vendor-1", liveId: "live-a", shareCode })).resolves.toBeNull();
  });

  it("revokes one target promoter link without affecting other shares", async () => {
    await expect(disableTeamFunnelLiveShare({ teamId: "team-1", pageId: "page-a", promoterMembershipId: "member-b" }))
      .resolves.toEqual({ pageId: "page-a", liveId: "live-a", promoterMembershipId: "member-b", isEnabled: false });
    expect(db.partnerLiveShare.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ liveId: "live-a", sourcePageId: "page-a", promoterMembershipId: "member-b", isEnabled: true }),
      data: { isEnabled: false },
    }));
  });

  it("reports an unavailable share when disable has no enabled row", async () => {
    db.partnerLiveShare.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(disableTeamFunnelLiveShare({ teamId: "team-1", pageId: "page-a", promoterMembershipId: "member-b" }))
      .rejects.toBeInstanceOf(TeamFunnelLiveShareUnavailableError);
  });
});
