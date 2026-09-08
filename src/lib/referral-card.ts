import QRCode from "qrcode";

export type ReferralCardInput = {
  participantName: string;
  salutation?: string | null;
  topic: string;
  startsAt?: string | Date | null;
  referralUrl: string;
  brandName?: string;
};

export type ReferralCard = {
  svg: string;
  downloadName: string;
  referralUrl: string;
};

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeText(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim().replace(/\s+/gu, " ").slice(0, 180);
  return normalized || fallback;
}

function formatStartAt(value: string | Date | null | undefined) {
  if (!value) return "精彩內容，準時見";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "精彩內容，準時見";
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(date);
}

function assertSafeReferralUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("推薦連結必須使用 HTTP 或 HTTPS");
  }
  return url.toString();
}

/** 建立含 UTM 的專屬推薦連結；拒絕 javascript: 等非 HTTP(S) 協定。 */
export function buildReferralUrl(input: {
  baseUrl: string;
  referralCode?: string | null;
  participantId?: string | null;
  campaign?: string;
}) {
  const url = new URL(assertSafeReferralUrl(input.baseUrl));
  if (input.referralCode?.trim()) url.searchParams.set("ref", input.referralCode.trim().slice(0, 120));
  if (input.participantId?.trim()) url.searchParams.set("participant", input.participantId.trim().slice(0, 120));
  url.searchParams.set("utm_source", "referral_card");
  url.searchParams.set("utm_medium", "share");
  url.searchParams.set("utm_campaign", (input.campaign?.trim() || "live_registration").slice(0, 160));
  return url.toString();
}

/** 產生暗色高對比分享海報 SVG 與 QR Code；所有外部文字都會 XML 跳脫。 */
export async function generateReferralCard(input: ReferralCardInput): Promise<ReferralCard> {
  const referralUrl = assertSafeReferralUrl(input.referralUrl);
  const participant = safeText(input.participantName, "你的朋友");
  const salutation = safeText(input.salutation, "嗨");
  const topic = safeText(input.topic, "線上分享會");
  const brand = safeText(input.brandName, "CelebrateDeal");
  const startsAt = formatStartAt(input.startsAt);
  const qrDataUrl = await QRCode.toDataURL(referralUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
    color: { dark: "#111827", light: "#ffffff" },
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(topic)} 分享邀請</title>
  <desc id="desc">${escapeXml(participant)} 邀請你參加 ${escapeXml(topic)}</desc>
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#312e81"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="24" result="blur"/></filter></defs>
  <rect width="1080" height="1350" rx="44" fill="url(#bg)"/><circle cx="880" cy="180" r="230" fill="#7c3aed" opacity=".32" filter="url(#glow)"/><circle cx="150" cy="1120" r="250" fill="#06b6d4" opacity=".18" filter="url(#glow)"/>
  <text x="86" y="120" fill="#a5b4fc" font-family="Arial,sans-serif" font-size="34" font-weight="700">${escapeXml(brand)}</text>
  <text x="86" y="260" fill="#ffffff" font-family="Arial,sans-serif" font-size="46" font-weight="600">${escapeXml(salutation)}，${escapeXml(participant)}邀請你</text>
  <text x="86" y="385" fill="#ffffff" font-family="Arial,sans-serif" font-size="72" font-weight="800">${escapeXml(topic)}</text>
  <text x="86" y="485" fill="#cbd5e1" font-family="Arial,sans-serif" font-size="34">${escapeXml(startsAt)}</text>
  <rect x="86" y="610" width="908" height="470" rx="32" fill="#ffffff" opacity=".96"/><image href="${escapeXml(qrDataUrl)}" x="360" y="660" width="360" height="360" preserveAspectRatio="xMidYMid meet"/>
  <text x="540" y="1050" text-anchor="middle" fill="#334155" font-family="Arial,sans-serif" font-size="28" font-weight="700">掃描 QR Code 立即報名</text>
  <text x="540" y="1240" text-anchor="middle" fill="#e0e7ff" font-family="Arial,sans-serif" font-size="24">${escapeXml(referralUrl.slice(0, 96))}</text>
</svg>`;
  return { svg, downloadName: "celebratedeal-referral-card.svg", referralUrl };
}

export const createReferralCard = generateReferralCard;
