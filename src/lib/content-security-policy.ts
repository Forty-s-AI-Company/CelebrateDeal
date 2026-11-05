/**
 * F-156: Content Security Policy for every HTML document.
 *
 * The policy is built per request in `src/proxy.ts` because script-src carries
 * a fresh nonce (Next.js reads it from the request CSP header and stamps it on
 * its own scripts). Every source below names the feature that needs it; the
 * same table is in `docs/launch/csp-rollout.md`. Remove a source together
 * with its feature.
 *
 * This module has no `@/` imports: `next.config.ts` imports it directly.
 */

/** Request header the proxy uses to hand the nonce to Server Components. */
export const CSP_NONCE_HEADER = "x-nonce";
export const CSP_REPORT_PATH = "/api/security/csp-report";
/** `Reporting-Endpoints` group name used by `report-to`. */
export const CSP_REPORT_GROUP = "csp-endpoint";

/**
 * Merchant custom code with JavaScript runs in this same-origin document,
 * framed with `sandbox` (opaque origin). It has its own response CSP, so the
 * site-wide script-src never needs 'unsafe-inline'.
 */
export const FUNNEL_CUSTOM_CODE_SANDBOX_PATH = "/sandbox/custom-code";

/**
 * `app`: every page except the public funnel. `public-funnel`: `/lp/*` and
 * the development-only `/browser-qa/*` harness, which also load the
 * platform-generated GA4 / Meta Pixel tags and the static custom-code frames.
 */
export type CspSurface = "app" | "public-funnel";

type Directives = Record<string, string[]>;

const TURNSTILE = "https://challenges.cloudflare.com";
const STREAM_HOSTS = ["https://videodelivery.net", "https://*.videodelivery.net", "https://*.cloudflarestream.com"];
const PAYUNI_UPP_HOSTS = ["https://api.payuni.com.tw", "https://sandbox-api.payuni.com.tw"];

function baseDirectives(nonce: string, development: boolean): Directives {
  return {
    "default-src": ["'self'"],
    // Next.js framework and page chunks carry the nonce; 'strict-dynamic' lets
    // them load further chunks and lets Turnstile's api.js load its own code.
    // 'self' and the Turnstile host are the fallback for CSP2-only browsers.
    // 'unsafe-eval' is development only (React rebuilds server stacks with eval).
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", TURNSTILE, ...(development ? ["'unsafe-eval'"] : [])],
    // Kept: React `style` attributes are used throughout the UI, third-party
    // widgets (Turnstile) may inject <style>, static custom-code frames contain
    // <style>, and funnel page custom CSS
    // is an inline <style>. A nonce here would disable 'unsafe-inline'.
    "style-src": ["'self'", "'unsafe-inline'"],
    // Merchant images (R2 public URLs, external https images), data: and blob:
    // previews before upload, DiceBear interaction avatars.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    // Self-hosted fonts under /fonts and the Next.js font output; https: for
    // merchant page CSS and static custom-code frames, which the editor
    // preview renders on admin pages as well.
    "font-src": ["'self'", "data:", "https:"],
    // Cloudflare Stream playback (hls.js uses blob: MediaSource URLs) and
    // merchant-provided https video files. The Stream hosts are redundant
    // with https: today and listed on purpose: they document the feature and
    // keep Stream working if https: is ever narrowed.
    "media-src": ["'self'", "blob:", ...STREAM_HOSTS, "https:"],
    // Turnstile challenge, YouTube (privacy-enhanced) and Vimeo players, and
    // the same-origin custom-code sandbox document.
    "frame-src": ["'self'", TURNSTILE, "https://www.youtube-nocookie.com", "https://player.vimeo.com"],
    // Turnstile, Stream manifests/segments and tus/direct uploads, R2
    // presigned image uploads. Sentry goes through the same-origin /monitoring
    // tunnel except in development, where the SDK posts to the ingest host.
    "connect-src": ["'self'", TURNSTILE, ...STREAM_HOSTS, "https://*.r2.cloudflarestorage.com", ...(development ? ["https://*.sentry.io"] : [])],
    // Presenter background segmentation worker (/presenter-segmentation) and
    // hls.js's transmux worker (blob:). Without this, 'strict-dynamic' would
    // block them through the script-src fallback.
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    // PayUni UPP checkout and card-binding forms post to these hosts.
    "form-action": ["'self'", ...PAYUNI_UPP_HOSTS],
    "report-uri": [CSP_REPORT_PATH],
    "report-to": [CSP_REPORT_GROUP],
  };
}

/** Extra sources for public funnel pages only. */
const PUBLIC_FUNNEL_EXTRA: Directives = {
  // GA4 gtag.js and the Meta Pixel loader (CSP2 fallback; 'strict-dynamic'
  // already trusts what the nonced init scripts insert).
  "script-src": ["https://www.googletagmanager.com", "https://connect.facebook.net"],
  // Static custom-code frames (srcdoc, no scripts) inherit this page policy;
  // merchant CSS may load https stylesheets.
  "style-src": ["https:"],
  "connect-src": [
    "https://www.google-analytics.com",
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://www.googletagmanager.com",
    "https://www.facebook.com",
  ],
};

export type BuildCspOptions = {
  nonce: string;
  surface: CspSurface;
  development?: boolean;
};

function serialize(directives: Directives): string {
  return Object.entries(directives).map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

export function buildContentSecurityPolicy({ nonce, surface, development = false }: BuildCspOptions): string {
  if (!isValidCspNonce(nonce)) throw new Error("Invalid CSP nonce");
  const directives = baseDirectives(nonce, development);
  if (surface === "public-funnel") {
    for (const [name, sources] of Object.entries(PUBLIC_FUNNEL_EXTRA)) directives[name] = [...directives[name]!, ...sources];
  }
  return serialize(directives);
}

/**
 * Report-Only preview of the next tightening, sent only beside an enforced
 * policy on app pages: <style> elements need the nonce, style attributes stay
 * allowed. It has no other directive, so it reports nothing the enforced
 * policy already covers. Public funnel pages get no preview: merchant page
 * CSS, static custom-code frames and visitor traffic would only add noise.
 * Expected reports are listed in docs/launch/csp-rollout.md.
 */
export function buildStylePreviewPolicy(nonce: string): string {
  if (!isValidCspNonce(nonce)) throw new Error("Invalid CSP nonce");
  return serialize({
    "style-src-elem": ["'self'", `'nonce-${nonce}'`],
    "style-src-attr": ["'unsafe-inline'"],
    "report-uri": [CSP_REPORT_PATH],
    "report-to": [CSP_REPORT_GROUP],
  });
}

/** 128 random bits, base64 (the character set Next.js accepts for nonces). */
export function createCspNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function isValidCspNonce(value: string): boolean {
  return /^[A-Za-z0-9+/]{22}==$/u.test(value);
}

/**
 * `CSP_ENFORCE`: unset, empty or `false` = Report-Only only; `true` = enforce
 * as well. Anything else is a configuration error that preflight fails; the
 * runtime then stays on Report-Only.
 */
export function parseCspEnforce(value: string | undefined): { valid: boolean; enforce: boolean } {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "true") return { valid: true, enforce: true };
  if (normalized === "" || normalized === "false") return { valid: true, enforce: false };
  return { valid: false, enforce: false };
}

export function cspSurfaceForPath(pathname: string): CspSurface {
  return pathname.startsWith("/lp/") || pathname.startsWith("/browser-qa/") ? "public-funnel" : "app";
}

export type CspHeaderSet = {
  /** Response headers for the document. */
  response: Record<string, string>;
  /** The policy Next.js reads the nonce from (set on the request). */
  requestPolicy: string;
};

export function contentSecurityPolicyHeaders({ nonce, surface, development = false, enforce }: { nonce: string; surface: CspSurface; development?: boolean; enforce: boolean }): CspHeaderSet {
  const policy = buildContentSecurityPolicy({ nonce, surface, development });
  const response: Record<string, string> = { "Reporting-Endpoints": `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"` };
  if (enforce) {
    response["Content-Security-Policy"] = policy;
    if (surface === "app") response["Content-Security-Policy-Report-Only"] = buildStylePreviewPolicy(nonce);
  } else {
    response["Content-Security-Policy-Report-Only"] = policy;
  }
  return { response, requestPolicy: policy };
}

/**
 * Response CSP of the custom-code sandbox document. The `sandbox` directive
 * keeps it opaque-origin even when opened top-level; the iframe's sandbox
 * attribute can only narrow it further. Merchant HTML/CSS/JS may load https
 * scripts, styles, images, fonts, media and frames, but may not call any
 * network API, submit forms or change the base URL.
 */
export const FUNNEL_CUSTOM_CODE_SANDBOX_CSP = [
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
  "default-src 'none'",
  "script-src 'unsafe-inline' https:",
  "style-src 'unsafe-inline' https:",
  "img-src https: data:",
  "font-src https:",
  "media-src https:",
  "frame-src https:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "frame-ancestors 'self'",
].join("; ");

/** Headers of the sandbox document (also applied in next.config.ts so they win over defaults). */
export const FUNNEL_CUSTOM_CODE_SANDBOX_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": FUNNEL_CUSTOM_CODE_SANDBOX_CSP,
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "no-referrer",
});
