import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  requireVendorManager: vi.fn(), getCsrfToken: vi.fn(), scriptFindFirst: vi.fn(), roleFindMany: vi.fn(), productFindMany: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ interactionScript: { findFirst: mocks.scriptFindFirst }, interactionRole: { findMany: mocks.roleFindMany }, product: { findMany: mocks.productFindMany } }) }));
vi.mock("@/components/ui", () => ({ PageHeader: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));
vi.mock("@/components/interaction-script-form", () => ({ InteractionScriptForm: (props: Record<string, unknown>) => <div data-testid="interaction-script-form">{JSON.stringify(props)}</div> }));

import EditInteractionScriptPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.getCsrfToken.mockResolvedValue("csrf-token");
  mocks.scriptFindFirst.mockResolvedValue({ id: "script-1", vendorId: "vendor-1", name: "開場節奏", events: [{ id: "event-1", triggerSec: 5 }], lives: [{ id: "live-1", title: "八月直播", video: { title: "片段" } }] });
  mocks.roleFindMany.mockResolvedValue([{ id: "role-1", name: "主持人" }]);
  mocks.productFindMany.mockResolvedValue([{ id: "product-1", name: "主打課程" }]);
});

describe("/interaction-scripts/[id]/edit route", () => {
  it("scopes script, roles and products to the vendor and forwards bound lives", async () => {
    const html = renderToStaticMarkup(await EditInteractionScriptPage({ params: Promise.resolve({ id: "script-1" }), searchParams: Promise.resolve({ error: "invalid_event" }) }));

    expect(mocks.scriptFindFirst).toHaveBeenCalledWith({ where: { id: "script-1", vendorId: "vendor-1" }, include: { events: { orderBy: { triggerSec: "asc" } }, lives: { include: { video: true } } } });
    expect(mocks.roleFindMany).toHaveBeenCalledWith({ where: { vendorId: "vendor-1", isActive: true } });
    expect(mocks.productFindMany).toHaveBeenCalledWith({ where: { vendorId: "vendor-1", isActive: true } });
    expect(html).toContain("編輯互動腳本");
    expect(html).toContain("script-1");
    expect(html).toContain("live-1");
    expect(html).toContain("invalid_event");
    expect(html).toContain("csrf-token");
  });

  it("fails closed with notFound and does not expose option data for a missing script", async () => {
    mocks.scriptFindFirst.mockResolvedValue(null);

    await expect(EditInteractionScriptPage({ params: Promise.resolve({ id: "missing" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.roleFindMany).toHaveBeenCalled();
    expect(mocks.productFindMany).toHaveBeenCalled();
    expect(mocks.getCsrfToken).toHaveBeenCalledExactlyOnceWith();
  });
});
