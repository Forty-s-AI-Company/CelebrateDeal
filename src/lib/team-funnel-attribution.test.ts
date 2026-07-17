import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  affiliate: { findFirst: vi.fn() },
  affiliateClick: { findFirst: vi.fn() },
  partnerFunnelPage: { findFirst: vi.fn() },
  live: { findFirst: vi.fn() },
  teamMembership: { findMany: vi.fn() },
  teamMembershipRelationship: { findMany: vi.fn() },
  teamClickAttribution: { upsert: vi.fn() },
  teamLeadAttribution: { upsert: vi.fn() },
};

vi.mock("@/lib/db", () => ({ getDb: () => db }));

import {
  ATTRIBUTION_TTL_SECONDS,
  attributionCookieFromRequest,
  encodeAttributionCookie,
  resolveReferral,
  resolveTeamFunnelAttribution,
  sourcePageSlugFromRequest,
} from "@/lib/team-funnel-attribution";

beforeEach(() => {
  vi.clearAllMocks();
  db.affiliate.findFirst.mockResolvedValue({ id: "affiliate-b" });
});

describe("team funnel attribution", () => {
  it("uses a query referral before a valid older cookie", async () => {
    const referral = await resolveReferral({
      vendorId: "vendor-1",
      queryCode: "new-code",
      legacyCode: "legacy-code",
      cookie: { clickId: "click-old", visitorId: "visitor-old", issuedAt: Date.now() },
    });

    expect(referral).toMatchObject({ code: "NEW-CODE", source: "query" });
    expect(db.affiliateClick.findFirst).not.toHaveBeenCalled();
  });

  it("does not revive a cookie when the explicit query code is unknown", async () => {
    db.affiliate.findFirst.mockResolvedValue(null);
    const referral = await resolveReferral({
      vendorId: "vendor-1",
      queryCode: "unknown",
      cookie: { clickId: "click-old", visitorId: "visitor-old", issuedAt: Date.now() },
    });

    expect(referral).toBeNull();
    expect(db.affiliateClick.findFirst).not.toHaveBeenCalled();
  });

  it("only accepts a non-expired cookie that matches a server click and visitor", async () => {
    const now = new Date("2026-07-17T00:00:00Z");
    db.affiliateClick.findFirst.mockResolvedValue({ referralCode: "B-CODE", affiliateId: "affiliate-b" });
    const referral = await resolveReferral({
      vendorId: "vendor-1",
      cookie: { clickId: "click-1", visitorId: "visitor-1", issuedAt: now.getTime() },
      now,
    });

    expect(referral).toEqual({ code: "B-CODE", affiliateId: "affiliate-b", visitorId: "visitor-1", source: "cookie" });
    expect(db.affiliateClick.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "click-1", visitorId: "visitor-1" }),
    }));

    const expired = new Request("https://app.example.test/form", {
      headers: { cookie: `celebratedeal_attribution=${encodeAttributionCookie({ clickId: "old", visitorId: "visitor", issuedAt: now.getTime() - (ATTRIBUTION_TTL_SECONDS + 1) * 1000 })}` },
    });
    expect(attributionCookieFromRequest(expired, now.getTime())).toBeNull();
  });

  it("attributes B's promotion to B while retaining A's content and webinar ownership", async () => {
    db.partnerFunnelPage.findFirst.mockResolvedValue({
      id: "page-b", teamId: "team-1", templateVersionId: "version-a", promoterMembershipId: "member-b", contentOwnerMembershipId: "member-a",
    });
    db.live.findFirst.mockResolvedValue({ seminarOwnerMembershipId: "member-a" });
    db.teamMembership.findMany.mockResolvedValue([
      { id: "member-a", affiliateId: "affiliate-a" },
      { id: "member-b", affiliateId: "affiliate-b" },
    ]);
    db.teamMembershipRelationship.findMany.mockResolvedValue([{ uplineMembershipId: "member-a", downlineMembershipId: "member-b" }]);

    const attribution = await resolveTeamFunnelAttribution({
      vendorId: "vendor-1", liveId: "live-a", sourcePageSlug: "b-page",
      referral: { code: "B-CODE", affiliateId: "affiliate-b", visitorId: "visitor-1", source: "query" },
    });

    expect(attribution).toMatchObject({
      sourcePageId: "page-b", templateVersionId: "version-a", promoterMembershipId: "member-b", leadOwnerMembershipId: "member-b",
      contentOwnerMembershipId: "member-a", leaderMembershipId: "member-a", webinarOwnerMembershipId: "member-a", source: "REFERRAL",
    });
  });

  it("rejects a cross-tenant or mismatched public page before any ownership lookup", async () => {
    db.partnerFunnelPage.findFirst.mockResolvedValue(null);
    const attribution = await resolveTeamFunnelAttribution({
      vendorId: "vendor-1", liveId: "live-a", sourcePageSlug: "foreign-page",
      referral: { code: "B-CODE", affiliateId: "affiliate-b", visitorId: null, source: "legacy" },
    });

    expect(attribution).toBeNull();
    expect(db.live.findFirst).not.toHaveBeenCalled();
  });

  it("only derives a source page from the API origin", () => {
    const sameOrigin = new Request("https://app.example.test/api/form-submissions", {
      headers: { referer: "https://app.example.test/funnel/b-page?ref=B-CODE" },
    });
    const foreignOrigin = new Request("https://app.example.test/api/form-submissions", {
      headers: { referer: "https://attacker.example.test/funnel/b-page?ref=B-CODE" },
    });

    expect(sourcePageSlugFromRequest(sameOrigin)).toBe("b-page");
    expect(sourcePageSlugFromRequest(foreignOrigin)).toBeNull();
  });

  it("requires the source page to be bound to the submitted webinar", async () => {
    db.partnerFunnelPage.findFirst.mockResolvedValue(null);

    await resolveTeamFunnelAttribution({
      vendorId: "vendor-1", liveId: "live-a", sourcePageSlug: "b-page", referral: null,
    });

    expect(db.partnerFunnelPage.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1", liveId: "live-a", slug: "b-page" },
    }));
  });
});
