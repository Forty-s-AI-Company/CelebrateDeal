import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const cspReportOnlyDirectives = [
  "default-src 'self'",
  // challenges.cloudflare.com: Turnstile on /register and /verify-email (script, iframe, siteverify calls from the widget).
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.sentry.io https://*.posthog.com https://app.posthog.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob: https://videodelivery.net https://*.videodelivery.net https:",
  // www.youtube-nocookie.com: the funnel video gallery embeds a YouTube video (privacy-enhanced mode) only after the visitor presses play.
  "frame-src 'self' https://challenges.cloudflare.com https://www.youtube-nocookie.com",
  "connect-src 'self' https://*.sentry.io https://*.posthog.com https://app.posthog.com https://api.cloudflare.com https://challenges.cloudflare.com https://*.payuni.com.tw https://sandbox-api.payuni.com.tw",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://api.payuni.com.tw https://sandbox-api.payuni.com.tw",
  "report-uri /api/security/csp-report",
];
const cspReportOnly = cspReportOnlyDirectives.join("; ");

/**
 * Public funnel pages (`/lp/*`). A custom-code iframe is a `srcdoc` document,
 * which inherits this page's policy in addition to its own meta CSP, so the
 * page policy must allow what the sandboxed frame may load (https scripts,
 * styles, fonts, frames). The frame's own meta CSP still sets connect-src,
 * form-action, base-uri and object-src to 'none'. The analytics hosts are for
 * the platform-rendered GA4 / Meta Pixel snippets (IDs only, no merchant code).
 *
 * Enforcement note: this stays compatible with custom code only while
 * script-src keeps 'unsafe-inline' and https:. Moving /lp to a nonce or
 * 'strict-dynamic' policy would block the srcdoc frame's inline scripts
 * (they cannot carry the page nonce); custom code must then move to its own
 * origin (a separate sandbox domain) before that change. Admin pages keep the
 * stricter site-wide policy, so their editor preview may report (and, once
 * enforced, block) external https scripts used by merchant code.
 */
const PUBLIC_FUNNEL_EXTRA_SOURCES: Readonly<Record<string, string>> = {
  "script-src": "https:",
  "style-src": "https:",
  "font-src": "https:",
  "frame-src": "https:",
  "connect-src": "https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.facebook.com",
};
const cspReportOnlyPublicFunnel = cspReportOnlyDirectives
  .map((directive) => {
    const name = directive.split(" ")[0]!;
    return PUBLIC_FUNNEL_EXTRA_SOURCES[name] ? `${directive} ${PUBLIC_FUNNEL_EXTRA_SOURCES[name]}` : directive;
  })
  .join("; ");
/**
 * Custom code may open new tabs (allow-popups + allow-popups-to-escape-sandbox)
 * only on these pages. COOP same-origin makes every popup opened from the
 * opaque-origin iframe a no-opener popup, so it cannot navigate this page
 * (reverse tabnabbing). The development-only browser QA harness mirrors it.
 */
const publicFunnelHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnlyPublicFunnel },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// Local release-mode QA uses this explicit switch so `next build` cannot
// publish source maps or create a Sentry release as an external side effect.
// Vercel/CI builds keep the normal upload behaviour unless they opt out.
const disableSentryAutoUpload = process.env.SENTRY_DISABLE_AUTO_UPLOAD === "true";

const nextConfig: NextConfig = {
  // Browser-only component QA can run beside a developer's active Next server
  // without sharing its build lock or cache.
  ...(process.env.FUNNEL_ELEMENTS_E2E === "true" ? { distDir: ".next-funnel-elements" } : {}),
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    // 商家圖片直接由瀏覽器向來源站載入；專案所有 Image 目前也都明確
    // 使用 unoptimized。不要保留可代理任意 HTTPS 主機的 Image Optimizer。
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
        ],
      },
      // Verification links carry a bearer token in the URL; never leak it in a
      // Referer (later rules override the site-wide policy above).
      { source: "/lp/:path*", headers: publicFunnelHeaders },
      { source: "/browser-qa/:path*", headers: publicFunnelHeaders },
      { source: "/verify-email", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/api/auth/email-verification/confirm", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/verify-email-change", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/api/auth/email-change/confirm", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      {
        // Only the authenticated studio document may request capture permissions.
        source: "/lives/:id/presenter",
        headers: [{ key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=(), browsing-topics=()" }],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // 本機隔離回歸會以 SENTRY_DISABLE_AUTO_UPLOAD=true 啟動；同步關閉
  // Sentry build telemetry，避免測試本身產生任何外部請求。
  telemetry: !disableSentryAutoUpload,
  silent: !process.env.CI,
  widenClientFileUpload: Boolean(process.env.SENTRY_AUTH_TOKEN) && !disableSentryAutoUpload,
  sourcemaps: {
    disable: disableSentryAutoUpload,
  },
  // 開發模式的 Next HTTP 代理會在 Sentry 上報時累加 response listeners。
  // 本機直接使用 SDK 的原始端點；部署環境仍保留既有 tunnel。
  tunnelRoute: process.env.NODE_ENV === "development" ? undefined : "/monitoring",
  webpack: {
    automaticVercelMonitors: true,
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
