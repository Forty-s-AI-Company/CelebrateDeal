import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn(), roleFindMany: vi.fn(), productFindMany: vi.fn(), getCsrfToken: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ interactionRole: { findMany: mocks.roleFindMany }, product: { findMany: mocks.productFindMany } }) }));
vi.mock("@/components/ui", () => ({ PageHeader: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));
vi.mock("@/components/interaction-script-form", () => ({ InteractionScriptForm: (props: Record<string, unknown>) => <div data-testid="interaction-script-form">{JSON.stringify(props)}</div> }));

import NewInteractionScriptPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.roleFindMany.mockResolvedValue([{ id: "role-1", name: "主持人", isActive: true }]);
  mocks.productFindMany.mockResolvedValue([{ id: "product-1", name: "主打課程", isActive: true }]);
  mocks.getCsrfToken.mockResolvedValue("csrf-token");
});

describe("/interaction-scripts/new route", () => {
  it("loads active roles/products for the current vendor and forwards an error state", async () => {
    const html = renderToStaticMarkup(await NewInteractionScriptPage({ searchParams: Promise.resolve({ error: "invalid_event" }) }));

    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.roleFindMany).toHaveBeenCalledWith({ where: { vendorId: "vendor-1", isActive: true } });
    expect(mocks.productFindMany).toHaveBeenCalledWith({ where: { vendorId: "vendor-1", isActive: true, fulfillmentTypeConfirmed: true } });
    expect(mocks.getCsrfToken).toHaveBeenCalledExactlyOnceWith();
    expect(html).toContain("新增互動腳本");
    expect(html).toContain("invalid_event");
    expect(html).toContain("csrf-token");
    expect(html).toContain("role-1");
    expect(html).toContain("product-1");
  });

  it("preserves an absent error as undefined while returning empty option lists", async () => {
    mocks.roleFindMany.mockResolvedValue([]);
    mocks.productFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await NewInteractionScriptPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("新增互動腳本");
    expect(html).toContain("roles");
    expect(html).toContain("products");
    expect(html).not.toContain("error");
  });
});
