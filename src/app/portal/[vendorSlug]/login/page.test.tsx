import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ vendor: vi.fn(), csrf: vi.fn(), notFound: vi.fn(), locale: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { findUnique: mocks.vendor } }) }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.csrf }));
vi.mock("@/lib/student-portal-locale", () => ({resolveStudentPortalLocale:mocks.locale}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/student-portal-login-form", () => ({ StudentPortalLoginForm: ({ vendorSlug,locale }: { vendorSlug: string;locale:string }) => <form data-vendor={vendorSlug} data-locale={locale}>login</form> }));

import StudentPortalLoginPage from "./page";

beforeEach(() => { vi.clearAllMocks(); mocks.locale.mockResolvedValue("zh-TW"); mocks.csrf.mockResolvedValue("csrf"); mocks.vendor.mockResolvedValue({ name: "老師品牌", slug: "teacher", logoUrl: null, primaryColor: "#2563eb" }); });

describe("student portal login page", () => {
  it("translates product copy and keeps merchant branding and identity unchanged",async()=>{
    mocks.locale.mockResolvedValue("en");
    const html=renderToStaticMarkup(await StudentPortalLoginPage({params:Promise.resolve({vendorSlug:"teacher"})}));
    expect(html).toContain("Return to your learning centre");
    expect(html).toContain("老師品牌");
    expect(html).toContain('data-vendor="teacher"');
    expect(html).toContain('data-locale="en"');
    expect(mocks.vendor.mock.calls[0][0].where).toEqual({slug:"teacher"});
  });
  it("loads only public brand fields and explains passwordless privacy", async () => {
    const html = renderToStaticMarkup(await StudentPortalLoginPage({ params: Promise.resolve({ vendorSlug: "teacher" }) }));
    expect(mocks.vendor).toHaveBeenCalledWith({ where: { slug: "teacher" }, select: { name: true, slug: true, logoUrl: true, primaryColor: true } });
    expect(html).toContain("回到你的學習中心");
    expect(html).toContain("不會透露這個 Email 是否已存在");
    expect(html).toContain('data-vendor="teacher"');
  });
});
