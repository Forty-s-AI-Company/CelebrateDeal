/**
 * A small, deliberately limited rich-text dialect for merchant-authored copy.
 *
 * It stores plain text with Markdown-like markers instead of arbitrary HTML.
 * That keeps existing text compatible and lets every renderer escape content
 * by default, so a public form or Email cannot become an XSS transport.
 */
export type RichTextInline =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "emphasis"; value: string }
  | { type: "link"; label: string; href: string };

export type RichTextBlock =
  | { type: "heading"; level: 2 | 3; inlines: RichTextInline[] }
  | { type: "paragraph"; inlines: RichTextInline[] }
  | { type: "unordered-list"; items: RichTextInline[][] }
  | { type: "ordered-list"; items: RichTextInline[][] };

export type TextSelectionInsertion = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

const inlineToken = /\[([^\]\n]{1,500})\]\(([^()\s]{1,2048})\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/gu;
const bareHttpUrl = /https?:\/\/[^\s<>"']{1,2048}/gu;
const headingLine = /^(#{1,2})\s+(.+)$/u;
const unorderedListLine = /^[-*]\s+(.+)$/u;
const orderedListLine = /^\d+[.)]\s+(.+)$/u;

function safeHttpLink(value: string) {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:")
      || !url.hostname
      || url.username
      || url.password
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function appendTextWithHttpLinks(inlines: RichTextInline[], value: string) {
  let position = 0;
  for (const match of value.matchAll(bareHttpUrl)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > position) inlines.push({ type: "text", value: value.slice(position, matchIndex) });
    const rawUrl = match[0].replace(/[.,;:!?，。！？）)\]]+$/u, "");
    const href = safeHttpLink(rawUrl);
    if (href) inlines.push({ type: "link", label: rawUrl, href });
    else inlines.push({ type: "text", value: match[0] });
    const trailingPunctuation = match[0].slice(rawUrl.length);
    if (trailingPunctuation) inlines.push({ type: "text", value: trailingPunctuation });
    position = matchIndex + match[0].length;
  }
  if (position < value.length) inlines.push({ type: "text", value: value.slice(position) });
}

/**
 * Inserts editor controls at the current DOM selection without trusting the
 * browser to keep that selection in range after a controlled React update.
 */
export function insertTextAtSelection(value: string, start: number, end: number, insertion: string): TextSelectionInsertion {
  const selectionStart = Math.min(value.length, Math.max(0, Math.trunc(start)));
  const selectionEnd = Math.min(value.length, Math.max(selectionStart, Math.trunc(end)));
  const nextValue = `${value.slice(0, selectionStart)}${insertion}${value.slice(selectionEnd)}`;
  const caret = selectionStart + insertion.length;
  return { value: nextValue, selectionStart: caret, selectionEnd: caret };
}

export function parseRichTextInlines(value: string): RichTextInline[] {
  const inlines: RichTextInline[] = [];
  let position = 0;

  for (const match of value.matchAll(inlineToken)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > position) appendTextWithHttpLinks(inlines, value.slice(position, matchIndex));

    const [, linkLabel, rawHref, strong, emphasis] = match;
    if (linkLabel !== undefined && rawHref !== undefined) {
      const href = safeHttpLink(rawHref);
      if (href) inlines.push({ type: "link", label: linkLabel, href });
      else appendTextWithHttpLinks(inlines, match[0]);
    } else if (strong !== undefined) {
      inlines.push({ type: "strong", value: strong });
    } else if (emphasis !== undefined) {
      inlines.push({ type: "emphasis", value: emphasis });
    } else {
      appendTextWithHttpLinks(inlines, match[0]);
    }
    position = matchIndex + match[0].length;
  }

  if (position < value.length) appendTextWithHttpLinks(inlines, value.slice(position));
  return inlines.length > 0 ? inlines : [{ type: "text", value }];
}

export function parseRichText(value: string): RichTextBlock[] {
  const lines = value.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: RichTextBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = line.match(headingLine);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]?.length === 1 ? 2 : 3, inlines: parseRichTextInlines(heading[2] ?? "") });
      index += 1;
      continue;
    }
    const unordered = line.match(unorderedListLine);
    if (unordered) {
      const items: RichTextInline[][] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(unorderedListLine);
        if (!item) break;
        items.push(parseRichTextInlines(item[1] ?? ""));
        index += 1;
      }
      blocks.push({ type: "unordered-list", items });
      continue;
    }
    const ordered = line.match(orderedListLine);
    if (ordered) {
      const items: RichTextInline[][] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(orderedListLine);
        if (!item) break;
        items.push(parseRichTextInlines(item[1] ?? ""));
        index += 1;
      }
      blocks.push({ type: "ordered-list", items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (!next.trim() || headingLine.test(next) || unorderedListLine.test(next) || orderedListLine.test(next)) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ type: "paragraph", inlines: parseRichTextInlines(paragraph.join("\n")) });
  }

  return blocks;
}

function inlinePlainText(inlines: RichTextInline[]) {
  return inlines.map((inline) => inline.type === "link" ? `${inline.label} (${inline.href})` : inline.value).join("");
}

export function richTextToPlainText(value: string) {
  return parseRichText(value).map((block) => {
    if (block.type === "unordered-list") return block.items.map((item) => `- ${inlinePlainText(item)}`).join("\n");
    if (block.type === "ordered-list") return block.items.map((item, index) => `${index + 1}. ${inlinePlainText(item)}`).join("\n");
    return inlinePlainText(block.inlines);
  }).join("\n\n");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inlinesToEmailHtml(inlines: RichTextInline[]) {
  return inlines.map((inline) => {
    if (inline.type === "strong") return `<strong>${escapeHtml(inline.value)}</strong>`;
    if (inline.type === "emphasis") return `<em>${escapeHtml(inline.value)}</em>`;
    if (inline.type === "link") return `<a href="${escapeHtml(inline.href)}">${escapeHtml(inline.label)}</a>`;
    return escapeHtml(inline.value).replaceAll("\n", "<br>");
  }).join("");
}

/** Converts only the constrained dialect above to Email-safe HTML. */
export function richTextToEmailHtml(value: string) {
  return parseRichText(value).map((block) => {
    if (block.type === "heading") return `<h${block.level}>${inlinesToEmailHtml(block.inlines)}</h${block.level}>`;
    if (block.type === "unordered-list") return `<ul>${block.items.map((item) => `<li>${inlinesToEmailHtml(item)}</li>`).join("")}</ul>`;
    if (block.type === "ordered-list") return `<ol>${block.items.map((item) => `<li>${inlinesToEmailHtml(item)}</li>`).join("")}</ol>`;
    return `<p>${inlinesToEmailHtml(block.inlines)}</p>`;
  }).join("\n");
}
