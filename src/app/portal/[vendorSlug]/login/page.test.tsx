import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ vendor: vi.fn(), csrf: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { findUnique: mocks.vendor } }) }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.csrf }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/student-portal-login-form", () => ({ StudentPortalLoginForm: ({ vendorSlug }: { vendorSlug: string }) => <form data-vendor={vendorSlug}>login</form> }));

import StudentPortalLoginPage from "./page";

beforeEach(() => { vi.clearAllMocks(); mocks.csrf.mockResolvedValue("csrf"); mocks.vendor.mockResolvedValue({ name: "老師品牌", slug: "teacher", logoUrl: null, primaryColor: "#2563eb" }); });

describe("student portal login page", () => {
  it("loads only public brand fields and explains passwordless privacy", async () => {
    const html = renderToStaticMarkup(await StudentPortalLoginPage({ params: Promise.resolve({ vendorSlug: "teacher" }) }));
    expect(mocks.vendor).toHaveBeenCalledWith({ where: { slug: "teacher" }, select: { name: true, slug: true, logoUrl: true, primaryColor: true } });
    expect(html).toContain("回到你的學習中心");
    expect(html).toContain("不會透露這個 Email 是否已存在");
    expect(html).toContain('data-vendor="teacher"');
  });
});
