import type { FunnelNode, FunnelPageSettings } from "@/lib/funnel-page-document";
import { conversionTemplateKit, type ConversionTemplateDefinition } from "./types";

/**
 * 名單感謝頁與訂單感謝頁的共用產生器。版型固定（成功狀態 → 三步驟 → 選填下一步／FAQ → 頁尾），
 * 色票、字型與文案來自主範本的 `thankYou`，所以每個名單頁、銷售頁都有一張同風格的感謝頁。
 * 節點 id 由版型決定、與範本無關；合併後不要改 id、型別或順序（快照測試會擋）。
 */
export function buildConversionThankYou(template: ConversionTemplateDefinition, prefix: string): FunnelNode[] {
  const { node, section, stack, headline, text, button } = conversionTemplateKit(prefix);
  const design = template.thankYou;
  const t = design.tokens;
  const order = template.kind === "sales";
  const cta = { backgroundColor: t.accent, color: t.onAccent, borderRadius: t.radius, fontSize: 17, padding: "16px 32px", width: "fit-content", margin: "0 auto" } as const;
  const card = (id: string, children: FunnelNode[], gap = 16) => stack(id, children, gap, { backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, borderRadius: Math.max(t.radius, 12), padding: 36, shadow: "soft" }, { mobile: { style: { padding: 22 } } });

  return [
    // 1. 成功狀態：勾選徽章、標題、說明與交付卡（名單：資源下載；訂單：購買內容與付款確認說明）。
    section("ty_hero", [
      text("ty_badge", `✓ ${design.eyebrow}`, undefined, { backgroundColor: t.accent, color: t.onAccent, borderRadius: 100, padding: "8px 20px", fontSize: 15, letterSpacing: 1, width: "fit-content", margin: "0 auto" }),
      headline("ty_title", design.title, "h1", { color: t.ink, fontSize: 44, lineHeight: 1.3 }, { tablet: { style: { fontSize: 38 } }, mobile: { style: { fontSize: 28, lineHeight: 1.35 } } }),
      text("ty_intro", design.intro, "lead", { color: t.body }),
      card("ty_card", [
        headline("ty_card_title", design.card.title, "h2", { color: t.ink, fontSize: 24, lineHeight: 1.4 }, { mobile: { style: { fontSize: 21 } } }),
        text("ty_card_text", design.card.text, undefined, { color: t.body }),
        ...(design.card.buttonLabel ? [button("ty_card_button", design.card.buttonLabel, design.card.buttonHref ?? "#ty-steps", cta)] : []),
      ]),
    ], { background: t.background, color: t.body, maxWidth: 760, paddingY: 88, paddingYTablet: 64, paddingYMobile: 40, gap: 24, align: "center" }),

    // 2. 接下來三步。
    section("ty_steps", [
      headline("ty_steps_title", order ? "接下來會發生什麼" : "接下來這樣做", "h2", { color: t.ink, fontSize: 30 }, { mobile: { style: { fontSize: 24 } } }),
      node("ty_steps_list", "icon_list", { layout: "grid", columns: 3, numbered: true, accentColor: t.accent, items: design.steps.map((step) => ({ icon: step.icon ?? "check", title: step.title, text: step.text })) }, undefined, { color: t.body, textAlign: "left" }),
    ], { background: t.background, color: t.body, maxWidth: 1040, paddingY: 40, paddingYTablet: 32, paddingYMobile: 24, gap: 28, align: "center", htmlId: "ty-steps" }),

    // 3. 選填：下一步推薦。
    ...(design.next ? [section("ty_next", [
      card("ty_next_card", [
        text("ty_next_eyebrow", design.next.eyebrow, "eyebrow", { color: t.accent }),
        headline("ty_next_title", design.next.title, "h2", { color: t.ink, fontSize: 26, lineHeight: 1.4 }, { mobile: { style: { fontSize: 22 } } }),
        text("ty_next_text", design.next.text, undefined, { color: t.body }),
        button("ty_next_button", design.next.buttonLabel, design.next.buttonHref, cta),
      ]),
    ], { background: t.background, color: t.body, maxWidth: 760, paddingY: 40, paddingYTablet: 32, paddingYMobile: 24, align: "center" })] : []),

    // 4. 選填：常見問題（訂單感謝頁：發票、退款、聯絡）。
    ...(design.faq?.length ? [section("ty_faq", [
      headline("ty_faq_title", "常見問題", "h2", { color: t.ink, fontSize: 28, textAlign: "center" }, { mobile: { style: { fontSize: 23 } } }),
      node("ty_faq_list", "faq", { items: design.faq.map((item) => ({ question: item.question, answer: item.answer })) }, undefined, { color: t.body, textAlign: "left" }),
    ], { background: t.background, color: t.body, maxWidth: 760, paddingY: 48, paddingYTablet: 40, paddingYMobile: 32, gap: 24 })] : []),

    // 5. 頁尾。
    section("ty_footer", [
      text("ty_footer_text", design.footer, "small", { color: t.footerText }),
    ], { background: t.footerBackground, color: t.footerText, maxWidth: 960, paddingY: 40, paddingYTablet: 36, paddingYMobile: 28, align: "center" }),
  ];
}

/** 感謝頁的頁面設定：沿用主範本字型，底色換成感謝頁底色。 */
export function conversionThankYouTheme(template: ConversionTemplateDefinition): { typography: Partial<FunnelPageSettings["typography"]>; background: { color: string } } {
  const t = template.thankYou.tokens;
  return { typography: { ...template.theme.typography, textColor: t.body, headingColor: t.ink, linkColor: t.accent }, background: { color: t.background } };
}
