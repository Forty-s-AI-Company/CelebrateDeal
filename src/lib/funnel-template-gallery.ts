import {
  FUNNEL_CAPABILITIES,
  createEmptyPageDocument,
  parsePageDocument,
  type FunnelNode,
  type FunnelNodeAction,
  type FunnelNodeType,
  type PageDocument,
} from "@/lib/funnel-page-document";
import type { FunnelStepType } from "@/lib/funnel-flow";

export const FUNNEL_TEMPLATE_GOALS = ["sell", "audience", "custom", "webinar"] as const;
export type FunnelTemplateGoal = (typeof FUNNEL_TEMPLATE_GOALS)[number];
export type FunnelTemplateStatus = "available" | "limited";

export type FunnelTemplatePreviewSnapshot = {
  eyebrow: string;
  headline: string;
  summary: string;
  palette: readonly [string, string, string];
  sectionCount: number;
};

export type FunnelTemplateGalleryItem = {
  id: string;
  referenceId: string;
  goal: FunnelTemplateGoal;
  category: string;
  name: string;
  description: string;
  status: FunnelTemplateStatus;
  statusReason: string;
  preview: FunnelTemplatePreviewSnapshot;
  build: (prefix: string) => FunnelNode[];
};

const node = (
  prefix: string,
  id: string,
  type: FunnelNodeType,
  props: Record<string, unknown> = {},
  children?: FunnelNode[],
  style: FunnelNode["style"] = {},
  actions: FunnelNodeAction[] = [],
): FunnelNode => ({
  schemaVersion: 1,
  id: `${prefix}_${id}`,
  type,
  props,
  style,
  overrides: {},
  visible: true,
  actions,
  attributes: {},
  ...(children ? { children } : {}),
});

const text = (prefix: string, id: string, value: string, style: FunnelNode["style"] = {}) =>
  node(prefix, id, "text", { text: value }, undefined, style);
const headline = (prefix: string, id: string, value: string, level: "h1" | "h2" | "h3" = "h2") =>
  node(prefix, id, "headline", { text: value, level });
const button = (prefix: string, id: string, label: string, action: FunnelNodeAction) =>
  node(prefix, id, "button", { label }, undefined, { borderRadius: 8 }, [action]);
const image = (prefix: string, id: string, alt: string) =>
  node(prefix, id, "image", { src: FUNNEL_PLACEHOLDER_IMAGE_SRC, alt, objectFit: "cover" }, undefined, { imageWidth: 100, borderRadius: 12 });
const box = (prefix: string, id: string, children: FunnelNode[]) => node(prefix, id, "content_box", {}, children, { padding: 24, borderRadius: 12 });
const columns = (prefix: string, id: string, children: FunnelNode[], count: 2 | 3 = 2) =>
  node(prefix, id, count === 3 ? "columns_3" : "columns_2", { gap: 24 }, children);
const section = (prefix: string, id: string, children: FunnelNode[], backgroundColor?: string) =>
  node(prefix, id, "section", {}, [node(prefix, `${id}_row`, "row", { maxWidth: 1120 }, children)], { padding: 56, ...(backgroundColor ? { backgroundColor } : {}) });
const list = (prefix: string, id: string, items: string[]) => node(prefix, id, "bulleted_list", { items });

const form = (prefix: string, id: string, heading: string, buttonLabel: string) => {
  const formId = `${prefix}_${id}`;
  return node(prefix, id, "form", { variant: "opt-in" }, [
    text(prefix, `${id}_title`, heading, { fontSize: 24, lineHeight: 1.25 }),
    node(prefix, `${id}_name`, "form_input", { inputType: "text", label: "姓名", placeholder: "請輸入姓名" }),
    node(prefix, `${id}_email`, "form_input", { inputType: "email", label: "電子信箱", placeholder: "name@example.com" }),
    node(prefix, `${id}_consent`, "checkbox", { label: "我同意接收本活動相關資訊", required: true }),
    button(prefix, `${id}_submit`, buttonLabel, { type: "submit_form", formId }),
  ], { padding: 24, borderRadius: 12 });
};

const limitedPayment = {
  capabilityStatus: FUNNEL_CAPABILITIES.payment.status,
  capabilityReason: FUNNEL_CAPABILITIES.payment.reason,
  disabled: true,
};

const checkout = (prefix: string, compact = false) => [
  section(prefix, "checkout", [columns(prefix, "checkout_columns", [
    node(prefix, "customer", "form", { variant: "checkout-contact" }, [
      text(prefix, "customer_title", compact ? "聯絡資料" : "完成訂購資料", { fontSize: 28, lineHeight: 1.2 }),
      node(prefix, "customer_name", "form_input", { inputType: "text", label: "姓名" }),
      node(prefix, "customer_email", "form_input", { inputType: "email", label: "電子信箱" }),
      text(prefix, "customer_notice", "請前往安全結帳頁填寫聯絡資料與配送地址；此處僅展示版面，不收集訂購資料。"),
    ]),
    node(prefix, "order", "form", { variant: "checkout-summary", ...limitedPayment }, [
      text(prefix, "order_title", "方案摘要", { fontSize: 28, lineHeight: 1.2 }),
      text(prefix, "order_name", compact ? "你的精選方案" : "CelebrateDeal 成長方案"),
      node(prefix, "order_price", "offer_price", limitedPayment),
      node(prefix, "payment_method", "payment_method", limitedPayment),
      node(prefix, "payment_button", "payment_button", { ...limitedPayment, label: "前往安全結帳" }),
    ]),
  ])], compact ? "white" : "#fff7ed"),
  section(prefix, "trust", [columns(prefix, "trust_columns", [
    box(prefix, "support", [headline(prefix, "support_title", "有問題嗎？", "h3"), text(prefix, "support_text", "請先聯絡客服確認方案與付款方式。")]),
    box(prefix, "promise", [headline(prefix, "promise_title", "安心確認", "h3"), text(prefix, "promise_text", "金額以安全結帳頁為準。只有付款服務確認成功後，訂單才會更新付款狀態。")]),
  ])]),
];

const subscription = (prefix: string) => [
  section(prefix, "hero", [columns(prefix, "hero_columns", [
    box(prefix, "hero_copy", [
      text(prefix, "eyebrow", "內容訂閱計畫"),
      headline(prefix, "hero_title", "讓好內容陪你持續成長", "h1"),
      text(prefix, "hero_text", "每週整理實作方法、案例與行動清單，幫你穩定推進。"),
      list(prefix, "hero_list", ["每週主題內容", "可重複使用的工作表", "會員限定交流"]),
    ]),
    node(prefix, "plan", "form", { variant: "subscription-summary", ...limitedPayment }, [
      text(prefix, "plan_title", "每月內容方案", { fontSize: 28, lineHeight: 1.2 }),
      text(prefix, "plan_price", "NT$ 方案價格待設定"),
      node(prefix, "plan_offer", "offer_price", limitedPayment),
      node(prefix, "plan_payment", "payment_method", limitedPayment),
      node(prefix, "plan_button", "payment_button", { ...limitedPayment, label: "訂閱付款尚未啟用" }),
    ]),
  ])], "#fffbeb"),
  section(prefix, "bonus", [headline(prefix, "bonus_title", "訂閱加值內容"), columns(prefix, "bonus_columns", [
    box(prefix, "bonus_one", [headline(prefix, "bonus_one_title", "範本資料庫", "h3"), text(prefix, "bonus_one_text", "直接套用常見行銷與內容範本。")]),
    box(prefix, "bonus_two", [headline(prefix, "bonus_two_title", "每月回顧", "h3"), text(prefix, "bonus_two_text", "用簡單方法整理成果與下一步。")]),
  ])]),
];

const audiencePage = (prefix: string, variant: "volunteer" | "charity" | "environment") => {
  const copy = {
    volunteer: { eyebrow: "志工招募", title: "一起把時間變成真正的改變", intro: "加入在地志工團隊，找到適合你的參與方式。", cta: "我要加入志工", theme: "#eff6ff" },
    charity: { eyebrow: "公益活動", title: "每一次參與，都能讓社區更靠近希望", intro: "掌握近期活動與服務消息，一起支持需要被看見的人。", cta: "收到活動通知", theme: "#fdf2f8" },
    environment: { eyebrow: "環境倡議", title: "守護土地，從今天的一個選擇開始", intro: "關注棲地、減塑與公民行動，把關心變成可持續的力量。", cta: "加入倡議名單", theme: "#ecfdf5" },
  }[variant];
  return [
    section(prefix, "header", [headline(prefix, "brand", "CelebrateDeal 公益行動", "h2"), node(prefix, "menu", "menu", { items: [{ label: "關於行動", href: "#about" }, { label: "參與方式", href: "#join" }, { label: "常見問題", href: "#faq" }] })]),
    section(prefix, "hero", [columns(prefix, "hero_columns", [
      box(prefix, "hero_copy", [text(prefix, "eyebrow", copy.eyebrow), headline(prefix, "hero_title", copy.title, "h1"), text(prefix, "hero_intro", copy.intro), image(prefix, "hero_image", `${copy.eyebrow}主視覺`)]),
      form(prefix, "hero_form", "留下聯絡方式", copy.cta),
    ])], copy.theme),
    section(prefix, "impact", [headline(prefix, "impact_title", "我們正在推進的事"), columns(prefix, "impact_columns", [
      box(prefix, "impact_one", [headline(prefix, "impact_one_title", "在地連結", "h3"), text(prefix, "impact_one_text", "串連社群夥伴，把資源送到真正需要的地方。")]),
      box(prefix, "impact_two", [headline(prefix, "impact_two_title", "透明行動", "h3"), text(prefix, "impact_two_text", "定期分享進度與成果，讓每份支持都有跡可循。")]),
      box(prefix, "impact_three", [headline(prefix, "impact_three_title", "長期陪伴", "h3"), text(prefix, "impact_three_text", "以可持續的方法累積影響，而非一次性的熱度。")]),
    ], 3)]),
    section(prefix, "faq", [headline(prefix, "faq_title", "常見問題"), node(prefix, "faq_list", "faq", { items: [
      { question: "需要具備經驗嗎？", answer: "不需要，我們會依參與方式提供清楚說明。" },
      { question: "留下資料後會發生什麼？", answer: "你會收到活動資訊，不會觸發付款或正式寄信測試。" },
    ] }, [])]),
    section(prefix, "footer", [text(prefix, "footer_text", "© CelebrateDeal 公益行動。聯絡資訊與隱私說明皆可自行編輯。")]),
  ];
};

const legalPage = (prefix: string, kind: "privacy" | "terms") => {
  const privacy = kind === "privacy";
  return [section(prefix, "legal", [box(prefix, "legal_content", [
    headline(prefix, "legal_title", privacy ? "隱私權政策" : "服務條款", "h1"),
    text(prefix, "legal_updated", "最後更新日期：請在發布前填寫"),
    headline(prefix, "legal_scope_title", privacy ? "我們如何處理資料" : "服務使用範圍", "h2"),
    text(prefix, "legal_scope_text", privacy ? "此範本提供可編輯的基本章節，發布前應由負責人依實際資料流程與法規完成審閱。" : "此範本提供可編輯的基本章節，發布前應依實際服務內容與權利義務完成審閱。"),
    headline(prefix, "legal_rights_title", privacy ? "你的權利" : "使用者責任", "h2"),
    text(prefix, "legal_rights_text", privacy ? "你可以聯絡服務提供者提出查詢、更正或刪除請求。請補上正式聯絡方式。" : "使用者應提供正確資料並遵守適用規範。請補上完整責任與終止條款。"),
    headline(prefix, "legal_contact_title", "聯絡方式", "h2"),
    text(prefix, "legal_contact_text", "請在發布前填入正式公司名稱、地址與聯絡管道。"),
  ])])];
};

const brandInfo = (prefix: string) => [
  section(prefix, "header", [headline(prefix, "brand", "CelebrateDeal", "h2"), node(prefix, "menu", "menu", { items: [{ label: "品牌故事", href: "#story" }, { label: "服務原則", href: "#principles" }, { label: "聯絡我們", href: "#contact" }] })]),
  section(prefix, "hero", [columns(prefix, "hero_columns", [box(prefix, "hero_copy", [headline(prefix, "hero_title", "讓值得慶祝的成果，被更多人看見", "h1"), text(prefix, "hero_text", "用清楚、可信任的資訊，介紹品牌使命與服務方式。")]), image(prefix, "hero_image", "品牌故事主視覺")])], "#f8fafc"),
  section(prefix, "principles", [headline(prefix, "principles_title", "我們重視的事"), columns(prefix, "principles_columns", [
    box(prefix, "principle_one", [headline(prefix, "principle_one_title", "清楚", "h3"), text(prefix, "principle_one_text", "重要資訊以自然、容易理解的方式呈現。")]),
    box(prefix, "principle_two", [headline(prefix, "principle_two_title", "負責", "h3"), text(prefix, "principle_two_text", "功能限制與資料用途都明確說明。")]),
    box(prefix, "principle_three", [headline(prefix, "principle_three_title", "同行", "h3"), text(prefix, "principle_three_text", "陪伴團隊把每個想法落實成下一步。")]),
  ], 3)]),
  section(prefix, "contact", [headline(prefix, "contact_title", "想進一步認識我們？"), button(prefix, "contact_button", "聯絡 CelebrateDeal", { type: "open_url", href: "#contact", newTab: false })]),
];

const availableReason = "可展開為獨立編輯的 CelebrateDeal 節點";
const limitedReason = "版面可編輯；需在訂單步驟綁定有效商品，付款方式由既有結帳服務提供。未綁定時不可付款";

const webinarPage = (prefix: string, stage: "registration" | "thank-you" | "broadcast") => {
  // 真正報名與播放能力仍由公開頁綁定的已驗證資源提供；模板只組合一般可編輯節點。
  if (stage === "registration") return [
    section(prefix, "hero", [columns(prefix, "hero_columns", [
      box(prefix, "hero_copy", [text(prefix, "eyebrow", "CelebrateDeal 線上講堂"), headline(prefix, "title", "把模糊的想法，整理成能落地的行動", "h1"), text(prefix, "intro", "60 分鐘實作分享，帶你拆解方法、案例與下一步。"), list(prefix, "highlights", ["真實案例拆解", "現場提問交流", "課後行動清單"])]),
      form(prefix, "registration_form", "免費保留席次", "我要報名"),
    ])], "#eff6ff"),
    section(prefix, "speaker", [columns(prefix, "speaker_columns", [image(prefix, "speaker_image", "講者形象照"), box(prefix, "speaker_copy", [text(prefix, "speaker_eyebrow", "本場講者"), headline(prefix, "speaker_name", "林怡安｜內容策略顧問", "h2"), text(prefix, "speaker_intro", "擅長把複雜策略整理成團隊可以一起執行的清楚步驟。")])])]),
    section(prefix, "agenda", [headline(prefix, "agenda_title", "這場分享會會帶走什麼？"), columns(prefix, "agenda_columns", [box(prefix, "agenda_one", [headline(prefix, "agenda_one_title", "看懂卡點", "h3"), text(prefix, "agenda_one_text", "用簡單框架找出轉換流程真正卡住的位置。")]), box(prefix, "agenda_two", [headline(prefix, "agenda_two_title", "帶走做法", "h3"), text(prefix, "agenda_two_text", "把概念變成明天就能開始的小步驟。")]), box(prefix, "agenda_three", [headline(prefix, "agenda_three_title", "持續優化", "h3"), text(prefix, "agenda_three_text", "建立能被團隊共同追蹤的迭代節奏。")])], 3)]),
  ];
  if (stage === "thank-you") return [
    section(prefix, "hero", [text(prefix, "eyebrow", "報名完成"), headline(prefix, "title", "席次已為你保留，接下來做三件小事", "h1"), text(prefix, "intro", "把活動放進行事曆，也記得查看收件匣中的參與資訊。")], "#ecfdf5"),
    section(prefix, "checklist", [columns(prefix, "checklist_columns", [box(prefix, "check_mail", [headline(prefix, "check_mail_title", "01｜確認 Email", "h3"), text(prefix, "check_mail_text", "活動連結與注意事項會寄到報名信箱。")]), box(prefix, "check_calendar", [headline(prefix, "check_calendar_title", "02｜記下時間", "h3"), text(prefix, "check_calendar_text", "預留不被打擾的學習時間，準時加入。")]), box(prefix, "check_question", [headline(prefix, "check_question_title", "03｜準備問題", "h3"), text(prefix, "check_question_text", "先記下最想解決的一個問題，現場會更有收穫。")])], 3)]),
    section(prefix, "share", [headline(prefix, "share_title", "也想邀請夥伴一起參加？"), text(prefix, "share_text", "把活動頁分享給正在面對相同挑戰的朋友。"), button(prefix, "share_button", "返回活動資訊", { type: "open_url", href: "#top", newTab: false })]),
  ];
  return [
    section(prefix, "hero", [columns(prefix, "hero_columns", [box(prefix, "player", [text(prefix, "live_badge", "LIVE｜活動進行中"), headline(prefix, "title", "歡迎來到 CelebrateDeal 線上講堂", "h1"), text(prefix, "player_notice", "播放入口會依已綁定的 Webinar 場次與開放狀態顯示。")]), box(prefix, "session", [headline(prefix, "session_title", "本場重點", "h3"), list(prefix, "session_list", ["釐清目前最重要的目標", "拆解可執行的轉換路徑", "完成一份下一步行動清單"])])])], "#f8fafc"),
    section(prefix, "notes", [columns(prefix, "notes_columns", [box(prefix, "notes_copy", [headline(prefix, "notes_title", "先把問題寫下來", "h2"), text(prefix, "notes_text", "觀看過程若有疑問，先記錄情境與期待結果，提問時會更容易得到具體建議。")]), box(prefix, "support", [headline(prefix, "support_title", "遇到播放問題？", "h3"), text(prefix, "support_text", "請先重新整理頁面並確認網路連線；仍無法觀看時，再聯絡主辦單位。")])])]),
  ];
};

// 課程與銷講內容只提供可編輯起點；不內建虛構成效、名額或成交保證。
const courseLeadPage = (prefix: string, variant: "workbook" | "consultation" | "lesson") => {
  const copy = {
    workbook: { title: "把專業整理成第一份課程大綱", eyebrow: "課程規劃工作表", intro: "從受眾、學習目標到單元安排，用一份工作表整理你的開課想法。", cta: "索取課程規劃資訊", theme: "#eff6ff", items: ["釐清想幫助的學員與問題", "寫下可檢查的學習目標", "排出第一版課程單元"] },
    consultation: { title: "先釐清需求，再決定適合的學習方案", eyebrow: "課程需求諮詢", intro: "說明目前的目標與遇到的困難，讓團隊先了解需求，再討論是否適合進一步諮詢。", cta: "留下諮詢意願", theme: "#f5f3ff", items: ["整理目前的學習或業務目標", "找出最需要協助的一個環節", "確認課程內容與投入是否適合"] },
    lesson: { title: "用一堂入門課，認識你的下一步", eyebrow: "課程體驗資訊", intro: "先了解主題、練習方式與適合對象，再決定是否參與完整課程。", cta: "索取體驗課資訊", theme: "#fff7ed", items: ["主題概念與常見誤區", "一個可以自行練習的任務", "完整課程的內容與適合對象"] },
  }[variant];
  const signup = form(prefix, "course_form", "留下聯絡方式", copy.cta);
  return [
    section(prefix, "hero", variant === "workbook" ? [columns(prefix, "hero_columns", [
      box(prefix, "hero_copy", [text(prefix, "eyebrow", copy.eyebrow), headline(prefix, "title", copy.title, "h1"), text(prefix, "intro", copy.intro)]), signup,
    ])] : [text(prefix, "eyebrow", copy.eyebrow), headline(prefix, "title", copy.title, "h1"), text(prefix, "intro", copy.intro)], copy.theme),
    section(prefix, "contents", [headline(prefix, "contents_title", variant === "consultation" ? "這次可以先討論什麼？" : "先了解這三件事"),
      columns(prefix, "contents_columns", copy.items.map((item, index) => box(prefix, `topic_${index}`, [headline(prefix, `topic_title_${index}`, `${index + 1}｜${item}`, "h3") ])), 3)]),
    ...(variant === "workbook" ? [] : [section(prefix, "signup", [signup])]),
    section(prefix, "next", [headline(prefix, "next_title", "送出之後會發生什麼？"), text(prefix, "next_text", "請依完成頁指示確認後續聯繫方式。留下聯絡方式不代表已購買課程或完成諮詢預約；課程內容、時程與聯絡方式請由主辦單位確認。")]),
  ];
};

const salesWebinarPage = (prefix: string, variant: "course" | "workshop" | "strategy") => {
  const copy = {
    course: { title: "開課前，先把你的課程路線說清楚", eyebrow: "課程說明會", intro: "了解課程主題、單元安排與練習方式，判斷是否符合你現在的需求。", cta: "報名課程說明會", theme: "#eff6ff", agenda: ["適合對象與先備條件", "課程單元與練習安排", "參與方式與問題討論"] },
    workshop: { title: "帶著一個問題，完成一份實作草稿", eyebrow: "線上實作工作坊", intro: "從範例拆解到自己動手，先用一次練習認識這套方法的使用方式。", cta: "報名實作工作坊", theme: "#ecfdf5", agenda: ["拆解範例與操作步驟", "完成自己的第一版草稿", "整理卡點與後續練習方向"] },
    strategy: { title: "把你的專業，整理成清楚的服務提案", eyebrow: "顧問服務銷講", intro: "從客戶需求、服務範圍到交付安排，了解如何說明一份完整提案。", cta: "報名服務提案講座", theme: "#fff7ed", agenda: ["定義想協助的客戶與問題", "釐清服務範圍與交付方式", "用提案說明價值與合作條件"] },
  }[variant];
  // Webinar 的公開報名由既有專用表單處理；模板導向它，不另外渲染停用的通用表單。
  const signup = box(prefix, "webinar_signup", [
    headline(prefix, "signup_title", "參加這場活動", "h2"),
    text(prefix, "signup_text", "確認活動資訊後，前往報名表填寫資料。"),
    button(prefix, "signup_button", copy.cta, { type: "open_url", href: "#webinar-registration", newTab: false }),
  ]);
  return [
    section(prefix, "hero", variant === "course" ? [columns(prefix, "hero_columns", [
      box(prefix, "hero_copy", [text(prefix, "eyebrow", copy.eyebrow), headline(prefix, "title", copy.title, "h1"), text(prefix, "intro", copy.intro)]), signup,
    ])] : [text(prefix, "eyebrow", copy.eyebrow), headline(prefix, "title", copy.title, "h1"), text(prefix, "intro", copy.intro)], copy.theme),
    section(prefix, "agenda", [headline(prefix, "agenda_title", "本場內容"), list(prefix, "agenda_list", copy.agenda)]),
    section(prefix, "speaker", [headline(prefix, "speaker_title", "講者與活動資訊"), text(prefix, "speaker_text", "請填入實際講者姓名、相關經驗與活動時間。報名前可先向主辦單位確認內容與參與方式。")]),
    ...(variant === "course" ? [] : [section(prefix, "signup", [signup])]),
    section(prefix, "participation", [headline(prefix, "participation_title", variant === "workshop" ? "參加前可以先準備" : "報名前先確認"), text(prefix, "participation_text", variant === "workshop" ? "先記下想處理的一個問題，並準備可操作的裝置。實作素材與需要的工具請依主辦單位公告為準。" : "本頁是活動報名，送出資料不代表購買課程。若活動中介紹付費方案，內容與費用需另行確認；報名狀態與觀看入口請依完成頁指示。")]),
  ];
};

const templates: FunnelTemplateGalleryItem[] = [
  { id: "webinar-broadcast", referenceId: "celebratedeal-webinar-broadcast", goal: "webinar", category: "播放會場", name: "專注播放會場", description: "直播狀態、重點摘要、提問筆記與播放問題指引。", status: "available", statusReason: availableReason, preview: { eyebrow: "Webinar", headline: "專注播放會場", summary: "線上活動與參與資訊", palette: ["#f8fafc", "#0f172a", "#f59e0b"], sectionCount: 2 }, build: (prefix) => webinarPage(prefix, "broadcast") },
  { id: "webinar-thank-you", referenceId: "celebratedeal-webinar-thank-you", goal: "webinar", category: "報名完成", name: "報名完成行動清單", description: "Email、行事曆與提問準備三步驟，降低報名後流失。", status: "available", statusReason: availableReason, preview: { eyebrow: "Webinar", headline: "報名完成行動清單", summary: "三步驟參與提醒", palette: ["#ecfdf5", "#047857", "#ffffff"], sectionCount: 3 }, build: (prefix) => webinarPage(prefix, "thank-you") },
  { id: "webinar-registration", referenceId: "celebratedeal-webinar-registration", goal: "webinar", category: "活動報名", name: "講者型活動報名頁", description: "價值主張、報名表單、講者介紹與三欄議程重點。", status: "available", statusReason: availableReason, preview: { eyebrow: "Webinar", headline: "講者型活動報名頁", summary: "講者與議程導向的長頁", palette: ["#eff6ff", "#2563eb", "#ffffff"], sectionCount: 3 }, build: (prefix) => webinarPage(prefix, "registration") },
  { id: "sell-product-checkout", referenceId: "25969", goal: "sell", category: "商品結帳", name: "暖色商品結帳", description: "地址與聯絡資料、方案摘要、付款限制提示及信任區塊。", status: "limited", statusReason: limitedReason, preview: { eyebrow: "Sell", headline: "暖色商品結帳", summary: "雙欄結帳與信任資訊", palette: ["#fff7ed", "#9a3412", "#ffffff"], sectionCount: 2 }, build: (prefix) => checkout(prefix) },
  { id: "sell-simple-checkout", referenceId: "25963", goal: "sell", category: "簡潔結帳", name: "藍白簡潔結帳", description: "精簡的聯絡資料與訂單摘要雙欄結構。", status: "limited", statusReason: limitedReason, preview: { eyebrow: "Sell", headline: "藍白簡潔結帳", summary: "聚焦轉換的精簡版面", palette: ["#ffffff", "#2563eb", "#eff6ff"], sectionCount: 2 }, build: (prefix) => checkout(prefix, true) },
  { id: "sell-content-subscription", referenceId: "25957", goal: "sell", category: "內容訂閱", name: "內容訂閱方案", description: "訂閱價值、方案卡與 bonus 內容；付款仍維持限制狀態。", status: "limited", statusReason: limitedReason, preview: { eyebrow: "Sell", headline: "內容訂閱方案", summary: "方案卡與加值內容", palette: ["#fffbeb", "#a16207", "#ffffff"], sectionCount: 2 }, build: subscription },
  { id: "audience-volunteer", referenceId: "26050", goal: "audience", category: "志工招募", name: "在地志工招募", description: "導覽、招募 Hero、名單表單、影響力與 FAQ 長頁。", status: "available", statusReason: availableReason, preview: { eyebrow: "Audience", headline: "在地志工招募", summary: "溫暖的社群招募長頁", palette: ["#eff6ff", "#1d4ed8", "#ffffff"], sectionCount: 5 }, build: (prefix) => audiencePage(prefix, "volunteer") },
  { id: "audience-charity-event", referenceId: "26049", goal: "audience", category: "公益活動", name: "公益活動名單", description: "公益活動訊息、參與表單、行動成果與常見問題。", status: "available", statusReason: availableReason, preview: { eyebrow: "Audience", headline: "公益活動名單", summary: "活動資訊與兩階段溝通入口", palette: ["#fdf2f8", "#be185d", "#ffffff"], sectionCount: 5 }, build: (prefix) => audiencePage(prefix, "charity") },
  { id: "audience-environment", referenceId: "26048", goal: "audience", category: "環境倡議", name: "環境倡議行動", description: "環境議題 Hero、倡議名單、成果卡與 FAQ。", status: "available", statusReason: availableReason, preview: { eyebrow: "Audience", headline: "環境倡議行動", summary: "自然色系的倡議長頁", palette: ["#ecfdf5", "#047857", "#ffffff"], sectionCount: 5 }, build: (prefix) => audiencePage(prefix, "environment") },
  { id: "custom-privacy", referenceId: "3012", goal: "custom", category: "隱私", name: "隱私權政策", description: "可編輯的隱私資料處理、權利與聯絡章節。", status: "available", statusReason: availableReason, preview: { eyebrow: "Custom", headline: "隱私權政策", summary: "簡潔的法務純文字版面", palette: ["#ffffff", "#0f172a", "#e2e8f0"], sectionCount: 1 }, build: (prefix) => legalPage(prefix, "privacy") },
  { id: "custom-terms", referenceId: "3011", goal: "custom", category: "條款", name: "服務條款", description: "可編輯的服務範圍、使用者責任與聯絡章節。", status: "available", statusReason: availableReason, preview: { eyebrow: "Custom", headline: "服務條款", summary: "簡潔的條款純文字版面", palette: ["#ffffff", "#1e293b", "#cbd5e1"], sectionCount: 1 }, build: (prefix) => legalPage(prefix, "terms") },
  { id: "custom-brand-info", referenceId: "3010", goal: "custom", category: "品牌資訊", name: "品牌資訊頁", description: "含導覽、Hero、品牌原則與聯絡行動的資訊頁。", status: "available", statusReason: availableReason, preview: { eyebrow: "Custom", headline: "品牌資訊頁", summary: "品牌化導覽與分段內容", palette: ["#f8fafc", "#7c3aed", "#ffffff"], sectionCount: 4 }, build: brandInfo },
  { id: "audience-course-workbook", referenceId: "celebratedeal-course-workbook", goal: "audience", category: "課程工作表", name: "課程規劃名單頁", description: "以課程工作表為主題，搭配學習目標、單元安排與名單表單。", status: "available", statusReason: availableReason, preview: { eyebrow: "課程名單", headline: "課程規劃名單頁", summary: "工作表與學習目標導向", palette: ["#eff6ff", "#1d4ed8", "#ffffff"], sectionCount: 3 }, build: prefix => courseLeadPage(prefix, "workbook") },
  { id: "audience-course-consultation", referenceId: "celebratedeal-course-consultation", goal: "audience", category: "課程諮詢", name: "課程需求諮詢名單頁", description: "先說明需求討論範圍，再收集聯絡方式，不冒充已完成預約。", status: "available", statusReason: availableReason, preview: { eyebrow: "課程名單", headline: "課程需求諮詢名單頁", summary: "需求釐清與諮詢意願", palette: ["#f5f3ff", "#7c3aed", "#ffffff"], sectionCount: 4 }, build: prefix => courseLeadPage(prefix, "consultation") },
  { id: "audience-course-lesson", referenceId: "celebratedeal-course-lesson", goal: "audience", category: "體驗課程", name: "入門體驗課名單頁", description: "介紹入門主題、練習任務與適合對象，讓訪客索取課程資訊。", status: "available", statusReason: availableReason, preview: { eyebrow: "課程名單", headline: "入門體驗課名單頁", summary: "體驗內容與後續學習路線", palette: ["#fff7ed", "#9a3412", "#ffffff"], sectionCount: 4 }, build: prefix => courseLeadPage(prefix, "lesson") },
  { id: "webinar-course-registration", referenceId: "celebratedeal-webinar-course", goal: "webinar", category: "課程說明會", name: "課程說明會報名頁", description: "課程內容、適合對象與參與方式，搭配首屏活動報名表單。", status: "available", statusReason: availableReason, preview: { eyebrow: "銷講活動", headline: "課程說明會報名頁", summary: "課程路線與報名前確認", palette: ["#eff6ff", "#2563eb", "#ffffff"], sectionCount: 4 }, build: prefix => salesWebinarPage(prefix, "course") },
  { id: "webinar-workshop-registration", referenceId: "celebratedeal-webinar-workshop", goal: "webinar", category: "實作工作坊", name: "線上實作工作坊報名頁", description: "實作目標、操作議程與參加前準備，搭配活動報名表單。", status: "available", statusReason: availableReason, preview: { eyebrow: "銷講活動", headline: "線上實作工作坊報名頁", summary: "範例拆解與動手練習", palette: ["#ecfdf5", "#047857", "#ffffff"], sectionCount: 5 }, build: prefix => salesWebinarPage(prefix, "workshop") },
  { id: "webinar-strategy-registration", referenceId: "celebratedeal-webinar-strategy", goal: "webinar", category: "顧問服務銷講", name: "服務提案銷講報名頁", description: "以客戶需求、服務範圍與交付方式為主題，清楚區分活動報名與購買。", status: "available", statusReason: availableReason, preview: { eyebrow: "銷講活動", headline: "服務提案銷講報名頁", summary: "服務價值與合作條件", palette: ["#fff7ed", "#9a3412", "#ffffff"], sectionCount: 5 }, build: prefix => salesWebinarPage(prefix, "strategy") },
];

export const FUNNEL_TEMPLATE_GALLERY: readonly FunnelTemplateGalleryItem[] = Object.freeze(templates);

let instanceSequence = 0;
function nextPrefix(templateId: string): string {
  instanceSequence += 1;
  return `gallery_${templateId}_${Date.now().toString(36)}_${instanceSequence}`;
}

export function getFunnelTemplateGalleryItem(templateId: string): FunnelTemplateGalleryItem | null {
  return FUNNEL_TEMPLATE_GALLERY.find((template) => template.id === templateId) ?? null;
}

export function listFunnelTemplateGallery(goal?: FunnelTemplateGoal, stepType?: FunnelStepType): readonly FunnelTemplateGalleryItem[] {
  const goalTemplates = goal ? FUNNEL_TEMPLATE_GALLERY.filter((template) => template.goal === goal) : FUNNEL_TEMPLATE_GALLERY;
  if (!stepType) return goalTemplates;
  if (goal === "webinar") {
    const templatesByStep: Partial<Record<FunnelStepType, string[]>> = {
      webinar_registration_page: ["webinar-registration", "webinar-course-registration", "webinar-workshop-registration", "webinar-strategy-registration"],
      webinar_thank_you_page: ["webinar-thank-you"],
      webinar_broadcast_page: ["webinar-broadcast"],
    };
    const templateIds = templatesByStep[stepType];
    return templateIds ? goalTemplates.filter((template) => templateIds.includes(template.id)) : [];
  }
  if (goal === "custom") return ["info_page", "contact_us_page"].includes(stepType) ? goalTemplates : [];
  if (goal === "audience") {
    if (stepType === "opt_in_page") return goalTemplates;
    // 保留原三款的可用步驟；新的完整課程長頁只提供給名單頁。
    return ["inline_form", "popup_form", "link_in_bio"].includes(stepType)
      ? goalTemplates.filter(template => !template.id.startsWith("audience-course-")) : [];
  }
  if (goal === "sell") return ["order_form", "sales_page", "upsell", "downsell"].includes(stepType) ? goalTemplates : [];
  return [];
}

/** 預設圖片占位檔；實體檔案位於 public/placeholder.svg。 */
export const FUNNEL_PLACEHOLDER_IMAGE_SRC = "/placeholder.svg";

function buildTemplateDocument(template: FunnelTemplateGalleryItem, prefix: string, pageId?: string): PageDocument {
  const empty = createEmptyPageDocument(pageId ?? `${prefix}_page`, template.name);
  const document = parsePageDocument({ ...empty, root: template.build(prefix) });
  if (!document) throw new Error(`一頁式網站模板無法通過 PageDocument 驗證：${template.id}`);
  return document;
}

/** Build a fresh, validated PageDocument. 節點 ID 每次呼叫都唯一，只可在套用（事件處理）時呼叫，不可用於 render。 */
export function instantiateFunnelTemplate(templateId: string, pageId?: string): PageDocument {
  const template = getFunnelTemplateGalleryItem(templateId);
  if (!template) throw new Error(`找不到一頁式網站模板：${templateId}`);
  return buildTemplateDocument(template, nextPrefix(template.id), pageId);
}

/** 預覽專用：節點 ID 只由模板 ID 決定，伺服器與瀏覽器 render 結果一致，避免 hydration 不符。 */
export function previewFunnelTemplate(templateId: string, pageId?: string): PageDocument {
  const template = getFunnelTemplateGalleryItem(templateId);
  if (!template) throw new Error(`找不到一頁式網站模板：${templateId}`);
  const prefix = `gallery_${template.id}_preview`;
  return buildTemplateDocument(template, prefix, pageId ?? `${prefix}_page`);
}
