// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { FUNNEL_CUSTOM_CODE_DOCUMENT_MESSAGE, FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, FUNNEL_CUSTOM_CODE_READY_MESSAGE } from "@/lib/funnel-custom-code";
import { FunnelCustomCodeSurfaceProvider, SandboxedCustomCode } from "./sandboxed-html";
import { FunnelPageDocumentRenderer } from "./funnel-page-document-renderer";
import { PublicFunnelDocument } from "./public-funnel-document";
import { FunnelCustomCodeRuntime } from "./funnel-custom-code-runtime";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";

/** What the server provides on /lp, the editor and the operations page while the emergency switch is off. */
const enabled = (children: ReactNode, allowPopups = false) => <FunnelCustomCodeSurfaceProvider allowPopups={allowPopups} scriptsEnabled>{children}</FunnelCustomCodeSurfaceProvider>;

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
  it("script mode: exactly allow-scripts, the same-origin sandbox document instead of a srcdoc that would inherit the page's nonce CSP", () => {
    const html = renderToStaticMarkup(enabled(<SandboxedCustomCode code={code} mode="script" label="自訂" />));
    const frame = frameOf(html);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("src")).toBe("/sandbox/custom-code");
    expect(frame.hasAttribute("srcdoc")).toBe(false);
    // The merchant code is posted to the frame after it loads, never put in the page markup.
    expect(html).not.toContain("inline()");
  });

  it("only public pages add popups, always together with escape-sandbox and never anything broader", () => {
    const frame = frameOf(renderToStaticMarkup(enabled(<SandboxedCustomCode code={code} mode="script" label="自訂" />, true)));
    expect(frame.getAttribute("sandbox")!.split(" ").sort()).toEqual(["allow-popups", "allow-popups-to-escape-sandbox", "allow-scripts"]);
    const staticFrame = frameOf(renderToStaticMarkup(enabled(<SandboxedCustomCode code={code} mode="static" label="自訂" />, true)));
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

  /** happy-dom does not load `src` frames; give the script frame a stand-in window. */
  function stubFrameWindow(frame: HTMLIFrameElement) {
    const frameWindow = { postMessage: vi.fn() };
    Object.defineProperty(frame, "contentWindow", { configurable: true, get: () => frameWindow });
    return frameWindow;
  }

  it("posts the merchant document with the frame CSP only to its own frame when that frame is ready", async () => {
    await act(async () => { root.render(enabled(<><SandboxedCustomCode code={code} mode="script" label="A" /><iframe title="other" srcDoc="<p>other</p>" /></>)); });
    const frame = container.querySelector<HTMLIFrameElement>('iframe[title="A"]')!;
    const other = container.querySelector<HTMLIFrameElement>('iframe[title="other"]')!;
    const frameWindow = stubFrameWindow(frame);
    const otherPost = vi.spyOn(other.contentWindow!, "postMessage");
    const send = async (data: unknown, source: unknown) => {
      await act(async () => { window.dispatchEvent(new MessageEvent("message", { data, source: source as MessageEventSource | null })); });
    };
    await send({ type: FUNNEL_CUSTOM_CODE_READY_MESSAGE }, other.contentWindow);
    await send({ type: FUNNEL_CUSTOM_CODE_READY_MESSAGE }, window);
    await send({ type: FUNNEL_CUSTOM_CODE_READY_MESSAGE, extra: true }, frameWindow);
    expect(frameWindow.postMessage).not.toHaveBeenCalled();
    expect(otherPost).not.toHaveBeenCalled();
    await send({ type: FUNNEL_CUSTOM_CODE_READY_MESSAGE }, frameWindow);
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(1);
    const [message, targetOrigin] = frameWindow.postMessage.mock.calls[0]!;
    expect(targetOrigin).toBe("*");
    expect(message.type).toBe(FUNNEL_CUSTOM_CODE_DOCUMENT_MESSAGE);
    expect(message.html).toContain("connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'");
    expect(message.html).toContain("script-src 'unsafe-inline' https:");
    expect(message.html).toContain("<script>inline()</script>");
    expect(message.html).toContain("document.body.dataset.ran");
  });

  it("accepts a valid height only from its own iframe and ignores everything else", async () => {
    await act(async () => { root.render(enabled(<><SandboxedCustomCode code={code} mode="script" label="A" height={200} /><iframe title="other" srcDoc="<p>other</p>" /></>)); });
    const frame = container.querySelector<HTMLIFrameElement>('iframe[title="A"]')!;
    const other = container.querySelector<HTMLIFrameElement>('iframe[title="other"]')!;
    stubFrameWindow(frame);
    expect(frame.contentWindow).toBeTruthy();
    expect(other.contentWindow).toBeTruthy();
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
    expect(frameOf(renderToStaticMarkup(enabled(<FunnelPageDocumentRenderer document={doc} mode="preview" />))).getAttribute("sandbox")).toBe("allow-scripts");
    const editor = renderToStaticMarkup(enabled(<FunnelPageDocumentRenderer document={doc} mode="editor" />));
    expect(frameOf(editor).getAttribute("sandbox")).toBe("");
    expect(editor).toContain("JS 只在預覽與公開頁面的隔離沙箱中執行");
  });

  it("ignores code smuggled into responsive overrides", () => {
    const node = codeNode("code", { html: "<p>base</p>" });
    node.overrides = { mobile: { props: { js: "smuggled()", html: "<p>override</p>" } } };
    const html = renderToStaticMarkup(enabled(<FunnelPageDocumentRenderer document={page([node])} viewport="mobile" mode="preview" />));
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
    // Above-the-fold notice: before the content shell, outside it, only because the page has JS.
    const notice = container.querySelector("[data-funnel-platform-top-notice]")!;
    expect(notice.textContent).toContain("請勿在其中輸入 CelebrateDeal 帳號密碼");
    expect(notice.closest("[data-funnel-content-shell]")).toBeNull();
    expect(notice.compareDocumentPosition(shell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the above-the-fold notice only for pages with custom JS", () => {
    const cssOnly = renderToStaticMarkup(<PublicFunnelDocument document={page([codeNode("code", { html: "<p>x</p>" })], "body{color:red}")} viewport="desktop" />);
    expect(cssOnly).not.toContain("data-funnel-platform-top-notice");
    expect(cssOnly).toContain("data-funnel-platform-disclosure");
  });

  it("adds no shell, style or disclosure to pages without custom code", () => {
    const html = renderToStaticMarkup(<PublicFunnelDocument document={page([])} viewport="desktop" />);
    expect(html).not.toContain("data-funnel-content-shell");
    expect(html).not.toContain("data-funnel-platform-disclosure");
    expect(html).toContain("data-funnel-content");
  });
});

describe("emergency switch on every rendering surface", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("fails closed: without a server-provided runtime no merchant JS runs", () => {
    const html = renderToStaticMarkup(<SandboxedCustomCode code={code} mode="script" label="X" />);
    expect(frameOf(html).getAttribute("sandbox")).toBe("");
    expect(frameOf(html).getAttribute("srcdoc")).not.toContain("<script");
    expect(html).toContain("data-funnel-custom-code-withheld");
  });

  it("the server runtime runs JS only while FUNNEL_CUSTOM_CODE_DISABLED is off, for preview, popups and the public page", () => {
    const doc = page([codeNode("code", { html: "<p>x</p>", js: "run()" })]);
    const surfaces = (allowPopups: boolean) => [
      <FunnelCustomCodeRuntime key="a" allowPopups={allowPopups}><FunnelPageDocumentRenderer document={doc} mode="preview" /></FunnelCustomCodeRuntime>,
      <FunnelCustomCodeRuntime key="b" allowPopups={allowPopups}><PublicFunnelDocument document={doc} viewport="desktop" /></FunnelCustomCodeRuntime>,
    ];
    vi.stubEnv("FUNNEL_CUSTOM_CODE_DISABLED", "");
    for (const surface of surfaces(false)) expect(frameOf(renderToStaticMarkup(surface)).getAttribute("sandbox")).toBe("allow-scripts");
    vi.stubEnv("FUNNEL_CUSTOM_CODE_DISABLED", "1");
    for (const allowPopups of [false, true]) for (const surface of surfaces(allowPopups)) {
      const html = renderToStaticMarkup(surface);
      expect(frameOf(html).getAttribute("sandbox")).toBe("");
      expect(frameOf(html).getAttribute("srcdoc")).not.toContain("run()");
    }
  });
});
