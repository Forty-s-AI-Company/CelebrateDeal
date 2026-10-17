import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), runtime: vi.fn() }));
vi.mock("@/lib/landing-page-service", () => ({ loadPublicLandingPage: mocks.load }));
vi.mock("@/lib/funnel-runtime", () => ({ resolvePublicFunnelRuntime: mocks.runtime }));
import { publicLandingPageStatus } from "./public-landing-page-status";
import { createFunnelFlow } from "./funnel-flow";
import { createFunnelStepPages } from "./funnel-step-pages";
const visitor = "synthetic-visitor-1234567890";
beforeEach(() => { vi.resetAllMocks(); });
describe("public pre-stream status", () => {
  it.each(["/lp/", "/lp/a/b/c", "/lp/%zz", "/other/a"])("rejects malformed path %s before a database read", async (path) => {
    expect(await publicLandingPageStatus(path, visitor)).toBe(404);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("retains the existing public loader eligibility checks, without presentation enrichment", async () => {
    mocks.load.mockResolvedValue(null);
    expect(await publicLandingPageStatus("/lp/unpublished", visitor)).toBe(404);
    expect(mocks.load).toHaveBeenCalledWith("unpublished", undefined, false);
  });
  it("accepts a legacy root but not a nonexistent legacy step", async () => {
    mocks.load.mockResolvedValue({ id: "page-1", content: { schemaVersion: 1, data: { root: {}, content: [] } } });
    expect(await publicLandingPageStatus("/lp/example", visitor)).toBe(200);
    expect(await publicLandingPageStatus("/lp/example/no-step", visitor)).toBe(404);
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it.each(["render", "closed", "redirect", "unavailable"])("mirrors runtime %s without recording visits", async (status) => {
    const content = createFunnelStepPages(createFunnelFlow({ id: "fixture", name: "合成", goal: "audience", domain: "fixture" })!)!;
    mocks.load.mockResolvedValue({ id: "page-1", content });
    mocks.runtime.mockResolvedValue({ decision: { status, renderedStepId: "opt_in", path: "thank-you" } });
    expect(await publicLandingPageStatus("/lp/example/opt-in", visitor)).toBe(status === "unavailable" ? 404 : 200);
    expect(mocks.runtime).toHaveBeenCalledWith({ pageId: "page-1", requestedStepId: "opt_in", visitorId: visitor });
  });
  it("rejects nonexistent and system steps", async () => {
    const content = createFunnelStepPages(createFunnelFlow({ id: "fixture", name: "合成", goal: "audience", domain: "fixture" })!)!;
    mocks.load.mockResolvedValue({ id: "page-1", content });
    expect(await publicLandingPageStatus("/lp/example/unknown", visitor)).toBe(404);
    const system = content.flow.steps.find((step) => step.isSystem)!;
    expect(await publicLandingPageStatus(`/lp/example/${system.path}`, visitor)).toBe(404);
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it("propagates an infrastructure failure for a distinct 503 response", async () => {
    mocks.load.mockRejectedValue(new Error("synthetic-read-failure"));
    await expect(publicLandingPageStatus("/lp/example", visitor)).rejects.toThrow("synthetic-read-failure");
  });
});
