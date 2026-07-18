import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";

const { claimTeamFunnelShare } = vi.hoisted(() => ({
  claimTeamFunnelShare: vi.fn(),
}));

vi.mock("@/lib/team-funnel-sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team-funnel-sharing")>()),
  claimTeamFunnelShare,
}));

import { POST } from "@/app/api/team-funnel/copies/route";
import {
  TeamFunnelShareConflictError,
  TeamFunnelShareUnavailableError,
} from "@/lib/team-funnel-sharing";

const shareCode = "test-fixture-share-code-12345678901234567890";
const payload = {
  teamId: "team-1",
  shareCode,
  mode: "QUICK_APPLY" as const,
  slug: "claimed-page",
};
const claimedCopy = {
  page: { id: "page-1", slug: "claimed-page" },
  duplicate: false,
  mode: "QUICK_APPLY" as const,
  source: { pageId: "source-page-1", templateId: "template-1", templateVersionId: "version-1", version: 1 },
  fieldModes: { HEADLINE: "editable" },
};

function copiesRequest(body: unknown = payload, headers: Record<string, string> = {}) {
  return new Request("https://app.example.test/api/team-funnel/copies", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  claimTeamFunnelShare.mockReset();
  claimTeamFunnelShare.mockResolvedValue(claimedCopy);
});

describe("POST /api/team-funnel/copies", () => {
  it.each([
    ["a cross-origin request", { origin: "https://attacker.example.test" }, { error: "Invalid request origin" }],
    ["a request without the trusted client header", { "x-celebratedeal-client": "" }, { error: "Missing trusted client header" }],
  ])("returns 403 for %s before attempting a claim", async (_description, headers, body) => {
    const response = await POST(copiesRequest(payload, headers));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(body);
    expect(claimTeamFunnelShare).not.toHaveBeenCalled();
  });

  it("accepts a same-origin request from the trusted client", async () => {
    const response = await POST(copiesRequest());

    expect(response.status).toBe(201);
    expect(claimTeamFunnelShare).toHaveBeenCalledWith(payload);
  });

  it("returns 400 for an invalid payload without attempting a claim", async () => {
    const response = await POST(copiesRequest({ ...payload, slug: "not a valid slug" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(claimTeamFunnelShare).not.toHaveBeenCalled();
  });

  it.each([
    "QUICK_APPLY",
    "COPY_THEN_EDIT",
    "BLANK_PAGE_BOUND_TO_A_WEBINAR",
  ] as const)("returns 201 when the %s copy mode is claimed for the first time", async (mode) => {
    const input = { ...payload, mode, slug: `claimed-${mode.toLowerCase().replaceAll("_", "-")}` };
    const data = { ...claimedCopy, mode, page: { id: `page-${mode.toLowerCase()}`, slug: input.slug } };
    claimTeamFunnelShare.mockResolvedValueOnce(data);

    const response = await POST(copiesRequest(input));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data });
    expect(claimTeamFunnelShare).toHaveBeenCalledWith(input);
  });

  it("returns 200 when the same share has already been claimed", async () => {
    const duplicate = { ...claimedCopy, duplicate: true, page: { id: "page-existing", slug: "existing-page" } };
    claimTeamFunnelShare.mockResolvedValueOnce(duplicate);

    const response = await POST(copiesRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: duplicate });
  });

  it.each([
    ["access denial", new TeamFunnelAccessDeniedError("tenant_mismatch")],
    ["an unavailable share", new TeamFunnelShareUnavailableError()],
  ])("maps %s to the generic 404 response", async (_description, error) => {
    claimTeamFunnelShare.mockRejectedValueOnce(error);

    const response = await POST(copiesRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_SHARE_NOT_FOUND" } });
  });

  it("maps a slug conflict to its 409 error code", async () => {
    claimTeamFunnelShare.mockRejectedValueOnce(new TeamFunnelShareConflictError("test-fixture-slug-conflict"));

    const response = await POST(copiesRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_SHARE_CONFLICT" } });
  });

  it("maps unexpected errors to 500 without exposing details", async () => {
    claimTeamFunnelShare.mockRejectedValueOnce(new Error("test-fixture-unexpected-error"));

    const response = await POST(copiesRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_COPY_WRITE_FAILED" } });
  });
});
