import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTeamFunnelLiveShare: vi.fn(),
  disableTeamFunnelLiveShare: vi.fn(),
}));

vi.mock("@/lib/team-funnel-live-sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team-funnel-live-sharing")>()),
  createTeamFunnelLiveShare: mocks.createTeamFunnelLiveShare,
  disableTeamFunnelLiveShare: mocks.disableTeamFunnelLiveShare,
}));

import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";
import {
  TeamFunnelLiveShareConflictError,
  TeamFunnelLiveShareUnavailableError,
} from "@/lib/team-funnel-live-sharing";
import { POST } from "@/app/api/team-funnel/live-shares/route";

const createPayload = { action: "create" as const, teamId: "team-1", pageId: "page-a", promoterMembershipId: "member-b" };
const disablePayload = { action: "disable" as const, teamId: "team-1", pageId: "page-a", promoterMembershipId: "member-b" };

function request(payload: unknown, headers: Record<string, string> = {}) {
  return new Request("https://app.example.test/api/team-funnel/live-shares", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.example.test", "x-celebratedeal-client": "web", ...headers },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTeamFunnelLiveShare.mockResolvedValue({ shareUrl: "/live/webinar-a?share=tls1.fixture", shareCode: "tls1.fixture" });
  mocks.disableTeamFunnelLiveShare.mockResolvedValue({ pageId: "page-a", liveId: "live-a", promoterMembershipId: "member-b", isEnabled: false });
});

describe("POST /api/team-funnel/live-shares", () => {
  it("rejects cross-origin requests before the service", async () => {
    const response = await POST(request(createPayload, { origin: "https://attacker.example.test" }));
    expect(response.status).toBe(403);
    expect(mocks.createTeamFunnelLiveShare).not.toHaveBeenCalled();
  });

  it("creates a dedicated share link", async () => {
    const response = await POST(request(createPayload));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: expect.objectContaining({ shareUrl: "/live/webinar-a?share=tls1.fixture" }) });
    expect(mocks.createTeamFunnelLiveShare).toHaveBeenCalledWith(createPayload);
  });

  it("disables a target share", async () => {
    const response = await POST(request(disablePayload));
    expect(response.status).toBe(200);
    expect(mocks.disableTeamFunnelLiveShare).toHaveBeenCalledWith(disablePayload);
  });

  it.each([
    [new TeamFunnelAccessDeniedError("missing_resource"), 404, "TEAM_FUNNEL_NOT_FOUND"],
    [new TeamFunnelLiveShareUnavailableError(), 404, "TEAM_FUNNEL_LIVE_SHARE_NOT_FOUND"],
    [new TeamFunnelLiveShareConflictError(), 409, "TEAM_FUNNEL_LIVE_SHARE_CONFLICT"],
  ])("maps a domain error without exposing details", async (error, status, code) => {
    mocks.createTeamFunnelLiveShare.mockRejectedValue(error);
    const response = await POST(request(createPayload));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
  });
});
