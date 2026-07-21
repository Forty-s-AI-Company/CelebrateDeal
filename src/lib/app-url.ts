const DEVELOPMENT_APP_URL = "http://localhost:31023";

/**
 * 取得伺服器產生郵件連結與付款回呼時唯一可信任的公開網址。
 * 正式環境刻意不接受 request Host fallback，避免 Host header 影響密碼
 * 重設連結或金流回呼位置。
 */
export function getCanonicalAppUrl(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) {
    if (env.NODE_ENV === "production") {
      throw new Error("NEXT_PUBLIC_APP_URL is required in production.");
    }
    return DEVELOPMENT_APP_URL;
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("NEXT_PUBLIC_APP_URL must be a valid absolute URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("NEXT_PUBLIC_APP_URL must not contain credentials.");
  }
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS in production.");
  }

  return url.origin;
}
