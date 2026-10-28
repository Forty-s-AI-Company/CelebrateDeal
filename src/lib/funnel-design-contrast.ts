import type { FunnelNode, PageDocument } from "@/lib/funnel-page-document";
import { funnelContrastRatio, funnelTextStyle, resolveFunnelTypography } from "@/lib/funnel-typography";
import { FUNNEL_SHOWCASE_DEFAULT_ACCENT, showcaseCards, showcaseColor, showcaseReadableOn } from "@/lib/funnel-showcase";

const showcaseAccent = (node: FunnelNode) => showcaseColor(node.props.accentColor) ?? FUNNEL_SHOWCASE_DEFAULT_ACCENT;

/** Showcase elements use the accent colour for small text (eyebrows, links), so it must pass against the section too. */
function checkShowcase(node: FunnelNode, color: string, bg: string, headingColor: string, check: (node: FunnelNode, role: string, foreground: string, background: string) => void) {
  switch (node.type) {
    case "section_title":
      check(node, "區塊標題", node.style.color ?? headingColor, bg);
      if (node.props.eyebrow) check(node, "英文小標", showcaseAccent(node), bg);
      break;
    case "image_cards":
      check(node, "卡片文字", color, bg);
      if (showcaseCards(node.props.items).some((card) => card.href)) check(node, "卡片連結", showcaseAccent(node), bg);
      break;
    case "icon_list": case "stats": case "logo_strip": check(node, node.type, color, bg); break;
    default: break;
  }
}

/**
 * Webinar elements (C-01～C-18) default their accent to the page link colour and
 * use it for small text (speaker role, agenda times, offer labels), so that pair is checked too.
 */
function checkWebinar(node: FunnelNode, color: string, bg: string, linkColor: string, check: (node: FunnelNode, role: string, foreground: string, background: string) => void) {
  const accent = showcaseColor(node.props.accentColor) ?? linkColor;
  const card = showcaseColor(node.props.cardColor);
  const cardText = showcaseColor(node.props.cardTextColor) ?? color;
  switch (node.type) {
    case "event_facts": check(node, "活動資訊", cardText, card ?? bg); break;
    case "speaker_profiles": check(node, "講者文字", color, bg); check(node, "講者職稱", accent, bg); break;
    case "agenda_timeline": check(node, "議程文字", color, card ?? bg); check(node, "議程時間", accent, card ?? bg); break;
    case "value_stack": check(node, "價值清單", cardText, card ?? bg); if (node.props.offerLabel) check(node, "本場優惠", accent, card ?? bg); break;
    case "session_schedule": check(node, "場次日期", accent, bg); break;
    case "fit_compare": check(node, "適合／不適合", color, card ?? bg); break;
    case "add_to_calendar": check(node, "行事曆按鈕外框文字", color, bg); break;
    case "deadline_notice": check(node, "截止提示", color, bg); break;
    case "announcement_bar": { const bar = showcaseColor(node.props.barColor) ?? linkColor; check(node, "公告條", showcaseColor(node.props.barTextColor) ?? showcaseReadableOn(bar), bar); break; }
    case "countdown": {
      if (node.props.variant === "bar") { const bar = showcaseColor(node.props.barColor) ?? accent; const text = showcaseColor(node.props.barTextColor); if (text) check(node, "倒數條", text, bar); }
      else check(node, "倒數", showcaseColor(node.props.numberColor) ?? (node.props.variant === "inline" ? accent : color), bg);
      break;
    }
    default: break;
  }
}

/** Default button colours used by the renderer when a button sets none. */
export const FUNNEL_DEFAULT_BUTTON_COLORS = { background: "#f59e0b", text: "#0f172a" } as const;

export type FunnelContrastIssue = { nodeId: string; role: string; foreground: string; background: string; ratio: number };

/**
 * Walks a document the way the renderer paints it (background inherited from
 * the nearest coloured section/box, text colour inherited, heading/eyebrow/link
 * defaults from page settings) and reports every text pair below `minimum`.
 * Used by tests to keep shipped templates and blocks at WCAG AA.
 */
export function findFunnelContrastIssues(document: PageDocument, minimum = 4.5): FunnelContrastIssue[] {
  const tokens = resolveFunnelTypography(document.settings, "desktop");
  const issues: FunnelContrastIssue[] = [];
  const check = (node: FunnelNode, role: string, foreground: string, background: string) => {
    const ratio = funnelContrastRatio(foreground, background);
    if (ratio !== null && ratio < minimum) issues.push({ nodeId: node.id, role, foreground, background, ratio: Math.round(ratio * 100) / 100 });
  };
  const walk = (nodes: FunnelNode[], background: string, text: string) => {
    for (const node of nodes) {
      if (!node.visible) continue;
      const style = node.style;
      const ownBackground = style.backgroundColor && style.backgroundColor !== "transparent" ? style.backgroundColor : null;
      const bg = node.type === "button" ? background : ownBackground ?? background;
      const color = style.color ?? text;
      switch (node.type) {
        case "headline": check(node, "標題", style.color ?? tokens.headingColor, bg); break;
        case "text": check(node, funnelTextStyle(node.props.textStyle) === "eyebrow" ? "眉標" : "文字", funnelTextStyle(node.props.textStyle) === "eyebrow" ? style.color ?? tokens.linkColor : color, bg); break;
        case "bulleted_list": case "checkbox": case "form_input": check(node, node.type, color, bg); break;
        case "menu": check(node, "選單連結", style.color ?? tokens.linkColor, bg); break;
        case "button": check(node, "按鈕", style.color ?? FUNNEL_DEFAULT_BUTTON_COLORS.text, ownBackground ?? FUNNEL_DEFAULT_BUTTON_COLORS.background); break;
        default: checkShowcase(node, color, bg, tokens.headingColor, check); checkWebinar(node, color, bg, tokens.linkColor, check); break;
      }
      if (node.children) walk(node.children, bg, color);
    }
  };
  walk(document.root, document.settings.background.color, tokens.textColor);
  return issues;
}
