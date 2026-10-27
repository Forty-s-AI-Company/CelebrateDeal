import { describe, expect, it } from "vitest";
import {
  buildFunnelCustomCodeSrcDoc,
  collectFunnelCustomCode,
  contentHasCustomScript,
  describeFunnelCustomCodeProblem,
  diffFunnelCustomCode,
  documentCustomCodeSummary,
  FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE,
  funnelCustomCodeCsp,
  funnelCustomCodeSandbox,
  isFunnelCustomCodeDisabled,
  parseFunnelCustomCodeHeightMessage,
  withoutFunnelCustomScripts,
} from "./funnel-custom-code";
import { createEmptyPageDocument, parsePageDocument, type FunnelNode, type PageDocument } from "./funnel-page-document";

function codeNode(id: string, props: Record<string, unknown>): FunnelNode {
  return { schemaVersion: 1, id, type: "raw_html", props, style: {}, overrides: {}, visible: true, actions: [], attributes: {} };
}

function page(nodes: FunnelNode[], customCss?: string): PageDocument {
  const document = createEmptyPageDocument("page-1");
  document.root = [{
    schemaVersion: 1, id: "section", type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {},
    children: [{ schemaVersion: 1, id: "row", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: nodes }],
  }];
  if (customCss !== undefined) document.settings.customCss = customCss;
  return document;
}

function directive(csp: string, name: string) {
  return csp.split("; ").find((part) => part.startsWith(`${name} `));
}

describe("custom code sandbox contract", () => {
  it("uses exactly the expected sandbox tokens and never grants same-origin, top navigation, forms or modals", () => {
    expect(funnelCustomCodeSandbox("static")).toBe("");
    expect(funnelCustomCodeSandbox("script")).toBe("allow-scripts");
    expect(funnelCustomCodeSandbox("script", { popups: true }).split(" ").sort()).toEqual(["allow-popups", "allow-popups-to-escape-sandbox", "allow-scripts"]);
    for (const mode of ["static", "script"] as const) for (const popups of [false, true]) {
      const tokens = funnelCustomCodeSandbox(mode, { popups });
      for (const forbidden of ["allow-same-origin", "allow-top-navigation", "allow-forms", "allow-modals", "allow-pointer-lock", "allow-downloads", "allow-storage-access"]) {
        expect(tokens).not.toContain(forbidden);
      }
    }
  });

  it("frame CSP loads https assets and scripts only in script mode, and closes connect, form, base and object", () => {
    const script = funnelCustomCodeCsp("script");
    expect(directive(script, "default-src")).toBe("default-src 'none'");
    expect(directive(script, "script-src")).toBe("script-src 'unsafe-inline' https:");
    expect(directive(script, "style-src")).toBe("style-src 'unsafe-inline' https:");
    expect(directive(script, "img-src")).toBe("img-src https: data:");
    expect(directive(script, "font-src")).toBe("font-src https:");
    for (const name of ["connect-src", "form-action", "base-uri", "object-src"]) expect(directive(script, name)).toBe(`${name} 'none'`);
    expect(script).not.toContain("unsafe-eval");
    expect(directive(funnelCustomCodeCsp("static"), "script-src")).toBe("script-src 'none'");
  });

  it("puts the CSP first and the platform height reporter before merchant code", () => {
    const srcDoc = buildFunnelCustomCodeSrcDoc({ html: "<p id=m>merchant</p>", css: ".m{color:red}", js: "window.merchant = 1;" }, "script");
    const head = srcDoc.slice(srcDoc.indexOf("<head>") + 6);
    expect(head.startsWith('<meta http-equiv="Content-Security-Policy" content="default-src \'none\';')).toBe(true);
    const reporter = srcDoc.indexOf(FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE);
    expect(reporter).toBeGreaterThan(0);
    expect(reporter).toBeLessThan(srcDoc.indexOf(".m{color:red}"));
    expect(reporter).toBeLessThan(srcDoc.indexOf("merchant</p>"));
    expect(reporter).toBeLessThan(srcDoc.indexOf("window.merchant"));
  });

  it("cannot end the platform script or style tag early from merchant JS or CSS", () => {
    const srcDoc = buildFunnelCustomCodeSrcDoc({ html: "", css: "a{content:\"</style><b>\"}", js: "const s = '</script><img src=x>';" }, "script");
    expect(srcDoc).not.toContain("</style><b>");
    expect(srcDoc).not.toContain("</script><img");
    expect(srcDoc.match(/<\/script>/gu)).toHaveLength(2);
  });

  it("rewrites only the closing-tag sequences, so regex literals, comparisons and CSS range queries keep their meaning", () => {
    const js = "const re = /a<!--b/; if (i<scriptCount) run(); const s = '</SCRIPT>';";
    const css = "@media (width < 600px){.a{color:red}} .b{content:'</style>'}";
    const srcDoc = buildFunnelCustomCodeSrcDoc({ html: "", css, js }, "script");
    expect(srcDoc).toContain("const re = /a<!--b/; if (i<scriptCount) run();");
    expect(srcDoc).toContain(String.raw`const s = '<\/SCRIPT>';`);
    expect(srcDoc).toContain("@media (width < 600px){.a{color:red}}");
    expect(srcDoc).toContain(String.raw`.b{content:'<\/style>'}`);
  });

  it("static mode carries no script at all", () => {
    const srcDoc = buildFunnelCustomCodeSrcDoc({ html: "<p>x</p>", css: "", js: "alert(1)" }, "static");
    expect(srcDoc).not.toContain("<script");
    expect(srcDoc).not.toContain("alert(1)");
  });
});

describe("height message validation", () => {
  it("accepts only the fixed shape with a finite number in range", () => {
    expect(parseFunnelCustomCodeHeightMessage({ type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: 321.2 })).toBe(322);
    expect(parseFunnelCustomCodeHeightMessage({ type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: 0 })).toBe(0);
    expect(parseFunnelCustomCodeHeightMessage({ type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: 20_000 })).toBe(20_000);
  });

  it.each([
    ["NaN", { type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: Number.NaN }],
    ["Infinity", { type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: Number.POSITIVE_INFINITY }],
    ["huge", { type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: 20_001 }],
    ["negative", { type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: -1 }],
    ["numeric string", { type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: "500" }],
    ["wrong type", { type: "other", height: 100 }],
    ["extra keys", { type: FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, height: 100, href: "https://evil.example" }],
    ["bare number", 100],
    ["array", [FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE, 100]],
    ["null", null],
  ])("ignores %s", (_name, data) => {
    expect(parseFunnelCustomCodeHeightMessage(data)).toBeNull();
  });
});

describe("stored content inventory", () => {
  it("parses legacy html-only nodes and enforces per-field byte limits on the server schema", () => {
    expect(parsePageDocument(page([codeNode("legacy", { html: "<p>舊資料</p>" })]))).not.toBeNull();
    expect(parsePageDocument(page([codeNode("big", { html: "a".repeat(50_000), css: "b".repeat(20_000), js: "c".repeat(50_000) })]))).not.toBeNull();
    expect(parsePageDocument(page([codeNode("html", { html: "a".repeat(50_001) })]))).toBeNull();
    expect(parsePageDocument(page([codeNode("css", { css: "a".repeat(20_001) })]))).toBeNull();
    expect(parsePageDocument(page([codeNode("js", { js: "中".repeat(16_667) })]))).toBeNull(); // 50,001 UTF-8 bytes
    expect(parsePageDocument(page([codeNode("js", { js: 42 })]))).toBeNull();
    // Other node types keep the generic 10,000-character prop limit.
    const text = page([]);
    text.root[0]!.children![0]!.children = [{ ...codeNode("t", { text: "a".repeat(10_001) }), type: "text" }];
    expect(parsePageDocument(text)).toBeNull();
  });

  it("validates page custom CSS on parse", () => {
    expect(parsePageDocument(page([], "body{color:red}"))).not.toBeNull();
    expect(parsePageDocument(page([], "@import url(https://evil.example/x.css);"))).toBeNull();
    expect(describeFunnelCustomCodeProblem(page([], "@import url(https://evil.example/x.css);"))).toBe("css_invalid");
    expect(describeFunnelCustomCodeProblem(page([codeNode("x", { js: "a".repeat(50_001) })]))).toBe("too_large");
    expect(describeFunnelCustomCodeProblem(page([]))).toBeNull();
  });

  it("collects nodes from every step, popup and the page CSS", () => {
    const step = page([codeNode("a", { js: "x()" })], ".a{color:red}");
    step.popups = [{ schemaVersion: 1, id: "popup", name: "P", settings: { showCloseButton: false, openAutomatically: true, automaticDelaySeconds: 1, openOnExitIntent: false, backgroundColor: "white", padding: 24, cornerRadius: 6, borderStyle: "solid", borderColor: "#e2e8f0", borderWidth: 1, shadow: "soft" }, root: [{ ...step.root[0]!, id: "ps", children: [{ ...step.root[0]!.children![0]!, id: "pr", children: [codeNode("b", { html: "<p>b</p>" })] }] }], capabilities: { exitIntent: { status: "available", reason: "x" } } }];
    const content = { schemaVersion: 1, flow: {}, activeStepId: "s1", pages: { s1: step } };
    const inventory = collectFunnelCustomCode(content);
    expect([...inventory.nodes.keys()].sort()).toEqual(["step:s1/node:a", "step:s1/node:b"]);
    expect([...inventory.pageCss.keys()]).toEqual(["step:s1"]);
    expect(contentHasCustomScript(content)).toBe(true);
    expect(documentCustomCodeSummary(step)).toEqual({ any: true, scripts: true });
    expect(documentCustomCodeSummary(page([]))).toEqual({ any: false, scripts: false });
  });

  it("diffs by location and reports fields and sizes, never code", () => {
    const before = page([codeNode("a", { html: "<p>a</p>" }), codeNode("gone", { css: "p{}" })]);
    const after = page([codeNode("a", { html: "<p>a</p>", js: "secret()" }), codeNode("new", { html: "<b>n</b>" })], "body{margin:0}");
    const changes = diffFunnelCustomCode(before, after);
    expect(changes).toEqual([
      { location: "page/node:a", kind: "node", change: "modified", fields: ["js"], bytes: { html: 8, css: 0, js: 8 }, scriptAddedOrChanged: true },
      { location: "page/node:gone", kind: "node", change: "removed", fields: ["css"], bytes: { html: 0, css: 0, js: 0 }, scriptAddedOrChanged: false },
      { location: "page/node:new", kind: "node", change: "added", fields: ["html"], bytes: { html: 8, css: 0, js: 0 }, scriptAddedOrChanged: false },
      { location: "page/page_css", kind: "page_css", change: "added", fields: ["css"], bytes: { css: 14 }, scriptAddedOrChanged: false },
    ]);
    expect(JSON.stringify(changes)).not.toContain("secret");
    expect(diffFunnelCustomCode(after, structuredClone(after))).toEqual([]);
  });
});

describe("emergency switch", () => {
  it("reads FUNNEL_CUSTOM_CODE_DISABLED as 1 or true only", () => {
    expect(isFunnelCustomCodeDisabled({ FUNNEL_CUSTOM_CODE_DISABLED: "1" })).toBe(true);
    expect(isFunnelCustomCodeDisabled({ FUNNEL_CUSTOM_CODE_DISABLED: " TRUE " })).toBe(true);
    for (const value of [undefined, "", "0", "false", "yes"]) expect(isFunnelCustomCodeDisabled({ FUNNEL_CUSTOM_CODE_DISABLED: value })).toBe(false);
  });

  it("removes JS and page CSS from public content without mutating the stored document", () => {
    const stored = page([codeNode("a", { html: "<p>a</p>", css: "p{}", js: "run()" })], "body{display:none}");
    const stripped = withoutFunnelCustomScripts(stored);
    expect(contentHasCustomScript(stripped)).toBe(false);
    expect(stripped.settings.customCss).toBeUndefined();
    expect(collectFunnelCustomCode(stripped).nodes.get("page/node:a")).toMatchObject({ html: "<p>a</p>", css: "p{}", js: "" });
    expect(contentHasCustomScript(stored)).toBe(true);
    expect(stored.settings.customCss).toBe("body{display:none}");
  });
});
