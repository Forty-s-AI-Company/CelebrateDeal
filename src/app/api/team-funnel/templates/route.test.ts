import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";
import { TeamFunnelConflictError } from "@/lib/team-funnel-pages";

const { publishTeamFunnelTemplateVersion } = vi.hoisted(() => ({
  publishTeamFunnelTemplateVersion: vi.fn(),
}));

vi.mock("@/lib/team-funnel-pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team-funnel-pages")>()),
  publishTeamFunnelTemplateVersion,
}));

import { POST } from "@/app/api/team-funnel/templates/route";

const payload = {
  action: "publish" as const,
  teamId: "team-1",
  templateId: "template-1",
  content: {
    headline: "A headline",
    subheadline: "A subheadline",
    body: "A body",
    ctaLabel: "Buy now",
    ctaUrl: "https://example.test/checkout",
  },
  lockedFields: ["HEADLINE"] as const,
  productSlots: [
    { slotKey: "main_product" as const, productId: "product-main", offerLabel: "主打方案" },
    { slotKey: "consultation" as const, productId: "product-consultation", offerLabel: null },
  ],
  sourcePage: {
    pageId: "source-page-1",
    slug: "summer-offer",
    webinarId: "live-1",
  },
};
const publishedVersion = {
  templateId: "template-1",
  version: { id: "version-2", version: 2 },
  fieldModes: { HEADLINE: "locked" },
};

function templatesRequest(body: unknown = payload, headers: Record<string, string> = {}) {
  return new Request("https://app.example.test/api/team-funnel/templates", {
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
  vi.clearAllMocks();
  publishTeamFunnelTemplateVersion.mockResolvedValue(publishedVersion);
});

describe("POST /api/team-funnel/templates", () => {
  it.each([
    ["a cross-origin request", { origin: "https://attacker.example.test" }, { error: "Invalid request origin" }],
    ["a request without the trusted client header", { "x-celebratedeal-client": "" }, { error: "Missing trusted client header" }],
  ])("returns 403 for %s before publishing a template version", async (_description, headers, body) => {
    const response = await POST(templatesRequest(payload, headers));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(body);
    expect(publishTeamFunnelTemplateVersion).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid payload without publishing a template version", async () => {
    const response = await POST(templatesRequest({ ...payload, templateId: "" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(publishTeamFunnelTemplateVersion).not.toHaveBeenCalled();
  });

  it("rejects duplicate product slots before publishing", async () => {
    const response = await POST(templatesRequest({
      ...payload,
      productSlots: [
        { slotKey: "main_product", productId: "product-main" },
        { slotKey: "main_product", productId: "product-backup" },
      ],
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(publishTeamFunnelTemplateVersion).not.toHaveBeenCalled();
  });

  it("rejects an invalid source-page slug before publishing", async () => {
    const response = await POST(templatesRequest({
      ...payload,
      sourcePage: { ...payload.sourcePage, slug: "Not A Safe Slug" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(publishTeamFunnelTemplateVersion).not.toHaveBeenCalled();
  });

  it("publishes a template version with a 201 response", async () => {
    const response = await POST(templatesRequest());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: publishedVersion });
    expect(publishTeamFunnelTemplateVersion).toHaveBeenCalledWith(payload);
  });

  it("rejects a legacy payload that omits product slots instead of silently clearing them", async () => {
    const legacyPayload = {
      action: payload.action,
      teamId: payload.teamId,
      templateId: payload.templateId,
      content: payload.content,
      lockedFields: payload.lockedFields,
    };
    const response = await POST(templatesRequest(legacyPayload));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(publishTeamFunnelTemplateVersion).not.toHaveBeenCalled();
  });

  it("normalizes blank optional labels and webinar IDs before publishing", async () => {
    const response = await POST(templatesRequest({
      ...payload,
      productSlots: [{ slotKey: "main_product", productId: "product-main", offerLabel: "   " }],
      sourcePage: { ...payload.sourcePage, webinarId: "   " },
    }));

    expect(response.status).toBe(201);
    expect(publishTeamFunnelTemplateVersion).toHaveBeenCalledWith({
      ...payload,
      productSlots: [{ slotKey: "main_product", productId: "product-main", offerLabel: null }],
      sourcePage: { ...payload.sourcePage, webinarId: null },
    });
  });

  it("maps access denial to an indistinguishable 404 response", async () => {
    publishTeamFunnelTemplateVersion.mockRejectedValue(new TeamFunnelAccessDeniedError("tenant_mismatch"));

    const response = await POST(templatesRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_NOT_FOUND" } });
  });

  it("maps resource conflicts to 409", async () => {
    publishTeamFunnelTemplateVersion.mockRejectedValue(new TeamFunnelConflictError("test-fixture-version-conflict"));

    const response = await POST(templatesRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_CONFLICT" } });
  });

  it("maps unexpected errors to 500 without exposing their details", async () => {
    publishTeamFunnelTemplateVersion.mockRejectedValue(new Error("test-fixture-unexpected-error"));

    const response = await POST(templatesRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_WRITE_FAILED" } });
  });
});
