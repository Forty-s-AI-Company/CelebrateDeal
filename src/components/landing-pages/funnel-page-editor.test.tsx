// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FunnelPageEditor } from "./funnel-page-editor";
import { editorShortcutFor, isTypingTarget, type FunnelEditorChrome } from "./funnel-editor-chrome";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node = (id: string, type: FunnelNode["type"], props: Record<string, unknown> = {}, children?: FunnelNode[]): FunnelNode => ({ schemaVersion: 1, id, type, props, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, ...(children ? { children } : {}) });
function fixture(): PageDocument {
  const document = createEmptyPageDocument("editor_fixture", "合成頁面");
  document.root = [node("section_a", "section", {}, [node("row_a", "row", {}, [node("text_a", "text", { text: "合成文字" })])])];
  return document;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function mount(element: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
  return container;
}
const button = (container: HTMLElement, name: string) => {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === name);
  if (!match) throw new Error(`button not found: ${name}`);
  return match;
};
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
const press = async (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
};

/** Controlled parent echoing every accepted document, like the workspace does. */
function Harness({ chrome, onDocument }: { chrome?: Partial<FunnelEditorChrome>; onDocument?: (document: PageDocument) => void }) {
  const [document, setDocument] = useState(fixture);
  const fullChrome: FunnelEditorChrome | undefined = chrome ? { title: "合成網站", saveState: "saved", onSave: () => undefined, onExit: () => undefined, ...chrome } : undefined;
  return <FunnelPageEditor document={document} chrome={fullChrome} onChange={(next) => { setDocument(next); onDocument?.(next); }} />;
}
const rootIds = (document: PageDocument) => JSON.stringify(document.root.map((item) => item.id));

describe("full-screen editor toolbar", () => {
  it("enables undo and redo only when history allows it", async () => {
    const container = await mount(<Harness />);
    expect(button(container, "復原").disabled).toBe(true);
    expect(button(container, "重做").disabled).toBe(true);
    await click(button(container, "區段"));
    expect(button(container, "復原").disabled).toBe(false);
    expect(button(container, "重做").disabled).toBe(true);
    await click(button(container, "復原"));
    expect(button(container, "復原").disabled).toBe(true);
    expect(button(container, "重做").disabled).toBe(false);
  });

  it("disables 儲存 when there is nothing to save and labels the saving state", async () => {
    const saved = await mount(<Harness chrome={{ saveState: "saved" }} />);
    expect(button(saved, "已儲存").disabled).toBe(true);
    const dirty = await mount(<Harness chrome={{ saveState: "dirty" }} />);
    expect(button(dirty, "儲存").disabled).toBe(false);
    const blocked = await mount(<Harness chrome={{ saveState: "dirty", saveBlocked: true }} />);
    expect(button(blocked, "儲存").disabled).toBe(true);
    const saving = await mount(<Harness chrome={{ saveState: "saving" }} />);
    expect(button(saving, "儲存中…").disabled).toBe(true);
  });

  it("shows the selected node's breadcrumb and selects an ancestor from it", async () => {
    const container = await mount(<Harness chrome={{}} />);
    expect(container.querySelector("header")?.textContent).toContain("合成網站");
    await click(container.querySelector<HTMLElement>('[data-funnel-node-id="text_a"]')!);
    const crumbs = Array.from(container.querySelectorAll('nav[aria-label="目前選取位置"] button')).map((item) => item.textContent);
    expect(crumbs).toEqual(["區段", "欄列", "文字"]);
    await click(button(container, "選取區段"));
    expect(container.querySelector('[data-funnel-node-settings]')?.getAttribute("data-funnel-node-settings")).toBe("section");
    expect(container.querySelector('[data-funnel-node-id="section_a"]')?.getAttribute("data-funnel-selected")).toBe("true");
  });
});

describe("left panel", () => {
  it("switches to the selected node's settings and back to the library", async () => {
    const container = await mount(<Harness />);
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("元件");
    await click(container.querySelector<HTMLElement>('[data-funnel-node-id="text_a"]')!);
    const settings = container.querySelector('[data-funnel-node-settings="text"]');
    expect(settings).not.toBeNull();
    expect(settings?.querySelector("h2")?.textContent).toBe("文字");
    for (const label of ["上移文字", "下移文字", "複製文字", "刪除文字"]) expect(button(container, label)).toBeTruthy();
    expect(container.querySelector('[role="tab"]')).toBeNull();
    await click(button(container, "返回（取消選取）"));
    expect(container.querySelector("[data-funnel-node-settings]")).toBeNull();
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("元件");
  });

  it("opens 頁面設定 and 彈出視窗 as panel views from the toolbar", async () => {
    const container = await mount(<Harness chrome={{ pageSettings: <p>工作區欄位</p> }} />);
    await click(button(container, "頁面設定"));
    expect(button(container, "頁面設定").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("aside")?.textContent).toContain("工作區欄位");
    expect(container.querySelector("aside")?.textContent).toContain("搜尋引擎標題");
    await click(button(container, "彈出視窗"));
    expect(container.querySelector("aside h2")?.textContent).toBe("彈出視窗");
    await click(button(container, "返回"));
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("元件");
  });

  it("lists block categories first and opens a category with a 返回 button", async () => {
    const container = await mount(<Harness />);
    await click(button(container, "版型區塊"));
    const categories = container.querySelectorAll('[aria-label="版型區塊分類"] button');
    expect(categories.length).toBeGreaterThan(0);
    await click(categories[0] as HTMLElement);
    expect(container.querySelector('[aria-label="版型區塊分類"]')).toBeNull();
    await click(button(container, "返回"));
    expect(container.querySelector('[aria-label="版型區塊分類"]')).not.toBeNull();
  });

  it("collapses with an edge toggle that reports aria-expanded", async () => {
    const container = await mount(<Harness />);
    const toggle = button(container, "收合左側面板");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await click(toggle);
    expect(container.querySelector<HTMLElement>("#funnel-editor-left-panel")?.hidden).toBe(true);
    expect(button(container, "展開左側面板").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("keyboard shortcuts", () => {
  it("deletes the selected node, undoes, redoes and deselects outside text fields", async () => {
    const documents: PageDocument[] = [];
    const container = await mount(<Harness onDocument={(next) => documents.push(next)} />);
    await click(container.querySelector<HTMLElement>('[data-funnel-node-id="section_a"]')!);
    await press("Delete");
    expect(rootIds(documents.at(-1)!)).toBe("[]");
    await press("z", { ctrlKey: true });
    expect(rootIds(documents.at(-1)!)).toBe('["section_a"]');
    await press("z", { ctrlKey: true, shiftKey: true });
    expect(rootIds(documents.at(-1)!)).toBe("[]");
    await press("y", { ctrlKey: true });
    expect(documents).toHaveLength(3);
    await press("z", { metaKey: true });
    expect(rootIds(documents.at(-1)!)).toBe('["section_a"]');
    await click(container.querySelector<HTMLElement>('[data-funnel-node-id="section_a"]')!);
    expect(container.querySelector("[data-funnel-node-settings]")).not.toBeNull();
    await press("Escape");
    expect(container.querySelector("[data-funnel-node-settings]")).toBeNull();
  });

  it("ignores Delete, undo and Escape while typing in an input but still saves with Ctrl+S", async () => {
    const onSave = vi.fn();
    const documents: PageDocument[] = [];
    const container = await mount(<Harness chrome={{ saveState: "dirty", onSave }} onDocument={(next) => documents.push(next)} />);
    await click(container.querySelector<HTMLElement>('[data-funnel-node-id="text_a"]')!);
    const input = container.querySelector<HTMLTextAreaElement>("[data-funnel-node-settings] textarea")!;
    input.focus();
    await press("Delete", {}, input);
    await press("Backspace", {}, input);
    await press("z", { ctrlKey: true }, input);
    await press("Escape", {}, input);
    expect(documents).toHaveLength(0);
    expect(container.querySelector("[data-funnel-node-settings]")).not.toBeNull();
    await press("s", { ctrlKey: true }, input);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("does not save with Ctrl+S when nothing changed", async () => {
    const onSave = vi.fn();
    await mount(<Harness chrome={{ saveState: "saved", onSave }} />);
    await press("s", { ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("maps keys without stealing text editing or dialog keys", () => {
    const base = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, isComposing: false, target: document.body };
    const field = document.createElement("input");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const dialogButton = document.createElement("button");
    dialog.append(dialogButton);
    document.body.append(field, editable, dialog);
    expect(isTypingTarget(field)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(editorShortcutFor({ ...base, key: "Delete" })).toBe("delete");
    expect(editorShortcutFor({ ...base, key: "Delete", target: field })).toBeNull();
    expect(editorShortcutFor({ ...base, key: "Backspace", target: editable })).toBeNull();
    expect(editorShortcutFor({ ...base, key: "z", ctrlKey: true, target: field })).toBeNull();
    expect(editorShortcutFor({ ...base, key: "s", ctrlKey: true, target: field })).toBe("save");
    expect(editorShortcutFor({ ...base, key: "Escape", target: dialogButton })).toBeNull();
    expect(editorShortcutFor({ ...base, key: "Delete", target: dialogButton })).toBeNull();
    expect(editorShortcutFor({ ...base, key: "Delete", altKey: true })).toBeNull();
    expect(editorShortcutFor({ ...base, key: "Escape", defaultPrevented: true })).toBeNull();
    expect(editorShortcutFor({ ...base, key: "z", isComposing: true, ctrlKey: true })).toBeNull();
    field.remove(); editable.remove(); dialog.remove();
  });
});
