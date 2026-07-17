import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  vendor: { findUnique: vi.fn() },
  live: { findFirst: vi.fn() },
  affiliate: { findFirst: vi.fn() },
  affiliateClick: { create: vi.fn(), findFirst: vi.fn() },
  partnerFunnelPage: { findFirst: vi.fn() },
  teamMembership: { findMany: vi.fn() },
  teamMembershipRelationship: { findMany: vi.fn() },
  teamClickAttribution: { upsert: vi.fn() },
};

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { POST } from "@/app/api/affiliate-clicks/route";

function request(payload: Record<string, unknown>, url = "https://app.example.test/api/affiliate-clicks") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.example.test", referer: "https://app.example.test/funnel/a-page", "x-celebratedeal-client": "web" },
    body: JSON.stringify({ vendorId: "vendor-1", liveId: "live-a", visitorId: "client-spoofed", landingPath: "/live/a", ...payload }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.vendor.findUnique.mockResolvedValue({ id: "vendor-1" });
  db.live.findFirst.mockResolvedValue({ id: "live-a", seminarOwnerMembershipId: "member-a" });
  db.affiliate.findFirst.mockResolvedValue({ id: "affiliate-a" });
  db.affiliateClick.create.mockResolvedValue({ id: "click-1" });
  db.partnerFunnelPage.findFirst.mockResolvedValue({
    id: "page-a", teamId: "team-1", templateVersionId: "version-a", promoterMembershipId: "member-a", contentOwnerMembershipId: "member-a",
  });
  db.teamMembership.findMany.mockResolvedValue([{ id: "member-a", affiliateId: "affiliate-a" }]);
  db.teamMembershipRelationship.findMany.mockResolvedValue([]);
  db.teamClickAttribution.upsert.mockResolvedValue({ id: "team-click-1" });
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
  });

  it("keeps legacy unknown-code clicks but does not create ownership attribution", async () => {
    db.affiliate.findFirst.mockResolvedValue(null);
    const response = await POST(request({ referralCode: "unknown", ownerId: "attacker" }));

    expect(response.status).toBe(200);
    expect(db.affiliateClick.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ affiliateId: null, referralCode: "UNKNOWN" }) }));
    expect(db.teamClickAttribution.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ promoterMembershipId: "member-a", source: "EXISTING_OWNER", referralCode: null }),
    }));
    expect(response.headers.getSetCookie().join("\n")).not.toContain("celebratedeal_attribution=");
  });

  it("does not accept a foreign page slug as a cross-tenant ownership claim", async () => {
    db.partnerFunnelPage.findFirst.mockResolvedValue(null);
    await POST(request({ referralCode: "a-code", ownerId: "foreign-page" }));

    expect(db.teamClickAttribution.upsert).not.toHaveBeenCalled();
  });
});
