import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ security: vi.fn(), manager: vi.fn(), scope: vi.fn(), prepare: vi.fn(), page: vi.fn(), publish: vi.fn(), publication: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.manager }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ landingPage: { findFirst: mocks.page } }) }));
vi.mock("@/lib/sales-project-scope", () => ({ requireEditableSalesProjectScope: mocks.scope }));
vi.mock("@/lib/quick-webinar", async original => ({ ...await original<typeof import("@/lib/quick-webinar")>(), prepareQuickWebinar: mocks.prepare }));
vi.mock("@/lib/landing-page-service", () => ({ publishLandingPage: mocks.publish, getLandingPagePublicationStatus: mocks.publication }));
import { createQuickWebinarAction } from "./quick-webinar-actions";
const previous = { status: "idle" as const, message: "" };
function input() { const form = new FormData(); Object.entries({ requestId: "12345678-1234-4123-8123-123456789abc", videoId: "video", startsAtLocal: "2030-08-01T10:00", title: "合成場次", vendorId: "foreign", projectId: "foreign" }).forEach(([k,v]) => form.set(k,v)); return form; }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.manager.mockResolvedValue({ auth: { user: { id: "user" } }, vendor: { id: "vendor", timezone: "Asia/Taipei" } });
  mocks.scope.mockResolvedValue({ projectId: "project" });
  mocks.prepare.mockResolvedValue({ pageId: "page", liveId: "live", slug: "synthetic-webinar", projectId: "project", projectReady: true, reused: false });
  mocks.page.mockResolvedValue({ status: "draft", revision: 1, unpublishedAt: null });
  mocks.publication.mockResolvedValue({ available: true, message: "公開頁可使用", missing: [] });
});
describe("quick webinar protected action", () => {
  it("uses only authenticated tenant/project scope and checks real public availability before giving a URL", async () => {
    const result = await createQuickWebinarAction(previous,input());
    expect(mocks.prepare).toHaveBeenCalledWith(expect.anything(), { vendorId: "vendor", userId: "user", timeZone: "Asia/Taipei", projectId: "project" }, { requestId: "12345678-1234-4123-8123-123456789abc", videoId: "video", startsAtLocal: "2030-08-01T10:00", title: "合成場次" });
    expect(mocks.page).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "page", vendorId: "vendor", projectId: "project" } }));
    expect(mocks.publish).toHaveBeenCalledWith("page",1);
    expect(result).toMatchObject({ status: "ready", publicUrl: "/lp/synthetic-webinar" });
  });
  it("stops at CSRF failure before authorization or persistence", async () => {
    mocks.security.mockRejectedValue(new Error("synthetic-security-denied"));
    await expect(createQuickWebinarAction(previous,input())).rejects.toThrow("synthetic-security-denied");
    expect(mocks.manager).not.toHaveBeenCalled();expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("stops a denied manager before looking up project scope", async () => {
    mocks.manager.mockRejectedValue(new Error("synthetic-role-denied"));
    await expect(createQuickWebinarAction(previous,input())).rejects.toThrow("synthetic-role-denied");
    expect(mocks.scope).not.toHaveBeenCalled();expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("keeps aggregate view read-only", async () => {
    mocks.scope.mockRejectedValue(new Error("sales_project_required"));
    expect(await createQuickWebinarAction(previous,input())).toMatchObject({ status: "error", message: expect.stringContaining("選取專案") });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("does not give a public URL or publish a funnel when the project gate is incomplete", async () => {
    mocks.prepare.mockResolvedValue({ pageId: "page", liveId: "live", projectId: "project", slug: "synthetic", projectReady: false });
    mocks.publication.mockResolvedValue({ available: false, message: "專案尚未發布，公開網址目前無法開啟", missing: [{ label: "尚無有效且已驗證的商家付款方式", href: "/billing/payment-methods" }] });
    const result=await createQuickWebinarAction(previous,input());expect(result.status).toBe("needs_attention");expect(result.publicUrl).toBeUndefined();expect(result.missing).toHaveLength(1);expect(mocks.publish).not.toHaveBeenCalled();
  });
  it.each([{ status: "draft", revision: 2, unpublishedAt: null },{ status: "draft", revision: 3, unpublishedAt: new Date() }])("does not republish an edited or manually stopped replay", async page => {
    mocks.prepare.mockResolvedValue({ pageId: "page", liveId: "live", projectId: "project", slug: "synthetic", projectReady: true, reused: true });mocks.page.mockResolvedValue(page);
    expect((await createQuickWebinarAction(previous,input())).status).toBe("needs_attention");expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("does not create a new publication version for an already-published replay", async () => {
    mocks.page.mockResolvedValue({ status: "published", revision: 2, unpublishedAt: null });
    expect((await createQuickWebinarAction(previous,input())).status).toBe("ready");expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("preserves created-resource links but never claims success after publication failure", async () => {
    mocks.publish.mockRejectedValue(new Error("synthetic-publication-failure"));const result=await createQuickWebinarAction(previous,input());expect(result.status).toBe("needs_attention");expect(result.publicUrl).toBeUndefined();expect(result.editorUrl).toBe("/landing-pages/page");expect(result.message).not.toContain("synthetic-publication-failure");
  });
});
