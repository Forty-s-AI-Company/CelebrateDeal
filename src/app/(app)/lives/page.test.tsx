import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn(), prefFindUnique: vi.fn(), liveFindMany: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: async () => ({ auth: { user: { id: "user-1" } }, vendor: await mocks.requireVendorManager() }) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ userOnboardingPreference: { findUnique: mocks.prefFindUnique }, live: { findMany: mocks.liveFindMany } }) }));

import LivesPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.prefFindUnique.mockResolvedValue({ selectedProjectId: "project-1", selectedProject: { id: "project-1", name: "原型食物", status: "active" } });
  mocks.liveFindMany.mockResolvedValue([]);
});

describe("/lives route", () => {
  it("scopes the list to the current vendor", async () => {
    await LivesPage();
    expect(mocks.liveFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1" } }));
  });

  it("links to a project-agnostic create page so a stale tab cannot bind or 404 the new live", async () => {
    const html = renderToStaticMarkup(await LivesPage());
    expect(html).toContain('href="/lives/new"');
    expect(html).not.toContain("projectId");
    expect(mocks.prefFindUnique).not.toHaveBeenCalled();
  });
});
