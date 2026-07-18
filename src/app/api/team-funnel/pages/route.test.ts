import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";
import { TeamFunnelConflictError } from "@/lib/team-funnel-pages";

const { copyTeamFunnelTemplateVersion, createTeamFunnelOriginalPage } = vi.hoisted(() => ({
  copyTeamFunnelTemplateVersion: vi.fn(),
  createTeamFunnelOriginalPage: vi.fn(),
}));

vi.mock("@/lib/team-funnel-pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team-funnel-pages")>()),
  copyTeamFunnelTemplateVersion,
  createTeamFunnelOriginalPage,
}));

import { POST } from "@/app/api/team-funnel/pages/route";

const createPayload = {
  action: "create" as const,
  teamId: "team-1",
  name: "Original page",
  slug: "original-page",
  content: {
    headline: "A headline",
    subheadline: "A subheadline",
    body: "A body",
    ctaLabel: "Buy now",
    ctaUrl: "https://example.test/checkout",
  },
  lockedFields: ["HEADLINE"] as const,
};
const copyPayload = {
  action: "copy" as const,
  teamId: "team-1",
  templateVersionId: "version-1",
  slug: "copied-page",
};
const createdPage = { template: { id: "template-1" }, page: { id: "page-1" } };
const copiedPage = { page: { id: "page-2" }, duplicate: false };

function pagesRequest(payload: unknown = createPayload, headers: Record<string, string> = {}) {
  return new Request("https://app.example.test/api/team-funnel/pages", {
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
  createTeamFunnelOriginalPage.mockResolvedValue(createdPage);
  copyTeamFunnelTemplateVersion.mockResolvedValue(copiedPage);
});

describe("POST /api/team-funnel/pages", () => {
  it.each([
    ["a cross-origin request", { origin: "https://attacker.example.test" }, { error: "Invalid request origin" }],
    ["a request without the trusted client header", { "x-celebratedeal-client": "" }, { error: "Missing trusted client header" }],
  ])("returns 403 for %s before calling page services", async (_description, headers, body) => {
    const response = await POST(pagesRequest(createPayload, headers));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(body);
    expect(createTeamFunnelOriginalPage).not.toHaveBeenCalled();
    expect(copyTeamFunnelTemplateVersion).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid payload without calling page services", async () => {
    const response = await POST(pagesRequest({ ...createPayload, slug: "not a slug" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(createTeamFunnelOriginalPage).not.toHaveBeenCalled();
    expect(copyTeamFunnelTemplateVersion).not.toHaveBeenCalled();
  });

  it("creates an original page with a 201 response", async () => {
    const response = await POST(pagesRequest());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: createdPage });
    expect(createTeamFunnelOriginalPage).toHaveBeenCalledWith(createPayload);
    expect(copyTeamFunnelTemplateVersion).not.toHaveBeenCalled();
  });

  it("copies a template version with a 200 response", async () => {
    const response = await POST(pagesRequest(copyPayload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: copiedPage });
    expect(copyTeamFunnelTemplateVersion).toHaveBeenCalledWith(copyPayload);
    expect(createTeamFunnelOriginalPage).not.toHaveBeenCalled();
  });

  it("maps access denial to an indistinguishable 404 response", async () => {
    copyTeamFunnelTemplateVersion.mockRejectedValue(new TeamFunnelAccessDeniedError("tenant_mismatch"));

    const response = await POST(pagesRequest(copyPayload));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_NOT_FOUND" } });
  });

  it("maps resource conflicts to 409", async () => {
    createTeamFunnelOriginalPage.mockRejectedValue(new TeamFunnelConflictError("test-fixture-slug-conflict"));

    const response = await POST(pagesRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_CONFLICT" } });
  });

  it("maps unexpected errors to 500 without exposing their details", async () => {
    createTeamFunnelOriginalPage.mockRejectedValue(new Error("test-fixture-unexpected-error"));

    const response = await POST(pagesRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_WRITE_FAILED" } });
  });
});
