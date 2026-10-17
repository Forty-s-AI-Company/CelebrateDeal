import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ editor: vi.fn(), publication: vi.fn(), manager: vi.fn() }));
const errors = vi.hoisted(() => ({ Missing: class extends Error {}, Scope: class extends Error {} }));
vi.mock("@/lib/landing-page-service", () => ({ getLandingPageForEditor: mocks.editor, getLandingPagePublicationStatus: mocks.publication, LandingPageNotFoundError: errors.Missing, LandingPageScopeError: errors.Scope }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.manager }));
vi.mock("@/lib/csrf", () => ({ CSRF_FIELD_NAME: "synthetic", getCsrfToken: async () => "synthetic" }));
vi.mock("@/components/landing-page-workspace", () => ({ LandingPageWorkspace: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not_found"); } }));
import EditLandingPage from "./page";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.editor.mockResolvedValue({ page: { id: "page-1", name: "合成頁面", slug: "synthetic", status: "draft", revision: 1, content: { schemaVersion: 1, data: { root: {}, content: [] } }, formId: null, liveId: null, versions: [] }, forms: [], lives: [] });
});
it("keeps the editor available when the informational read fails", async () => {
  mocks.publication.mockRejectedValue(new Error("synthetic-read-failure"));
  const result = await EditLandingPage({ params: Promise.resolve({ id: "page-1" }), searchParams: Promise.resolve({}) });
  expect(result.props.initialPublication).toMatchObject({ available: false, projectHref: "/projects" });
  expect(result.props.initialPublication.message).toContain("尚無法確認");
  expect(result.props.page.id).toBe("page-1");
});
it.each([errors.Missing, errors.Scope])("keeps scoped not-found handling", async (ErrorType) => {
  mocks.publication.mockRejectedValue(new ErrorType());
  await expect(EditLandingPage({ params: Promise.resolve({ id: "page-1" }), searchParams: Promise.resolve({}) })).rejects.toThrow("not_found");
});
