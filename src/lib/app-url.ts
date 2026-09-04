const DEVELOPMENT_APP_URL = "http://localhost:31023";
const VERCEL_PREVIEW_DEPLOYMENT_HOST = /^(?=.{1,63}\.vercel\.app$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/u;

function isExplicitLocalE2eUrl(url: URL, env: NodeJS.ProcessEnv) {
  return (
    env.E2E_TEST_MODE === "true"
    && env.E2E_BASE_URL === url.origin
    && url.protocol === "http:"
    && ["127.0.0.1", "localhost"].includes(url.hostname)
  );
}

/**
 * Production-mode Browser evidence runs use a built server on loopback. Keep
 * that exception narrow and reusable so local-only adapters cannot be enabled
 * by a single environment flag or an untrusted request Host.
 */
export function isExplicitLocalE2eRuntime(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return false;
  try {
    return isExplicitLocalE2eUrl(new URL(configured), env);
  } catch {
    return false;
  }
}

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
  if (env.NODE_ENV === "production" && url.protocol !== "https:" && !isExplicitLocalE2eUrl(url, env)) {
    throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS in production.");
  }

  return url.origin;
}

function verifiedPreviewOrigin(env: NodeJS.ProcessEnv) {
  // VERCEL_URL is a server-owned binding, but accept only the documented bare
  // deployment hostname. This rejects credentials, paths, queries, ports and
  // lookalike multi-label hosts before they can influence a payment return.
  const deploymentHost = env.VERCEL_URL;
  if (typeof deploymentHost !== "string" || !VERCEL_PREVIEW_DEPLOYMENT_HOST.test(deploymentHost)) {
    return null;
  }
  return `https://${deploymentHost}`;
}

/**
 * Retain browser-return state on the origin that issued checkout only for an
 * exact, server-verified Vercel Preview running against PayUni Sandbox.
 * Every other deployment and provider mode remains pinned to the canonical
 * public URL so request URLs and Host headers cannot select a redirect target.
 */
export function getPaymentReturnAppUrl(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const canonical = getCanonicalAppUrl(env);
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return canonical;
  }
  if (requestOrigin === canonical) return canonical;
  if (env.VERCEL_ENV !== "preview" || env.PAYUNI_ENV !== "sandbox") return canonical;

  const previewOrigin = verifiedPreviewOrigin(env);
  return requestOrigin === previewOrigin ? previewOrigin : canonical;
}
