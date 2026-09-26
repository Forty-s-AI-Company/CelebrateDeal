import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classifyBrowserRequest, validateBrowserSmokeBinding, verifyStagingAliasBinding } from "./staging-browser-smoke.mjs";
import { verifyMvpPayUniLineage } from "./mvp-payuni-sandbox-e2e.mjs";

const ALIAS = "celebrate-deal-staging.carry-digital-nomad.in.net";
const OBJECT_PATH = /^\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/u;
const R2_UPLOAD_HOST = /^celebrate-deal-staging\.[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/u;
const SYNTHETIC_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");

function emptyReceipt(sourceSha) {
  return {
    schemaVersion: "celebratedeal-staging-r2-image-smoke/v1",
    sourceSha: /^[a-f0-9]{40}$/u.test(sourceSha ?? "") ? sourceSha : null,
    result: "BLOCKED", reason: "INVALID_BINDING", lineage: "NOT_VERIFIED", aliasBinding: "NOT_VERIFIED",
    stage: "NOT_STARTED", stagingBucket: "NOT_VERIFIED", publicR2Dev: "NOT_VERIFIED",
    browserErrors: 0, unsafeRequestsBlocked: 0, blockedRequestKind: "NONE",
    sideEffects: { syntheticSessionCreated: 0, syntheticSessionRevoked: 0, presignPosts: 0, r2Puts: 0, completePosts: 0, publicReads: 0 },
  };
}

/** A signed URL is usable only for one synthetic object in the dedicated staging bucket. */
export function isStagingR2UploadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && R2_UPLOAD_HOST.test(url.hostname) && OBJECT_PATH.test(url.pathname)
      && url.searchParams.has("X-Amz-Signature");
  } catch { return false; }
}

export function isSyntheticPublicR2Url(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && /^pub-[a-z0-9-]+\.r2\.dev$/u.test(url.hostname)
      && OBJECT_PATH.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}

/** Report only a fixed request category, never a URL, header, or signed query. */
export function classifyBlockedRequest(request) {
  let url;
  try { url = new URL(request.url()); } catch { return "INVALID_URL"; }
  if (url.protocol !== "https:" || url.hostname !== ALIAS) {
    return ["GET", "HEAD"].includes(request.method()) ? "EXTERNAL_READ" : "EXTERNAL_WRITE";
  }
  if (url.pathname === "/api/affiliate-attribution/direct-entry") return "ATTRIBUTION_RESET";
  if (request.headers()["next-action"]) return "NEXT_ACTION";
  return "SAME_HOST_WRITE";
}

function safeBrowserEnvironment() {
  return process.platform === "win32"
    ? { PATH: "C:\\Windows\\System32;C:\\Windows", SystemRoot: "C:\\Windows", TEMP: "C:\\Windows\\Temp", TMP: "C:\\Windows\\Temp" }
    : { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/tmp", TMPDIR: "/tmp" };
}

/** Exercises the real product-image UI with one synthetic image and no product save. */
export async function runStagingR2ImageSmoke(env = process.env, dependencies = {}) {
  const receipt = emptyReceipt(env.CELEBRATEDEAL_SOURCE_SHA);
  if (!validateBrowserSmokeBinding(env)) return receipt;
  const verifyLineage = dependencies.verifyLineage ?? verifyMvpPayUniLineage;
  const verifyAlias = dependencies.verifyAlias ?? verifyStagingAliasBinding;
  try {
    if (!await verifyLineage(env)) { receipt.reason = "LINEAGE_NOT_VERIFIED"; return receipt; }
    receipt.lineage = "VERIFIED";
    if (!await verifyAlias(env)) { receipt.reason = "ALIAS_NOT_VERIFIED"; return receipt; }
    receipt.aliasBinding = "VERIFIED";
  } catch { receipt.reason = "BINDING_CHECK_FAILED"; return receipt; }

  const origin = `https://${ALIAS}`;
  const { chromium } = dependencies.playwright ?? await import("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: true, env: safeBrowserEnvironment(), args: ["--no-proxy-server", "--disable-quic"] });
  } catch { receipt.reason = "BROWSER_LAUNCH_FAILED"; return receipt; }
  let context;
  let sessionIssued = false;
  let cleanupFailed = false;
  let uploadedObjectPath = null;
  let uploadedDigest = null;
  try {
    context = await browser.newContext({ locale: "zh-TW", viewport: { width: 1365, height: 768 }, serviceWorkers: "block" });
    await context.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (isStagingR2UploadUrl(request.url()) && method === "PUT") {
        receipt.sideEffects.r2Puts += 1;
        receipt.stagingBucket = "VERIFIED";
        uploadedObjectPath = url.pathname;
        const body = request.postDataBuffer();
        uploadedDigest = body ? createHash("sha256").update(body).digest("hex") : null;
        return route.continue();
      }
      if (R2_UPLOAD_HOST.test(url.hostname) && method === "OPTIONS" && OBJECT_PATH.test(url.pathname)) return route.continue();
      if (/^pub-[a-z0-9-]+\.r2\.dev$/u.test(url.hostname) && method === "GET") return route.continue();
      if (url.hostname === ALIAS && method === "POST" && url.pathname === "/api/media/images/presign" && !url.search) {
        receipt.sideEffects.presignPosts += 1;
        return route.continue();
      }
      if (url.hostname === ALIAS && method === "POST" && url.pathname === "/api/media/images/complete" && !url.search) {
        receipt.sideEffects.completePosts += 1;
        return route.continue();
      }
      const requestClass = classifyBrowserRequest(request);
      if (requestClass === "READ") return route.continue();
      if (requestClass === "SENTRY_TUNNEL" || requestClass === "CSP_REPORT") return route.fulfill({ status: 204 });
      if (requestClass === "ATTRIBUTION_RESET") return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      receipt.unsafeRequestsBlocked += 1;
      if (receipt.blockedRequestKind === "NONE") receipt.blockedRequestKind = classifyBlockedRequest(request);
      return route.abort();
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    if (!await verifyAlias(env)) { receipt.reason = "ALIAS_DRIFT"; return receipt; }
    receipt.stage = "SESSION_ISSUE";
    const session = await context.request.post(`${origin}/api/admin/ops/payuni/wp4-session`, {
      headers: { Authorization: `Bearer ${env.JOB_SECRET}`, "x-celebratedeal-source-sha": env.CELEBRATEDEAL_SOURCE_SHA },
      maxRedirects: 0, timeout: 15_000, failOnStatusCode: false,
    });
    const sessionStatus = session.status();
    await session.dispose();
    if (sessionStatus !== 204) { receipt.reason = "SESSION_NOT_ISSUED"; return receipt; }
    sessionIssued = true;
    receipt.sideEffects.syntheticSessionCreated += 1;

    receipt.stage = "PRODUCT_EDIT";
    const page = await context.newPage();
    page.on("pageerror", () => { receipt.browserErrors += 1; });
    const navigation = await page.goto(`${origin}/products/wp4_synthetic_product_v1/edit`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    let headingVisible = false;
    try {
      await page.getByRole("heading", { name: "編輯商品", exact: true }).waitFor({ state: "visible", timeout: 8_000 });
      headingVisible = true;
    } catch { /* A missing product editor is a blocked app journey. */ }
    if (navigation?.status() !== 200 || !headingVisible) {
      receipt.reason = "PRODUCT_EDIT_UNAVAILABLE";
      return receipt;
    }

    receipt.stage = "IMAGE_UPLOAD";
    await page.locator('input[type="file"][accept*="image/png"]').setInputFiles({ name: "staging-r2-synthetic.png", mimeType: "image/png", buffer: SYNTHETIC_PNG });
    await page.getByRole("button", { name: "開始上傳", exact: true }).click({ timeout: 10_000 });
    await page.getByText("縮圖上傳完成，儲存表單後即會套用。", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    const publicUrl = await page.locator('input[name="imageUrl"]').inputValue();
    const assetId = await page.locator('input[name="imageAssetId"]').inputValue();
    if (!assetId || !isSyntheticPublicR2Url(publicUrl) || new URL(publicUrl).pathname !== uploadedObjectPath) {
      receipt.reason = "PUBLIC_URL_INVALID";
      return receipt;
    }
    receipt.stage = "PUBLIC_READ";
    const publicResponse = await context.request.get(publicUrl, { maxRedirects: 0, timeout: 15_000, failOnStatusCode: false });
    receipt.sideEffects.publicReads += 1;
    const bytes = publicResponse.status() === 200 ? await publicResponse.body() : null;
    const contentType = publicResponse.headers()["content-type"] ?? "";
    await publicResponse.dispose();
    // The product UI converts the input PNG to JPEG before its signed PUT.
    // Compare public bytes with the actual browser-uploaded payload, never a fixture hash.
    const matches = bytes !== null && uploadedDigest !== null && contentType.startsWith("image/jpeg")
      && createHash("sha256").update(bytes).digest("hex") === uploadedDigest;
    if (matches) receipt.publicR2Dev = "VERIFIED";
    receipt.result = matches && receipt.stagingBucket === "VERIFIED" && receipt.browserErrors === 0
      && receipt.unsafeRequestsBlocked === 0 && receipt.sideEffects.presignPosts === 1
      && receipt.sideEffects.r2Puts === 1 && receipt.sideEffects.completePosts === 1 ? "PASS" : "BLOCKED";
    receipt.reason = receipt.result === "PASS" ? "NONE" : "IMAGE_JOURNEY_FAILED";
    receipt.stage = "COMPLETE";
  } catch {
    receipt.reason = "BROWSER_EXECUTION_FAILED";
  } finally {
    if (sessionIssued && context) {
      try {
        const cleanup = await context.request.delete(`${origin}/api/admin/ops/payuni/wp4-session`, {
          headers: { Authorization: `Bearer ${env.JOB_SECRET}`, "x-celebratedeal-source-sha": env.CELEBRATEDEAL_SOURCE_SHA },
          maxRedirects: 0, timeout: 15_000, failOnStatusCode: false,
        });
        if (cleanup.status() === 204) receipt.sideEffects.syntheticSessionRevoked += 1;
        else cleanupFailed = true;
        await cleanup.dispose();
      } catch { cleanupFailed = true; }
    }
    await context?.close();
    await browser.close();
    if (cleanupFailed) { receipt.result = "BLOCKED"; receipt.reason = "SESSION_CLEANUP_FAILED"; }
  }
  return receipt;
}

async function main() {
  const receipt = await runStagingR2ImageSmoke();
  if (process.env.RUNNER_TEMP) {
    await writeFile(`${process.env.RUNNER_TEMP}/celebratedeal-staging-r2-image-smoke.json`, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exitCode = receipt.result === "PASS" ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
