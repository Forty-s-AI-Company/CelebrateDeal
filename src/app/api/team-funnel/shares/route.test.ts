import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";

const { createTeamFunnelShare, disableTeamFunnelShare } = vi.hoisted(() => ({
  createTeamFunnelShare: vi.fn(),
  disableTeamFunnelShare: vi.fn(),
}));

vi.mock("@/lib/team-funnel-sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team-funnel-sharing")>()),
  createTeamFunnelShare,
  disableTeamFunnelShare,
}));

import { POST } from "@/app/api/team-funnel/shares/route";
import { TeamFunnelShareConflictError } from "@/lib/team-funnel-sharing";

const createPayload = {
  action: "create" as const,
  teamId: "team-1",
  pageId: "page-1",
  maxUses: 5,
  audience: { type: "DIRECT_DOWNLINE" as const },
};
const disablePayload = { action: "disable" as const, teamId: "team-1", pageId: "page-1" };
const createdShare = {
  share: { id: "share-1", pageId: "page-1", expiresAt: null, maxUses: 5, isEnabled: true },
  shareCode: "test-fixture-share-code",
};
const disabledShare = { id: "share-1", pageId: "page-1", isEnabled: false };

function sharesRequest(payload: unknown = createPayload, headers: Record<string, string> = {}) {
  return new Request("https://app.example.test/api/team-funnel/shares", {
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

function expectNoServiceCalls() {
  expect(createTeamFunnelShare).not.toHaveBeenCalled();
  expect(disableTeamFunnelShare).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  createTeamFunnelShare.mockResolvedValue(createdShare);
  disableTeamFunnelShare.mockResolvedValue(disabledShare);
});

describe("POST /api/team-funnel/shares", () => {
  it.each([
    ["a cross-origin request", { origin: "https://attacker.example.test" }, { error: "Invalid request origin" }],
    ["a request without the trusted client header", { "x-celebratedeal-client": "" }, { error: "Missing trusted client header" }],
  ])("returns 403 for %s before calling share services", async (_description, headers, body) => {
    const response = await POST(sharesRequest(createPayload, headers));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(body);
    expectNoServiceCalls();
  });

  it("returns 400 for an invalid payload without calling share services", async () => {
    const response = await POST(sharesRequest({ ...createPayload, maxUses: 0 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_REQUEST" } });
    expectNoServiceCalls();
  });

  it("creates a share with a 201 response", async () => {
    const response = await POST(sharesRequest());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: createdShare });
    expect(createTeamFunnelShare).toHaveBeenCalledWith(createPayload);
    expect(disableTeamFunnelShare).not.toHaveBeenCalled();
  });

  it("disables a share with a 200 response", async () => {
    const response = await POST(sharesRequest(disablePayload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: disabledShare });
    expect(disableTeamFunnelShare).toHaveBeenCalledWith(disablePayload);
    expect(createTeamFunnelShare).not.toHaveBeenCalled();
  });

  it("maps access denial to an indistinguishable 404 response", async () => {
    disableTeamFunnelShare.mockRejectedValue(new TeamFunnelAccessDeniedError("missing_resource"));

    const response = await POST(sharesRequest(disablePayload));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_NOT_FOUND" } });
  });

  it("maps share conflicts to 409", async () => {
    createTeamFunnelShare.mockRejectedValue(new TeamFunnelShareConflictError("test-fixture-share-conflict"));

    const response = await POST(sharesRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_SHARE_CONFLICT" } });
  });

  it("maps unexpected errors to 500 without exposing their details", async () => {
    createTeamFunnelShare.mockRejectedValue(new Error("test-fixture-unexpected-error"));

    const response = await POST(sharesRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_SHARE_WRITE_FAILED" } });
  });
});
