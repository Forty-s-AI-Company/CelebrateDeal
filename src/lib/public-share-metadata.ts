import type { Metadata } from "next";

import { getCanonicalAppUrl } from "@/lib/app-url";

const DESCRIPTION_LIMIT = 160;

function plainText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** 分享預覽的描述只取純文字並限制長度，避免把長篇內容整段貼進 meta。 */
export function shareDescription(...candidates: Array<string | null | undefined>) {
  const text = candidates.map(plainText).find(Boolean);
  if (!text) return undefined;
  return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT - 1)}…` : text;
}

/** 只回傳可公開抓取的 http(s) 絕對網址；相對路徑以公開網址補齊，其他一律捨棄。 */
export function shareImageUrl(raw: string | null | undefined) {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const url = /^https?:\/\//i.test(value)
      ? new URL(value)
      : value.startsWith("/") && !value.startsWith("//")
        ? new URL(value, getCanonicalAppUrl())
        : null;
    return url && (url.protocol === "https:" || url.protocol === "http:") ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** 找不到、未發布或不可公開的頁面：不洩漏任何內容，也不讓搜尋引擎收錄。 */
export function unavailableShareMetadata(): Metadata {
  return { title: "頁面不存在", robots: { index: false, follow: false } };
}

export function buildShareMetadata(input: {
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  siteName?: string | null;
}): Metadata {
  const description = shareDescription(input.description);
  const image = shareImageUrl(input.imageUrl);
  return {
    title: input.title,
    ...(description ? { description } : {}),
    openGraph: {
      title: input.title,
      ...(description ? { description } : {}),
      ...(input.siteName ? { siteName: input.siteName } : {}),
      type: "website",
      ...(image ? { images: [image] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary", title: input.title, ...(description ? { description } : {}), ...(image ? { images: [image] } : {}) },
  };
}
