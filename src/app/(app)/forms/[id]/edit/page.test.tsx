import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }), requireVendorManagerContext: vi.fn(), getSalesProjectScope: vi.fn(), findFirst: vi.fn(), videoFindMany: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.requireVendorManagerContext }));
vi.mock("@/lib/sales-project-scope", () => ({ getSalesProjectScope: mocks.getSalesProjectScope }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ registrationForm: { findFirst: mocks.findFirst }, video: { findMany: mocks.videoFindMany } }) }));
vi.mock("@/components/ui", () => ({ PageHeader: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));
vi.mock("@/components/form-builder", () => ({ FormBuilder: ({ form, error, promoVideos, enableFunnelWizard }: { form?: { id: string; name: string; fields: unknown }; error?: string; promoVideos: Array<{ id: string; title: string }>; enableFunnelWizard?: boolean }) => <div data-testid="form-builder">{JSON.stringify({ id: form?.id, name: form?.name, fields: form?.fields, error, promoVideos, enableFunnelWizard })}</div> }));

import EditFormPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManagerContext.mockResolvedValue({ auth: { user: { id: "user-1" } }, vendor: { id: "vendor-1" } });
  mocks.getSalesProjectScope.mockResolvedValue({ projectId: null, projectName: null, isAggregate: false, isLegacyWorkspace: true });
  mocks.findFirst.mockResolvedValue({ id: "form-1", name: "活動報名", slug: "summer", fields: [{ key: "email" }] });
  mocks.videoFindMany.mockResolvedValue([{ id: "video-1", title: "宣傳影片" }]);
});

describe("/forms/[id]/edit route", () => {
  it("scopes the form query and forwards form data and error", async () => {
    const html = renderToStaticMarkup(await EditFormPage({ params: Promise.resolve({ id: "form-1" }), searchParams: Promise.resolve({ error: "invalid_fields" }) }));
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "form-1", vendorId: "vendor-1" } });
    expect(mocks.videoFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", status: "ready" },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    });
    expect(html).toContain("編輯報名表");
    expect(html).toContain("form-1");
    expect(html).toContain("invalid_fields");
    expect(html).toContain("宣傳影片");
    expect(html).toContain("enableFunnelWizard");
  });

  it("fails closed when a foreign or missing form is not found", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(EditFormPage({ params: Promise.resolve({ id: "missing" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledExactlyOnceWith();
  });

  it("rejects aggregate editing before loading editable data", async () => {
    mocks.getSalesProjectScope.mockResolvedValue({ projectId: null, projectName: null, isAggregate: true, isLegacyWorkspace: false });
    await expect(EditFormPage({ params: Promise.resolve({ id: "form-1" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.videoFindMany).not.toHaveBeenCalled();
  });

  it("requires the selected project on the form and promo-video reads", async () => {
    mocks.getSalesProjectScope.mockResolvedValue({ projectId: "project-1", projectName: "專案一", isAggregate: false, isLegacyWorkspace: false });
    await EditFormPage({ params: Promise.resolve({ id: "form-1" }), searchParams: Promise.resolve({}) });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "form-1", vendorId: "vendor-1", projectId: "project-1" } });
    expect(mocks.videoFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", status: "ready" } }));
  });
});
