import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.sentry.io https://*.posthog.com https://app.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob: https://videodelivery.net https://*.videodelivery.net https:",
  "connect-src 'self' https://*.sentry.io https://*.posthog.com https://app.posthog.com https://api.cloudflare.com https://*.payuni.com.tw https://sandbox-api.payuni.com.tw",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://api.payuni.com.tw https://sandbox-api.payuni.com.tw",
  "report-uri /api/security/csp-report",
].join("; ");

// Local release-mode QA uses this explicit switch so `next build` cannot
// publish source maps or create a Sentry release as an external side effect.
// Vercel/CI builds keep the normal upload behaviour unless they opt out.
const disableSentryAutoUpload = process.env.SENTRY_DISABLE_AUTO_UPLOAD === "true";

const nextConfig: NextConfig = {
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
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: Boolean(process.env.SENTRY_AUTH_TOKEN) && !disableSentryAutoUpload,
  sourcemaps: {
    disable: disableSentryAutoUpload,
  },
  tunnelRoute: "/monitoring",
  webpack: {
    automaticVercelMonitors: true,
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
