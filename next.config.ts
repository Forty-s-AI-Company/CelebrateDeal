import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { FUNNEL_CUSTOM_CODE_SANDBOX_HEADERS, FUNNEL_CUSTOM_CODE_SANDBOX_PATH } from "./src/lib/content-security-policy";

/*
 * F-156: the Content Security Policy is not set here. It carries a fresh
 * script nonce per request, so `src/proxy.ts` builds it for every HTML
 * document (Report-Only, plus an enforced copy when CSP_ENFORCE=true) from
 * `src/lib/content-security-policy.ts`, where every source names its feature.
 */

/**
 * Custom code may open new tabs (allow-popups + allow-popups-to-escape-sandbox)
 * only on these pages. COOP same-origin makes every popup opened from the
 * opaque-origin iframe a no-opener popup, so it cannot navigate this page
 * (reverse tabnabbing). The development-only browser QA harness mirrors it.
 */
const publicFunnelHeaders = [
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
  typescript: {
    // The build's type check (`next build` runs the project tsc with the
    // default Node heap) covers the application only: tsconfig.build.json
    // extends tsconfig.json and leaves out test files and test runners, which
    // `npm run typecheck` still checks in full. Checking everything needs
    // 4.2-4.4 GB and ran out of the default heap; see
    // docs/operations/build-typecheck-memory.md. Never use ignoreBuildErrors.
    tsconfigPath: "tsconfig.build.json",
  },
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
        ],
      },
      // The custom-code sandbox document must be frameable by this origin and
      // carries its own CSP (sandbox, no network APIs). Configured headers win
      // over the route handler's, so they are set here (later rule wins).
      {
        source: FUNNEL_CUSTOM_CODE_SANDBOX_PATH,
        headers: Object.entries(FUNNEL_CUSTOM_CODE_SANDBOX_HEADERS).map(([key, value]) => ({ key, value })),
      },
      // Verification links carry a bearer token in the URL; never leak it in a
      // Referer (later rules override the site-wide policy above).
      { source: "/lp/:path*", headers: publicFunnelHeaders },
      { source: "/browser-qa/:path*", headers: publicFunnelHeaders },
      { source: "/verify-email", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/api/auth/email-verification/confirm", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/verify-email-change", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/api/auth/email-change/confirm", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/revert-email-change", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/api/auth/email-change/revert", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      // Same-origin, not no-referrer: the page's confirm POST must carry a real
      // Origin (no-referrer makes it "null", which the switch API refuses). The
      // page loads nothing from other sites, so the token still never leaves.
      { source: "/live-session-switch", headers: [{ key: "Referrer-Policy", value: "same-origin" }] },
      { source: "/api/live-session-switch", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
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
