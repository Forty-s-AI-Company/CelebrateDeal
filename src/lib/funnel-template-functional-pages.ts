import type { FunnelNode, FunnelNodeStyle, FunnelPageSettings } from "@/lib/funnel-page-document";
import type { FunnelTemplateGalleryItem, FunnelTemplateGoal } from "@/lib/funnel-template-gallery";
import { webinarTemplateKit } from "@/lib/funnel-templates/webinar/types";

/**
 * 功能頁範本 v2（docs/product/webinar-templates/migration-plan.md §3）：
 * Webinar 感謝頁、播放頁、隱私權政策、服務條款共用一套設計語言，不跟著 20 個報名範本換主題色。
 * 舊版（webinar-thank-you、webinar-broadcast、custom-privacy、custom-terms）仍可解析，只是不再列入範本庫。
 * 節點 id 由 `webinarTemplateKit` 產生且固定；已存頁面與分析會參照，合併後不要改 id、型別或順序。
 */
export const FUNCTIONAL_PAGE_TOKENS = {
  pageBackground: "#f8fafc",
  card: "#ffffff",
  heading: "#0f172a",
  body: "#334155",
  secondary: "#475569",
  accent: "#1d4ed8",
  line: "#e2e8f0",
} as const;
const T = FUNCTIONAL_PAGE_TOKENS;

export type FunctionalPageDefinition = {
  id: string;
  referenceId: string;
  goal: Extract<FunnelTemplateGoal, "webinar" | "custom">;
  category: string;
  name: string;
  description: string;
  /** 取代的舊範本 id；舊 id 會標記為 retired。 */
  replaces: string;
  tags: NonNullable<FunnelTemplateGalleryItem["tags"]>;
  preview: FunnelTemplateGalleryItem["preview"];
  theme: { typography: Partial<FunnelPageSettings["typography"]>; background: { color: string } };
  build: (prefix: string) => FunnelNode[];
};

const typography = (bodyLineHeight: number): Partial<FunnelPageSettings["typography"]> => ({
  headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight, textColor: T.body, headingColor: T.heading, linkColor: T.accent,
});
const theme = (bodyLineHeight: number) => ({ typography: typography(bodyLineHeight), background: { color: T.pageBackground } });

/** 白色內容卡：桌機 40px、手機 22px 內距。 */
function cardStyle(): { style: FunnelNodeStyle; mobile: { style: FunnelNodeStyle } } {
  return {
    style: { backgroundColor: T.card, borderColor: T.line, borderWidth: 1, borderRadius: 16, padding: 40, shadow: "soft" },
    mobile: { style: { padding: 22 } },
  };
}

const h2Style: FunnelNodeStyle = { color: T.heading, fontSize: 28, lineHeight: 1.35 };
const sectionOptions = (maxWidth: number) => ({ background: T.pageBackground, color: T.body, maxWidth, paddingY: 64, paddingYTablet: 48, paddingYMobile: 32, gap: 24 });
/** Consecutive cards sit 32px apart (16px section padding on each side; 20px on phones). */
const stacked = { ...sectionOptions(960), paddingY: 16, paddingYTablet: 14, paddingYMobile: 10 };

/** 感謝頁（960px）：成功狀態、三步驟、活動資訊、選填講者。 */
function buildThankYou(prefix: string): FunnelNode[] {
  const { node, section, stack, headline, text } = webinarTemplateKit(prefix);
  const card = (id: string, children: FunnelNode[], gap = 20, align?: "center") => {
    const base = cardStyle();
    return stack(id, children, gap, { ...base.style, ...(align ? { textAlign: align } : {}) }, { mobile: base.mobile });
  };
  return [
    section("hero", [
      card("hero_card", [
        text("hero_check", "✓", undefined, { color: T.accent, fontSize: 40, lineHeight: 1 }),
        text("hero_eyebrow", "感謝你的報名", "eyebrow", { color: T.accent }),
        headline("hero_title", "報名完成，席位已保留", "h1", { color: T.heading, fontSize: 38, lineHeight: 1.3 }, { mobile: { style: { fontSize: 28 } } }),
        text("hero_event", "{{webinar.title}}", "lead", { color: T.secondary }),
      ], 14, "center"),
    ], { ...sectionOptions(960), paddingY: 48, paddingYTablet: 40, paddingYMobile: 24 }),

    section("steps", [
      card("steps_card", [
        headline("steps_title", "接下來做三件小事", "h2", h2Style, { mobile: { style: { fontSize: 24 } } }),
        node("steps_list", "icon_list", { layout: "list", numbered: true, accentColor: T.accent, items: [
          { icon: "message", title: "確認收件匣", text: "活動資訊會寄到你的報名信箱；若沒看到，請檢查促銷內容與垃圾郵件匣。" },
          { icon: "clock", title: "加入行事曆", text: "按下方按鈕，把活動放進 Google 日曆或下載 .ics 檔。" },
          { icon: "lightbulb", title: "準備你的問題", text: "先寫下最想問的一到兩件事，活動中提問會更有效率。" },
        ] }, undefined, { color: T.body }),
        node("steps_calendar", "add_to_calendar", { accentColor: T.accent, align: "left", icsLabel: "下載 .ics 行事曆檔" }),
      ]),
    ], stacked),

    section("facts", [
      card("facts_card", [
        node("facts_bar", "event_facts", { layout: "row", formatLabel: "線上直播", showDuration: true, showTimezone: true, accentColor: T.accent }, undefined, { color: T.body }),
      ]),
    ], stacked),

    // 選填：不需要講者介紹時，請在編輯器刪除或隱藏這個區段。
    section("speaker", [
      card("speaker_box", [
        node("speaker_card", "speaker_profiles", { layout: "featured", size: "small", photoShape: "circle", accentColor: T.accent, items: [
          { photo: "/placeholder.svg", alt: "講者照片（請替換）", name: "講者姓名（請替換）", role: "職稱／所屬單位", bio: "用兩三句話介紹講者的專長，以及這場活動能帶給參加者的幫助。" },
        ] }, undefined, { color: T.body }),
      ]),
    ], stacked),

    section("footer", [
      text("footer_text", "有問題嗎？回覆確認信即可聯絡主辦單位。", "small", { color: T.secondary, textAlign: "center" }),
    ], { ...sectionOptions(960), paddingY: 40, paddingYTablet: 32, paddingYMobile: 28 }),
  ];
}

/** 播放頁（960px）：播放區由平台元件提供，範本只做外圍。 */
function buildBroadcast(prefix: string): FunnelNode[] {
  const { node, section, stack, headline, text } = webinarTemplateKit(prefix);
  const card = (id: string, children: FunnelNode[], gap = 20) => {
    const base = cardStyle();
    return stack(id, children, gap, base.style, { mobile: base.mobile });
  };
  return [
    section("bar", [
      stack("bar_title", [
        text("bar_eyebrow", "線上直播", "eyebrow", { color: T.accent }),
        headline("bar_headline", "歡迎進場", "h1", { color: T.heading, fontSize: 36, lineHeight: 1.3 }, { mobile: { style: { fontSize: 28 } } }),
        text("bar_event", "{{webinar.title}}", "lead", { color: T.secondary }),
      ], 10),
      node("bar_facts", "event_facts", { layout: "row", formatLabel: "線上直播", showDuration: true, accentColor: T.accent }, undefined, { color: T.body }),
    ], { ...sectionOptions(960), paddingY: 48, paddingYTablet: 40, paddingYMobile: 28 }),

    section("player", [
      node("player_note", "callout", { tone: "info", title: "觀看方式", text: "播放入口會依活動狀態顯示在這個頁面。若直播開始後仍看不到畫面，請重新整理頁面並確認網路連線。" }),
    ], stacked),

    section("summary", [
      card("summary_card", [
        headline("summary_title", "這場直播的重點", "h2", h2Style, { mobile: { style: { fontSize: 24 } } }),
        node("summary_list", "icon_list", { layout: "list", numbered: false, accentColor: T.accent, items: [
          { icon: "target", title: "重點一", text: "用一句話寫下這場直播要解決的問題。" },
          { icon: "check", title: "重點二", text: "列出參加者可以帶走的方法或清單。" },
          { icon: "message", title: "重點三", text: "說明提問方式，以及哪些問題會在直播中回答。" },
        ] }, undefined, { color: T.body }),
      ]),
    ], stacked),

    section("speaker", [
      card("speaker_box", [
        node("speaker_card", "speaker_profiles", { layout: "featured", size: "small", photoShape: "circle", accentColor: T.accent, items: [
          { photo: "/placeholder.svg", alt: "講者照片（請替換）", name: "講者姓名（請替換）", role: "職稱／所屬單位", bio: "用兩三句話介紹講者的專長與這場直播的主題。" },
        ] }, undefined, { color: T.body }),
      ]),
    ], stacked),

    section("faq", [
      card("faq_card", [
        headline("faq_title", "直播常見問題", "h2", h2Style, { mobile: { style: { fontSize: 24 } } }),
        node("faq_list", "faq", { items: [
          { question: "看不到畫面怎麼辦？", answer: "請先重新整理頁面，並確認網路連線；仍無法播放時，換一個瀏覽器再試一次。" },
          { question: "沒有聲音怎麼辦？", answer: "請確認裝置沒有靜音，並檢查瀏覽器分頁是否被靜音。" },
          { question: "我要怎麼提問？", answer: "請依主辦單位在直播中公布的方式提問；也可以先把問題寫下來。" },
          { question: "錯過直播還能觀看嗎？", answer: "是否提供回放由主辦單位決定；若有回放，會顯示在這個頁面。" },
        ] }, [], { color: T.body, textAlign: "left" }),
      ]),
    ], stacked),

    section("footer", [
      text("footer_text", "遇到無法解決的問題，請聯絡主辦單位。", "small", { color: T.secondary, textAlign: "center" }),
    ], { ...sectionOptions(960), paddingY: 40, paddingYTablet: 32, paddingYMobile: 28 }),
  ];
}

type PolicyChapter = { id: string; title: string; body: string };
const POLICY_NOTICE = "本頁為示意章節，請依實際營運內容與法律意見修改後再發布；發布前應由負責人完成審閱。";

/** 政策頁（720px）：頁首目錄（錨點）＋可編輯章節。 */
function buildPolicy(prefix: string, kind: "privacy" | "terms", chapters: PolicyChapter[]): FunnelNode[] {
  const { node, section, stack, headline, text } = webinarTemplateKit(prefix);
  const base = cardStyle();
  const privacy = kind === "privacy";
  return [
    // 頁首：標題、最後更新日期與修改提醒。
    section("head", [
      stack("head_card", [
        text("head_eyebrow", privacy ? "隱私權" : "服務條款", "eyebrow", { color: T.accent }),
        headline("head_title", privacy ? "隱私權政策" : "服務條款", "h1", { color: T.heading, fontSize: 36, lineHeight: 1.3 }, { mobile: { style: { fontSize: 28 } } }),
        text("head_updated", "最後更新日期：請在發布前填寫", "small", { color: T.secondary }),
        node("head_notice", "callout", { tone: "warning", title: "請依實際營運內容與法律意見修改", text: POLICY_NOTICE }),
      ], 14, { ...base.style }, { mobile: base.mobile }),
    ], { ...sectionOptions(720), paddingY: 48, paddingYTablet: 40, paddingYMobile: 24 }),
    // 頁首目錄：錨點連結清單（選單元件只能放在區段內，不能放進內容卡）。
    section("toc", [
      text("toc_title", "本頁目錄", "eyebrow", { color: T.secondary }),
      node("toc_menu", "menu", { items: chapters.map((chapter) => ({ label: chapter.title, href: `#${chapter.id}` })) }, undefined, { color: T.accent }),
    ], { ...sectionOptions(720), paddingY: 8, paddingYTablet: 8, paddingYMobile: 8, gap: 8 }),
    section("body", [
      stack("body_card", chapters.flatMap((chapter) => [
        headline(`${chapter.id}_title`, chapter.title, "h2", { ...h2Style, margin: "16px 0 0" }, { htmlId: chapter.id, mobile: { style: { fontSize: 24 } } }),
        text(`${chapter.id}_text`, chapter.body, undefined, { color: T.body, fontSize: 17, lineHeight: 1.85 }),
      ]), 18, { ...base.style }, { mobile: base.mobile }),
    ], { ...sectionOptions(720), paddingY: 32, paddingYTablet: 28, paddingYMobile: 20 }),
  ];
}

const privacyChapters: PolicyChapter[] = [
  { id: "collect", title: "我們蒐集的資料", body: "請列出實際蒐集的資料類型，例如姓名、電子信箱、聯絡電話與訂購紀錄，以及蒐集的時機。" },
  { id: "purpose", title: "資料的使用目的", body: "請說明資料用於哪些用途，例如活動通知、客戶服務與訂單處理，並避免寫入實際未進行的用途。" },
  { id: "sharing", title: "資料的分享與委外", body: "請依實際情況說明是否與金流、物流或其他服務供應商共用資料，以及共用的範圍。" },
  { id: "retention", title: "保存期間與安全措施", body: "請填入資料保存期間與採取的保護措施，內容須與實際作業一致。" },
  { id: "rights", title: "你的權利", body: "你可以聯絡服務提供者提出查詢、更正或刪除請求。請補上受理方式與處理時限。" },
  { id: "contact", title: "聯絡方式", body: "請在發布前填入正式公司名稱、地址與聯絡管道。" },
];

const termsChapters: PolicyChapter[] = [
  { id: "scope", title: "服務使用範圍", body: "請說明本服務提供的內容與適用對象，以及使用前需要同意的條件。" },
  { id: "duties", title: "使用者責任", body: "使用者應提供正確資料並遵守適用規範。請補上帳號保管、禁止行為與違規處理。" },
  { id: "purchase", title: "購買與退款說明", body: "若提供付費內容或服務，請依實際購買流程與退款規則填寫；沒有付費內容時可刪除本章。" },
  { id: "intellectual", title: "智慧財產權", body: "請說明內容、素材與商標的權利歸屬，以及使用者可以如何使用。" },
  { id: "liability", title: "責任限制與終止", body: "請依實際服務與適用法規，填寫責任範圍、服務中止與終止的條件。" },
  { id: "contact", title: "聯絡方式", body: "請在發布前填入正式公司名稱、地址與聯絡管道。" },
];

export const FUNCTIONAL_PAGE_TEMPLATES: readonly FunctionalPageDefinition[] = Object.freeze([
  {
    id: "webinar-thank-you-v2", referenceId: "celebratedeal-webinar-thank-you-v2", goal: "webinar", category: "報名完成", name: "報名完成頁",
    description: "成功狀態、三步驟行動清單、活動資訊與加入行事曆，適用任何 Webinar 報名範本。",
    replaces: "webinar-thank-you", tags: { purposes: ["webinar"], styles: ["minimal"] },
    preview: { eyebrow: "Webinar", headline: "報名完成頁", summary: "三步驟參與提醒與加入行事曆", palette: [T.pageBackground, T.accent, T.card], sectionCount: 5 },
    theme: theme(1.75), build: buildThankYou,
  },
  {
    id: "webinar-broadcast-v2", referenceId: "celebratedeal-webinar-broadcast-v2", goal: "webinar", category: "播放會場", name: "直播播放頁",
    description: "活動標題列、觀看方式、重點摘要、講者卡與直播常見問題；播放區由平台提供。",
    replaces: "webinar-broadcast", tags: { purposes: ["webinar"], styles: ["professional"] },
    preview: { eyebrow: "Webinar", headline: "直播播放頁", summary: "播放區外圍的摘要與常見問題", palette: [T.pageBackground, T.accent, T.card], sectionCount: 6 },
    theme: theme(1.75), build: buildBroadcast,
  },
  {
    id: "custom-privacy-v2", referenceId: "celebratedeal-privacy-v2", goal: "custom", category: "隱私", name: "隱私權政策",
    description: "頁首目錄與可編輯章節，附修改提醒與最後更新日期佔位。",
    replaces: "custom-privacy", tags: { purposes: ["policy"], styles: ["minimal"] },
    preview: { eyebrow: "Custom", headline: "隱私權政策", summary: "頁首目錄與六個可編輯章節", palette: [T.pageBackground, T.accent, T.card], sectionCount: 3 },
    theme: theme(1.85), build: (prefix) => buildPolicy(prefix, "privacy", privacyChapters),
  },
  {
    id: "custom-terms-v2", referenceId: "celebratedeal-terms-v2", goal: "custom", category: "條款", name: "服務條款",
    description: "頁首目錄與可編輯章節，附修改提醒與最後更新日期佔位。",
    replaces: "custom-terms", tags: { purposes: ["policy"], styles: ["minimal"] },
    preview: { eyebrow: "Custom", headline: "服務條款", summary: "頁首目錄與六個可編輯章節", palette: [T.pageBackground, T.accent, T.card], sectionCount: 3 },
    theme: theme(1.85), build: (prefix) => buildPolicy(prefix, "terms", termsChapters),
  },
]);

/** 功能頁在範本庫的條目；`statusReason` 與其他可編輯範本一致。 */
export function functionalPageGalleryItem(page: FunctionalPageDefinition): FunnelTemplateGalleryItem {
  return {
    id: page.id, referenceId: page.referenceId, goal: page.goal, category: page.category, name: page.name, description: page.description,
    status: "available", statusReason: "可展開為獨立編輯的 CelebrateDeal 節點", preview: page.preview,
    theme: page.theme, tags: page.tags, build: page.build,
  };
}
