import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn(), roleFindMany: vi.fn(), getCsrfToken: vi.fn(), importAction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ interactionRole: { findMany: mocks.roleFindMany } }) }));
vi.mock("@/app/actions", () => ({ importSystemRolesAction: mocks.importAction }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="csrfToken" value="synthetic" /> }));
vi.mock("@/components/interaction-roles-workbench", () => ({ InteractionRolesWorkbench: ({ roles, csrfToken }: { roles: unknown; csrfToken: string }) => <div data-testid="roles-workbench">{JSON.stringify({ roles, csrfToken })}</div> }));
vi.mock("@/components/ui", () => ({ PageHeader: ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => <header><h1>{title}</h1><p>{description}</p>{action}</header> }));

import InteractionRolesPage from "./page";

beforeEach(() => { vi.clearAllMocks(); mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" }); mocks.roleFindMany.mockResolvedValue([{ id: "role-1", vendorId: "vendor-1", name: "主持人", type: "official" }]); mocks.getCsrfToken.mockResolvedValue("csrf-token"); });

describe("/interaction-roles route", () => {
  it("scopes roles and forwards CSRF data to the workbench", async () => {
    const html = renderToStaticMarkup(await InteractionRolesPage());
    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith(); expect(mocks.roleFindMany).toHaveBeenCalledWith({ where: { vendorId: "vendor-1" }, orderBy: { createdAt: "desc" } }); expect(mocks.getCsrfToken).toHaveBeenCalledExactlyOnceWith(); expect(html).toContain("互動角色"); expect(html).toContain("匯入 10 個官方角色"); expect(html).toContain("role-1"); expect(html).toContain("csrf-token");
  });

  it("renders an empty workbench without inventing roles", async () => { mocks.roleFindMany.mockResolvedValue([]); const html = renderToStaticMarkup(await InteractionRolesPage()); expect(html).toContain('&quot;roles&quot;:[]'); });
});
