import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn(), context: vi.fn(), scope: vi.fn(), projects: vi.fn(), templateName: vi.fn(), picker: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/actions/sales-workspace-actions", () => ({ selectSalesProjectAction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager, requireVendorManagerContext: mocks.context }));
vi.mock("@/lib/sales-project-scope", () => ({ getSalesProjectScope: mocks.scope, listSelectableSalesProjects: mocks.projects }));
vi.mock("@/lib/csrf", () => ({ CSRF_FIELD_NAME: "csrf", getCsrfToken: async () => "synthetic-csrf" }));
vi.mock("@/lib/landing-page-template-service", () => ({ getLandingPageTemplateName: mocks.templateName }));
vi.mock("@/components/landing-pages/funnel-goal-picker", () => ({ FunnelGoalPicker: (props: unknown) => { mocks.picker(props); return <div>goal picker</div>; } }));
import NewLandingPage from "./page";

const render = async (query: Record<string, string>) => renderToStaticMarkup(await NewLandingPage({ searchParams: Promise.resolve(query) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ auth: { user: { id: "user-1" } }, vendor: { id: "vendor-1" } });
  mocks.scope.mockResolvedValue({ projectId: "project-1", projectName: "專案", isAggregate: false, isLegacyWorkspace: false });
});

it("takes a platform template's name and goal from the gallery, not the query", async () => {
  await render({ template: "platform:custom-luxury-course", goal: "sell" });
  expect(mocks.picker).toHaveBeenCalledWith(expect.objectContaining({ initialGoal: "custom", template: { kind: "platform", id: "custom-luxury-course", name: "高質感課程品牌（黑金）", goal: "custom" }, templateMissing: false }));
});

it("looks up an own template's name under the caller's vendor", async () => {
  mocks.templateName.mockResolvedValue("我的名單頁");
  await render({ template: "mine:tpl_1", goal: "audience" });
  expect(mocks.templateName).toHaveBeenCalledWith("tpl_1");
  expect(mocks.picker).toHaveBeenCalledWith(expect.objectContaining({ initialGoal: "audience", template: { kind: "mine", id: "tpl_1", name: "我的名單頁" } }));
});

// platform:custom-brand-info and platform:webinar-example: retired and hidden templates cannot start a new page from an old link.
it.each([["mine:foreign"], ["platform:missing"], ["platform:custom-brand-info"], ["platform:webinar-example"], ["other:id"], ["mine:"]])("reports %s as missing instead of using it", async (template) => {
  mocks.templateName.mockResolvedValue(null);
  await render({ template });
  expect(mocks.picker).toHaveBeenCalledWith(expect.objectContaining({ template: undefined, templateMissing: true }));
});

it("rejects a non-manager before resolving any template", async () => {
  mocks.requireVendorManager.mockRejectedValueOnce(new Error("redirect:/dashboard?error=insufficient_role"));
  await expect(render({ template: "mine:tpl_1" })).rejects.toThrow("insufficient_role");
  expect(mocks.templateName).not.toHaveBeenCalled();
});

it("without a selected project explains why and lists the vendor's projects to switch to", async () => {
  mocks.scope.mockResolvedValue({ projectId: null, projectName: null, isAggregate: true, isLegacyWorkspace: false });
  mocks.projects.mockResolvedValue([{ id: "project-1", name: "秋季課程" }]);
  const html = await render({ template: "platform:custom-terms-v2" });
  expect(mocks.projects).toHaveBeenCalledWith("vendor-1");
  expect(html).toContain("一頁式網站屬於銷售專案，請先選擇專案");
  expect(html).toContain("切換到「秋季課程」");
  expect(mocks.picker).not.toHaveBeenCalled();
  expect(mocks.templateName).not.toHaveBeenCalled();
});

it("with no project at all offers to create one", async () => {
  mocks.scope.mockResolvedValue({ projectId: null, projectName: null, isAggregate: false, isLegacyWorkspace: true });
  mocks.projects.mockResolvedValue([]);
  const html = await render({});
  expect(html).toContain('href="/projects/new"');
  expect(mocks.picker).not.toHaveBeenCalled();
});
