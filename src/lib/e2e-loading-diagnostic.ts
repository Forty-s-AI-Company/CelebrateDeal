import { headers } from "next/headers";

const MIN_DELAY_MS = 1;
const MAX_DELAY_MS = 10_000;

function isLoopbackHost(value: string | null) {
  if (!value) return false;

  try {
    const hostname = new URL(`http://${value}`).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

/**
 * Adds a bounded, loopback-only delay for browser loading evidence.
 * Production requests and ordinary local requests return without waiting.
 */
export async function applyE2eLoadingDelay() {
  if (process.env.E2E_TEST_MODE !== "true") return;

  // This helper only adds local browser-evidence delay. Direct Server Component
  // unit renders do not have a Next request scope, so the diagnostic must
  // quietly opt out instead of affecting the page's functional render.
  let requestHeaders: Awaited<ReturnType<typeof headers>>;
  try {
    requestHeaders = await headers();
  } catch {
    return;
  }

  if (!isLoopbackHost(requestHeaders.get("host"))) return;

  const parsed = Number.parseInt(requestHeaders.get("x-e2e-loading-delay-ms") ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_DELAY_MS || parsed > MAX_DELAY_MS) return;

  await new Promise<void>((resolve) => {
    setTimeout(resolve, parsed);
  });
}
