import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  scope: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.auth }));
vi.mock("@/lib/sales-project-scope", () => ({ getSalesProjectScope: mocks.scope }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ landingPage: { findMany: mocks.findMany } }) }));

import { listLandingPages } from "./landing-page-service";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ auth: { user: { id: "user-1" } }, vendor: { id: "vendor-1" } });
  mocks.scope.mockResolvedValue({ projectId: "project-1", projectName: "Launch", isAggregate: false, isLegacyWorkspace: false });
  mocks.findMany.mockResolvedValue([]);
});

describe("listLandingPages", () => {
  it("derives vendor and selected project from the server session", async () => {
    await listLandingPages();
    expect(mocks.scope).toHaveBeenCalledWith("user-1", "vendor-1");
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1", projectId: "project-1" },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    }));
  });

  it("uses vendor-wide read-only scope when the selected project is aggregate", async () => {
    mocks.scope.mockResolvedValue({ projectId: null, projectName: null, isAggregate: true, isLegacyWorkspace: false });
    await listLandingPages();
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1" } }));
  });

  it("returns only the stable management projection", async () => {
    const updatedAt = new Date("2026-09-21T00:00:00.000Z");
    mocks.findMany.mockResolvedValue([{ id: "page-1", name: "Launch", slug: "launch", status: "draft", revision: 3, publishedAt: null, updatedAt, draftContent: { secret: true } }]);
    const result = await listLandingPages();
    expect(result.pages).toEqual([{ id: "page-1", name: "Launch", slug: "launch", status: "draft", revision: 3, publishedAt: null, updatedAt }]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
