import { existsSync } from "node:fs";
import path from "node:path";
import { findFunnelContrastIssues } from "@/lib/funnel-design-contrast";
import { createEmptyPageDocument, explainPageDocumentIssue, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import { getFunnelTemplateGalleryItem, previewFunnelTemplate } from "@/lib/funnel-template-gallery";
import { FUNNEL_FONT_OPTIONS } from "@/lib/funnel-typography";
import { WEBINAR_TEMPLATE_SAMPLE_MARK, type WebinarTemplateDefinition } from "./types";

/**
 * Unit-level template checks (qa-standards §5.3), shared by every
 * `NN-<slug>.test.ts`. Node-only (reads `public/`), never imported by app code.
 * Returns human-readable issues; an empty list means the template passes.
 */

const flatten = (nodes: FunnelNode[]): FunnelNode[] => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
const HARDCODED_DATE = /20\d\d\s*[年/-]/u;
const IMAGE_KEYS = new Set(["src", "imageUrl", "url", "photo", "avatar", "thumbnail", "logoSrc", "backgroundImage", "poster"]);
const FONT_VALUES = new Set<string>(FUNNEL_FONT_OPTIONS.map((option) => option.value));

function strings(value: unknown, key = ""): Array<{ key: string; text: string }> {
  if (typeof value === "string") return [{ key, text: value }];
  if (Array.isArray(value)) return value.flatMap((item) => strings(item, key));
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).flatMap(([childKey, item]) => strings(item, childKey));
  return [];
}

function imageSources(node: FunnelNode): string[] {
  return strings(node.props).filter((entry) => IMAGE_KEYS.has(entry.key) && entry.text.startsWith("/")).map((entry) => entry.text);
}

/** Node ids and types in render order: pin this in a snapshot (saved pages and analytics refer to node ids). */
export function webinarTemplateNodeSignature(template: WebinarTemplateDefinition): string[] {
  return flatten(template.build("snapshot")).map((node) => `${node.id}:${node.type}`);
}

/** Per-node content rules: id prefix, images, dates, sample marks and countdown sources. */
function nodeIssues(node: FunnelNode, prefix: string): string[] {
  const issues: string[] = [];
  if (!node.id.startsWith(prefix)) issues.push(`節點 id 沒有使用範本前綴：${node.id}`);
  if (node.type === "raw_html") issues.push("範本不得使用 raw_html（自訂程式碼）");
  for (const src of imageSources(node)) {
    if (src !== "/placeholder.svg" && !src.startsWith("/funnel-illustrations/webinar/")) issues.push(`圖片必須放在 public/funnel-illustrations/webinar/** 或使用佔位圖：${node.id} → ${src}`);
    else if (!existsSync(path.join(process.cwd(), "public", src))) issues.push(`圖片檔案不存在：${src}`);
  }
  for (const entry of strings(node.props)) if (HARDCODED_DATE.test(entry.text)) issues.push(`文字寫死了日期，請改用 {{webinar.date}} 或活動資訊列：${node.id}（${entry.text.slice(0, 30)}）`);
  if (node.type === "testimonial_wall" && !strings(node.props.items).some((entry) => entry.text.includes(WEBINAR_TEMPLATE_SAMPLE_MARK))) issues.push(`評價必須標示「${WEBINAR_TEMPLATE_SAMPLE_MARK}」：${node.id}`);
  if (node.type === "countdown" && (node.props.source ?? "fixed") === "fixed") issues.push(`倒數不得寫死截止時間，請用 source: "webinar_start" 或 "registration_close"：${node.id}`);
  return issues;
}

export function webinarTemplateIssues(template: WebinarTemplateDefinition): string[] {
  const issues: string[] = [];
  if (!getFunnelTemplateGalleryItem(template.id)) return [`${template.id} 沒有登記在範本庫（index.ts 的位置是否還是 null？）`];
  if (!/^webinar-[a-z0-9-]+$/u.test(template.id)) issues.push("id 必須是 webinar-<小寫英數與連字號>");
  let document: PageDocument;
  try { document = previewFunnelTemplate(template.id); } catch (error) {
    // Name the first schema path or tree rule that failed (e.g. borderRadius > 500, a duplicate node id).
    const empty = createEmptyPageDocument("template_check_page", template.name);
    const reason = explainPageDocumentIssue({ ...empty, settings: { ...empty.settings, ...template.settings, typography: { ...empty.settings.typography, ...template.theme.typography } }, root: template.build(`gallery_${template.id}_preview`) });
    return [...issues, `無法建立 PageDocument：${(error as Error).message}${reason ? `（${reason}）` : ""}`];
  }
  const nodes = flatten(document.root);
  for (const node of nodes) issues.push(...nodeIssues(node, `gallery_${template.id}_preview_`));
  issues.push(...structureIssues(template, document, nodes));
  return issues;
}

/** Page-level rules: contrast, fonts, required webinar elements, sticky CTA, mobile padding and tags. */
function structureIssues(template: WebinarTemplateDefinition, document: PageDocument, nodes: FunnelNode[]): string[] {
  const issues: string[] = [];
  for (const issue of findFunnelContrastIssues(document, 4.5)) issues.push(`對比不足 ${issue.ratio}:1（${issue.role}）：${issue.nodeId} ${issue.foreground} on ${issue.background}`);
  const typography = template.theme.typography;
  for (const font of [typography.bodyFont, typography.headingFont]) if (font && !FONT_VALUES.has(font)) issues.push(`字型必須是 FUNNEL_FONT_OPTIONS 的 value：${font}`);
  if (!nodes.some((node) => node.type === "form")) issues.push("報名頁必須有報名表單（form）");
  if (!nodes.some((node) => node.type === "event_facts")) issues.push("必須放活動資訊列（event_facts，C-01）");
  if (!nodes.some((node) => node.type === "speaker_profiles")) issues.push("必須放講者卡（speaker_profiles，C-02）");
  if (!template.settings?.stickyCta?.enabled) issues.push("必須開啟固定報名列（settings.stickyCta，C-04）");
  for (const section of document.root.filter((node) => node.type === "section")) if (!section.overrides.mobile?.style?.padding) issues.push(`區段缺少手機版內距：${section.id}`);
  if (!template.purposes.length || !template.styles.length) issues.push("必須有用途與風格標籤");
  return issues;
}
