import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ manager: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.manager }));

import { getLandingPageStepTemplatePreview, instantiateLandingPageStepTemplate, LandingPageTemplateNotFoundError } from "./landing-page-template-service";
import { listFunnelTemplateGallery } from "./funnel-template-gallery";

const templateId = listFunnelTemplateGallery("audience", "opt_in_page")[0]!.id;
const ok = { goal: "audience", stepType: "opt_in_page", templateId };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.manager.mockResolvedValue({ auth: { user: { id: "u1", emailVerifiedAt: null }, member: { role: "owner" } }, vendor: { id: "v1" } });
});

describe("step template picker service", () => {
  it("requires a vendor manager before any document is built", async () => {
    mocks.manager.mockRejectedValue(new Error("synthetic authorization denial"));
    await expect(getLandingPageStepTemplatePreview(ok)).rejects.toThrow("synthetic authorization denial");
    await expect(instantiateLandingPageStepTemplate({ ...ok, pageId: "p" })).rejects.toThrow("synthetic authorization denial");
  });

  it("returns the documents for an offered template", async () => {
    expect((await getLandingPageStepTemplatePreview(ok)).root.length).toBeGreaterThan(0);
    expect((await instantiateLandingPageStepTemplate({ ...ok, pageId: "p" })).id).toBe("p");
  });

  it("answers an unknown or incompatible template the same way as a missing one", async () => {
    for (const bad of [{ ...ok, templateId: "nope" }, { ...ok, stepType: "thank_you_page" }, { ...ok, goal: "webinar" }]) {
      await expect(getLandingPageStepTemplatePreview(bad)).rejects.toBeInstanceOf(LandingPageTemplateNotFoundError);
      await expect(instantiateLandingPageStepTemplate({ ...bad, pageId: "p" })).rejects.toBeInstanceOf(LandingPageTemplateNotFoundError);
    }
  });
});
