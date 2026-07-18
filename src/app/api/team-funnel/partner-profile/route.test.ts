import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";
import { TeamFunnelPartnerProfileError } from "@/lib/team-funnel-product-slots";

const { getTeamFunnelPartnerProfile } = vi.hoisted(() => ({
  getTeamFunnelPartnerProfile: vi.fn(),
}));

vi.mock("@/lib/team-funnel-product-slots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team-funnel-product-slots")>()),
  getTeamFunnelPartnerProfile,
}));

import { POST } from "@/app/api/team-funnel/partner-profile/route";

const validPayload = { action: "get", teamId: "team-1", pageId: "page-1" };
const profile = {
  pageId: "page-1",
  vendorId: "vendor-1",
  teamId: "team-1",
  mode: "course" as const,
  webinarOwnerMembershipId: "member-1",
  registrationPromoterMembershipId: "member-2",
  leadOwnerMembershipId: "member-2",
  clickAttribution: {
    pageId: "page-1",
    vendorId: "vendor-1",
    teamId: "team-1",
    leaderMembershipId: "member-1",
    promoterMembershipId: "member-2",
    contentOwnerMembershipId: "member-1",
    seminarOwnerMembershipId: "member-1",
  },
  conversionAttribution: {
    pageId: "page-1",
    vendorId: "vendor-1",
    teamId: "team-1",
    leaderMembershipId: "member-1",
    promoterMembershipId: "member-2",
    contentOwnerMembershipId: "member-1",
    seminarOwnerMembershipId: "member-1",
  },
};

function partnerProfileRequest(payload: unknown = validPayload, headers: Record<string, string> = {}) {
  return new Request("https://app.example.test/api/team-funnel/partner-profile", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getTeamFunnelPartnerProfile.mockResolvedValue(profile);
});

describe("POST /api/team-funnel/partner-profile", () => {
  it.each([
    ["a cross-origin request", { origin: "https://attacker.example.test" }, { error: "Invalid request origin" }],
    ["a request without the trusted client header", { "x-celebratedeal-client": "" }, { error: "Missing trusted client header" }],
  ])("returns 403 for %s before calling the profile service", async (_description, headers, body) => {
    const response = await POST(partnerProfileRequest(validPayload, headers));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(body);
    expect(getTeamFunnelPartnerProfile).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid payload without calling the profile service", async () => {
    const response = await POST(partnerProfileRequest({ action: "get", teamId: "team-1" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(getTeamFunnelPartnerProfile).not.toHaveBeenCalled();
  });

  it("returns the partner profile", async () => {
    const response = await POST(partnerProfileRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: profile });
    expect(getTeamFunnelPartnerProfile).toHaveBeenCalledWith(validPayload);
  });

  it("maps access denial to 404 without disclosing whether the profile exists", async () => {
    getTeamFunnelPartnerProfile.mockRejectedValue(new TeamFunnelAccessDeniedError("missing_resource"));

    const response = await POST(partnerProfileRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_NOT_FOUND" } });
  });

  it("maps partner profile conflicts to 409", async () => {
    getTeamFunnelPartnerProfile.mockRejectedValue(new TeamFunnelPartnerProfileError());

    const response = await POST(partnerProfileRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_INVALID_PARTNER_PROFILE" } });
  });

  it("maps unexpected errors to 500", async () => {
    getTeamFunnelPartnerProfile.mockRejectedValue(new Error("test-fixture-unexpected-error"));

    const response = await POST(partnerProfileRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_PROFILE_READ_FAILED" } });
  });
});
