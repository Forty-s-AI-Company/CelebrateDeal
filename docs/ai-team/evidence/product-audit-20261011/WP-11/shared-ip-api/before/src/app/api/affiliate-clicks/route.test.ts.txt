import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  vendor: { findUnique: vi.fn() },
  live: { findFirst: vi.fn() },
  affiliate: { findFirst: vi.fn() },
  affiliateClick: { create: vi.fn(), findFirst: vi.fn() },
  partnerLiveShare: { findFirst: vi.fn() },
  partnerFunnelPage: { findFirst: vi.fn() },
  teamMembership: { findMany: vi.fn() },
  teamMembershipRelationship: { findMany: vi.fn() },
  teamClickAttribution: { upsert: vi.fn() },
};

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { POST } from "@/app/api/affiliate-clicks/route";

function request(payload: Record<string, unknown>, url = "https://app.example.test/api/affiliate-clicks", headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.example.test", referer: "https://app.example.test/funnel/a-page", "x-celebratedeal-client": "web", ...headers },
    body: JSON.stringify({ vendorId: "vendor-1", liveId: "live-a", visitorId: "client-spoofed", landingPath: "/live/a", ...payload }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "affiliate-click-route-test-secret-over-32-bytes");
  db.vendor.findUnique.mockResolvedValue({ id: "vendor-1" });
  db.live.findFirst.mockResolvedValue({ id: "live-a", seminarOwnerMembershipId: "member-a" });
  db.affiliate.findFirst.mockResolvedValue({ id: "affiliate-a" });
  db.affiliateClick.create.mockResolvedValue({ id: "click-1" });
  db.partnerFunnelPage.findFirst.mockResolvedValue({
    id: "page-a", teamId: "team-1", templateVersionId: "version-a", promoterMembershipId: "member-a", contentOwnerMembershipId: "member-a",
    sharing: { accessMode: "PUBLIC", isEnabled: true, expiresAt: null },
  });
  db.teamMembership.findMany.mockResolvedValue([{ id: "member-a", affiliateId: "affiliate-a" }]);
  db.teamMembershipRelationship.findMany.mockResolvedValue([]);
  db.teamClickAttribution.upsert.mockResolvedValue({ id: "team-click-1" });
  db.partnerLiveShare.findFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("affiliate click attribution", () => {
  it("records A self-promotion with a server visitor cookie and immutable source lineage", async () => {
    const response = await POST(request({ referralCode: "a-code", ownerId: "attacker" }));

    expect(response.status).toBe(200);
    expect(db.affiliateClick.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      affiliateId: "affiliate-a", visitorId: expect.not.stringMatching(/^client-spoofed$/), referralCode: "A-CODE",
    }) }));
    expect(db.teamClickAttribution.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ pageId: "page-a", promoterMembershipId: "member-a", source: "REFERRAL" }),
    }));
    const cookies = response.headers.getSetCookie();
    expect(cookies.join("\n")).toContain("HttpOnly");
    expect(cookies.join("\n")).toContain("SameSite=lax");
    expect(cookies.join("\n")).toMatch(/celebratedeal_attribution=ta1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}/u);
  });

  it("records the click but omits sticky attribution when signing is unavailable", async () => {
    vi.stubEnv("CSRF_SECRET", "");
    vi.stubEnv("JOB_SECRET", "");

    const response = await POST(request({ referralCode: "a-code" }));

    expect(response.status).toBe(200);
    expect(db.affiliateClick.create).toHaveBeenCalledOnce();
    expect(response.headers.getSetCookie().join("\n")).toContain("celebratedeal_visitor=");
    expect(response.headers.getSetCookie().join("\n")).not.toContain("celebratedeal_attribution=");
  });

  it("keeps a server-resolved page attribution when a legacy referral code is unknown", async () => {
    db.affiliate.findFirst.mockResolvedValue(null);
    const response = await POST(request({ referralCode: "unknown", ownerId: "attacker" }));

    expect(response.status).toBe(200);
    expect(db.affiliateClick.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ affiliateId: null, referralCode: "UNKNOWN" }) }));
    expect(db.teamClickAttribution.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ promoterMembershipId: "member-a", source: "EXISTING_OWNER", referralCode: null }),
    }));
    expect(response.headers.getSetCookie().join("\n")).toContain("celebratedeal_attribution=");
  });

  it("records a shared playback click with source-page lineage even without a referral code", async () => {
    const response = await POST(request({}, "https://app.example.test/api/affiliate-clicks?sourcePage=b-page"));

    expect(response.status).toBe(200);
    expect(db.affiliateClick.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ affiliateId: null, referralCode: null }),
    }));
    expect(db.teamClickAttribution.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ pageId: "page-a", source: "EXISTING_OWNER", referralCode: null }),
    }));
    expect(response.headers.getSetCookie().join("\n")).toContain("celebratedeal_attribution=");
  });

  it("sticks a verified Live-share promoter cookie for the later checkout", async () => {
    const shareCode = `tls1.${"a".repeat(43)}`;
    db.affiliate.findFirst.mockResolvedValue({ id: "affiliate-b" });
    db.live.findFirst.mockResolvedValue({ id: "live-a", quotaPolicy: { affiliateMode: "enabled" } });
    db.partnerLiveShare.findFirst.mockResolvedValue({
      vendorId: "vendor-1",
      teamId: "team-1",
      liveId: "live-a",
      sourcePageId: "page-a",
      promoterMembershipId: "member-b",
      expiresAt: null,
      isEnabled: true,
      sourcePage: {
        teamId: "team-1",
        liveId: "live-a",
        templateVersionId: "version-a",
        promoterMembershipId: "member-a",
        contentOwnerMembershipId: "member-a",
      },
      live: { teamId: "team-1", seminarOwnerMembershipId: "member-a", status: "live", replayEnabled: true },
    });
    db.teamMembership.findMany.mockResolvedValue([
      {
        id: "member-a",
        vendorId: "vendor-1",
        teamId: "team-1",
        vendorMemberId: "vendor-member-a",
        status: "ACTIVE",
        leftAt: null,
        vendorMember: { userId: "user-a", status: "active", deactivatedAt: null },
        affiliate: { code: "A-CODE", isActive: true },
      },
      {
        id: "member-b",
        vendorId: "vendor-1",
        teamId: "team-1",
        vendorMemberId: "vendor-member-b",
        status: "ACTIVE",
        leftAt: null,
        vendorMember: { userId: "user-b", status: "active", deactivatedAt: null },
        affiliate: { code: "B-CODE", isActive: true },
      },
    ]);
    db.teamMembershipRelationship.findMany.mockResolvedValue([{
      teamId: "team-1",
      uplineMembershipId: "member-a",
      downlineMembershipId: "member-b",
      effectiveAt: new Date("2026-01-01"),
      endedAt: null,
    }]);

    const response = await POST(request({ shareCode }));

    expect(response.status).toBe(200);
    expect(db.affiliateClick.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ affiliateId: "affiliate-b", referralCode: "B-CODE" }),
    }));
    expect(db.teamClickAttribution.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ promoterMembershipId: "member-b", source: "REFERRAL", referralCode: "B-CODE" }),
    }));
    expect(response.headers.getSetCookie().join("\n")).toContain("celebratedeal_attribution=");
  });

  it("uses the live default referral code when no legacy code is supplied", async () => {
    db.live.findFirst.mockResolvedValue({
      id: "live-a",
      seminarOwnerMembershipId: "member-a",
      quotaPolicy: { affiliateMode: "enabled", defaultAffiliateCode: "a-code" },
    });

    const response = await POST(request({}, "https://app.example.test/api/affiliate-clicks", { referer: "" }));

    expect(response.status).toBe(200);
    expect(db.affiliate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ code: "A-CODE", vendorId: "vendor-1", isActive: true }),
    }));
    expect(db.affiliateClick.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ affiliateId: "affiliate-a", referralCode: "A-CODE" }),
    }));
  });

  it("does not persist or cookie legacy attribution when the live policy disables it", async () => {
    db.live.findFirst.mockResolvedValue({
      id: "live-a",
      seminarOwnerMembershipId: "member-a",
      quotaPolicy: { affiliateMode: "disabled", defaultAffiliateCode: "a-code" },
    });

    const response = await POST(request({ referralCode: "a-code" }, "https://app.example.test/api/affiliate-clicks", { referer: "" }));

    expect(response.status).toBe(200);
    expect(db.affiliate.findFirst).not.toHaveBeenCalled();
    expect(db.affiliateClick.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ affiliateId: null, referralCode: null }),
    }));
    expect(response.headers.getSetCookie().join("\n")).not.toContain("celebratedeal_attribution=");
  });

  it("rejects a click that carries neither referral nor source-page lineage", async () => {
    const response = await POST(request({}, "https://app.example.test/api/affiliate-clicks", { referer: "" }));

    expect(response.status).toBe(400);
    expect(db.affiliateClick.create).not.toHaveBeenCalled();
  });

  it("does not accept a foreign page slug as a cross-tenant ownership claim", async () => {
    db.partnerFunnelPage.findFirst.mockResolvedValue(null);
    await POST(request({ referralCode: "a-code", ownerId: "foreign-page" }));

    expect(db.teamClickAttribution.upsert).not.toHaveBeenCalled();
  });

  it("rejects a live that is not in a public lifecycle", async () => {
    db.live.findFirst.mockResolvedValue(null);

    const response = await POST(request({ referralCode: "a-code" }));

    expect(response.status).toBe(404);
    expect(db.live.findFirst).toHaveBeenCalledWith({
      where: {
        id: "live-a",
        vendorId: "vendor-1",
        OR: [
          { status: { in: ["scheduled", "live"] } },
          { status: "ended", replayEnabled: true },
        ],
      },
      select: { id: true, quotaPolicy: true },
    });
    expect(db.affiliateClick.create).not.toHaveBeenCalled();
  });
});
