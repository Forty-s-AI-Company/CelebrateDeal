import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }), requireVendorManager: vi.fn(), roleFindMany: vi.fn(), roleFindFirst: vi.fn(), getCsrfToken: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ interactionRole: { findMany: mocks.roleFindMany, findFirst: mocks.roleFindFirst } }) }));
vi.mock("@/components/interaction-roles-workbench", () => ({ InteractionRolesWorkbench: ({ roles, selectedRole, csrfToken }: { roles: unknown; selectedRole: unknown; csrfToken: string }) => <div data-testid="roles-workbench">{JSON.stringify({ roles, selectedRole, csrfToken })}</div> }));
vi.mock("@/components/ui", () => ({ PageHeader: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));

import EditInteractionRolePage from "./page";

beforeEach(() => { vi.clearAllMocks(); mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" }); mocks.roleFindMany.mockResolvedValue([{ id: "role-1", name: "主持人" }]); mocks.roleFindFirst.mockResolvedValue({ id: "role-2", vendorId: "vendor-1", name: "AI 助手", type: "assistant" }); mocks.getCsrfToken.mockResolvedValue("csrf-token"); });

describe("/interaction-roles/[id]/edit route", () => {
  it("scopes both list and selected role to the vendor", async () => { const html = renderToStaticMarkup(await EditInteractionRolePage({ params: Promise.resolve({ id: "role-2" }) })); expect(mocks.roleFindMany).toHaveBeenCalledWith({ where: { vendorId: "vendor-1" }, orderBy: { createdAt: "desc" } }); expect(mocks.roleFindFirst).toHaveBeenCalledWith({ where: { id: "role-2", vendorId: "vendor-1" } }); expect(html).toContain("點選左側使用者"); expect(html).toContain("role-2"); expect(html).toContain("csrf-token"); });
  it("fails closed when a selected role is missing", async () => { mocks.roleFindFirst.mockResolvedValue(null); await expect(EditInteractionRolePage({ params: Promise.resolve({ id: "missing" }) })).rejects.toThrow("NOT_FOUND"); expect(mocks.notFound).toHaveBeenCalledExactlyOnceWith(); });
});
