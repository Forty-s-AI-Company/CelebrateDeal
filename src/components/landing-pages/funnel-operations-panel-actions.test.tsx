// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { defaultFunnelOperations } from "@/lib/funnel-operations";
import { instantiateFunnelTemplate, listFunnelTemplateGallery } from "@/lib/funnel-template-gallery";
import { replaceFunnelStepPage, type FunnelStepPages } from "@/lib/funnel-step-pages";
import { instantiateStepTemplateDocument, listStepTemplateOptions } from "@/lib/funnel-step-template-options";

const mocks = vi.hoisted(() => ({ push: vi.fn(), action: vi.fn(), instantiate: vi.fn(), read: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }));
vi.mock("@/app/actions/landing-page-actions", () => ({ landingPageAction: mocks.action }));
vi.mock("@/app/actions/landing-page-template-actions", () => ({ instantiateStepTemplateAction: mocks.instantiate, readStepTemplatePreviewAction: mocks.read }));
vi.mock("@/app/actions/funnel-operations-actions", () => ({ readFunnelOperations: vi.fn(), updateFunnelOperations: vi.fn() }));
vi.mock("@/components/landing-pages/funnel-automation-settings", () => ({ FunnelAutomationSettings: () => null }));

import { FunnelOperationsPanel } from "./funnel-operations-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.clearAllMocks();
  // The server action builds the document with the same function the real action uses.
  mocks.instantiate.mockImplementation(async (request: Parameters<typeof instantiateStepTemplateDocument>[0]) => {
    const document = instantiateStepTemplateDocument(request);
    return document ? { ok: true, document } : { ok: false, message: "找不到這個範本，或你沒有使用它的權限。" };
  });
  // The panel loads reports independently; keep that request synthetic and inert.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
});

function initial(status: "draft" | "published") {
  const created = createGoalFunnelStepPages({ id: "synthetic", name: "測試網站", goal: "audience", domain: "synthetic" })!;
  const first = created.flow.steps.find((step) => !step.isSystem)!;
  const templateId = listFunnelTemplateGallery("audience", first.type)[0]!.id;
  const applied = replaceFunnelStepPage(created, first.id, instantiateFunnelTemplate(templateId, created.pages[first.id]!.id), templateId);
  if (!applied.ok) throw new Error(applied.error);
  const content = applied.state;
  return {
    content, panel: { pageId: "page-1", name: "測試網站", slug: "synthetic", currency: "TWD", revision: 7, status, operations: defaultFunnelOperations(), content, formId: null, liveId: null, steps: content.flow.steps.filter((step) => !step.isSystem).map(({ id, name, path }) => ({ id, name, path })) },
  };
}
async function mount(status: "draft" | "published") {
  const { content, panel } = initial(status);
  const stepId = content.flow.steps.find((step) => !step.isSystem)!.id;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<FunnelOperationsPanel initial={panel} initialStepId={stepId} csrfName="csrf" csrfToken="synthetic" templateOptions={listStepTemplateOptions("audience")} initialPublication={{ available: false, message: "專案尚未發布，公開網址目前無法開啟。", projectHref: "/projects/p1", missing: [] }} />));
  cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
  return { container, stepId };
}
const button = (scope: ParentNode, name: string) => {
  const match = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((item) => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === name);
  if (!match) throw new Error(`button not found: ${name}`);
  return match;
};
const click = async (element: HTMLElement) => { await act(async () => element.click()); };

describe("management page owns publishing", () => {
  it("opens the full-screen editor for the selected step", async () => {
    const { container, stepId } = await mount("draft");
    await click(button(container, "編輯頁面"));
    expect(mocks.push).toHaveBeenCalledWith(`/landing-pages/page-1/edit?step=${encodeURIComponent(stepId)}`);
  });

  it("publishes the saved draft with the current revision and shows the new status", async () => {
    mocks.action.mockResolvedValue({ status: "success", message: "已發布。", id: "page-1", revision: 8, publication: { available: true, message: "公開網址可以開啟。", projectHref: "/projects/p1", missing: [] } });
    const { container } = await mount("draft");
    expect(button(container, "發布狀態：草稿")).toBeTruthy();
    await click(button(container, "發布"));
    const data = mocks.action.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(["operation", "id", "revision", "csrf"].map((key) => [key, data.get(key)]))).toEqual({ operation: "publish", id: "page-1", revision: "7", csrf: "synthetic" });
    expect(data.get("content")).toBeNull();
    expect(button(container, "發布狀態：已發布")).toBeTruthy();
    expect(button(container, "重新發布")).toBeTruthy();
  });

  it("shows the diagnosis a refused publish carries, such as the independent publication limit", async () => {
    mocks.action.mockResolvedValue({
      status: "error",
      message: "免費帳號最多可同時有 3 個不需發布專案就公開的名單型網站，目前已達上限。",
      publication: { available: false, message: "一頁式網站尚未發布。免費帳號最多可同時有 3 個…", projectHref: "/projects/p1", missing: [{ label: "升級付費方案", href: "/billing/plans" }] },
    });
    const { container } = await mount("draft");
    await click(button(container, "發布"));
    expect(container.querySelector("[role=status]")?.textContent).toContain("目前已達上限");
    await click(button(container, "發布狀態：草稿"));
    const region = container.querySelector("[aria-label=公開網址狀態]");
    expect(region?.textContent).toContain("一頁式網站尚未發布。免費帳號最多可同時有 3 個");
    expect(region?.querySelector("a[href='/billing/plans']")?.textContent).toBe("升級付費方案");
    expect(button(container, "發布")).toBeTruthy();
  });

  it("offers only lead and general step types when adding a step to an audience Funnel", async () => {
    const { container } = await mount("draft");
    await click(button(container, "新增步驟"));
    const select = Array.from(container.querySelectorAll("select")).find((item) => item.closest("label")?.textContent?.startsWith("類型"))!;
    expect(Array.from(select.querySelectorAll("optgroup")).map((group) => group.label)).toEqual(["名單", "資訊"]);
    const values = Array.from(select.querySelectorAll("option")).map((option) => option.value);
    expect(values).toEqual(["opt_in_page", "opt_in_thank_you_page", "inline_form", "popup_form", "link_in_bio", "info_page", "contact_us_page"]);
    expect(values).not.toContain("thank_you_page");
  });

  it("offers unpublish, duplicate and delete from the overflow menu", async () => {
    mocks.action.mockResolvedValue({ status: "success", message: "已建立草稿副本。", id: "copy-1" });
    const { container } = await mount("published");
    await click(button(container, "更多網站操作"));
    expect(button(container, "取消發布")).toBeTruthy();
    await click(button(container, "複製網站"));
    expect((mocks.action.mock.calls[0]![1] as FormData).get("operation")).toBe("duplicate");
    expect(mocks.push).toHaveBeenCalledWith("/landing-pages/copy-1/operations");
  });

  it("deletes only after confirmation", async () => {
    mocks.action.mockResolvedValue({ status: "success", message: "已刪除。", id: "page-1" });
    const { container } = await mount("draft");
    await click(button(container, "更多網站操作"));
    await click(button(container, "刪除網站"));
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
    await click(button(document.body, "取消"));
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.action).not.toHaveBeenCalled();
    await click(button(container, "更多網站操作"));
    await click(button(container, "刪除網站"));
    await click(button(document.body, "移除"));
    expect((mocks.action.mock.calls[0]![1] as FormData).get("operation")).toBe("delete");
    expect(mocks.push).toHaveBeenCalledWith("/landing-pages");
  });

  it("returns focus to the overflow-menu button when a delete confirmation is cancelled", async () => {
    const { container } = await mount("draft");
    const more = button(container, "更多網站操作");
    await click(more);
    await click(button(container, "刪除網站"));
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
    await click(button(document.body, "取消"));
    expect(document.activeElement).toBe(more);
    expect(mocks.action).not.toHaveBeenCalled();
  });
});

describe("step template picker applies server built documents", () => {
  const savedContent = () => JSON.parse((mocks.action.mock.calls[0]![1] as FormData).get("content") as string) as FunnelStepPages;
  const options = listStepTemplateOptions("audience");
  const cardApply = (container: HTMLElement, templateId: string) => {
    const name = options.find((option) => option.id === templateId)!.name;
    const card = Array.from(container.querySelectorAll<HTMLElement>("article")).find((item) => item.querySelector("strong")?.textContent === name)!;
    return button(card, "套用模板");
  };

  it("asks before replacing, then applies the server document to the step and saves it", async () => {
    mocks.action.mockResolvedValue({ status: "success", message: "已儲存。", id: "page-1", revision: 8 });
    const { container, stepId } = await mount("draft");
    const current = initial("draft").content.flow.steps.find((step) => step.id === stepId)!.template.templateId;
    const target = options.find((option) => option.stepTypes.includes("opt_in_page") && option.id !== current)!.id;
    await click(button(container, "更換模板"));
    await click(cardApply(container, target));
    expect(document.body.querySelector('[role="alertdialog"]')?.textContent).toContain("更換模板會取代目前步驟的頁面內容");
    expect(mocks.instantiate).not.toHaveBeenCalled();
    await click(button(document.body, "確認"));
    const pageId = initial("draft").content.pages[stepId]!.id;
    expect(mocks.instantiate).toHaveBeenCalledWith({ goal: "audience", stepType: "opt_in_page", templateId: target, pageId });
    const saved = savedContent();
    expect(saved.flow.steps.find((step) => step.id === stepId)!.template.templateId).toBe(target);
    const expected = (await mocks.instantiate.mock.results[0]!.value).document;
    expect(saved.pages[stepId]).toEqual(expected);
    expect(container.textContent).toContain("模板已套用");
  });

  it("does nothing when the replacement is cancelled", async () => {
    const { container } = await mount("draft");
    await click(button(container, "更換模板"));
    await click(button(container, "套用模板"));
    await click(button(document.body, "取消"));
    expect(mocks.instantiate).not.toHaveBeenCalled();
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it("keeps the canvas and shows the error when the server refuses the template", async () => {
    mocks.instantiate.mockResolvedValue({ ok: false, message: "找不到這個範本，或你沒有使用它的權限。" });
    const { container } = await mount("draft");
    await click(button(container, "更換模板"));
    await click(button(container, "套用模板"));
    await click(button(document.body, "確認"));
    expect(container.querySelector("[role=alert]")?.textContent).toContain("找不到這個範本，或你沒有使用它的權限。畫布內容沒有變更");
    expect(mocks.action).not.toHaveBeenCalled();
    expect(button(container, "取消更換模板")).toBeTruthy();
  });

  it("keeps the canvas and shows an error when the request itself fails", async () => {
    mocks.instantiate.mockRejectedValue(new Error("network"));
    const { container } = await mount("draft");
    await click(button(container, "更換模板"));
    await click(button(container, "套用模板"));
    await click(button(document.body, "確認"));
    expect(container.querySelector("[role=alert]")?.textContent).toContain("模板目前無法套用，畫布內容沒有變更");
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it("builds the starter page of a new step on the server too", async () => {
    mocks.action.mockResolvedValue({ status: "success", message: "已儲存。", id: "page-1", revision: 8 });
    const { container } = await mount("draft");
    await click(button(container, "新增步驟"));
    await click(button(document.body, "儲存"));
    expect(mocks.instantiate).toHaveBeenCalledWith(expect.objectContaining({ goal: "audience", stepType: "opt_in_page", templateId: options.find((option) => option.stepTypes.includes("opt_in_page"))!.id }));
    const saved = savedContent();
    const created = saved.flow.steps.find((step) => step.name === "新步驟")!;
    expect(saved.pages[created.id]).toEqual((await mocks.instantiate.mock.results[0]!.value).document);
    expect(created.template.templateId).toBe(options.find((option) => option.stepTypes.includes("opt_in_page"))!.id);
  });

  it("shows the error inside the add-step dialog and creates nothing when the server fails", async () => {
    mocks.instantiate.mockResolvedValue({ ok: false, message: "找不到這個範本，或你沒有使用它的權限。" });
    const { container } = await mount("draft");
    await click(button(container, "新增步驟"));
    await click(button(document.body, "儲存"));
    expect(document.body.querySelector('[aria-labelledby="add-step-title"] [role=alert]')?.textContent).toContain("畫布內容沒有變更");
    expect(mocks.action).not.toHaveBeenCalled();
  });
});
