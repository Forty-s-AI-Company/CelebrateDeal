import type { FunnelNode, PageDocument } from "@/lib/funnel-page-document";
import { funnelContrastRatio, funnelTextStyle, resolveFunnelTypography } from "@/lib/funnel-typography";

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
        default: break;
      }
      if (node.children) walk(node.children, bg, color);
    }
  };
  walk(document.root, document.settings.background.color, tokens.textColor);
  return issues;
}
