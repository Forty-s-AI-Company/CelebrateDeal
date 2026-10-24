import { beforeEach, expect, it, vi } from "vitest";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";

const mocks = vi.hoisted(() => ({ editor: vi.fn(), publication: vi.fn(), manager: vi.fn() }));
const errors = vi.hoisted(() => ({ Missing: class extends Error {}, Scope: class extends Error {} }));
vi.mock("@/lib/landing-page-service", () => ({ getLandingPageForEditor: mocks.editor, getLandingPagePublicationStatus: mocks.publication, LandingPageNotFoundError: errors.Missing, LandingPageScopeError: errors.Scope }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.manager }));
vi.mock("@/lib/csrf", () => ({ CSRF_FIELD_NAME: "synthetic", getCsrfToken: async () => "synthetic" }));
vi.mock("@/components/landing-page-workspace", () => ({ LandingPageWorkspace: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not_found"); } }));

import EditLandingPage from "./page";

const props = (searchParams: { step?: string } = {}) => ({ params: Promise.resolve({ id: "page-1" }), searchParams: Promise.resolve(searchParams) });
const pageRow = (content: unknown) => ({ page: { id: "page-1", name: "合成頁面", slug: "synthetic", status: "draft", revision: 1, content, formId: null, liveId: null, versions: [] }, forms: [], lives: [] });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.editor.mockResolvedValue(pageRow({ schemaVersion: 1, data: { root: {}, content: [] } }));
});

it("passes the merchant diagnosis to the editor", async () => {
  const diagnosis = { available: false, message: "專案尚未發布，公開網址目前無法開啟。", projectHref: "/projects/project-1", missing: [] };
  mocks.publication.mockResolvedValue(diagnosis);
  const result = await EditLandingPage(props());
  expect(result.props.initialPublication).toEqual(diagnosis);
});

it("keeps the editor available when the informational read fails", async () => {
  mocks.publication.mockRejectedValue(new Error("synthetic-read-failure"));
  const result = await EditLandingPage(props());
  expect(result.props.initialPublication).toMatchObject({ available: false, projectHref: "/projects" });
  expect(result.props.initialPublication.message).toContain("尚無法確認");
  expect(result.props.page.id).toBe("page-1");
});

it.each([errors.Missing, errors.Scope])("keeps scoped not-found handling", async (ErrorType) => {
  mocks.publication.mockRejectedValue(new ErrorType());
  await expect(EditLandingPage(props())).rejects.toThrow("not_found");
});

it("authorizes the manager before loading any page data", async () => {
  const denied = new Error("synthetic authorization denial");
  mocks.manager.mockRejectedValueOnce(denied);
  await expect(EditLandingPage(props())).rejects.toBe(denied);
  expect(mocks.editor).not.toHaveBeenCalled();
  expect(mocks.publication).not.toHaveBeenCalled();
});

it("opens the requested step and returns to that step on the management page", async () => {
  const content = createGoalFunnelStepPages({ id: "flow", name: "合成網站", goal: "audience", domain: "synthetic" })!;
  const target = content.flow.steps.filter((step) => !step.isSystem).at(-1)!;
  expect(target.id).not.toBe(content.activeStepId);
  mocks.editor.mockResolvedValue(pageRow(content));
  mocks.publication.mockResolvedValue({ available: true, message: "ok", projectHref: "/projects", missing: [] });
  const result = await EditLandingPage(props({ step: target.id }));
  expect(result.props.page.content.activeStepId).toBe(target.id);
  expect(result.props.managementHref).toBe("/landing-pages/page-1/operations");
  expect(result.props.returnHref).toBe(`/landing-pages/page-1/operations?step=${encodeURIComponent(target.id)}&tab=configuration`);
});

it("ignores an unknown step and keeps legacy pages returning to the list", async () => {
  const content = createGoalFunnelStepPages({ id: "flow", name: "合成網站", goal: "audience", domain: "synthetic" })!;
  mocks.editor.mockResolvedValue(pageRow(content));
  mocks.publication.mockResolvedValue({ available: true, message: "ok", projectHref: "/projects", missing: [] });
  const result = await EditLandingPage(props({ step: "foreign-step" }));
  expect(result.props.page.content.activeStepId).toBe(content.activeStepId);

  mocks.editor.mockResolvedValue(pageRow({ schemaVersion: 1, data: { root: {}, content: [] } }));
  const legacy = await EditLandingPage(props());
  expect(legacy.props.returnHref).toBeUndefined();
  expect(legacy.props.managementHref).toBeUndefined();
});
