import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  context: vi.fn(),
  scope: vi.fn(),
  templates: vi.fn(),
  targets: vi.fn(),
  csrf: vi.fn(),
  library: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager, requireVendorManagerContext: mocks.context }));
vi.mock("@/lib/sales-project-scope", () => ({ getSalesProjectScope: mocks.scope }));
vi.mock("@/lib/csrf", () => ({ CSRF_FIELD_NAME: "csrf", getCsrfToken: mocks.csrf }));
vi.mock("@/lib/landing-page-template-service", () => ({ listLandingPageTemplates: mocks.templates, listLandingPageTemplateTargets: mocks.targets }));
vi.mock("@/components/landing-pages/landing-page-template-library", () => ({ LandingPageTemplateLibrary: (props: unknown) => { mocks.library(props); return <div>template library</div>; } }));
import Page from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ auth: { user: { id: "user-1" } }, vendor: { id: "vendor-1" } });
  mocks.templates.mockResolvedValue([]);
  mocks.targets.mockResolvedValue([{ id: "page-1", name: "網站" }]);
  mocks.csrf.mockResolvedValue("synthetic-csrf");
});

it("rejects roles that cannot manage one-page sites before loading templates or issuing CSRF", async () => {
  // support/partner are redirected by the same guard as /landing-pages.
  const denied = new Error("redirect:/dashboard?error=insufficient_role");
  mocks.requireVendorManager.mockRejectedValueOnce(denied);
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toBe(denied);
  expect(mocks.templates).not.toHaveBeenCalled();
  expect(mocks.targets).not.toHaveBeenCalled();
  expect(mocks.csrf).not.toHaveBeenCalled();
});

it("loads own templates and the selected project's sites", async () => {
  mocks.scope.mockResolvedValue({ projectId: "project-1", projectName: "專案", isAggregate: false, isLegacyWorkspace: false });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ tab: "mine" }) }));
  expect(html).toContain("範本");
  expect(html).toContain('href="/landing-pages"');
  expect(mocks.scope).toHaveBeenCalledWith("user-1", "vendor-1");
  expect(mocks.library).toHaveBeenCalledWith(expect.objectContaining({ csrfToken: "synthetic-csrf", myTemplates: [], sites: [{ id: "page-1", name: "網站" }], initialTab: "mine" }));
});

it("does not list sites without a selected project (aggregate overview)", async () => {
  mocks.scope.mockResolvedValue({ projectId: null, projectName: null, isAggregate: true, isLegacyWorkspace: false });
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ tab: "other" }) }));
  expect(mocks.targets).not.toHaveBeenCalled();
  expect(mocks.library).toHaveBeenCalledWith(expect.objectContaining({ sites: null, initialTab: "platform" }));
});
