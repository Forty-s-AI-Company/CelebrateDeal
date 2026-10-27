"use client";

import { useMemo } from "react";
import { PublicFunnelDocument } from "./public-funnel-document";
import { FunnelCustomCodeSurfaceProvider } from "./sandboxed-html";
import { createEmptyPageDocument, parsePageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";

/**
 * 開發用瀏覽器 QA：用公開頁同一個元件（PublicFunnelDocument）渲染含自訂程式碼
 * 與頁面自訂 CSS 的頁面。路由（/browser-qa/*）與 /lp/* 送出相同的 COOP 與 CSP。
 * 所有資料都是合成的。
 */
export type FunnelCustomCodeHarnessVariant = "probe" | "hide" | "overlay";

/** 商家 JS：嘗試讀取平台 Cookie、父頁 DOM、導向 top、使用儲存與網路，把結果寫在自己的 iframe 內。 */
const PROBE_JS = `
var out = {};
function attempt(name, run) { try { out[name] = String(run()); } catch (error) { out[name] = "threw:" + error.name; } }
attempt("cookie", function () { return document.cookie; });
attempt("parentDocument", function () { return parent.document.title; });
attempt("parentCookie", function () { return parent.document.cookie; });
attempt("topHref", function () { return top.location.href; });
attempt("topNavigation", function () { top.location.href = "https://example.invalid/hijacked"; return "assigned"; });
attempt("localStorage", function () { return localStorage.length; });
attempt("origin", function () { return self.origin; });
function render() { document.getElementById("probe").textContent = JSON.stringify(out); }
out.fetch = "pending";
fetch("/api/health").then(function () { out.fetch = "allowed"; render(); }, function (error) { out.fetch = "blocked:" + error.name; render(); });
document.getElementById("open").addEventListener("click", function () {
  var popup = window.open(document.getElementById("open").dataset.href, "_blank");
  out.popupHandle = popup === null ? "null" : "returned";
  render();
});
document.getElementById("grow").addEventListener("click", function () { document.getElementById("spacer").style.height = "600px"; });
render();
`;

function node(id: string, type: FunnelNode["type"], props: Record<string, unknown> = {}, children?: FunnelNode[], attributes: Record<string, string> = {}): FunnelNode {
  return { schemaVersion: 1, id, type, props, style: {}, overrides: {}, visible: true, actions: [], attributes, ...(children ? { children } : {}) };
}

const VARIANT_CSS: Record<FunnelCustomCodeHarnessVariant, string> = {
  probe: "",
  hide: "body{display:none} * {display:none} html{visibility:hidden}",
  overlay: "#takeover{position:fixed;inset:0;z-index:2147483647;background:#fff;display:block;width:100vw;height:100vh} :root{--x:1}",
};

function harnessDocument(variant: FunnelCustomCodeHarnessVariant, popupHref: string): PageDocument {
  const document = createEmptyPageDocument("custom_code_harness", "Custom code harness");
  document.root = [node("section", "section", {}, [node("row", "row", {}, [
    node("intro", "text", { text: "商家內容" }, undefined, { id: "takeover" }),
    node("code", "raw_html", {
      title: "商家自訂程式碼",
      html: `<button id="open" type="button" data-href="${popupHref}">開新分頁</button><button id="grow" type="button">變高</button><pre id="probe">loading</pre><div id="spacer" style="height:10px"></div>`,
      css: "body{font-family:system-ui;margin:8px}",
      js: PROBE_JS,
    }),
  ])])];
  if (VARIANT_CSS[variant]) document.settings.customCss = VARIANT_CSS[variant];
  const parsed = parsePageDocument(document);
  if (!parsed) throw new Error("harness document must pass the production schema");
  return parsed;
}

export function FunnelCustomCodeBrowserHarness({ variant, popupHref }: { variant: FunnelCustomCodeHarnessVariant; popupHref: string }) {
  const document = useMemo(() => harnessDocument(variant, popupHref), [variant, popupHref]);
  return <FunnelCustomCodeSurfaceProvider allowPopups>
    <div id="platform-sentinel" data-testid="platform-sentinel">platform</div>
    <PublicFunnelDocument document={document} viewport="desktop" />
  </FunnelCustomCodeSurfaceProvider>;
}
