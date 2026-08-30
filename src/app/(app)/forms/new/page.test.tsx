import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn(), videoFindMany: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ video: { findMany: mocks.videoFindMany } }) }));
vi.mock("@/components/ui", () => ({ PageHeader: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));
vi.mock("@/components/form-builder", () => ({ FormBuilder: ({ error, promoVideos }: { error?: string; promoVideos: Array<{ id: string; title: string }> }) => <div data-testid="form-builder">{JSON.stringify({ error: error ?? "no-error", promoVideos })}</div> }));

import NewFormPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.videoFindMany.mockResolvedValue([{ id: "video-1", title: "宣傳影片" }]);
});

describe("/forms/new route", () => {
  it("requires vendor manager and forwards validation errors", async () => {
    const html = renderToStaticMarkup(await NewFormPage({ searchParams: Promise.resolve({ error: "invalid_fields" }) }));
    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.videoFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", status: "ready" },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    });
    expect(html).toContain("新增報名表");
    expect(html).toContain("invalid_fields");
    expect(html).toContain("宣傳影片");
  });

  it("keeps a clean builder state when no error is supplied", async () => {
    const html = renderToStaticMarkup(await NewFormPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("新增報名表"); expect(html).toContain("no-error");
  });
});
