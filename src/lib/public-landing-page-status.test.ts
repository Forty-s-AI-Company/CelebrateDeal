import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("tests inject the database"); } }));

import { defaultFunnelOperations } from "./funnel-operations";
import { createFunnelFlow } from "./funnel-flow";
import { createFunnelStepPages } from "./funnel-step-pages";
import { publicFunnelRouteStatus, publicLandingPageStatus } from "./public-landing-page-status";

const visitor = "synthetic-visitor-1234567890";
const legacy = { schemaVersion: 1, data: { root: {}, content: [] } };
const funnel = () => createFunnelStepPages(createFunnelFlow({ id: "fixture", name: "合成", goal: "audience", domain: "fixture" })!)!;
const publishedAt = new Date("2026-09-13T00:00:00.000Z");

const findMany = vi.fn();
const count = vi.fn();
const database = { landingPage: { findMany }, registrationForm: { count } } as never;

function candidate(overrides: Record<string, unknown> = {}, version: Record<string, unknown> = {}) {
  return {
    id: "page-1", vendorId: "vendor-1", projectId: "project-1", publishedAt, operations: null,
    publishedVersion: { vendorId: "vendor-1", pageId: "page-1", content: legacy, formId: null, liveId: null, live: null, ...version },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  findMany.mockResolvedValue([candidate()]);
  count.mockResolvedValue(0);
});

describe("public pre-stream status", () => {
  it.each(["/lp/", "/lp/a/b/c", "/lp/%zz", "/lp/a/%zz", "/other/a", "/lp/not%20a%20slug"])("rejects malformed path %s before a database read", async (path) => {
    expect(await publicLandingPageStatus(path, visitor, database)).toBe(404);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("looks up only by public slug with both publication layers and no presentation data", async () => {
    expect(await publicLandingPageStatus("/lp/Fall-Launch", visitor, database)).toBe(200);
    expect(findMany).toHaveBeenCalledTimes(1);
    const query = findMany.mock.calls[0]?.[0];
    expect(query.where).toEqual({ slug: "fall-launch", status: "published", publishedVersionId: { not: null }, project: { is: { status: "published", publishedAt: { not: null } } } });
    expect(query.take).toBe(2);
    expect(Object.keys(query.select.publishedVersion.select).sort()).toEqual(["content", "formId", "live", "liveId", "pageId", "vendorId"]);
    expect(Object.keys(query.select.publishedVersion.select.live.select).sort()).toEqual(["formId", "projectId", "status", "vendorId"]);
    expect(count).not.toHaveBeenCalled();
  });

  it("returns 404 for an unpublished project or Funnel and for an ambiguous slug", async () => {
    findMany.mockResolvedValueOnce([]);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(404);
    findMany.mockResolvedValueOnce([candidate(), candidate({ id: "page-2" })]);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(404);
  });

  it("rejects a published version that belongs to another page or tenant", async () => {
    findMany.mockResolvedValueOnce([candidate({}, { vendorId: "vendor-2" })]);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(404);
    findMany.mockResolvedValueOnce([candidate({}, { pageId: "page-2" })]);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(404);
    findMany.mockResolvedValueOnce([candidate({ publishedAt: null })]);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(404);
    findMany.mockResolvedValueOnce([candidate({}, { content: { broken: true } })]);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(404);
  });

  it("returns 404 when a referenced registration form is disabled or outside the project", async () => {
    findMany.mockResolvedValue([candidate({}, { formId: "form-1" })]);
    count.mockResolvedValueOnce(0);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(404);
    expect(count).toHaveBeenCalledWith({ where: { id: { in: ["form-1"] }, vendorId: "vendor-1", projectId: "project-1", isActive: true } });
    count.mockResolvedValueOnce(1);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(200);
  });

  it("returns 404 for a bound live that is not public or not bound to the same form", async () => {
    const live = { vendorId: "vendor-1", projectId: "project-1", status: "scheduled", formId: "form-1" };
    count.mockResolvedValue(1);
    findMany.mockResolvedValueOnce([candidate({}, { formId: "form-1", liveId: "live-1", live })]);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(200);
    findMany.mockResolvedValueOnce([candidate({}, { formId: "form-1", liveId: "live-1", live: { ...live, status: "draft" } })]);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(404);
    findMany.mockResolvedValueOnce([candidate({}, { formId: "form-1", liveId: "live-1", live: { ...live, projectId: "project-2" } })]);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(404);
    findMany.mockResolvedValueOnce([candidate({}, { formId: "form-1", liveId: "live-1", live: null })]);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(404);
  });

  it("accepts a legacy root but not a step path on legacy content", async () => {
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(200);
    expect(await publicLandingPageStatus("/lp/example/no-step", visitor, database)).toBe(404);
  });

  it("serves the first public Funnel step and an existing step path", async () => {
    const content = funnel();
    const first = content.flow.steps.find((step) => !step.isSystem)!;
    findMany.mockResolvedValue([candidate({}, { content })]);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(200);
    expect(await publicLandingPageStatus(`/lp/example/${first.path}`, visitor, database)).toBe(200);
  });

  it("returns 404 for a nonexistent or system step", async () => {
    const content = funnel();
    findMany.mockResolvedValue([candidate({}, { content })]);
    expect(await publicLandingPageStatus("/lp/example/unknown-step", visitor, database)).toBe(404);
    const system = content.flow.steps.find((step) => step.isSystem)!;
    expect(await publicLandingPageStatus(`/lp/example/${system.path}`, visitor, database)).toBe(404);
  });

  it("returns 404 for invalid Funnel operations, matching the runtime", async () => {
    findMany.mockResolvedValue([candidate({ operations: { invalid: true } }, { content: funnel() })]);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(404);
  });

  it("keeps a closed deadline at 200 so the route renders its closed notice", async () => {
    const operations = { ...defaultFunnelOperations(), deadline: { enabled: true, timezone: "Asia/Taipei", expiresAt: "2020-01-01T00:00:00+08:00", behavior: "closed", redirectPath: "" } };
    findMany.mockResolvedValue([candidate({ operations }, { content: funnel() })]);
    expect(await publicLandingPageStatus("/lp/example", visitor, database)).toBe(200);
  });

  it("propagates an infrastructure failure for a distinct 503 response", async () => {
    findMany.mockRejectedValue(new Error("synthetic-read-failure"));
    await expect(publicLandingPageStatus("/lp/example", visitor, database)).rejects.toThrow("synthetic-read-failure");
  });
});

describe("public Funnel route decision", () => {
  it("requires a valid visitor identifier like the runtime", () => {
    expect(publicFunnelRouteStatus({ pageId: "page-1", content: funnel(), operations: null, visitorId: "short" })).toBe(404);
    expect(publicFunnelRouteStatus({ pageId: "page-1", content: funnel(), operations: null, visitorId: visitor })).toBe(200);
  });

  it("returns 404 when the first public step has no page document", () => {
    const content = funnel();
    const first = content.flow.steps.find((step) => !step.isSystem)!;
    const pages = { ...content.pages };
    delete pages[first.id];
    expect(publicFunnelRouteStatus({ pageId: "page-1", content: { ...content, pages }, operations: null, visitorId: visitor })).toBe(404);
  });
});
