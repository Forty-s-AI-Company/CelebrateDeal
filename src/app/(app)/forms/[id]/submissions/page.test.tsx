import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }), requireVendorManager: vi.fn(), findFirst: vi.fn(), formatDateTime: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ registrationForm: { findFirst: mocks.findFirst } }) }));
vi.mock("@/lib/format", () => ({ formatDateTime: mocks.formatDateTime }));
vi.mock("@/components/ui", () => ({ Card: ({ children }: { children: ReactNode }) => <section>{children}</section>, PageHeader: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));

import FormSubmissionsPage from "./page";

beforeEach(() => { vi.clearAllMocks(); mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" }); mocks.formatDateTime.mockReturnValue("2026/08/06 12:00"); mocks.findFirst.mockResolvedValue({ name: "活動報名", submissions: [{ id: "s1", name: "王小明", email: "safe@example.test", phone: "0900-000-000", source: "社群", createdAt: new Date("2026-08-06T04:00:00.000Z"), live: { title: "八月直播" } }, { id: "s2", name: "李小華", email: "other@example.test", phone: null, source: "直接", createdAt: new Date("2026-08-05T04:00:00.000Z"), live: null }] }); });

describe("/forms/[id]/submissions route", () => {
  it("scopes submissions and renders live source with formatted timestamps", async () => {
    const html = renderToStaticMarkup(await FormSubmissionsPage({ params: Promise.resolve({ id: "form-1" }) }));
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "form-1", vendorId: "vendor-1" }, include: { submissions: { orderBy: { createdAt: "desc" }, include: { live: true } } } });
    expect(mocks.formatDateTime).toHaveBeenCalledTimes(2); expect(html).toContain("活動報名 名單"); expect(html).toContain("王小明"); expect(html).toContain("八月直播"); expect(html).toContain("直接"); expect(html).toContain("2026/08/06 12:00");
  });

  it("fails closed when the form is not visible to the vendor", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(FormSubmissionsPage({ params: Promise.resolve({ id: "missing" }) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledExactlyOnceWith();
  });
});
