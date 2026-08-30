import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db, resolveShare } = vi.hoisted(() => ({
  db: {
    affiliate: { findFirst: vi.fn() },
    affiliateClick: { findFirst: vi.fn() },
    partnerFunnelPage: { findFirst: vi.fn() },
    live: { findFirst: vi.fn() },
    teamMembership: { findMany: vi.fn() },
    teamMembershipRelationship: { findMany: vi.fn() },
    teamClickAttribution: { upsert: vi.fn() },
    teamLeadAttribution: { upsert: vi.fn() },
  },
  resolveShare: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/team-funnel-live-sharing", () => ({ resolveTeamFunnelLiveShare: resolveShare }));

import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_TTL_SECONDS,
  attributionCookieFromRequest,
  attributionCookieOptions,
  encodeAttributionCookie,
  liveShareCodeFromRequest,
  normalizeReferralCode,
  recordClickAttribution,
  recordLeadAttribution,
  referralCodeFromRequest,
  resolveReferral,
  resolveTeamFunnelAttribution,
  sourcePageSlugFromRequest,
  visitorIdFromRequest,
} from "@/lib/team-funnel-attribution";

const attribution = {
  vendorId: "vendor-1",
  teamId: "team-1",
  sourcePageId: "page-a",
  templateVersionId: "version-a",
  promoterMembershipId: "member-b",
  leadOwnerMembershipId: "member-b",
  leaderMembershipId: "member-a",
  contentOwnerMembershipId: "member-a",
  webinarOwnerMembershipId: "member-a",
  referralCode: "B-CODE",
  source: "REFERRAL" as const,
};

function publicPage(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-a",
    teamId: "team-1",
    templateVersionId: "version-a",
    promoterMembershipId: "member-a",
    contentOwnerMembershipId: "member-a",
    sharing: { accessMode: "PUBLIC", isEnabled: true, expiresAt: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "source-attribution-test-secret-over-32-bytes");
  db.affiliate.findFirst.mockResolvedValue({ id: "affiliate-b" });
  db.affiliateClick.findFirst.mockResolvedValue(null);
  db.partnerFunnelPage.findFirst.mockResolvedValue(publicPage());
  db.live.findFirst.mockResolvedValue({ seminarOwnerMembershipId: "member-a" });
  db.teamMembership.findMany.mockResolvedValue([{ id: "member-a", affiliateId: "affiliate-a" }, { id: "member-b", affiliateId: "affiliate-b" }]);
  db.teamMembershipRelationship.findMany.mockResolvedValue([{ uplineMembershipId: "member-a", downlineMembershipId: "member-b" }]);
  resolveShare.mockResolvedValue(attribution);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("team funnel attribution source attribution", () => {
  it("normalizes referral clues and ignores oversized or empty codes", () => {
    expect(normalizeReferralCode("  b-code ")).toBe("B-CODE");
    expect(normalizeReferralCode("")).toBeNull();
    expect(normalizeReferralCode("a".repeat(81))).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
  });

  it("extracts referral clues from the request URL or same request headers", () => {
    expect(referralCodeFromRequest(new Request("https://app.example.test/live?ref=b-code"))).toBe("B-CODE");
    expect(referralCodeFromRequest(new Request("https://app.example.test/live", { headers: { referer: "https://app.example.test/?ref=header-code" } }))).toBe("HEADER-CODE");
    expect(referralCodeFromRequest(new Request("https://app.example.test/live", { headers: { referer: "not-a-url" } }))).toBeNull();
  });

  it("accepts only safe source-page and Live-share clues from trusted origins", () => {
    const share = "tls1.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012";
    expect(sourcePageSlugFromRequest(new Request("https://app.example.test/live?sourcePage=Summer-Offer"))).toBe("summer-offer");
    expect(sourcePageSlugFromRequest(new Request("https://app.example.test/live?sourcePage=bad_slug"))).toBeNull();
    expect(sourcePageSlugFromRequest(new Request("https://app.example.test/live", { headers: { referer: "https://app.example.test/funnel/summer-offer" } }))).toBe("summer-offer");
    expect(sourcePageSlugFromRequest(new Request("https://app.example.test/live", { headers: { referer: "https://attacker.example.test/funnel/summer-offer" } }))).toBeNull();

    expect(liveShareCodeFromRequest(new Request(`https://app.example.test/live?share=${share}`))).toBe(share);
    expect(liveShareCodeFromRequest(new Request("https://app.example.test/live?share=bad"))).toBeNull();
    expect(liveShareCodeFromRequest(new Request(`https://app.example.test/live?share=tls1.${"a".repeat(156)}`))).toBeNull();
    expect(liveShareCodeFromRequest(new Request("https://app.example.test/live", { headers: { referer: `https://app.example.test/live?share=${share}` } }))).toBe(share);
    expect(liveShareCodeFromRequest(new Request("https://app.example.test/live", { headers: { referer: `https://attacker.example.test/live?share=${share}` } }))).toBeNull();
  });

  it("validates visitor and attribution cookies with TTL and malformed input boundaries", () => {
    const now = Date.parse("2026-08-07T00:00:00Z");
    const visitor = "visitor-12345678901234567890";
    const encoded = encodeURIComponent(visitor);
    expect(visitorIdFromRequest(new Request("https://app.example.test", { headers: { cookie: `celebratedeal_visitor=${encoded}` } }))).toBe(visitor);
    expect(visitorIdFromRequest(new Request("https://app.example.test", { headers: { cookie: "celebratedeal_visitor=short" } }))).toMatch(/^[0-9a-f-]{36}$/u);

    const value = { clickId: "click-1", visitorId: visitor, issuedAt: now - 1000 };
    const token = encodeAttributionCookie(value);
    const valid = new Request("https://app.example.test", { headers: { cookie: `${ATTRIBUTION_COOKIE}=${token}` } });
    expect(token).toMatch(/^ta1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
    expect(attributionCookieFromRequest(valid, now)).toEqual(value);
    expect(attributionCookieFromRequest(new Request("https://app.example.test", { headers: { cookie: `${ATTRIBUTION_COOKIE}=not-json` } }), now)).toBeNull();
    expect(attributionCookieFromRequest(new Request("https://app.example.test", { headers: { cookie: `${ATTRIBUTION_COOKIE}=%E0%A4%A` } }), now)).toBeNull();
    expect(attributionCookieFromRequest(new Request("https://app.example.test", { headers: { cookie: `${ATTRIBUTION_COOKIE}=${encodeAttributionCookie({ ...value, issuedAt: now + 1 })}` } }), now)).toBeNull();
    expect(attributionCookieFromRequest(new Request("https://app.example.test", { headers: { cookie: `${ATTRIBUTION_COOKIE}=${encodeAttributionCookie({ ...value, issuedAt: now - (ATTRIBUTION_TTL_SECONDS * 1000 + 1) })}` } }), now)).toBeNull();
  });

  it("rejects unsigned, tampered and differently signed attribution cookies", () => {
    const now = Date.parse("2026-08-07T00:00:00Z");
    const value = { clickId: "click-1", visitorId: "visitor-12345678901234567890", issuedAt: now };
    const token = encodeAttributionCookie(value);
    const [version, payload, signature] = token.split(".");
    const tamperedPayload = `${payload?.startsWith("A") ? "B" : "A"}${payload?.slice(1)}`;
    const tamperedSignature = `${signature?.startsWith("A") ? "B" : "A"}${signature?.slice(1)}`;
    const parse = (cookieValue: string) => attributionCookieFromRequest(new Request("https://app.example.test", {
      headers: { cookie: `${ATTRIBUTION_COOKIE}=${cookieValue}` },
    }), now);

    expect(parse(Buffer.from(JSON.stringify(value)).toString("base64url"))).toBeNull();
    expect(parse(`${version}.${tamperedPayload}.${signature}`)).toBeNull();
    expect(parse(`${version}.${payload}.${tamperedSignature}`)).toBeNull();

    vi.stubEnv("CSRF_SECRET", "different-source-attribution-secret-over-32-bytes");
    expect(parse(token)).toBeNull();
  });

  it("fails closed when the signing key is unavailable", () => {
    const now = Date.parse("2026-08-07T00:00:00Z");
    const token = encodeAttributionCookie({ clickId: "click-1", visitorId: "visitor-12345678901234567890", issuedAt: now });
    vi.stubEnv("CSRF_SECRET", "");
    vi.stubEnv("JOB_SECRET", "");

    expect(attributionCookieFromRequest(new Request("https://app.example.test", {
      headers: { cookie: `${ATTRIBUTION_COOKIE}=${token}` },
    }), now)).toBeNull();
  });

  it("sets secure cookie options according to the request origin", () => {
    expect(attributionCookieOptions(new Request("https://app.example.test"))).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax", maxAge: ATTRIBUTION_TTL_SECONDS });
    expect(attributionCookieOptions(new Request("http://127.0.0.1:31023"))).toMatchObject({ secure: false, path: "/" });
  });

  it("resolves query, cookie and legacy referral sources with fail-closed fallbacks", async () => {
    await expect(resolveReferral({ vendorId: "vendor-1", queryCode: " query-code ", cookie: null })).resolves.toMatchObject({ code: "QUERY-CODE", source: "query" });
    expect(db.affiliateClick.findFirst).not.toHaveBeenCalled();

    db.affiliateClick.findFirst.mockResolvedValueOnce({ referralCode: "COOKIE-CODE", affiliateId: "affiliate-b" });
    await expect(resolveReferral({ vendorId: "vendor-1", cookie: { clickId: "click-1", visitorId: "visitor-1", issuedAt: Date.now() } })).resolves.toMatchObject({ code: "COOKIE-CODE", source: "cookie" });

    db.affiliateClick.findFirst.mockResolvedValueOnce(null);
    await expect(resolveReferral({ vendorId: "vendor-1", legacyCode: " legacy-code ", cookie: { clickId: "missing", visitorId: "visitor-1", issuedAt: Date.now() } })).resolves.toMatchObject({ code: "LEGACY-CODE", source: "legacy" });

    db.affiliate.findFirst.mockResolvedValueOnce(null);
    await expect(resolveReferral({ vendorId: "vendor-1", legacyCode: "unknown", cookie: null })).resolves.toBeNull();
  });

  it("delegates a valid Live share clue before public-page lookup and handles empty live ids", async () => {
    const now = new Date("2026-08-07T00:00:00Z");
    await expect(resolveTeamFunnelAttribution({ vendorId: "vendor-1", liveId: "live-a", sourcePageSlug: null, referral: null, liveShareCode: "tls1.synthetic", now })).resolves.toEqual(attribution);
    expect(resolveShare).toHaveBeenCalledWith({ vendorId: "vendor-1", liveId: "live-a", shareCode: "tls1.synthetic", now });
    expect(db.partnerFunnelPage.findFirst).not.toHaveBeenCalled();

    await expect(resolveTeamFunnelAttribution({ vendorId: "vendor-1", liveId: null, sourcePageSlug: "page", referral: null })).resolves.toBeNull();
    expect(resolveShare).toHaveBeenCalledOnce();
  });

  it("returns the existing owner when no referral membership matches and rejects missing live data", async () => {
    const existing = await resolveTeamFunnelAttribution({ vendorId: "vendor-1", liveId: "live-a", sourcePageSlug: "page-a", referral: null });
    expect(existing).toMatchObject({ promoterMembershipId: "member-a", leadOwnerMembershipId: "member-a", source: "EXISTING_OWNER", referralCode: null });

    db.live.findFirst.mockResolvedValueOnce(null);
    await expect(resolveTeamFunnelAttribution({ vendorId: "vendor-1", liveId: "live-a", sourcePageSlug: "page-a", referral: null })).resolves.toBeNull();

    db.teamMembership.findMany.mockResolvedValueOnce([{ id: "member-b", affiliateId: "affiliate-b" }]);
    await expect(resolveTeamFunnelAttribution({ vendorId: "vendor-1", liveId: "live-a", sourcePageSlug: "page-a", referral: null })).resolves.toBeNull();
  });

  it("records click and lead attribution only when a resolved attribution exists", async () => {
    await recordClickAttribution("click-1", null);
    await recordLeadAttribution("form-1", null);
    expect(db.teamClickAttribution.upsert).not.toHaveBeenCalled();
    expect(db.teamLeadAttribution.upsert).not.toHaveBeenCalled();

    await recordClickAttribution("click-1", attribution);
    await recordLeadAttribution("form-1", attribution);
    expect(db.teamClickAttribution.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId_affiliateClickId: { vendorId: "vendor-1", affiliateClickId: "click-1" } }, update: {} }));
    expect(db.teamLeadAttribution.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { formSubmissionId: "form-1" }, update: {} }));
  });
});
