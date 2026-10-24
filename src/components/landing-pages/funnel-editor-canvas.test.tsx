// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { FunnelPageEditor } from "./funnel-page-editor";
import { FunnelPageDocumentRenderer } from "./funnel-page-document-renderer";
import { insertPlainText, readEditableText } from "./funnel-inline-editable";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node = (id: string, type: FunnelNode["type"], props: Record<string, unknown> = {}, children?: FunnelNode[], extra: Partial<FunnelNode> = {}): FunnelNode => ({ schemaVersion: 1, id, type, props, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, ...(children ? { children } : {}), ...extra });
function fixture(): PageDocument {
  const document = createEmptyPageDocument("canvas_fixture", "合成頁面");
  document.root = [node("section_a", "section", {}, [node("row_a", "row", {}, [
    node("text_a", "text", { text: "合成文字" }),
    node("headline_a", "headline", { text: "合成標題", level: "h1" }),
    node("button_a", "button", { label: "立即報名" }),
    node("list_a", "bulleted_list", { items: ["第一點", "第二點"] }),
  ])])];
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

function Harness({ onDocument }: { onDocument: (document: PageDocument) => void }) {
  const [document, setDocument] = useState(fixture);
  return <FunnelPageEditor document={document} onChange={(next) => { setDocument(next); onDocument(next); }} />;
}

async function setup() {
  const documents: PageDocument[] = [];
  const container = await mount(<Harness onDocument={(next) => documents.push(next)} />);
  return { container, documents };
}

const canvasNode = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[role="region"] [data-funnel-node-id="${id}"]`)!;
const editable = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-funnel-inline-editing]");
const rowChildren = (document: PageDocument) => document.root[0]!.children![0]!.children!;
const find = (document: PageDocument, id: string) => rowChildren(document).find((item) => item.id === id)!;
const toolbarButton = (container: HTMLElement, label: string) => {
  const match = container.querySelector<HTMLButtonElement>(`[role="toolbar"] button[aria-label="${label}"]`);
  if (!match) throw new Error(`toolbar button not found: ${label}`);
  return match;
};
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
const key = async (target: EventTarget, keyName: string, init: KeyboardEventInit = {}) => {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...init })); });
};
/** Double-click as the browser delivers it: two clicks (the second hits the selected node). */
async function startEditing(container: HTMLElement, target: HTMLElement) {
  await click(target);
  await click(target);
  const element = editable(container);
  if (!element) throw new Error("inline editor did not open");
  return element;
}

describe("inline editing on the canvas", () => {
  it("commits with Enter as one history step that undo restores", async () => {
    const { container, documents } = await setup();
    const element = await startEditing(container, canvasNode(container, "text_a"));
    expect(element.getAttribute("role")).toBe("textbox");
    expect(element.getAttribute("aria-label")).toBe("編輯文字");
    expect(element.textContent).toBe("合成文字");
    element.textContent = "直接在畫布上修改";
    await key(element, "Enter");
    expect(editable(container)).toBeNull();
    expect(documents).toHaveLength(1);
    expect(find(documents[0]!, "text_a").props.text).toBe("直接在畫布上修改");
    // The left panel shows the committed text.
    expect(container.querySelector<HTMLTextAreaElement>("[data-funnel-node-settings] textarea")?.value).toBe("直接在畫布上修改");
    await key(document.body, "z", { ctrlKey: true });
    expect(documents).toHaveLength(2);
    expect(find(documents[1]!, "text_a").props.text).toBe("合成文字");
  });

  it("cancels with Escape without touching the document", async () => {
    const { container, documents } = await setup();
    const element = await startEditing(container, canvasNode(container, "headline_a"));
    expect(element.tagName).toBe("H1");
    element.textContent = "不要保存";
    await key(element, "Escape");
    expect(editable(container)).toBeNull();
    expect(documents).toHaveLength(0);
    expect(canvasNode(container, "headline_a").textContent).toBe("合成標題");
  });

  it("commits on blur and edits button labels in a non-button element", async () => {
    const { container, documents } = await setup();
    const element = await startEditing(container, canvasNode(container, "button_a"));
    expect(element.tagName).toBe("SPAN");
    element.textContent = "馬上加入";
    await act(async () => { element.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(documents).toHaveLength(1);
    expect(find(documents[0]!, "button_a").props.label).toBe("馬上加入");
  });

  it("edits one list entry from the clicked item", async () => {
    const { container, documents } = await setup();
    const second = canvasNode(container, "list_a").querySelectorAll("li")[1] as HTMLElement;
    await click(second);
    await click(second);
    const element = editable(container)!;
    expect(element.tagName).toBe("LI");
    expect(element.textContent).toBe("第二點");
    element.textContent = "改過的第二點";
    await key(element, "Enter");
    expect(find(documents[0]!, "list_a").props.items).toEqual(["第一點", "改過的第二點"]);
  });

  it("opens from the floating toolbar's 編輯文字 button too", async () => {
    const { container } = await setup();
    await click(canvasNode(container, "text_a"));
    await click(toolbarButton(container, "編輯文字文字"));
    expect(editable(container)?.textContent).toBe("合成文字");
  });

  it("pastes plain text only and keeps line breaks only where the node supports them", async () => {
    const { container, documents } = await setup();
    const paste = (target: HTMLElement) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => (type === "text/plain" ? "貼上\r\n第二行​" : "<b onclick=alert(1)>粗體</b>") } });
      target.dispatchEvent(event);
      return event;
    };
    const text = await startEditing(container, canvasNode(container, "text_a"));
    text.textContent = "";
    let event!: Event;
    await act(async () => { event = paste(text); });
    expect(event.defaultPrevented).toBe(true);
    expect(text.innerHTML).not.toContain("<b");
    await key(text, "Enter");
    expect(find(documents[0]!, "text_a").props.text).toBe("貼上\n第二行");

    const headline = await startEditing(container, canvasNode(container, "headline_a"));
    headline.textContent = "";
    await act(async () => { paste(headline); });
    await key(headline, "Enter");
    expect(find(documents.at(-1)!, "headline_a").props.text).toBe("貼上 第二行");
  });

  it("adds a line break with Shift+Enter in text but not in single-line nodes", async () => {
    const { container, documents } = await setup();
    const text = await startEditing(container, canvasNode(container, "text_a"));
    await key(text, "Enter", { shiftKey: true });
    expect(editable(container)).not.toBeNull();
    text.append("下一行");
    await key(text, "Enter");
    expect(find(documents[0]!, "text_a").props.text).toBe("合成文字\n下一行");
    const headline = await startEditing(container, canvasNode(container, "headline_a"));
    await key(headline, "Enter", { shiftKey: true });
    expect(headline.textContent).toBe("合成標題");
    expect(editable(container)).not.toBeNull();
  });

  it("suppresses Delete, undo and Escape-deselect shortcuts while editing", async () => {
    const { container, documents } = await setup();
    const element = await startEditing(container, canvasNode(container, "text_a"));
    for (const target of [element, document.body]) {
      await key(target, "Delete");
      await key(target, "Backspace");
      await key(target, "z", { ctrlKey: true });
      await key(target, "y", { ctrlKey: true });
    }
    expect(documents).toHaveLength(0);
    expect(editable(container)).not.toBeNull();
    expect(canvasNode(container, "text_a")).not.toBeNull();
    const save = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => { element.dispatchEvent(save); });
    expect(save.defaultPrevented).toBe(true);
  });

  it("reads typed line breaks and inserts plain text at the caret", () => {
    const host = document.createElement("div");
    host.innerHTML = "第一行<br>第二行<div>第三行</div>";
    expect(readEditableText(host)).toBe("第一行\n第二行\n第三行");
    const target = document.createElement("p");
    target.textContent = "AB";
    document.body.append(target);
    insertPlainText(target, "<i>C</i>");
    expect(target.textContent).toBe("AB<i>C</i>");
    expect(target.querySelector("i")).toBeNull();
    target.remove();
  });
});

describe("contentEditable stays inside the editor", () => {
  const binding = { nodeId: "text_a", onCommit: () => undefined, onCancel: () => undefined };
  it("never renders an editable element in preview or public renders", () => {
    const preview = renderToStaticMarkup(<FunnelPageDocumentRenderer document={fixture()} mode="preview" inlineEditing={binding} />);
    const publicPage = renderToStaticMarkup(<FunnelPageDocumentRenderer document={fixture()} publicSurface inlineEditing={binding} />);
    for (const html of [preview, publicPage]) {
      expect(html).not.toMatch(/contenteditable/iu);
      expect(html).not.toContain("data-funnel-inline-editing");
      expect(html).not.toContain("data-funnel-list-item");
    }
    expect(renderToStaticMarkup(<FunnelPageDocumentRenderer document={fixture()} mode="editor" inlineEditing={binding} />)).toMatch(/contenteditable="(?:true|plaintext-only)"/iu);
    expect(renderToStaticMarkup(<FunnelPageDocumentRenderer document={fixture()} mode="editor" />)).not.toMatch(/contenteditable/iu);
  });
});

describe("selection chrome", () => {
  it("attaches a labelled toolbar to the selected node", async () => {
    const { container } = await setup();
    await click(canvasNode(container, "headline_a"));
    const toolbar = container.querySelector('[role="toolbar"]')!;
    expect(toolbar.getAttribute("aria-label")).toBe("標題工具");
    const labels = Array.from(toolbar.querySelectorAll("button")).map((item) => item.getAttribute("aria-label"));
    expect(labels).toEqual(["拖曳移動標題", "編輯標題文字", "上移標題", "下移標題", "複製標題", "選取上層", "刪除標題"]);
    expect(toolbarButton(container, "上移標題").disabled).toBe(false);
    await click(canvasNode(container, "text_a"));
    expect(toolbarButton(container, "上移文字").disabled).toBe(true);
    await click(canvasNode(container, "list_a"));
    expect(toolbarButton(container, "下移項目清單").disabled).toBe(true);
  });

  it("moves, duplicates next to the original, selects the parent and deletes with focus kept on the canvas", async () => {
    const { container, documents } = await setup();
    await click(canvasNode(container, "headline_a"));
    await click(toolbarButton(container, "上移標題"));
    expect(rowChildren(documents.at(-1)!).map((item) => item.id).slice(0, 2)).toEqual(["headline_a", "text_a"]);
    const duplicate = toolbarButton(container, "複製標題");
    duplicate.focus();
    await click(duplicate);
    const ids = rowChildren(documents.at(-1)!).map((item) => item.id);
    expect(ids[0]).toBe("headline_a");
    expect(ids[1]).toMatch(/^headline_/u);
    expect(ids[1]).not.toBe("headline_a");
    expect(canvasNode(container, ids[1]!).getAttribute("data-funnel-selected")).toBe("true");
    expect(document.activeElement).toBe(toolbarButton(container, "複製標題"));
    expect(container.querySelector('[role="status"][aria-live="polite"]')?.textContent).toContain("已複製標題");
    await click(toolbarButton(container, "選取上層"));
    expect(container.querySelector("[data-funnel-node-settings]")?.getAttribute("data-funnel-node-settings")).toBe("row");
    await click(canvasNode(container, "text_a"));
    await click(toolbarButton(container, "刪除文字"));
    expect(rowChildren(documents.at(-1)!).some((item) => item.id === "text_a")).toBe(false);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("編輯畫布");
  });
});

describe("device visibility", () => {
  it("toggles 手機顯示 as one override command and dims the node only in the editor", async () => {
    const { container, documents } = await setup();
    await click(canvasNode(container, "text_a"));
    const toggles = Array.from(container.querySelectorAll<HTMLLabelElement>("[data-funnel-device-visibility] label"));
    expect(toggles.map((label) => label.textContent)).toEqual(["桌機顯示", "手機顯示"]);
    const mobile = toggles[1]!.querySelector("input")!;
    expect(mobile.checked).toBe(true);
    await click(mobile);
    expect(documents).toHaveLength(1);
    expect(find(documents[0]!, "text_a").overrides).toEqual({ mobile: { visible: false } });
    expect(canvasNode(container, "text_a").hasAttribute("data-funnel-hidden")).toBe(false);
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="手機"]')!);
    expect(canvasNode(container, "text_a").getAttribute("data-funnel-hidden")).toBe("mobile");
    expect(canvasNode(container, "text_a").textContent).toContain("手機版隱藏");
    const preview = renderToStaticMarkup(<FunnelPageDocumentRenderer document={documents[0]!} viewport="mobile" />);
    expect(preview).not.toContain("合成文字");
    expect(preview).not.toContain("手機版隱藏");
    await key(document.body, "z", { ctrlKey: true });
    expect(find(documents.at(-1)!, "text_a").overrides).toEqual({});
  });
});

type FakeTransfer = { types: string[]; dropEffect: string; effectAllowed: string; data: Record<string, string>; setData: (type: string, value: string) => void; getData: (type: string) => string; setDragImage: () => void };
function transfer(): FakeTransfer {
  const value: FakeTransfer = { types: [], dropEffect: "none", effectAllowed: "all", data: {}, setData: (type, data) => { value.data[type] = data; value.types.push(type); }, getData: (type) => value.data[type] ?? "", setDragImage: () => undefined };
  return value;
}
function dragEvent(type: string, data: FakeTransfer) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { dataTransfer: { value: data }, clientX: { value: 0 }, clientY: { value: 0 } });
  return event;
}
async function fire(target: EventTarget, event: Event) {
  await act(async () => { target.dispatchEvent(event); });
  return event;
}

describe("drag and drop", () => {
  it("drops a library element after the hovered node as one undoable command", async () => {
    const { container, documents } = await setup();
    const data = transfer();
    await fire(container.querySelector<HTMLElement>('[data-palette-type="headline"]')!, dragEvent("dragstart", data));
    const over = await fire(canvasNode(container, "text_a"), dragEvent("dragover", data));
    expect(over.defaultPrevented).toBe(true);
    expect(data.dropEffect).toBe("copy");
    await fire(canvasNode(container, "text_a"), dragEvent("drop", data));
    expect(documents).toHaveLength(1);
    const ids = rowChildren(documents[0]!).map((item) => item.id);
    expect(ids[0]).toBe("text_a");
    expect(rowChildren(documents[0]!)[1]!.type).toBe("headline");
    await key(document.body, "z", { ctrlKey: true });
    expect(rowChildren(documents.at(-1)!).map((item) => item.id)).toEqual(["text_a", "headline_a", "button_a", "list_a"]);
  });

  it("moves a node with the toolbar drag handle and ignores drops on itself", async () => {
    const { container, documents } = await setup();
    await click(canvasNode(container, "text_a"));
    const data = transfer();
    await fire(toolbarButton(container, "拖曳移動文字"), dragEvent("dragstart", data));
    const self = await fire(canvasNode(container, "text_a"), dragEvent("dragover", data));
    expect(self.defaultPrevented).toBe(false);
    await fire(canvasNode(container, "text_a"), dragEvent("drop", data));
    expect(documents).toHaveLength(0);
    await fire(toolbarButton(container, "拖曳移動文字"), dragEvent("dragstart", data));
    const over = await fire(canvasNode(container, "list_a"), dragEvent("dragover", data));
    expect(over.defaultPrevented).toBe(true);
    expect(data.dropEffect).toBe("move");
    await fire(canvasNode(container, "list_a"), dragEvent("drop", data));
    expect(documents).toHaveLength(1);
    expect(rowChildren(documents[0]!).map((item) => item.id)).toEqual(["headline_a", "button_a", "list_a", "text_a"]);
  });

  it("ignores foreign drags such as files", async () => {
    const { container, documents } = await setup();
    const data = transfer();
    data.types.push("Files");
    const over = await fire(canvasNode(container, "text_a"), dragEvent("dragover", data));
    expect(over.defaultPrevented).toBe(false);
    await fire(canvasNode(container, "text_a"), dragEvent("drop", data));
    expect(documents).toHaveLength(0);
  });
});
