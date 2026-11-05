import { FUNNEL_CUSTOM_CODE_SANDBOX_HEADERS } from "@/lib/content-security-policy";
import { FUNNEL_CUSTOM_CODE_SANDBOX_DOCUMENT } from "@/lib/funnel-custom-code";

/**
 * F-156: the document merchant custom code with JavaScript runs in. It is
 * fixed (no input, no session, no database) and only waits for its parent
 * frame to post the merchant HTML. The response CSP (`sandbox` without
 * allow-same-origin, no network APIs, framing by this origin only) is also
 * set in next.config.ts, because configured headers take precedence over a
 * route handler's own.
 */
export async function GET() {
  return new Response(FUNNEL_CUSTOM_CODE_SANDBOX_DOCUMENT, {
    status: 200,
    headers: {
      ...FUNNEL_CUSTOM_CODE_SANDBOX_HEADERS,
      "Cache-Control": "public, max-age=300",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
