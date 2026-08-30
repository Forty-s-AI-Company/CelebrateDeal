import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn(), roleFindMany: vi.fn(), getCsrfToken: vi.fn(), importAction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ interactionRole: { findMany: mocks.roleFindMany } }) }));
vi.mock("@/app/actions", () => ({ importSystemRolesAction: mocks.importAction }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="csrfToken" value="synthetic" /> }));
vi.mock("@/components/interaction-roles-workbench", () => ({ InteractionRolesWorkbench: ({ roles, csrfToken, error }: { roles: unknown; csrfToken: string; error?: string | null }) => <div data-testid="roles-workbench">{JSON.stringify({ roles, csrfToken, error })}</div> }));
vi.mock("@/components/ui", () => ({ PageHeader: ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => <header><h1>{title}</h1><p>{description}</p>{action}</header> }));

import NewInteractionRolePage from "./page";

beforeEach(() => { vi.clearAllMocks(); mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" }); mocks.roleFindMany.mockResolvedValue([{ id: "role-1", name: "主持人" }]); mocks.getCsrfToken.mockResolvedValue("csrf-token"); });

describe("/interaction-roles/new route", () => {
  it("loads existing vendor roles for the new-role workbench", async () => { const html = renderToStaticMarkup(await NewInteractionRolePage({})); expect(mocks.roleFindMany).toHaveBeenCalledWith({ where: { vendorId: "vendor-1" }, orderBy: { createdAt: "desc" } }); expect(html).toContain("建立可重複使用的官方互動角色"); expect(html).toContain("匯入 10 個官方角色"); expect(html).toContain("role-1"); expect(html).toContain("csrf-token"); });
  it("keeps the new-role page deterministic when the vendor has no roles", async () => { mocks.roleFindMany.mockResolvedValue([]); const html = renderToStaticMarkup(await NewInteractionRolePage({})); expect(html).toContain('&quot;roles&quot;:[]'); expect(html).toContain("csrf-token"); });
  it("forwards a missing-role recovery state", async () => { const html = renderToStaticMarkup(await NewInteractionRolePage({ searchParams: Promise.resolve({ error: "missing_role" }) })); expect(html).toContain('&quot;error&quot;:&quot;missing_role&quot;'); });
});
