"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { safeContentHref } from "@/lib/safe-url";
import {
  buildFunnelCustomCodeSrcDoc,
  FUNNEL_CUSTOM_CODE_DEFAULT_HEIGHT,
  FUNNEL_CUSTOM_CODE_MAX_HEIGHT,
  funnelCustomCodeSandbox,
  parseFunnelCustomCodeHeightMessage,
  type FunnelCustomCode,
  type FunnelCustomCodeMode,
} from "@/lib/funnel-custom-code";

const ALLOWED_TAGS = new Set([
  "a", "article", "b", "blockquote", "br", "code", "div", "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hr", "i", "img", "li", "mark", "ol", "p", "pre", "s", "section", "small", "span", "strong", "sub", "sup", "table", "tbody",
  "td", "th", "thead", "tr", "u", "ul",
]);
const VOID_TAGS = new Set(["br", "hr", "img"]);

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** href/src values keep only same-origin paths, anchors and HTTPS (rules in `@/lib/safe-url`). */
function safeUrl(value: string): string | null {
  return safeContentHref(value);
}

/**
 * 沒有 JS 的自訂程式碼（以及緊急開關啟用時）沿用原本的保守 HTML 白名單：
 * 不執行任何腳本，只保留排版標籤與 alt／title／href／src／class。
 */
export function sanitizeFunnelHtml(input: string): string {
  return input.slice(0, 50_000)
    .replace(/<(script|style|template|iframe|object|embed|svg|math|form|noscript|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "")
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<\/?[^>]*>/gu, (source) => {
    const closing = /^<\s*\//u.test(source);
    const match = source.match(/^<\s*\/?\s*([a-z0-9]+)/iu);
    const tag = match?.[1]?.toLowerCase();
    if (!tag || !ALLOWED_TAGS.has(tag)) return "";
    if (closing) return VOID_TAGS.has(tag) ? "" : `</${tag}>`;
    const attributes: string[] = [];
    for (const attribute of source.matchAll(/\s(alt|title|href|src|class)\s*=\s*(["'])(.*?)\2/giu)) {
      const name = attribute[1]!.toLowerCase();
      const rawValue = attribute[3] ?? "";
      const value = name === "href" || name === "src" ? safeUrl(rawValue)
        : name === "class" ? (/^[\w\s-]{0,200}$/u.test(rawValue) ? rawValue : null)
          : rawValue.slice(0, 500);
      if (value !== null) attributes.push(`${name}="${escapeAttribute(value)}"`);
    }
    if (tag === "a") attributes.push('rel="noreferrer noopener"');
    return `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}${VOID_TAGS.has(tag) ? " /" : ""}>`;
    });
}

/**
 * 自訂程式碼能否開新分頁。只有公開頁（`/lp/*`，回應帶 COOP: same-origin）
 * 會開啟；編輯器與後台預覽一律不開，避免彈出頁經 opener 導向後台。
 */
const FunnelCustomCodeSurfaceContext = createContext<{ allowPopups: boolean }>({ allowPopups: false });

export function FunnelCustomCodeSurfaceProvider({ allowPopups, children }: { allowPopups: boolean; children: ReactNode }) {
  return <FunnelCustomCodeSurfaceContext.Provider value={{ allowPopups }}>{children}</FunnelCustomCodeSurfaceContext.Provider>;
}

function clampHeight(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return FUNNEL_CUSTOM_CODE_DEFAULT_HEIGHT;
  return Math.min(Math.max(Math.round(value), 40), FUNNEL_CUSTOM_CODE_MAX_HEIGHT);
}

/**
 * 自訂程式碼 iframe。
 * - static：sandbox=""，HTML 先 sanitize，不執行任何腳本，固定高度。
 * - script：sandbox="allow-scripts"（公開頁另加 allow-popups 與
 *   allow-popups-to-escape-sandbox），商家 HTML／CSS／JS 原樣在不透明來源執行；
 *   高度只接受來自這個 iframe（event.source）且在範圍內的數字。
 */
export function SandboxedCustomCode({ code, mode, label, height }: { code: FunnelCustomCode; mode: FunnelCustomCodeMode; label: string; height?: number }) {
  const { allowPopups } = useContext(FunnelCustomCodeSurfaceContext);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const initialHeight = clampHeight(height);
  const [reportedHeight, setReportedHeight] = useState<number | null>(null);
  const srcDoc = buildFunnelCustomCodeSrcDoc(mode === "static" ? { html: sanitizeFunnelHtml(code.html), css: code.css, js: "" } : code, mode);
  useEffect(() => {
    if (mode !== "script") return;
    const onMessage = (event: MessageEvent) => {
      const frameWindow = frameRef.current?.contentWindow;
      // 只信任這個 iframe 自己的訊息；event.origin 對不透明來源永遠是 "null"，不能用來判斷。
      if (!frameWindow || event.source !== frameWindow) return;
      const next = parseFunnelCustomCodeHeightMessage(event.data);
      if (next !== null) setReportedHeight(next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [mode]);
  return <iframe
    ref={frameRef}
    title={label}
    sandbox={funnelCustomCodeSandbox(mode, { popups: allowPopups })}
    referrerPolicy="no-referrer"
    srcDoc={srcDoc}
    data-funnel-custom-code={mode}
    style={{ height: `${reportedHeight ?? initialHeight}px` }}
    className="block w-full border-0"
  />;
}

/** 舊介面：只有 HTML、不執行腳本。 */
export function SandboxedHtml({ html, label }: { html: string; label: string }) {
  return <SandboxedCustomCode code={{ html, css: "", js: "" }} mode="static" label={label} />;
}
