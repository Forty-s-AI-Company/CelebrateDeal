// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE } from "@/lib/funnel-custom-code";
import { FunnelCustomCodeSurfaceProvider, SandboxedCustomCode } from "./sandboxed-html";
import { FunnelPageDocumentRenderer } from "./funnel-page-document-renderer";
import { PublicFunnelDocument } from "./public-funnel-document";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";

const code = { html: "<p class=\"m\">merchant</p><script>inline()</script>", css: ".m{color:red}", js: "document.body.dataset.ran = '1';" };

function frameOf(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.querySelector("iframe")!;
}

function codeNode(id: string, props: Record<string, unknown>): FunnelNode {
  return { schemaVersion: 1, id, type: "raw_html", props, style: {}, overrides: {}, visible: true, actions: [], attributes: {} };
}

function page(nodes: FunnelNode[], customCss?: string): PageDocument {
  const value = createEmptyPageDocument("page-1");
  value.root = [{
    schemaVersion: 1, id: "section", type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {},
    children: [{ schemaVersion: 1, id: "row", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: nodes }],
  }];
  if (customCss !== undefined) value.settings.customCss = customCss;
  return value;
}

describe("SandboxedCustomCode markup", () => {
  it("script mode: exactly allow-scripts, merchant code raw inside an opaque-origin srcdoc with the frame CSP", () => {
    const frame = frameOf(renderToStaticMarkup(<SandboxedCustomCode code={code} mode="script" label="自訂" />));
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    const srcDoc = frame.getAttribute("srcdoc")!;
    expect(srcDoc).toContain("connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'");
    expect(srcDoc).toContain("script-src 'unsafe-inline' https:");
    expect(srcDoc).toContain("<script>inline()</script>");
    expect(srcDoc).toContain("document.body.dataset.ran");
  });

  it("only public pages add popups, always together with escape-sandbox and never anything broader", () => {
    const frame = frameOf(renderToStaticMarkup(<FunnelCustomCodeSurfaceProvider allowPopups><SandboxedCustomCode code={code} mode="script" label="自訂" /></FunnelCustomCodeSurfaceProvider>));
    expect(frame.getAttribute("sandbox")!.split(" ").sort()).toEqual(["allow-popups", "allow-popups-to-escape-sandbox", "allow-scripts"]);
    const staticFrame = frameOf(renderToStaticMarkup(<FunnelCustomCodeSurfaceProvider allowPopups><SandboxedCustomCode code={code} mode="static" label="自訂" /></FunnelCustomCodeSurfaceProvider>));
    expect(staticFrame.getAttribute("sandbox")).toBe("");
  });

  it("static mode: empty sandbox, sanitized HTML, no script, and keeps the CSS inside the frame", () => {
    const frame = frameOf(renderToStaticMarkup(<SandboxedCustomCode code={code} mode="static" label="自訂" />));
    expect(frame.getAttribute("sandbox")).toBe("");
    const srcDoc = frame.getAttribute("srcdoc")!;
    expect(srcDoc).not.toContain("<script");
    expect(srcDoc).toContain("script-src 'none'");
    expect(srcDoc).toContain('<p class="m">merchant</p>');
    expect(srcDoc).toContain(".m{color:red}");
  });
});

describe("SandboxedCustomCode height messages", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("accepts a valid height only from its own iframe and ignores everything else", async () => {
    await act(async () => { root.render(<><SandboxedCustomCode code={code} mode="script" label="A" height={200} /><iframe title="other" /></>); });
    const frame = container.querySelector<HTMLIFrameElement>('iframe[title="A"]')!;
    const other = container.querySelector<HTMLIFrameElement>('iframe[title="other"]')!;
    expect(frame.contentWindow).toBeTruthy();
    const send = async (data: unknown, source: Window | null) => {
      await act(async () => { window.dispatchEvent(new MessageEvent("message", { data, source: source as MessageEventSource | null })); });
    };
    expect(frame.style.height).toBe("200px");
    await send({ type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: 480 }, frame.contentWindow);
    expect(frame.style.height).toBe("480px");
    // Wrong source: another frame, the page itself, or no source at all.
    await send({ type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: 900 }, other.contentWindow);
    await send({ type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: 901 }, window);
    await send({ type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: 902 }, null);
    // Right source, bad data.
    for (const height of ["700", Number.NaN, Number.POSITIVE_INFINITY, 20_001, -5, 1e12]) {
      await send({ type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height }, frame.contentWindow);
    }
    await send(640, frame.contentWindow);
    await send({ type: "other", height: 640 }, frame.contentWindow);
    expect(frame.style.height).toBe("480px");
  });

  it("static frames never listen for height messages", async () => {
    await act(async () => { root.render(<SandboxedCustomCode code={code} mode="static" label="S" height={300} />); });
    const frame = container.querySelector<HTMLIFrameElement>('iframe[title="S"]')!;
    await act(async () => { window.dispatchEvent(new MessageEvent("message", { data: { type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: 999 }, source: frame.contentWindow as MessageEventSource | null })); });
    expect(frame.style.height).toBe("300px");
  });
});

describe("renderer integration", () => {
  it("runs JS only outside the editor canvas", () => {
    const doc = page([codeNode("code", { html: "<p>x</p>", js: "run()" })]);
    expect(frameOf(renderToStaticMarkup(<FunnelPageDocumentRenderer document={doc} mode="preview" />)).getAttribute("sandbox")).toBe("allow-scripts");
    const editor = renderToStaticMarkup(<FunnelPageDocumentRenderer document={doc} mode="editor" />);
    expect(frameOf(editor).getAttribute("sandbox")).toBe("");
    expect(editor).toContain("JS 只在預覽與公開頁面的隔離沙箱中執行");
  });

  it("ignores code smuggled into responsive overrides", () => {
    const node = codeNode("code", { html: "<p>base</p>" });
    node.overrides = { mobile: { props: { js: "smuggled()", html: "<p>override</p>" } } };
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page([node])} viewport="mobile" mode="preview" />);
    expect(frameOf(html).getAttribute("sandbox")).toBe("");
    expect(html).not.toContain("smuggled");
    expect(html).not.toContain("override");
  });

  it("renders page CSS scoped inside a contained shell and keeps the platform disclosure outside it", () => {
    const doc = page([codeNode("code", { html: "<p>x</p>", js: "run()" })], "body{display:none} * {display:none} .x{position:fixed;inset:0;z-index:2147483647;background:#fff}");
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<PublicFunnelDocument document={doc} viewport="desktop" />);
    const shell = container.querySelector<HTMLElement>("[data-funnel-content-shell]")!;
    expect(shell.style.contain).toBe("layout paint");
    expect(shell.style.isolation).toBe("isolate");
    const style = shell.querySelector("style[data-funnel-custom-css]")!.textContent!;
    for (const rule of style.split("\n")) expect(rule.startsWith("[data-funnel-content]")).toBe(true);
    expect(shell.querySelector("[data-funnel-content]")).not.toBeNull();
    const disclosure = container.querySelector("[data-funnel-platform-disclosure]")!;
    expect(disclosure.textContent).toContain("部分互動內容為商家自訂腳本");
    expect(disclosure.closest("[data-funnel-content]")).toBeNull();
    expect(disclosure.closest("[data-funnel-content-shell]")).toBeNull();
    expect(disclosure.querySelector('a[href="/policies/privacy"]')).not.toBeNull();
  });

  it("adds no shell, style or disclosure to pages without custom code", () => {
    const html = renderToStaticMarkup(<PublicFunnelDocument document={page([])} viewport="desktop" />);
    expect(html).not.toContain("data-funnel-content-shell");
    expect(html).not.toContain("data-funnel-platform-disclosure");
    expect(html).toContain("data-funnel-content");
  });
});
