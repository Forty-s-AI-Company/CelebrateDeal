// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  readTarget: vi.fn(),
  readDocument: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  selectProject: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/app/actions/sales-workspace-actions", () => ({ selectSalesProjectAction: mocks.selectProject }));
vi.mock("@/app/actions/landing-page-template-actions", () => ({
  applyLandingPageTemplateAction: mocks.apply,
  renameLandingPageTemplateAction: mocks.rename,
  deleteLandingPageTemplateAction: mocks.remove,
  readLandingPageTemplateTargetAction: mocks.readTarget,
  readLandingPageTemplateDocumentAction: mocks.readDocument,
  saveLandingPageTemplateAction: mocks.save,
}));

import { listFunnelTemplateCatalog } from "@/lib/funnel-template-catalog";
import { previewFunnelTemplate } from "@/lib/funnel-template-gallery";
import { prepareStoredTemplateDocument } from "@/lib/landing-page-template-document";
import type { LandingPageTemplateSummary, LandingPageTemplateTarget } from "@/lib/landing-page-template-service";
import { LandingPageTemplateLibrary, templateCreateHref, templateStepAvailability } from "./landing-page-template-library";
import { SaveAsTemplateDialog } from "./save-as-template-dialog";

let container: HTMLDivElement;
let root: Root;

const myDocument = prepareStoredTemplateDocument(previewFunnelTemplate("audience-volunteer"), "我的秋季名單頁")!;
const myTemplate: LandingPageTemplateSummary = {
  id: "tpl_own_1",
  name: "我的秋季名單頁",
  readable: true,
  thumbnail: { ...myDocument, root: myDocument.root.slice(0, 2), popups: [] },
  createdAt: "2026-10-20T02:00:00.000Z",
  updatedAt: "2026-10-26T02:00:00.000Z",
};
const brokenTemplate: LandingPageTemplateSummary = { id: "tpl_broken", name: "壞掉的範本", readable: false, thumbnail: null, createdAt: "2026-10-01T02:00:00.000Z", updatedAt: "2026-10-01T02:00:00.000Z" };
const target: LandingPageTemplateTarget = {
  id: "page_1", name: "秋季活動", revision: 7, goal: "audience",
  steps: [
    { id: "opt_in", name: "名單頁", type: "opt_in_page", isSystem: false, templateId: "audience-volunteer" },
    { id: "opt_in_thank_you", name: "感謝頁", type: "opt_in_thank_you_page", isSystem: false, templateId: null },
    { id: "inactive", name: "停用頁", type: "inactive_page", isSystem: true, templateId: null },
  ],
};

async function render(ui: ReactNode) {
  await act(async () => { root.render(ui); });
}

function library(props: Partial<Parameters<typeof LandingPageTemplateLibrary>[0]> = {}) {
  return <LandingPageTemplateLibrary csrfName="csrf" csrfToken="synthetic-token" myTemplates={[myTemplate]} sites={[{ id: "page_1", name: "秋季活動" }]} {...props} />;
}

const buttonNamed = (name: string, scope: ParentNode = container) => [...scope.querySelectorAll("button")].find((button) => button.textContent?.trim() === name || button.getAttribute("aria-label") === name);
const cards = (label = "平台範本") => [...container.querySelectorAll(`ul[aria-label="${label}"] > li`)];
const cardTitles = (label?: string) => cards(label).map((card) => card.querySelector("[data-template-title]")?.textContent);
const dialog = () => document.querySelector<HTMLElement>("[role=dialog], [role=alertdialog]");

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("element not found");
  await act(async () => { (element as HTMLElement).click(); });
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  for (const mock of Object.values(mocks)) mock.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("template library filters", () => {
  it("shows every platform template and filters by purpose and style", async () => {
    await render(library());
    const catalog = listFunnelTemplateCatalog();
    expect(cards()).toHaveLength(catalog.length);
    // 退役與只在步驟選單的範本不出現在範本庫（全部瀏覽）。
    expect(cardTitles()).not.toContain("藍白簡潔結帳");
    expect(cardTitles()).not.toContain("講者型活動報名頁");

    const purpose = container.querySelector("[role=group][aria-label=用途]")!;
    await click(buttonNamed("銷售", purpose));
    expect(buttonNamed("銷售", purpose)!.getAttribute("aria-pressed")).toBe("true");
    const sales = catalog.filter((entry) => entry.purposes.includes("sales"));
    expect(cardTitles()).toEqual(sales.map((entry) => entry.name));
    expect(container.textContent).toContain(`符合條件的範本：${sales.length} 個`);

    const style = container.querySelector("[role=group][aria-label=風格]")!;
    await click(buttonNamed("專業", style));
    expect(cardTitles()).toEqual(sales.filter((entry) => entry.styles.includes("professional")).map((entry) => entry.name));
    expect(cardTitles()).toContain("SaaS 產品 Demo 雙欄報名頁");

    // Pressing the active chip again clears that filter.
    await click(buttonNamed("銷售", purpose));
    expect(cardTitles()).toEqual(catalog.filter((entry) => entry.styles.includes("professional")).map((entry) => entry.name));
  });

  it("lists the 高質感課程品牌（黑金） template with a thumbnail under 品牌首頁 + 高質感", async () => {
    await render(library());
    const luxury = cards().find((card) => card.querySelector("[data-template-title]")?.textContent === "高質感課程品牌（黑金）");
    expect(luxury).toBeDefined();
    expect(luxury!.textContent).toContain("品牌首頁");
    expect(luxury!.textContent).toContain("高質感");
    expect(luxury!.querySelector("[data-template-unreadable]")).toBeNull();
    const thumbnail = luxury!.querySelector<HTMLElement>("[aria-hidden=true][inert]");
    // The thumbnail renders the real template, but only its first sections (the card shows the top of the page).
    const sections = thumbnail?.querySelectorAll("[data-funnel-renderer] section").length ?? 0;
    expect(sections).toBeGreaterThan(0);
    expect(sections).toBeLessThanOrEqual(3);

    await click(buttonNamed("品牌首頁", container.querySelector("[role=group][aria-label=用途]")!));
    await click(buttonNamed("高質感", container.querySelector("[role=group][aria-label=風格]")!));
    expect(cardTitles()).toEqual(["高質感課程品牌（黑金）"]);
  });

  it("offers to clear filters when nothing matches", async () => {
    await render(library());
    await click(buttonNamed("條款與政策", container.querySelector("[role=group][aria-label=用途]")!));
    await click(buttonNamed("活潑", container.querySelector("[role=group][aria-label=風格]")!));
    expect(cards()).toHaveLength(0);
    expect(container.textContent).toContain("沒有符合條件的範本");
    await click(buttonNamed("清除篩選"));
    expect(cards()).toHaveLength(listFunnelTemplateCatalog().length);
  });
});

describe("template library tabs", () => {
  it("switches between platform and own templates with the tab semantics", async () => {
    await render(library());
    const platformTab = container.querySelector<HTMLButtonElement>("#template-tab-platform")!;
    const mineTab = container.querySelector<HTMLButtonElement>("#template-tab-mine")!;
    expect(platformTab.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("#template-panel-platform")).not.toBeNull();

    await click(mineTab);
    expect(mineTab.getAttribute("aria-selected")).toBe("true");
    expect(platformTab.getAttribute("tabindex")).toBe("-1");
    expect(container.querySelector("#template-panel-platform")).toBeNull();
    expect(cardTitles("我的範本")).toEqual(["我的秋季名單頁"]);
    expect(container.querySelector("[role=group][aria-label=用途]")).toBeNull();

    await act(async () => { mineTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
    expect(platformTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(platformTab);
  });

  it("opens on 我的範本 and explains how to add one when there is none", async () => {
    await render(library({ myTemplates: [], initialTab: "mine" }));
    expect(container.querySelector("#template-tab-mine")!.getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("還沒有自己的範本");
  });
});

describe("template preview", () => {
  it("opens a full preview, switches desktop and mobile, and hands off to 使用", async () => {
    await render(library());
    await click(buttonNamed("預覽 AI 工具極簡報名頁"));
    expect(dialog()?.textContent).toContain("AI 工具極簡報名頁");
    const viewport = () => document.querySelector("[data-template-preview-viewport]")!;
    expect(viewport().getAttribute("data-template-preview-viewport")).toBe("desktop");

    await click(buttonNamed("手機版", dialog()!));
    expect(viewport().getAttribute("data-template-preview-viewport")).toBe("mobile");
    expect(viewport().className).toContain("max-w-[390px]");
    expect(buttonNamed("手機版", dialog()!)!.getAttribute("aria-pressed")).toBe("true");
    await click(buttonNamed("電腦版", dialog()!));
    expect(viewport().getAttribute("data-template-preview-viewport")).toBe("desktop");

    await click(buttonNamed("使用這個範本", dialog()!));
    expect(document.querySelector("[data-template-preview-viewport]")).toBeNull();
    expect(dialog()?.textContent).toContain("使用「AI 工具極簡報名頁」");
    const create = [...dialog()!.querySelectorAll("a")].find((link) => link.textContent?.includes("前往建立"));
    expect(create?.getAttribute("href")).toBe(templateCreateHref({ kind: "platform", id: "webinar-ai-minimal", goal: "webinar" }));
  });

  it("closes the preview with the close button", async () => {
    await render(library());
    await click(buttonNamed("預覽 AI 工具極簡報名頁"));
    await click(buttonNamed("關閉", dialog()!));
    expect(dialog()).toBeNull();
  });
});

describe("apply to an existing site", () => {
  async function openApply(templateButton: string) {
    await click(buttonNamed(templateButton));
    await click([...dialog()!.querySelectorAll("label")].find((label) => label.textContent?.includes("套用到現有網站"))!.querySelector("input"));
    mocks.readTarget.mockResolvedValue({ ok: true, target });
    await choose(dialog()!.querySelector("select")!, "page_1");
  }

  it("requires the overwrite confirmation before applying, then sends the revision it read", async () => {
    await render(library({ initialTab: "mine" }));
    await openApply("使用 我的秋季名單頁");
    expect(mocks.readTarget).toHaveBeenCalledWith("page_1");
    const radios = [...dialog()!.querySelectorAll<HTMLInputElement>("input[name=template-target-step]")];
    expect(radios.map((radio) => [radio.value, radio.disabled])).toEqual([["opt_in", false], ["opt_in_thank_you", false], ["inactive", true]]);
    expect(radios[0]!.checked).toBe(true);

    const applyButton = () => buttonNamed("套用範本", dialog()!)!;
    expect(applyButton().disabled).toBe(true);
    expect(dialog()!.textContent).toContain("取代「名單頁」目前的頁面內容");
    await click(dialog()!.querySelector("input[type=checkbox]"));
    expect(applyButton().disabled).toBe(false);

    mocks.apply.mockResolvedValue({ status: "success", message: "範本已套用；可以前往編輯器調整內容。", id: "page_1", revision: 8, stepId: "opt_in" });
    await click(applyButton());
    const sent = mocks.apply.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(sent.entries())).toEqual({ csrf: "synthetic-token", templateKind: "mine", templateId: "tpl_own_1", pageId: "page_1", stepId: "opt_in", revision: "7" });
    expect(dialog()!.textContent).toContain("範本已套用");
    expect([...dialog()!.querySelectorAll("a")].find((link) => link.textContent === "前往編輯器")?.getAttribute("href")).toContain("/landing-pages/page_1/edit");
  });

  it("resets the confirmation when another step is chosen and offers a reload on conflict", async () => {
    await render(library({ initialTab: "mine" }));
    await openApply("使用 我的秋季名單頁");
    await click(dialog()!.querySelector("input[type=checkbox]"));
    await click(dialog()!.querySelector("input[value=opt_in_thank_you]"));
    expect(dialog()!.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked).toBe(false);
    expect(dialog()!.textContent).toContain("取代「感謝頁」目前的頁面內容");

    await click(dialog()!.querySelector("input[type=checkbox]"));
    mocks.apply.mockResolvedValue({ status: "error", code: "conflict", message: "這個網站已有較新的版本，系統沒有覆蓋它。" });
    await click(buttonNamed("套用範本", dialog()!));
    expect(dialog()!.querySelector("[role=alert]")?.textContent).toContain("較新的版本");
    mocks.readTarget.mockResolvedValue({ ok: true, target: { ...target, revision: 9 } });
    await click(buttonNamed("重新讀取網站", dialog()!));
    expect(mocks.readTarget).toHaveBeenCalledTimes(2);
  });

  it("only offers the steps a platform template fits", async () => {
    await render(library());
    await openApply("使用 AI 工具極簡報名頁");
    const radios = [...dialog()!.querySelectorAll<HTMLInputElement>("input[name=template-target-step]")];
    expect(radios.every((radio) => radio.disabled)).toBe(true);
    expect(dialog()!.textContent).toContain("這個範本不適用此步驟類型");
    expect(templateStepAvailability({ kind: "platform", id: "leads-checklist-minimal" }, target, target.steps[0]!)).toEqual({ ok: true });
    expect(templateStepAvailability({ kind: "platform", id: "audience-volunteer" }, target, target.steps[0]!)).toEqual({ ok: false, reason: "這個範本不適用此步驟類型" });
  });

  it("shows the project guidance on both paths when no project is selected, and switches in place", async () => {
    await render(library({ sites: null, projects: [{ id: "project_1", name: "秋季課程" }] }));
    await click(buttonNamed("使用 AI 工具極簡報名頁"));
    const guidance = () => dialog()!.querySelector("[data-sales-project-required]");
    expect(guidance()?.textContent).toContain("一頁式網站屬於銷售專案，請先選擇專案");
    expect([...dialog()!.querySelectorAll("a")].some((link) => link.textContent?.includes("前往建立"))).toBe(false);
    await click([...dialog()!.querySelectorAll("label")].find((label) => label.textContent?.includes("套用到現有網站"))!.querySelector("input"));
    expect(guidance()?.textContent).toContain("切換到「秋季課程」");
    expect(dialog()!.querySelector("select")).toBeNull();
    mocks.selectProject.mockResolvedValue(undefined);
    await click(buttonNamed("切換到「秋季課程」", dialog()!));
    expect(mocks.selectProject).toHaveBeenCalledWith("project_1");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("offers to create a sales project from the template dialog when there is none", async () => {
    await render(library({ sites: null, projects: [] }));
    await click(buttonNamed("使用 AI 工具極簡報名頁"));
    expect(dialog()!.querySelector('a[href="/projects/new"]')?.textContent).toBe("建立銷售專案");
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});

describe("own template list", () => {
  it("reads the full document only when an own template is previewed", async () => {
    mocks.readDocument.mockResolvedValue({ ok: true, document: myDocument });
    await render(library({ initialTab: "mine" }));
    expect(mocks.readDocument).not.toHaveBeenCalled();
    await click(buttonNamed("預覽 我的秋季名單頁"));
    expect(mocks.readDocument).toHaveBeenCalledWith("tpl_own_1");
    expect(dialog()?.textContent).toContain("我的秋季名單頁");
    expect(document.querySelector("[data-template-preview-viewport]")).not.toBeNull();
    await click(buttonNamed("使用這個範本", dialog()!));
    expect(dialog()?.textContent).toContain("使用「我的秋季名單頁」");
  });

  it("reports a preview that cannot be read without opening the dialog", async () => {
    mocks.readDocument.mockResolvedValue({ ok: false, message: "找不到這個範本，或你沒有使用它的權限。" });
    await render(library({ initialTab: "mine" }));
    await click(buttonNamed("預覽 我的秋季名單頁"));
    expect(dialog()).toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("找不到這個範本");
  });

  it("lists an unreadable template so it can only be deleted", async () => {
    await render(library({ initialTab: "mine", myTemplates: [myTemplate, brokenTemplate] }));
    const broken = cards("我的範本").find((card) => card.textContent?.includes("壞掉的範本"))!;
    expect(broken.querySelector("[data-template-unreadable]")?.textContent).toContain("無法讀取這個範本的內容");
    expect([...broken.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"))).toEqual(["刪除 壞掉的範本"]);
    mocks.remove.mockResolvedValue({ status: "success", message: "ok", id: "tpl_broken" });
    await click(buttonNamed("刪除 壞掉的範本"));
    await click(buttonNamed("刪除範本", dialog()!));
    expect(cardTitles("我的範本")).toEqual(["我的秋季名單頁"]);
  });
});

describe("page custom CSS and JS in the library", () => {
  /** A stored template whose page CSS paints headings in `color` and whose 自訂程式碼 node has JS. */
  function styled(id: string, color: string) {
    const document = structuredClone(myDocument);
    document.settings.customCss = `h2 { color: ${color}; }`;
    document.root = [{ schemaVersion: 1, id: `${id}_section`, type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1, id: `${id}_row`, type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [
      { schemaVersion: 1, id: `${id}_title`, type: "headline", props: { text: `${id} 標題`, level: "h2" }, style: {}, overrides: {}, visible: true, actions: [], attributes: {} },
      { schemaVersion: 1, id: `${id}_code`, type: "raw_html", props: { html: "<p>區塊</p>", js: "document.title = 'ran';" }, style: {}, overrides: {}, visible: true, actions: [], attributes: {} },
    ] }] }];
    const summary: LandingPageTemplateSummary = { id, name: `範本 ${id}`, readable: true, thumbnail: document, createdAt: "2026-10-20T02:00:00.000Z", updatedAt: "2026-10-26T02:00:00.000Z" };
    return { document, summary };
  }
  const customCssStyles = () => [...document.querySelectorAll("style[data-funnel-custom-css]")].map((style) => style.textContent ?? "");
  const scriptFrames = () => document.querySelectorAll('iframe[sandbox*="allow-scripts"]').length;

  it("never outputs page custom CSS or runs JS in thumbnails, even when a thumbnail carries them", async () => {
    const first = styled("tpl_red", "#b91c1c");
    const second = styled("tpl_green", "#047857");
    await render(library({ initialTab: "mine", myTemplates: [first.summary, second.summary] }));
    expect(cardTitles("我的範本")).toEqual(["範本 tpl_red", "範本 tpl_green"]);
    expect(customCssStyles()).toEqual([]);
    expect(scriptFrames()).toBe(0);
  });

  it("outputs only the previewed template's page CSS, does not run its JS, and says so", async () => {
    const first = styled("tpl_red", "#b91c1c");
    const second = styled("tpl_green", "#047857");
    mocks.readDocument.mockResolvedValue({ ok: true, document: second.document });
    await render(library({ initialTab: "mine", myTemplates: [first.summary, second.summary] }));
    await click(buttonNamed("預覽 範本 tpl_green"));
    const styles = customCssStyles();
    expect(styles).toHaveLength(1);
    expect(styles[0]).toContain("#047857");
    expect(styles[0]).not.toContain("#b91c1c");
    expect(scriptFrames()).toBe(0);
    expect(dialog()!.textContent).toContain("JS 只會在公開頁的隔離沙箱中執行，預覽不執行");
    await click(buttonNamed("關閉", dialog()!));
    expect(customCssStyles()).toEqual([]);
  });

  it("keeps the usual note for a template without JS", async () => {
    mocks.readDocument.mockResolvedValue({ ok: true, document: myDocument });
    await render(library({ initialTab: "mine" }));
    await click(buttonNamed("預覽 我的秋季名單頁"));
    expect(dialog()!.textContent).toContain("預覽與使用後的頁面內容與顯示方式相同。");
  });
});

describe("own template management", () => {
  it("renames a template", async () => {
    await render(library({ initialTab: "mine" }));
    await click(buttonNamed("改名 我的秋季名單頁"));
    await type(dialog()!.querySelector("input")!, "冬季名單頁");
    mocks.rename.mockResolvedValue({ status: "success", message: "ok", id: "tpl_own_1" });
    await act(async () => { dialog()!.querySelector("form")!.requestSubmit(); });
    expect(Object.fromEntries((mocks.rename.mock.calls[0]![1] as FormData).entries())).toMatchObject({ templateId: "tpl_own_1", name: "冬季名單頁" });
    expect(cardTitles("我的範本")).toEqual(["冬季名單頁"]);
    expect(container.textContent).toContain("範本已改名為「冬季名單頁」");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("asks before deleting and keeps the template when the server refuses", async () => {
    await render(library({ initialTab: "mine" }));
    await click(buttonNamed("刪除 我的秋季名單頁"));
    expect(document.querySelector("[role=alertdialog]")?.textContent).toContain("刪除範本「我的秋季名單頁」？");
    mocks.remove.mockResolvedValueOnce({ status: "error", message: "找不到這個範本，或你沒有使用它的權限。" });
    await click(buttonNamed("刪除範本", dialog()!));
    expect(dialog()!.querySelector("[role=alert]")?.textContent).toContain("找不到這個範本");
    expect(cardTitles("我的範本")).toHaveLength(1);

    mocks.remove.mockResolvedValueOnce({ status: "success", message: "ok", id: "tpl_own_1" });
    await click(buttonNamed("刪除範本", dialog()!));
    expect(dialog()).toBeNull();
    expect(cardTitles("我的範本")).toHaveLength(0);
  });
});

describe("save as template dialog", () => {
  it("sends only the page, step and name, and links to 我的範本 after saving", async () => {
    mocks.save.mockResolvedValue({ status: "success", message: "已存成範本「網站－名單頁」。", id: "tpl_new" });
    await render(<SaveAsTemplateDialog csrfName="csrf" csrfToken="synthetic-token" pageId="page_1" stepId="opt_in" stepName="名單頁" defaultName="網站－名單頁" onClose={vi.fn()} />);
    expect(dialog()!.textContent).toContain("不會存入範本");
    await act(async () => { dialog()!.querySelector("form")!.requestSubmit(); });
    expect(Object.fromEntries((mocks.save.mock.calls[0]![1] as FormData).entries())).toEqual({ csrf: "synthetic-token", pageId: "page_1", stepId: "opt_in", name: "網站－名單頁" });
    expect([...dialog()!.querySelectorAll("a")].find((link) => link.textContent === "查看我的範本")?.getAttribute("href")).toBe("/landing-pages/templates?tab=mine");
  });

  it("blocks saving while there are unsaved changes", async () => {
    await render(<SaveAsTemplateDialog csrfName="csrf" csrfToken="t" pageId="page_1" defaultName="網站" blockedReason="你有尚未儲存的變更。" onClose={vi.fn()} />);
    expect(buttonNamed("存成範本", dialog()!)!.disabled).toBe(true);
    expect(dialog()!.textContent).toContain("你有尚未儲存的變更");
    await act(async () => { dialog()!.querySelector("form")!.requestSubmit(); });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
