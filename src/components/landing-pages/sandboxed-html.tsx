"use client";

const ALLOWED_TAGS = new Set(["a", "b", "blockquote", "br", "code", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "span", "strong", "ul"]);
const VOID_TAGS = new Set(["br", "hr", "img"]);

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function safeUrl(value: string): string | null {
  const trimmed = value.trim();
  if ((trimmed.startsWith("/") && !trimmed.startsWith("//")) || trimmed.startsWith("#")) return trimmed;
  try { return new URL(trimmed).protocol === "https:" ? trimmed : null; } catch { return null; }
}

export function sanitizeFunnelHtml(input: string): string {
  return input.slice(0, 20_000)
    .replace(/<(script|style|template|iframe|object|embed|svg|math|form)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "")
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<\/?[^>]*>/gu, (source) => {
    const closing = /^<\s*\//u.test(source);
    const match = source.match(/^<\s*\/?\s*([a-z0-9]+)/iu);
    const tag = match?.[1]?.toLowerCase();
    if (!tag || !ALLOWED_TAGS.has(tag)) return "";
    if (closing) return VOID_TAGS.has(tag) ? "" : `</${tag}>`;
    const attributes: string[] = [];
    for (const attribute of source.matchAll(/\s(alt|title|href|src)\s*=\s*(["'])(.*?)\2/giu)) {
      const name = attribute[1]!.toLowerCase();
      const rawValue = attribute[3] ?? "";
      const value = name === "href" || name === "src" ? safeUrl(rawValue) : rawValue.slice(0, 500);
      if (value !== null) attributes.push(`${name}="${escapeAttribute(value)}"`);
    }
    if (tag === "a") attributes.push('rel="noreferrer noopener"');
    return `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}${VOID_TAGS.has(tag) ? " /" : ""}>`;
    });
}

export function SandboxedHtml({ html, label }: { html: string; label: string }) {
  const sanitized = sanitizeFunnelHtml(html);
  const srcDoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"></head><body>${sanitized}</body></html>`;
  return <iframe title={label} sandbox="" referrerPolicy="no-referrer" srcDoc={srcDoc} className="min-h-40 w-full rounded-lg border border-slate-200" />;
}
