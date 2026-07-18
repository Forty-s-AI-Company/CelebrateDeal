import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";

const {
  createTeamFunnelTemplateProductSlot,
  resolvePersistedTeamFunnelProductSlots,
  upsertTeamFunnelPartnerProductSlotOverride,
} = vi.hoisted(() => ({
  createTeamFunnelTemplateProductSlot: vi.fn(),
  resolvePersistedTeamFunnelProductSlots: vi.fn(),
  upsertTeamFunnelPartnerProductSlotOverride: vi.fn(),
}));

vi.mock("@/lib/team-funnel-product-slots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team-funnel-product-slots")>()),
  createTeamFunnelTemplateProductSlot,
  resolvePersistedTeamFunnelProductSlots,
  upsertTeamFunnelPartnerProductSlotOverride,
}));

import { POST } from "@/app/api/team-funnel/product-slots/route";
import {
  TeamFunnelInvalidProductSlotError,
  TeamFunnelInvalidProductUrlError,
  TeamFunnelPartnerProfileError,
  TeamFunnelProductSlotConflictError,
} from "@/lib/team-funnel-product-slots";

const templatePayload = {
  action: "set-template-default" as const,
  teamId: "team-1",
  templateVersionId: "version-1",
  slotKey: "main_product" as const,
  productId: "product-1",
  offerLabel: "Starter offer",
};
const overridePayload = {
  action: "set-override" as const,
  teamId: "team-1",
  pageId: "page-1",
  slotKey: "bundle_product" as const,
  overrideUrl: "https://shop.example.test/offer",
};
const resolvePayload = { action: "resolve" as const, teamId: "team-1", pageId: "page-1" };

const createdSlot = { id: "slot-1", ...templatePayload };
const override = { id: "override-1", pageId: overridePayload.pageId, productSlotId: "slot-2" };
const resolvedSlots = { profile: { pageId: resolvePayload.pageId }, slots: [] };

function productSlotsRequest(payload: unknown = templatePayload, headers: Record<string, string> = {}) {
  return new Request("https://app.example.test/api/team-funnel/product-slots", {
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
  expect(createTeamFunnelTemplateProductSlot).not.toHaveBeenCalled();
  expect(upsertTeamFunnelPartnerProductSlotOverride).not.toHaveBeenCalled();
  expect(resolvePersistedTeamFunnelProductSlots).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  createTeamFunnelTemplateProductSlot.mockResolvedValue(createdSlot);
  upsertTeamFunnelPartnerProductSlotOverride.mockResolvedValue(override);
  resolvePersistedTeamFunnelProductSlots.mockResolvedValue(resolvedSlots);
});

describe("POST /api/team-funnel/product-slots", () => {
  it.each([
    ["a cross-origin request", { origin: "https://attacker.example.test" }, { error: "Invalid request origin" }],
    ["a request without the trusted client header", { "x-celebratedeal-client": "" }, { error: "Missing trusted client header" }],
  ])("returns 403 for %s before calling product-slot services", async (_description, headers, body) => {
    const response = await POST(productSlotsRequest(templatePayload, headers));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(body);
    expectNoServiceCalls();
  });

  it.each([
    ["set-template-default", { ...templatePayload, productId: "" }],
    ["set-override", { ...overridePayload, productId: null, overrideUrl: null }],
    ["resolve", { action: "resolve", teamId: "team-1" }],
  ])("returns 400 when the %s payload is invalid", async (_action, payload) => {
    const response = await POST(productSlotsRequest(payload));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_REQUEST" } });
    expectNoServiceCalls();
  });

  it("creates a template default slot with a 201 response", async () => {
    const response = await POST(productSlotsRequest(templatePayload));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: createdSlot });
    expect(createTeamFunnelTemplateProductSlot).toHaveBeenCalledWith(templatePayload);
    expect(upsertTeamFunnelPartnerProductSlotOverride).not.toHaveBeenCalled();
    expect(resolvePersistedTeamFunnelProductSlots).not.toHaveBeenCalled();
  });

  it("upserts a partner product-slot override with a 200 response", async () => {
    const response = await POST(productSlotsRequest(overridePayload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: override });
    expect(upsertTeamFunnelPartnerProductSlotOverride).toHaveBeenCalledWith(overridePayload);
    expect(createTeamFunnelTemplateProductSlot).not.toHaveBeenCalled();
    expect(resolvePersistedTeamFunnelProductSlots).not.toHaveBeenCalled();
  });

  it("resolves persisted product slots with a 200 response", async () => {
    const response = await POST(productSlotsRequest(resolvePayload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: resolvedSlots });
    expect(resolvePersistedTeamFunnelProductSlots).toHaveBeenCalledWith(resolvePayload);
    expect(createTeamFunnelTemplateProductSlot).not.toHaveBeenCalled();
    expect(upsertTeamFunnelPartnerProductSlotOverride).not.toHaveBeenCalled();
  });

  it("maps access denial to an indistinguishable 404 response", async () => {
    createTeamFunnelTemplateProductSlot.mockRejectedValue(new TeamFunnelAccessDeniedError("missing_resource"));

    const response = await POST(productSlotsRequest(templatePayload));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_NOT_FOUND" } });
  });

  it.each([
    ["an invalid product URL", overridePayload, new TeamFunnelInvalidProductUrlError(), "TEAM_FUNNEL_INVALID_PRODUCT_URL"],
    ["an invalid product slot", templatePayload, new TeamFunnelInvalidProductSlotError(), "TEAM_FUNNEL_INVALID_PRODUCT_SLOT"],
  ])("maps %s to its 400 error code", async (_description, payload, error, code) => {
    if (payload.action === "set-override") upsertTeamFunnelPartnerProductSlotOverride.mockRejectedValueOnce(error);
    else createTeamFunnelTemplateProductSlot.mockRejectedValueOnce(error);

    const response = await POST(productSlotsRequest(payload));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code } });
  });

  it.each([
    ["a duplicate template slot", templatePayload, new TeamFunnelProductSlotConflictError(), "TEAM_FUNNEL_PRODUCT_SLOT_CONFLICT"],
    ["an invalid partner profile", resolvePayload, new TeamFunnelPartnerProfileError(), "TEAM_FUNNEL_INVALID_PARTNER_PROFILE"],
  ])("maps %s to its 409 error code", async (_description, payload, error, code) => {
    if (payload.action === "resolve") resolvePersistedTeamFunnelProductSlots.mockRejectedValueOnce(error);
    else createTeamFunnelTemplateProductSlot.mockRejectedValueOnce(error);

    const response = await POST(productSlotsRequest(payload));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code } });
  });

  it("maps unexpected errors to 500 without exposing their details", async () => {
    resolvePersistedTeamFunnelProductSlots.mockRejectedValue(new Error("test-fixture-unexpected-error"));

    const response = await POST(productSlotsRequest(resolvePayload));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "TEAM_FUNNEL_PRODUCT_SLOT_WRITE_FAILED" } });
  });
});
