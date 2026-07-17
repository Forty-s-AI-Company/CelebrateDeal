import { beforeEach, describe, expect, it, vi } from "vitest";

const owner = {
  id: "member-a", vendorId: "vendor-1", teamId: "team-1", vendorMemberId: "vendor-member-a", userId: "user-a",
  status: "ACTIVE" as const, leftAt: null, vendorMemberStatus: "active", vendorMemberDeactivatedAt: null,
};
const partner = { ...owner, id: "member-b", vendorMemberId: "vendor-member-b", userId: "user-b" };
const secondPartner = { ...owner, id: "member-c", vendorMemberId: "vendor-member-c", userId: "user-c" };
let currentActor = owner;
let existingPage: Record<string, unknown> | null = null;
let shareState: Record<string, unknown>;

const db = {
  $transaction: vi.fn(),
  teamMembership: { findFirst: vi.fn(), findMany: vi.fn() },
  teamMembershipRelationship: { findMany: vi.fn() },
  partnerFunnelPage: { findFirst: vi.fn(), create: vi.fn() },
  partnerFunnelPageShareSetting: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
};

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: currentActor.userId },
    member: { id: currentActor.vendorMemberId, status: "active", deactivatedAt: null },
  })),
  requireVendor: vi.fn(async () => ({ id: currentActor.vendorId })),
}));

import { POST as copiesPost } from "@/app/api/team-funnel/copies/route";
import {
  claimTeamFunnelShare,
  createTeamFunnelShare,
  disableTeamFunnelShare,
  hashShareCode,
  TeamFunnelShareUnavailableError,
} from "@/lib/team-funnel-sharing";

function membershipRecord(member: typeof owner) {
  return {
    id: member.id, vendorId: member.vendorId, teamId: member.teamId, vendorMemberId: member.vendorMemberId,
    status: member.status, leftAt: member.leftAt,
    vendorMember: { userId: member.userId, status: member.vendorMemberStatus, deactivatedAt: member.vendorMemberDeactivatedAt },
  };
}

function sourcePage(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-a", vendorId: "vendor-1", teamId: "team-1", templateVersionId: "version-a",
    promoterMembershipId: owner.id, contentOwnerMembershipId: owner.id, liveId: "live-a",
    headline: "A headline", subheadline: "A subheadline", body: "A body", ctaLabel: "Join", ctaUrl: "https://example.test/join",
    live: { id: "live-a", seminarOwnerMembershipId: owner.id },
    templateVersion: { templateId: "template-a", version: 3, fieldLocks: [{ field: "CTA_URL" }] },
    ...overrides,
  };
}

function setting(overrides: Record<string, unknown> = {}) {
  return {
    id: "share-a", pageId: "page-a", tokenHash: "hash", accessMode: "TOKEN_REQUIRED", isEnabled: true,
    expiresAt: null, maxUses: null, useCount: 0, ...overrides,
  };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`https://app.example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.example.test", "x-celebratedeal-client": "web" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentActor = owner;
  existingPage = null;
  shareState = setting();
  db.teamMembership.findFirst.mockImplementation(async () => membershipRecord(currentActor));
  db.teamMembership.findMany.mockResolvedValue([membershipRecord(owner), membershipRecord(partner)]);
  db.teamMembershipRelationship.findMany.mockResolvedValue([
    { teamId: "team-1", uplineMembershipId: owner.id, downlineMembershipId: partner.id, effectiveAt: new Date("2026-01-01"), endedAt: null },
  ]);
  db.partnerFunnelPage.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => args.where.id ? sourcePage() : existingPage);
  db.partnerFunnelPageShareSetting.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => {
    shareState = setting(args.create);
    return shareState;
  });
  db.partnerFunnelPageShareSetting.update.mockImplementation(async (args: { data: Record<string, unknown> }) => {
    shareState = { ...shareState, ...args.data };
    return shareState;
  });
  db.partnerFunnelPageShareSetting.updateMany.mockImplementation(async (args: { data: { useCount: { increment: number } } }) => {
    shareState = { ...shareState, useCount: Number(shareState.useCount) + args.data.useCount.increment };
    return { count: 1 };
  });
  db.partnerFunnelPageShareSetting.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    if (args.where.tokenHash) return { ...shareState, page: sourcePage() };
    return shareState;
  });
  db.partnerFunnelPage.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
    existingPage = { id: "page-b", ...args.data };
    return existingPage;
  });
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));
});

async function issueForPartner(audience: "DIRECT_DOWNLINE" | "MEMBER" = "DIRECT_DOWNLINE") {
  currentActor = owner;
  const result = await createTeamFunnelShare({
    teamId: "team-1", pageId: "page-a", audience: audience === "MEMBER" ? { type: "MEMBER", membershipId: partner.id } : { type: audience }, maxUses: 5,
  });
  currentActor = partner;
  return result.shareCode;
}

describe("team funnel sharing", () => {
  it("returns a share code only on creation and persists only its irreversible hash", async () => {
    const shareCode = await issueForPartner("MEMBER");

    expect(shareCode).toMatch(/^tf1\./);
    expect(db.partnerFunnelPageShareSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ tokenHash: hashShareCode(shareCode), accessMode: "TOKEN_REQUIRED" }),
    }));
    expect(JSON.stringify(db.partnerFunnelPageShareSetting.upsert.mock.calls)).not.toContain(shareCode);
  });

  it("accepts an allowed share, keeps A's ownership/locks/webinar lineage, and is idempotent", async () => {
    const shareCode = await issueForPartner();
    const first = await claimTeamFunnelShare({ teamId: "team-1", shareCode, mode: "QUICK_APPLY", slug: "partner-page" });
    const retry = await claimTeamFunnelShare({ teamId: "team-1", shareCode, mode: "QUICK_APPLY", slug: "another-slug" });

    expect(first).toMatchObject({ duplicate: false, source: { pageId: "page-a", templateVersionId: "version-a" }, fieldModes: { CTA_URL: "locked" } });
    expect(retry).toMatchObject({ duplicate: true, page: { id: "page-b" } });
    expect(db.partnerFunnelPage.create).toHaveBeenCalledOnce();
    expect(db.partnerFunnelPage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      promoterMembershipId: partner.id, contentOwnerMembershipId: owner.id, liveId: "live-a", templateVersionId: "version-a",
    }) }));
  });

  it("returns the existing copy with a non-created response on an idempotent route retry", async () => {
    const shareCode = await issueForPartner();
    const input = { teamId: "team-1", shareCode, mode: "QUICK_APPLY", slug: "partner-page" };

    expect((await copiesPost(jsonRequest("/api/team-funnel/copies", input))).status).toBe(201);
    expect((await copiesPost(jsonRequest("/api/team-funnel/copies", { ...input, slug: "ignored-on-retry" }))).status).toBe(200);
    expect(db.partnerFunnelPage.create).toHaveBeenCalledOnce();
  });

  it.each([
    ["QUICK_APPLY", "A headline", "Join"],
    ["COPY_THEN_EDIT", "A headline", "Join"],
    ["BLANK_PAGE_BOUND_TO_A_WEBINAR", "", ""],
  ] as const)("creates the %s copy mode with its webinar binding", async (mode, headline, ctaLabel) => {
    const shareCode = await issueForPartner();
    const result = await claimTeamFunnelShare({ teamId: "team-1", shareCode, mode, slug: `partner-${mode.toLowerCase()}` });

    expect(result).toMatchObject({ mode, duplicate: false });
    expect(db.partnerFunnelPage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ headline, ctaLabel, liveId: "live-a" }) }));
  });

  it("does not rebind an A copy to a webinar owned by somebody else", async () => {
    const shareCode = await issueForPartner();
    db.partnerFunnelPageShareSetting.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.tokenHash) return { ...shareState, page: sourcePage({ live: { id: "live-x", seminarOwnerMembershipId: partner.id } }) };
      return shareState;
    });
    await expect(claimTeamFunnelShare({ teamId: "team-1", shareCode, mode: "QUICK_APPLY", slug: "partner-page" }))
      .rejects.toMatchObject({ code: "TEAM_FUNNEL_SHARE_CONFLICT" });
  });

  it("rejects expired or disabled shares through the same unavailable response", async () => {
    const shareCode = await issueForPartner();
    shareState = setting({ expiresAt: new Date("2026-01-01") });
    await expect(claimTeamFunnelShare({ teamId: "team-1", shareCode, mode: "QUICK_APPLY", slug: "partner-page" }))
      .rejects.toBeInstanceOf(TeamFunnelShareUnavailableError);

    shareState = setting({ accessMode: "DISABLED", isEnabled: false });
    await expect(claimTeamFunnelShare({ teamId: "team-1", shareCode, mode: "QUICK_APPLY", slug: "partner-page" }))
      .rejects.toBeInstanceOf(TeamFunnelShareUnavailableError);
  });

  it("does not issue an additional copy after a usage-limited share is consumed", async () => {
    const shareCode = await issueForPartner();
    shareState = { ...shareState, maxUses: 1 };
    await claimTeamFunnelShare({ teamId: "team-1", shareCode, mode: "QUICK_APPLY", slug: "first-partner-page" });

    // This represents a distinct eligible B: the first B's existing copy must
    // not hide a failed usage-limit check for another B.
    existingPage = null;
    currentActor = secondPartner;
    db.teamMembership.findMany.mockResolvedValue([membershipRecord(owner), membershipRecord(partner), membershipRecord(secondPartner)]);
    db.teamMembershipRelationship.findMany.mockResolvedValue([
      { teamId: "team-1", uplineMembershipId: owner.id, downlineMembershipId: partner.id, effectiveAt: new Date("2026-01-01"), endedAt: null },
      { teamId: "team-1", uplineMembershipId: owner.id, downlineMembershipId: secondPartner.id, effectiveAt: new Date("2026-01-01"), endedAt: null },
    ]);

    await expect(claimTeamFunnelShare({ teamId: "team-1", shareCode, mode: "QUICK_APPLY", slug: "second-partner-page" }))
      .rejects.toBeInstanceOf(TeamFunnelShareUnavailableError);
    expect(db.partnerFunnelPage.create).toHaveBeenCalledOnce();
  });

  it("uses the sharing promoter's direct-downline relationship when page content is upstream-owned", async () => {
    currentActor = partner;
    const upstreamOwnedPage = sourcePage({ promoterMembershipId: partner.id, contentOwnerMembershipId: owner.id });
    db.teamMembership.findMany.mockResolvedValue([membershipRecord(owner), membershipRecord(partner), membershipRecord(secondPartner)]);
    db.teamMembershipRelationship.findMany.mockResolvedValue([
      { teamId: "team-1", uplineMembershipId: partner.id, downlineMembershipId: secondPartner.id, effectiveAt: new Date("2026-01-01"), endedAt: null },
    ]);
    db.partnerFunnelPage.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => args.where.id ? upstreamOwnedPage : existingPage);

    const { shareCode } = await createTeamFunnelShare({ teamId: "team-1", pageId: "page-a", audience: { type: "DIRECT_DOWNLINE" } });
    currentActor = secondPartner;
    db.partnerFunnelPageShareSetting.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.tokenHash) return { ...shareState, page: upstreamOwnedPage };
      return shareState;
    });

    await expect(claimTeamFunnelShare({ teamId: "team-1", shareCode, mode: "QUICK_APPLY", slug: "downline-page" }))
      .resolves.toMatchObject({ duplicate: false, page: { promoterMembershipId: secondPartner.id, contentOwnerMembershipId: owner.id } });
  });

  it("enforces the target member and hides cross-tenant source pages", async () => {
    const shareCode = await issueForPartner("MEMBER");
    currentActor = { ...owner, id: "member-c", vendorMemberId: "vendor-member-c", userId: "user-c" };
    db.teamMembership.findMany.mockResolvedValue([membershipRecord(owner), membershipRecord(partner), membershipRecord(currentActor)]);
    await expect(claimTeamFunnelShare({ teamId: "team-1", shareCode, mode: "QUICK_APPLY", slug: "partner-page" }))
      .rejects.toBeInstanceOf(TeamFunnelShareUnavailableError);

    currentActor = partner;
    db.partnerFunnelPageShareSetting.findFirst.mockResolvedValueOnce({ ...shareState, page: sourcePage({ vendorId: "vendor-foreign" }) });
    await expect(claimTeamFunnelShare({ teamId: "team-1", shareCode, mode: "QUICK_APPLY", slug: "partner-page" }))
      .rejects.toBeInstanceOf(TeamFunnelShareUnavailableError);
  });

  it("disables a share without returning its share code", async () => {
    const result = await disableTeamFunnelShare({ teamId: "team-1", pageId: "page-a" });
    expect(result).toEqual({ id: "share-a", pageId: "page-a", isEnabled: false });
    expect(db.partnerFunnelPageShareSetting.update).toHaveBeenCalledWith(expect.objectContaining({ data: { accessMode: "DISABLED", isEnabled: false } }));
  });

  it("uses the generic not-found response for a wrong member share-code claim route", async () => {
    const shareCode = await issueForPartner("MEMBER");
    currentActor = { ...owner, id: "member-c", vendorMemberId: "vendor-member-c", userId: "user-c" };
    db.teamMembership.findMany.mockResolvedValue([membershipRecord(owner), membershipRecord(partner), membershipRecord(currentActor)]);
    const response = await copiesPost(jsonRequest("/api/team-funnel/copies", { teamId: "team-1", shareCode, mode: "QUICK_APPLY", slug: "partner-page" }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_SHARE_NOT_FOUND" } });
  });
});
