import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { validateBrowserSmokeBinding, verifyStagingAliasBinding } from "./staging-browser-smoke.mjs";
import { verifyMvpPayUniLineage } from "./mvp-payuni-sandbox-e2e.mjs";

const ALIAS = "celebrate-deal-staging.carry-digital-nomad.in.net";
const FUNNEL_PATH = /^\/landing-pages\/[a-z0-9]+(?:\/operations)?$/u;
const PUBLIC_PATH = /^\/lp\/staging-synthetic-[a-f0-9]{12}(?:\/[^/?#]+)?$/u;

function receipt(sourceSha) {
  return {
    schemaVersion: "celebratedeal-staging-funnel-smoke/v1",
    scope: "create_save_publish_public",
    sourceSha: /^[a-f0-9]{40}$/u.test(sourceSha ?? "") ? sourceSha : null,
    result: "BLOCKED", reason: "INVALID_BINDING", stage: "NOT_STARTED",
    lineage: "NOT_VERIFIED", aliasBinding: "NOT_VERIFIED",
    projectCreated: false, create: false, template: false, draft: false, published: false, publicDesktop: false, publicMobile: false,
    projectDestination: "NOT_OBSERVED", createPageStatus: null, createPageRoute: "NOT_OBSERVED", projectStillMissing: false,
    createActionStatus: null, createFeedbackKind: "NOT_OBSERVED", createDestination: "NOT_OBSERVED",
    pageErrors: 0, blockedWrites: 0, blockedExternal: 0,
    sideEffects: { syntheticSessionCreated: 0, syntheticSessionRevoked: 0, projectCreates: 0, funnelCreates: 0, funnelWrites: 0, paymentSubmissions: 0, refundSubmissions: 0, emailSubmissions: 0 },
  };
}

/** Keep browser navigation evidence to fixed route categories, never full URLs. */
export function funnelRouteCategory(value) {
  try {
    const path = new URL(value).pathname;
    if (path === "/landing-pages/new") return "FUNNEL_NEW";
    if (path === "/onboarding") return "ONBOARDING";
    if (/^\/projects\/[a-z0-9]+$/u.test(path)) return "PROJECT";
    if (path === "/login") return "LOGIN";
  } catch { return "INVALID_URL"; }
  return "OTHER";
}

/** Map only known product messages to fixed categories; never save raw text. */
export function funnelCreateFeedbackKind(messages) {
  if (messages.includes("草稿已建立。")) return "CREATED";
  if (messages.includes("請先選擇一個銷售專案後再管理一頁式網站。")) return "SCOPE_REQUIRED";
  if (messages.includes("頁面內容格式不正確或資料過大，請重新整理後再試。")) return "FORMAT_INVALID";
  if (messages.includes("請確認頁面內容與已選的報名表單、直播都屬於目前專案且可公開使用。")) return "BINDING_INVALID";
  if (messages.includes("暫時無法完成操作；內容仍保留，請稍後再試。")) return "SERVER_FAILURE";
  if (messages.includes("連線中斷，Funnel 尚未建立，請稍後再試。")) return "NETWORK_FAILURE";
  return messages.length === 0 ? "NONE" : "OTHER";
}

function browserEnvironment() {
  return process.platform === "win32"
    ? { PATH: "C:\\Windows\\System32;C:\\Windows", SystemRoot: "C:\\Windows", TEMP: "C:\\Windows\\Temp", TMP: "C:\\Windows\\Temp" }
    : { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/tmp", TMPDIR: "/tmp" };
}

/** Only the owner-side synthetic Funnel actions may mutate staging. */
export function classifyFunnelRequest(request, allowedFunnelPath = null) {
  let url;
  try { url = new URL(request.url()); } catch { return "EXTERNAL"; }
  if (url.protocol !== "https:" || url.hostname !== ALIAS) return "EXTERNAL";
  if (["GET", "HEAD"].includes(request.method())) return "READ";
  if (request.method() === "POST" && url.pathname === "/monitoring") return "TELEMETRY";
  if (request.method() === "POST" && url.pathname === "/api/security/csp-report") return "TELEMETRY";
  if (request.method() === "POST" && url.pathname === "/api/affiliate-attribution/direct-entry" && !request.postData()) return "ATTRIBUTION_RESET";
  if (request.method() === "POST" && url.pathname === "/projects/new") return "PROJECT_CREATE";
  if (request.method() === "POST" && request.headers()["next-action"]
    && (url.pathname === "/landing-pages/new" || (allowedFunnelPath && FUNNEL_PATH.test(url.pathname)
      && [allowedFunnelPath, `${allowedFunnelPath}/operations`].includes(url.pathname)))) return "FUNNEL_WRITE";
  return "BLOCK";
}

async function visible(locator, timeout = 10_000) {
  try { await locator.waitFor({ state: "visible", timeout }); return true; } catch { return false; }
}

export async function runStagingFunnelSmoke(env = process.env, dependencies = {}) {
  const result = receipt(env.CELEBRATEDEAL_SOURCE_SHA);
  if (!validateBrowserSmokeBinding(env)) return result;
  const verifyLineage = dependencies.verifyLineage ?? verifyMvpPayUniLineage;
  const verifyAlias = dependencies.verifyAlias ?? verifyStagingAliasBinding;
  try {
    if (!await verifyLineage(env)) { result.reason = "LINEAGE_NOT_VERIFIED"; return result; }
    result.lineage = "VERIFIED";
    if (!await verifyAlias(env)) { result.reason = "ALIAS_NOT_VERIFIED"; return result; }
    result.aliasBinding = "VERIFIED";
  } catch { result.reason = "BINDING_CHECK_FAILED"; return result; }

  const origin = `https://${ALIAS}`;
  const { chromium } = dependencies.playwright ?? await import("playwright");
  let browser;
  try { browser = await chromium.launch({ headless: true, env: browserEnvironment(), args: ["--no-proxy-server", "--disable-quic"] }); }
  catch { result.reason = "BROWSER_LAUNCH_FAILED"; return result; }
  let context;
  let publicContext;
  let sessionIssued = false;
  let cleanupFailed = false;
  let allowedFunnelPath = null;
  try {
    context = await browser.newContext({ locale: "zh-TW", viewport: { width: 1365, height: 768 }, serviceWorkers: "block" });
    await context.route("**/*", (route) => {
      const kind = classifyFunnelRequest(route.request(), allowedFunnelPath);
      if (kind === "READ") return route.continue();
      if (kind === "PROJECT_CREATE" && result.sideEffects.projectCreates === 0) {
        result.sideEffects.projectCreates += 1;
        return route.continue();
      }
      if (kind === "FUNNEL_WRITE" && !(new URL(route.request().url()).pathname === "/landing-pages/new" && result.sideEffects.funnelCreates > 0)) {
        result.sideEffects.funnelWrites += 1;
        if (new URL(route.request().url()).pathname === "/landing-pages/new") result.sideEffects.funnelCreates += 1;
        return route.continue();
      }
      if (kind === "TELEMETRY") return route.fulfill({ status: 204 });
      if (kind === "ATTRIBUTION_RESET") return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      if (kind === "EXTERNAL") result.blockedExternal += 1;
      else result.blockedWrites += 1;
      return route.abort();
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    if (!await verifyAlias(env)) { result.reason = "ALIAS_DRIFT"; return result; }
    result.stage = "SESSION";
    const session = await context.request.post(`${origin}/api/admin/ops/payuni/wp4-session`, {
      headers: { Authorization: `Bearer ${env.JOB_SECRET}`, "x-celebratedeal-source-sha": env.CELEBRATEDEAL_SOURCE_SHA },
      maxRedirects: 0, timeout: 15_000, failOnStatusCode: false,
    });
    const issued = session.status() === 204;
    await session.dispose();
    if (!issued) { result.reason = "SESSION_NOT_ISSUED"; return result; }
    sessionIssued = true;
    result.sideEffects.syntheticSessionCreated = 1;

    const page = await context.newPage();
    page.on("pageerror", () => { result.pageErrors += 1; });
    page.on("response", (response) => {
      const request = response.request();
      if (request.method() !== "POST" || !request.headers()["next-action"]) return;
      try {
        const url = new URL(request.url());
        if (url.hostname === ALIAS && url.pathname === "/landing-pages/new") result.createActionStatus = response.status();
      } catch { /* The action status stays unknown. */ }
    });
    const slug = `staging-synthetic-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    result.stage = "CREATE";
    let createResponse = await page.goto(`${origin}/landing-pages/new`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (await visible(page.getByText("請先選擇一個銷售專案，再建立一頁式網站。", { exact: true }), 2_000)) {
      result.stage = "PROJECT_CREATE";
      const projectResponse = await page.goto(`${origin}/projects/new`, { waitUntil: "domcontentloaded", timeout: 20_000 });
      if (projectResponse?.status() !== 200 || !await visible(page.getByRole("heading", { name: "建立銷售專案" }))) {
        result.reason = "PROJECT_CREATE_UNAVAILABLE"; return result;
      }
      await page.getByLabel("專案名稱", { exact: true }).fill("Staging Synthetic Project");
      await page.getByLabel("網址代稱", { exact: true }).fill(`${slug}-project`);
      await page.getByRole("button", { name: "建立專案", exact: true }).click({ timeout: 10_000 });
      try { await page.waitForURL((url) => url.pathname === "/onboarding" || /^\/projects\/[a-z0-9]+$/u.test(url.pathname), { timeout: 20_000 }); }
      catch { result.reason = "PROJECT_CREATE_FAILED"; return result; }
      result.projectCreated = true;
      result.projectDestination = funnelRouteCategory(page.url());
      result.stage = "CREATE";
      createResponse = await page.goto(`${origin}/landing-pages/new`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    }
    result.createPageStatus = createResponse?.status() ?? null;
    result.createPageRoute = funnelRouteCategory(page.url());
    const createHeadingVisible = await visible(page.getByRole("heading", { name: "建立新的 Funnel" }));
    result.projectStillMissing = await visible(page.getByText("請先選擇一個銷售專案，再建立一頁式網站。", { exact: true }), 1_000);
    if (result.createPageStatus !== 200 || !createHeadingVisible) { result.reason = "CREATE_PAGE_UNAVAILABLE"; return result; }
    await page.getByRole("textbox", { name: "名稱 *", exact: true }).fill("Staging Synthetic Funnel");
    await page.getByRole("textbox", { name: /^Funnel 網址 \*/u }).fill(slug);
    await page.getByRole("button", { name: /建立名單/u }).click();
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    try { await page.waitForURL((url) => FUNNEL_PATH.test(url.pathname) && url.pathname.endsWith("/operations"), { timeout: 20_000 }); }
    catch {
      result.createDestination = funnelRouteCategory(page.url());
      result.createFeedbackKind = funnelCreateFeedbackKind(await page.getByRole("status").allTextContents());
      result.reason = "CREATE_FAILED";
      return result;
    }
    const funnelPath = new URL(page.url()).pathname.replace(/\/operations$/u, "");
    allowedFunnelPath = funnelPath;
    result.create = true;

    result.stage = "TEMPLATE";
    await page.getByRole("button", { name: "套用模板", exact: true }).first().click({ timeout: 10_000 });
    if (!await visible(page.getByRole("status").filter({ hasText: "模板已套用" }))) { result.reason = "TEMPLATE_FAILED"; return result; }
    result.template = true;
    await page.getByRole("button", { name: "Edit Page", exact: true }).click({ timeout: 10_000 });
    try { await page.waitForURL((url) => url.pathname === funnelPath, { timeout: 15_000 }); }
    catch { result.reason = "EDITOR_UNAVAILABLE"; return result; }

    result.stage = "SAVE";
    await page.getByRole("button", { name: "儲存草稿", exact: true }).click({ timeout: 10_000 });
    if (!await visible(page.getByRole("status").filter({ hasText: "草稿已儲存" }))
      || !await visible(page.getByRole("button", { name: "發布已儲存草稿", exact: true }))) { result.reason = "SAVE_FAILED"; return result; }
    result.draft = true;
    result.stage = "PUBLISH";
    await page.getByRole("button", { name: "發布已儲存草稿", exact: true }).click({ timeout: 10_000 });
    if (!await visible(page.getByRole("link", { name: /查看公開頁/u }))) { result.reason = "PUBLISH_FAILED"; return result; }
    result.published = true;

    // A separate cookie-free context proves the published page works for buyers.
    publicContext = await browser.newContext({ locale: "zh-TW", viewport: { width: 1365, height: 768 }, serviceWorkers: "block" });
    await publicContext.route("**/*", (route) => {
      const kind = classifyFunnelRequest(route.request());
      if (kind === "READ") return route.continue();
      if (kind === "TELEMETRY") return route.fulfill({ status: 204 });
      if (kind === "ATTRIBUTION_RESET") return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      if (kind === "EXTERNAL") result.blockedExternal += 1;
      else result.blockedWrites += 1;
      return route.abort();
    });
    await publicContext.routeWebSocket("**/*", (socket) => socket.close());
    const publicPage = await publicContext.newPage();
    publicPage.on("pageerror", () => { result.pageErrors += 1; });
    result.stage = "PUBLIC_DESKTOP";
    const publicResponse = await publicPage.goto(`${origin}/lp/${slug}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    result.publicDesktop = publicResponse?.status() === 200 && PUBLIC_PATH.test(new URL(publicPage.url()).pathname)
      && await visible(publicPage.locator("[data-funnel-renderer]"));
    if (!result.publicDesktop) { result.reason = "PUBLIC_DESKTOP_FAILED"; return result; }
    result.stage = "PUBLIC_MOBILE";
    await publicPage.setViewportSize({ width: 390, height: 844 });
    await publicPage.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    result.publicMobile = PUBLIC_PATH.test(new URL(publicPage.url()).pathname)
      && await visible(publicPage.locator("[data-funnel-renderer]"))
      && await publicPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1);
    result.stage = "COMPLETE";
    result.result = result.publicMobile && result.pageErrors === 0 && result.blockedWrites === 0
      && result.sideEffects.funnelCreates === 1 && result.sideEffects.funnelWrites >= 3 ? "PASS" : "BLOCKED";
    result.reason = result.result === "PASS" ? "NONE" : "FUNNEL_JOURNEY_FAILED";
  } catch { result.reason = "BROWSER_EXECUTION_FAILED"; }
  finally {
    if (sessionIssued && context) {
      try {
        const cleanup = await context.request.delete(`${origin}/api/admin/ops/payuni/wp4-session`, {
          headers: { Authorization: `Bearer ${env.JOB_SECRET}`, "x-celebratedeal-source-sha": env.CELEBRATEDEAL_SOURCE_SHA },
          maxRedirects: 0, timeout: 15_000, failOnStatusCode: false,
        });
        if (cleanup.status() === 204) result.sideEffects.syntheticSessionRevoked = 1;
        else cleanupFailed = true;
        await cleanup.dispose();
      } catch { cleanupFailed = true; }
    }
    await publicContext?.close();
    await context?.close();
    await browser.close();
    if (cleanupFailed) { result.result = "BLOCKED"; result.reason = "SESSION_CLEANUP_FAILED"; }
  }
  return result;
}

async function main() {
  const result = await runStagingFunnelSmoke();
  if (process.env.RUNNER_TEMP) await writeFile(`${process.env.RUNNER_TEMP}/celebratedeal-staging-funnel-smoke.json`, `${JSON.stringify(result)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.result === "PASS" ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
