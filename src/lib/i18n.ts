export const SUPPORTED_LOCALES = ["zh-TW", "zh-CN", "en", "ja"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = { "zh-TW": "繁體中文", "zh-CN": "简体中文", en: "English", ja: "日本語" };

export const messages = {
  "zh-TW": { registerNow: "立即報名", countdown: "倒數計時", bookConsultation: "預約諮詢", checkoutPayment: "結帳付款", myCourses: "我的課程", installApp: "安裝 App", language: "語言", liveRoom: "直播間", studentCenter: "學員中心", freePreview: "免費試看", limitedOffer: "限時優惠" },
  "zh-CN": { registerNow: "立即报名", countdown: "倒计时", bookConsultation: "预约咨询", checkoutPayment: "结账付款", myCourses: "我的课程", installApp: "安装 App", language: "语言", liveRoom: "直播间", studentCenter: "学员中心", freePreview: "免费试看", limitedOffer: "限时优惠" },
  en: { registerNow: "Register now", countdown: "Countdown", bookConsultation: "Book a consultation", checkoutPayment: "Checkout and pay", myCourses: "My courses", installApp: "Install app", language: "Language", liveRoom: "Live room", studentCenter: "Student center", freePreview: "Free preview", limitedOffer: "Limited-time offer" },
  ja: { registerNow: "今すぐ申し込む", countdown: "カウントダウン", bookConsultation: "相談を予約", checkoutPayment: "購入手続き・支払い", myCourses: "マイコース", installApp: "アプリをインストール", language: "言語", liveRoom: "ライブ配信", studentCenter: "受講者センター", freePreview: "無料視聴", limitedOffer: "期間限定オファー" },
} as const;
export type MessageKey = keyof typeof messages["en"];

export function resolveLocale(value: string | null | undefined): Locale {
  if (!value) return "zh-TW";
  const normalized = value.trim().replace("_", "-").toLowerCase();
  if (normalized === "zh-tw" || normalized === "zh-hant") return "zh-TW";
  if (normalized === "zh-cn" || normalized === "zh-hans" || normalized === "zh") return "zh-CN";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
  return "zh-TW";
}

export function detectLocaleFromCookie(cookieHeader?: string | null): Locale | null {
  const match = cookieHeader?.match(/(?:^|;\s*)(?:locale|NEXT_LOCALE)=([^;]+)/i);
  const encodedLocale = match?.[1];
  if (!encodedLocale) return null;
  try { return resolveLocale(decodeURIComponent(encodedLocale)); } catch { return null; }
}

export function detectLocaleFromAcceptLanguage(header?: string | null): Locale {
  const candidates = (header ?? "").split(",").map((part) => ({ value: part.split(";")[0]?.trim() ?? "", quality: Number(part.match(/q=([0-9.]+)/i)?.[1] ?? 1) })).filter((candidate) => candidate.value).sort((a, b) => b.quality - a.quality);
  for (const candidate of candidates) {
    const value = candidate.value.toLowerCase();
    if (value === "zh-tw" || value === "zh-hant") return "zh-TW";
    if (value === "zh-cn" || value === "zh-hans" || value === "zh") return "zh-CN";
    if (value === "en" || value.startsWith("en-")) return "en";
    if (value === "ja" || value.startsWith("ja-")) return "ja";
  }
  return "zh-TW";
}

export function detectLocale(input: { cookie?: string | null; acceptLanguage?: string | null } = {}): Locale {
  return detectLocaleFromCookie(input.cookie) ?? detectLocaleFromAcceptLanguage(input.acceptLanguage);
}

export function getMessages(locale?: string | null) { return messages[resolveLocale(locale)]; }
export function t(locale: string | null | undefined, key: MessageKey): string { return getMessages(locale)[key] ?? messages["zh-TW"][key]; }
