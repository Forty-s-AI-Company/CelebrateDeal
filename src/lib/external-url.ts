/**
 * 將會交給瀏覽器導覽或載入的商家網址限制為明確的 HTTP(S) 絕對網址。
 * 不提供 base URL，刻意拒絕 `//host/path` 與相對路徑，避免呼叫端誤判來源。
 */
export function parseSafeExternalHttpUrl(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
