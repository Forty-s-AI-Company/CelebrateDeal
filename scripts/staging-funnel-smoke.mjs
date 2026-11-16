import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classifyBrowserExecutionFailure, validateBrowserSmokeBinding, verifyStagingAliasBinding } from "./staging-browser-smoke.mjs";
import { verifyMvpPayUniLineage } from "./mvp-payuni-sandbox-e2e.mjs";

// /landing-pages/new without a selected sales project (SalesProjectRequiredNotice).
const PROJECT_REQUIRED_HEADING = "一頁式網站屬於銷售專案，請先選擇專案";
// Goal picker labels (src/components/landing-pages/funnel-goal-picker.tsx). The slug label also
// wraps the "/lp/" prefix, so both labels are substring matches like the CI e2e journey.
export const CREATE_NAME_LABEL = "名稱 *";
export const CREATE_SLUG_LABEL = "一頁式網站網址 *";
export const CREATE_SUBMIT_LABEL = "建立";
const FUNNEL_STEPS = new Set([
  "CONTEXT_SETUP", "PAGE_OPEN", "CREATE_PAGE_OPEN", "PROJECT_PAGE_OPEN", "PROJECT_NAME_FILL", "PROJECT_SLUG_FILL",
  "PROJECT_SUBMIT", "CREATE_NAME_FILL", "CREATE_SLUG_FILL", "CREATE_GOAL_SELECT", "CREATE_SUBMIT", "CREATE_DESTINATION",
  "TEMPLATE_APPLY", "EDITOR_OPEN", "EDITOR_ADD_SECTION", "EDITOR_SAVE", "EDITOR_LEAVE", "STALE_CLEANUP", "PUBLISH_PREFLIGHT",
  "PUBLISH_BUTTON_ENABLED", "PUBLISH", "PUBLISH_RESULT", "PUBLIC_OPEN", "PUBLIC_MOBILE_RELOAD",
]);
// Management-page publication chip (src/components/landing-page-publication-chip.tsx) and the
// header publish button (src/components/landing-pages/funnel-operations-panel.tsx).
export const PUBLICATION_CHIP_DRAFT_LABEL = "發布狀態：草稿";
export const PUBLICATION_REGION_LABEL = "公開網址狀態";
export const PUBLISH_BUTTON_LABEL = "發布";
export const PUBLISHED_CHIP_PATTERN = /^發布狀態：(已發布|公開網址無法開啟)/u;
/**
 * Fixed fragments of the server's publication diagnosis (src/lib/independent-publish-limit.ts and
 * audienceFunnelPreflightStatus in src/lib/landing-page-service.ts). Only the matching category is
 * kept; the page text itself is never stored. Order matters: the server checks e-mail first.
 */
export const PUBLISH_DIAGNOSIS_FRAGMENTS = Object.freeze([
  Object.freeze(["PLATFORM_DISABLED", "平台目前暫停「不需發布專案就公開」的名單型網站新發布"]),
  Object.freeze(["EMAIL_UNVERIFIED", "這個商家的註冊 Email 還沒有完成驗證"]),
  Object.freeze(["LIMIT_REACHED", "免費帳號最多可同時有"]),
  Object.freeze(["LIVE_REQUIRES_PROJECT", "直播要等所屬專案發布後才能公開"]),
  Object.freeze(["REVISION_CONFLICT", "這個頁面已有較新的版本"]),
  Object.freeze(["READY", "名單型網站發布後即可開啟"]),
]);
// Data preconditions the runner cannot fix; each maps to its own receipt reason.
const PUBLISH_BLOCKED_REASONS = Object.freeze({
  PLATFORM_DISABLED: "PUBLISH_DISABLED_BY_PLATFORM",
  EMAIL_UNVERIFIED: "PUBLISH_BLOCKED_EMAIL_UNVERIFIED",
  LIMIT_REACHED: "PUBLISH_LIMIT_REACHED",
  LIVE_REQUIRES_PROJECT: "PUBLISH_BLOCKED_LIVE_REQUIRES_PROJECT",
});

const ALIAS = "celebrate-deal-staging.carry-digital-nomad.in.net";
const FUNNEL_PATH = /^\/landing-pages\/[a-z0-9]+(?:\/operations|\/edit)?$/u;
const PUBLIC_PATH = /^\/lp\/staging-synthetic-[a-f0-9]{12}(?:\/[^/?#]+)?$/u;

function receipt(sourceSha) {
  return {
    schemaVersion: "celebratedeal-staging-funnel-smoke/v2",
    scope: "create_save_publish_public",
    sourceSha: /^[a-f0-9]{40}$/u.test(sourceSha ?? "") ? sourceSha : null,
    result: "BLOCKED", reason: "INVALID_BINDING", stage: "NOT_STARTED",
    lineage: "NOT_VERIFIED", aliasBinding: "NOT_VERIFIED",
    projectCreated: false, create: false, template: false, draft: false, published: false, publicDesktop: false, publicMobile: false,
    projectDestination: "NOT_OBSERVED", createPageStatus: null, createPageRoute: "NOT_OBSERVED", projectStillMissing: false,
    createActionStatus: null, createFeedbackKind: "NOT_OBSERVED", createDestination: "NOT_OBSERVED",
    operationsGetRequests: 0, operationsGetResponses: 0, operationsGetFinished: 0, operationsGetFailures: 0, operationsGetLastStatus: null,
    editorGetRequests: 0, editorGetResponses: 0, editorGetFinished: 0, editorGetFailures: 0, editorGetLastStatus: null,
    editorDialogs: 0, editorNavigation: "NOT_OBSERVED",
    // How the page's same-route GETs ended: document load, RSC navigation fetch or router prefetch,
    // and whether a failure was an abort (navigation superseded or page left) or something else.
    operationsGetKinds: { document: 0, rsc: 0, prefetch: 0, other: 0 }, operationsGetFailureKinds: { aborted: 0, other: 0 },
    editorGetKinds: { document: 0, rsc: 0, prefetch: 0, other: 0 }, editorGetFailureKinds: { aborted: 0, other: 0 },
    staleCleanup: "NOT_RUN", staleFound: 0,
    publishPreflight: "NOT_OBSERVED", publishOutcome: "NOT_OBSERVED", publishActionStatus: null,
    publicStatus: null, publicRouteMatched: false, publicRendererVisible: false,
    publicSurface: "NOT_OBSERVED",
    syntheticProjectStatus: "NOT_OBSERVED",
    pageErrors: 0, blockedWrites: 0, blockedExternal: 0,
    // Which fixed step stopped the run, why (an exception class, CONDITION_NOT_MET or DATA_PRECONDITION)
    // and on which route class. Exceptions set it everywhere; the publish stage also sets it without one.
    failureStep: "NONE", failureCategory: "NONE", failurePage: "NOT_OBSERVED",
    sideEffects: { syntheticSessionCreated: 0, syntheticSessionRevoked: 0, projectCreates: 0, funnelCreates: 0, funnelWrites: 0, staleUnpublishes: 0, paymentSubmissions: 0, refundSubmissions: 0, emailSubmissions: 0 },
  };
}

/** Keep browser navigation evidence to fixed route categories, never full URLs. */
export function funnelRouteCategory(value) {
  try {
    const path = new URL(value).pathname;
    if (path === "/landing-pages/new") return "FUNNEL_NEW";
    if (path === "/onboarding") return "ONBOARDING";
    if (path === "/projects/new") return "PROJECT_NEW";
    if (/^\/projects\/[a-z0-9]+$/u.test(path)) return "PROJECT";
    if (path === "/login") return "LOGIN";
    if (/^\/landing-pages\/[a-z0-9]+\/operations$/u.test(path)) return "FUNNEL_OPERATIONS";
    if (/^\/landing-pages\/[a-z0-9]+\/edit$/u.test(path)) return "FUNNEL_EDITOR";
    if (/^\/lp\//u.test(path)) return "PUBLIC_FUNNEL";
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
  if (messages.includes("建立失敗，一頁式網站尚未建立，請稍後再試。")
    || messages.includes("連線中斷，Funnel 尚未建立，請稍後再試。")) return "NETWORK_FAILURE";
  return messages.length === 0 ? "NONE" : "OTHER";
}

/** A fixed category distinguishes a blocked click from a slow editor response. */
export function funnelEditorNavigationKind({ dialogs, requests, responses, finished, failures }) {
  if (dialogs > 0) return "CONFIRMATION_DISMISSED";
  if (requests === 0) return "NO_REQUEST";
  if (responses === 0) return failures > 0 ? "REQUEST_FAILED" : "NO_RESPONSE";
  if (finished === 0) return failures > 0 ? "RESPONSE_ABORTED" : "RESPONSE_UNFINISHED";
  return "RESPONSE_FINISHED_NO_ROUTE";
}

/** Reduce the publication diagnosis or action feedback to a fixed category; never keep the text. */
export function classifyPublishDiagnosis(texts) {
  const joined = (Array.isArray(texts) ? texts : [texts]).filter((text) => typeof text === "string").join("\n");
  if (joined.trim() === "") return "NONE";
  for (const [category, fragment] of PUBLISH_DIAGNOSIS_FRAGMENTS) if (joined.includes(fragment)) return category;
  return "OTHER";
}

export function publishBlockedReason(category) {
  return Object.hasOwn(PUBLISH_BLOCKED_REASONS, category) ? PUBLISH_BLOCKED_REASONS[category] : null;
}

/** Same-route GET class from request metadata only (resource type and Next router headers). */
export function classifyRouteGetKind(request) {
  try {
    if (request.resourceType() === "document") return "document";
    const headers = request.headers();
    if (headers["next-router-prefetch"]) return "prefetch";
    if (headers.rsc) return "rsc";
  } catch { /* Unknown requests stay "other". */ }
  return "other";
}

export function classifyRequestFailureKind(request) {
  try { return /net::ERR_ABORTED|NS_BINDING_ABORTED/u.test(request.failure()?.errorText ?? "") ? "aborted" : "other"; }
  catch { return "other"; }
}

async function waitEnabled(locator, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await locator.isEnabled({ timeout: 1_000 })) return true; } catch { /* Not rendered yet. */ }
    await new Promise((resolve) => { setTimeout(resolve, 250); });
  }
  return false;
}

/**
 * Read-only check of the draft's publication diagnosis before pressing 發布: open the status chip,
 * classify its fixed message, close it. Returns a category from PUBLISH_DIAGNOSIS_FRAGMENTS,
 * "NONE", "OTHER" or "NOT_OBSERVED" (chip or popover missing).
 */
export async function inspectPublishPreflight(page) {
  try {
    const chip = page.getByRole("button", { name: PUBLICATION_CHIP_DRAFT_LABEL, exact: true });
    if (!await visible(chip, 10_000)) return "NOT_OBSERVED";
    await chip.click({ timeout: 5_000 });
    const region = page.getByRole("region", { name: PUBLICATION_REGION_LABEL, exact: true });
    if (!await visible(region, 5_000)) return "NOT_OBSERVED";
    const category = classifyPublishDiagnosis(await region.innerText({ timeout: 5_000 }));
    await chip.click({ timeout: 5_000 }).catch(() => {});
    return category;
  } catch { return "NOT_OBSERVED"; }
}

/**
 * Publish stage on the management page. Every stop sets reason, failureStep, failureCategory and
 * failurePage; data preconditions (unverified owner e-mail, free-plan limit, platform switch) stop
 * before the click with their own reason. Returns true only when the published chip appears.
 */
export async function runPublishStage(page, result, { funnelPath, onPublishClick = () => {}, enabledTimeout = 15_000 } = {}) {
  const stop = (reason, step, category) => {
    result.reason = reason;
    result.failureStep = step;
    result.failureCategory = category;
    try { result.failurePage = funnelRouteCategory(page.url()); } catch { result.failurePage = "INVALID_URL"; }
    return false;
  };
  try { await page.waitForURL((url) => url.pathname === `${funnelPath}/operations`, { timeout: 15_000 }); }
  catch {
    result.publishOutcome = "LEAVE_ROUTE_NOT_REACHED";
    return stop("PUBLISH_FAILED", "EDITOR_LEAVE", "CONDITION_NOT_MET");
  }
  result.publishPreflight = await inspectPublishPreflight(page);
  const blocked = publishBlockedReason(result.publishPreflight);
  if (blocked) {
    result.publishOutcome = "NOT_CLICKED";
    return stop(blocked, "PUBLISH_PREFLIGHT", "DATA_PRECONDITION");
  }
  const publishButton = page.getByRole("button", { name: PUBLISH_BUTTON_LABEL, exact: true });
  if (!await waitEnabled(publishButton, enabledTimeout)) {
    result.publishOutcome = "BUTTON_DISABLED_OR_MISSING";
    return stop("PUBLISH_FAILED", "PUBLISH_BUTTON_ENABLED", "CONDITION_NOT_MET");
  }
  result.failureStep = "NONE";
  onPublishClick();
  await publishButton.click({ timeout: 10_000 });
  if (await visible(page.getByRole("button", { name: PUBLISHED_CHIP_PATTERN }), 20_000)) {
    result.publishOutcome = "PUBLISHED";
    return true;
  }
  let feedback = "NOT_OBSERVED";
  try { feedback = classifyPublishDiagnosis(await page.getByRole("status").allTextContents()); } catch { /* Stays NOT_OBSERVED. */ }
  result.publishOutcome = feedback === "NONE" || feedback === "NOT_OBSERVED" ? "NO_FEEDBACK" : `REFUSED_${feedback}`;
  const refused = publishBlockedReason(feedback);
  return refused
    ? stop(refused, "PUBLISH_RESULT", "DATA_PRECONDITION")
    : stop("PUBLISH_FAILED", "PUBLISH_RESULT", "CONDITION_NOT_MET");
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
      && [allowedFunnelPath, `${allowedFunnelPath}/operations`, `${allowedFunnelPath}/edit`].includes(url.pathname)))) return "FUNNEL_WRITE";
  return "BLOCK";
}

async function visible(locator, timeout = 10_000) {
  try { await locator.waitFor({ state: "visible", timeout }); return true; } catch { return false; }
}

export const MAX_STALE_UNPUBLISH = 10;
const STALE_NAME = "Staging Synthetic Funnel";
const STALE_SLUG = /^\/lp\/staging-synthetic-[a-f0-9]{12}$/u;

/**
 * Unpublish Funnels this smoke created earlier (exact name + generated slug) so the synthetic owner's
 * free-plan publication limit is not exhausted. The list only shows the signed-in synthetic owner's
 * own vendor, and the management action re-checks ownership server-side. Never throws; the outcome
 * is a fixed enum on the receipt and the publish preflight still reports a real limit.
 */
export async function unpublishStaleSyntheticFunnels(page, result, { origin, begin, end }) {
  result.staleCleanup = "NONE_FOUND";
  try {
    for (let index = 0; index < MAX_STALE_UNPUBLISH; index += 1) {
      await page.goto(`${origin}/landing-pages`, { waitUntil: "domcontentloaded", timeout: 20_000 });
      const row = page.getByRole("row")
        .filter({ has: page.getByText(STALE_NAME, { exact: true }) })
        .filter({ has: page.getByText(STALE_SLUG) })
        .filter({ hasText: "已發布" }).first();
      if (!await visible(row, index === 0 ? 8_000 : 3_000)) return;
      result.staleFound += 1;
      const href = await row.getByRole("link", { name: /開啟/u }).getAttribute("href");
      const match = /^\/landing-pages\/([a-z0-9]+)\/operations$/u.exec(href ?? "");
      if (!match) { result.staleCleanup = "LINK_INVALID"; return; }
      await page.goto(`${origin}${href}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
      begin(`/landing-pages/${match[1]}`);
      try {
        await page.getByRole("button", { name: "更多網站操作", exact: true }).click({ timeout: 10_000 });
        await page.getByRole("button", { name: "取消發布", exact: true }).click({ timeout: 10_000 });
        if (!await visible(page.getByRole("button", { name: PUBLISH_BUTTON_LABEL, exact: true }), 20_000)) {
          result.staleCleanup = "UNPUBLISH_FAILED"; return;
        }
      } finally { end(); }
      result.staleCleanup = "UNPUBLISHED";
    }
    result.staleCleanup = "LIMIT_EXCEEDED";
  } catch { result.staleCleanup = "UNAVAILABLE"; }
}

/** Read only the named synthetic project's status; never publish or return IDs. */
export async function inspectSyntheticProjectStatus(page) {
  try {
    const response = await page.goto(`https://${ALIAS}/projects`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (response?.status() !== 200) return "UNAVAILABLE";
    if (!await visible(page.getByRole("heading", { name: "銷售專案", exact: true }))) return "UNAVAILABLE";
    const heading = page.getByRole("heading", { name: "Staging Synthetic Project", exact: true });
    if (await heading.count() !== 1) return "MISSING_OR_AMBIGUOUS";
    // The card contains the title/status row and the management link.
    const card = heading.locator("xpath=../../..");
    const draft = await card.getByText("草稿", { exact: true }).count();
    const published = await card.getByText("已發布", { exact: true }).count();
    const archived = await card.getByText("已封存", { exact: true }).count();
    if (draft + published + archived !== 1) return "UNKNOWN";
    return draft ? "DRAFT" : published ? "PUBLISHED" : "ARCHIVED";
  } catch { return "UNAVAILABLE"; }
}

/** Accept only paths created by this runner, not arbitrary tenant/public URLs. */
/**
 * The create page also shows its heading above the "select a project" guidance,
 * so a still-missing project must stop the run here instead of timing out on
 * the absent form fields.
 */
export function createPageBlocked({ status, headingVisible, projectStillMissing }) {
  return status !== 200 || !headingVisible || projectStillMissing === true;
}

export function syntheticFunnelSlug(value) {
  return typeof value === "string" && /^\/lp\/staging-synthetic-[a-f0-9]{12}$/u.test(value.trim())
    ? value.trim().slice(4) : null;
}

export async function inspectPublicSurface(page, rendererVisible) {
  if (rendererVisible) return "RENDERER";
  for (const [name, result] of [["404", "NOT_FOUND"], ["此活動已截止", "CLOSED"], ["系統暫時無法顯示這個頁面", "APPLICATION_ERROR"]]) {
    if (await page.getByRole("heading", { name, exact: true }).count() > 0) return result;
  }
  return "UNKNOWN";
}

export async function runStagingFunnelSmoke(env = process.env, dependencies = {}) {
  const result = receipt(env.CELEBRATEDEAL_SOURCE_SHA);
  const diagnosticOnly = env.CELEBRATEDEAL_FUNNEL_DIAGNOSTIC_ONLY === "true";
  if (diagnosticOnly) result.scope = "existing_public_read_only";
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
  let cleaningStale = false;
  // Fixed name of the browser action in progress; reported only if an exception stops the run.
  let step = "CONTEXT_SETUP";
  let activePage = null;
  try {
    context = await browser.newContext({ locale: "zh-TW", viewport: { width: 1365, height: 768 }, serviceWorkers: "block" });
    await context.route("**/*", (route) => {
      const kind = classifyFunnelRequest(route.request(), allowedFunnelPath);
      if (kind === "READ") return route.continue();
      if (!diagnosticOnly && kind === "PROJECT_CREATE" && result.sideEffects.projectCreates === 0) {
        result.sideEffects.projectCreates += 1;
        return route.continue();
      }
      if (!diagnosticOnly && kind === "FUNNEL_WRITE" && cleaningStale) {
        result.sideEffects.staleUnpublishes += 1;
        return route.continue();
      }
      if (!diagnosticOnly && kind === "FUNNEL_WRITE" && !(new URL(route.request().url()).pathname === "/landing-pages/new" && result.sideEffects.funnelCreates > 0)) {
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

    step = "PAGE_OPEN";
    const page = await context.newPage();
    activePage = page;
    page.on("pageerror", () => { result.pageErrors += 1; });
    // Record only counts/statuses for the post-create destination; never persist its ID or URL.
    let editorNavigationStarted = false;
    const isOperationsGet = (request) => {
      try {
        const url = new URL(request.url());
        return request.method() === "GET" && url.hostname === ALIAS && /^\/landing-pages\/[a-z0-9]+\/operations$/u.test(url.pathname);
      } catch { return false; }
    };
    const isEditorGet = (request) => {
      try {
        const url = new URL(request.url());
        return editorNavigationStarted && request.method() === "GET" && url.hostname === ALIAS
          && allowedFunnelPath !== null && url.pathname === `${allowedFunnelPath}/edit`;
      } catch { return false; }
    };
    page.on("request", (request) => {
      if (isOperationsGet(request)) { result.operationsGetRequests += 1; result.operationsGetKinds[classifyRouteGetKind(request)] += 1; }
      if (isEditorGet(request)) { result.editorGetRequests += 1; result.editorGetKinds[classifyRouteGetKind(request)] += 1; }
    });
    page.on("requestfinished", (request) => {
      if (isOperationsGet(request)) result.operationsGetFinished += 1;
      if (isEditorGet(request)) result.editorGetFinished += 1;
    });
    page.on("requestfailed", (request) => {
      if (isOperationsGet(request)) { result.operationsGetFailures += 1; result.operationsGetFailureKinds[classifyRequestFailureKind(request)] += 1; }
      if (isEditorGet(request)) { result.editorGetFailures += 1; result.editorGetFailureKinds[classifyRequestFailureKind(request)] += 1; }
    });
    let publishClicked = false;
    page.on("dialog", (dialog) => {
      if (editorNavigationStarted) result.editorDialogs += 1;
      // Preserve Playwright's default dismissal while recording only its count.
      void dialog.dismiss().catch(() => {});
    });
    page.on("response", (response) => {
      const request = response.request();
      if (isOperationsGet(request)) {
        result.operationsGetResponses += 1;
        result.operationsGetLastStatus = response.status();
      }
      if (isEditorGet(request)) {
        result.editorGetResponses += 1;
        result.editorGetLastStatus = response.status();
      }
      if (request.method() !== "POST" || !request.headers()["next-action"]) return;
      try {
        const url = new URL(request.url());
        if (url.hostname === ALIAS && url.pathname === "/landing-pages/new") result.createActionStatus = response.status();
        if (publishClicked && url.hostname === ALIAS && allowedFunnelPath !== null
          && url.pathname === `${allowedFunnelPath}/operations`) result.publishActionStatus = response.status();
      } catch { /* The action status stays unknown. */ }
    });
    let slug;
    if (diagnosticOnly) {
      result.stage = "EXISTING_FUNNEL";
      await page.goto(`${origin}/landing-pages`, { waitUntil: "domcontentloaded", timeout: 20_000 });
      const row = page.getByRole("row").filter({ has: page.getByText("Staging Synthetic Funnel", { exact: true }) }).filter({ hasText: "已發布" }).first();
      if (!await visible(row)) { result.reason = "EXISTING_FUNNEL_UNAVAILABLE"; return result; }
      slug = syntheticFunnelSlug(await row.getByText(/^\/lp\/staging-synthetic-[a-f0-9]{12}$/u).textContent());
      if (!slug) { result.reason = "EXISTING_FUNNEL_INVALID"; return result; }
      result.syntheticProjectStatus = await inspectSyntheticProjectStatus(page);
    } else {
    // Free-plan accounts cap concurrent publications, and earlier runs leave their Funnels published.
    result.stage = "STALE_CLEANUP";
    step = "STALE_CLEANUP";
    await unpublishStaleSyntheticFunnels(page, result, {
      origin,
      begin: (path) => { allowedFunnelPath = path; cleaningStale = true; },
      end: () => { allowedFunnelPath = null; cleaningStale = false; },
    });
    slug = `staging-synthetic-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    result.stage = "CREATE";
    step = "CREATE_PAGE_OPEN";
    let createResponse = await page.goto(`${origin}/landing-pages/new`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (await visible(page.getByRole("heading", { name: PROJECT_REQUIRED_HEADING, exact: true }), 2_000)) {
      result.stage = "PROJECT_CREATE";
      step = "PROJECT_PAGE_OPEN";
      const projectResponse = await page.goto(`${origin}/projects/new`, { waitUntil: "domcontentloaded", timeout: 20_000 });
      if (projectResponse?.status() !== 200 || !await visible(page.getByRole("heading", { name: "建立銷售專案" }))) {
        result.reason = "PROJECT_CREATE_UNAVAILABLE"; return result;
      }
      step = "PROJECT_NAME_FILL";
      await page.getByLabel("專案名稱", { exact: true }).fill("Staging Synthetic Project");
      step = "PROJECT_SLUG_FILL";
      await page.getByLabel("網址代稱", { exact: true }).fill(`${slug}-project`);
      step = "PROJECT_SUBMIT";
      await page.getByRole("button", { name: "建立專案", exact: true }).click({ timeout: 10_000 });
      try { await page.waitForURL((url) => url.pathname === "/onboarding" || /^\/projects\/[a-z0-9]+$/u.test(url.pathname), { timeout: 20_000 }); }
      catch { result.reason = "PROJECT_CREATE_FAILED"; return result; }
      result.projectCreated = true;
      result.projectDestination = funnelRouteCategory(page.url());
      result.stage = "CREATE";
      step = "CREATE_PAGE_OPEN";
      createResponse = await page.goto(`${origin}/landing-pages/new`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    }
    result.createPageStatus = createResponse?.status() ?? null;
    result.createPageRoute = funnelRouteCategory(page.url());
    const createHeadingVisible = await visible(page.getByRole("heading", { name: "建立新的一頁式網站" }));
    result.projectStillMissing = await visible(page.getByRole("heading", { name: PROJECT_REQUIRED_HEADING, exact: true }), 1_000);
    if (createPageBlocked({ status: result.createPageStatus, headingVisible: createHeadingVisible, projectStillMissing: result.projectStillMissing })) { result.reason = "CREATE_PAGE_UNAVAILABLE"; return result; }
    // Same labels as the merged CI journey (tests/e2e/landing-page-flow.spec.ts) on the goal picker.
    step = "CREATE_NAME_FILL";
    await page.getByLabel(CREATE_NAME_LABEL).fill("Staging Synthetic Funnel");
    step = "CREATE_SLUG_FILL";
    await page.getByLabel(CREATE_SLUG_LABEL).fill(slug);
    step = "CREATE_GOAL_SELECT";
    await page.getByRole("button", { name: /建立名單/u }).click({ timeout: 10_000 });
    step = "CREATE_SUBMIT";
    await page.getByRole("button", { name: CREATE_SUBMIT_LABEL, exact: true }).click({ timeout: 10_000 });
    step = "CREATE_DESTINATION";
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
    step = "TEMPLATE_APPLY";
    const templateButton = page.getByRole("button", { name: "套用模板", exact: true }).first();
    if (!await visible(templateButton, 20_000)) { result.reason = "OPERATIONS_NOT_READY"; return result; }
    await templateButton.click({ timeout: 10_000 });
    if (!await visible(page.getByRole("status").filter({ hasText: "模板已套用" }))) { result.reason = "TEMPLATE_FAILED"; return result; }
    result.template = true;
    editorNavigationStarted = true;
    step = "EDITOR_OPEN";
    await page.getByRole("button", { name: "編輯頁面", exact: true }).click({ timeout: 10_000 });
    try { await page.waitForURL((url) => url.pathname === `${funnelPath}/edit`, { timeout: 15_000 }); }
    catch {
      result.editorNavigation = funnelEditorNavigationKind({
        dialogs: result.editorDialogs, requests: result.editorGetRequests,
        responses: result.editorGetResponses, finished: result.editorGetFinished, failures: result.editorGetFailures,
      });
      result.reason = "EDITOR_UNAVAILABLE";
      return result;
    }
    result.editorNavigation = "ROUTE_REACHED";
    const toolbar = page.getByLabel("編輯器工具列", { exact: true });
    if (!await visible(toolbar)) {
      result.reason = "EDITOR_NOT_READY";
      return result;
    }
    result.editorNavigation = "EDITOR_READY";

    result.stage = "SAVE";
    // Save stays disabled until the canvas changes, so add one synthetic section first.
    step = "EDITOR_ADD_SECTION";
    await page.getByRole("button", { name: "區段", exact: true }).click({ timeout: 10_000 });
    step = "EDITOR_SAVE";
    await toolbar.getByRole("button", { name: "儲存", exact: true }).click({ timeout: 10_000 });
    if (!await visible(page.getByRole("status").filter({ hasText: "草稿已儲存" }))
      || !await visible(toolbar.getByRole("button", { name: "已儲存", exact: true }))) { result.reason = "SAVE_FAILED"; return result; }
    result.draft = true;
    result.stage = "PUBLISH";
    // Publishing lives on the management page header, not in the editor.
    step = "EDITOR_LEAVE";
    await toolbar.getByRole("button", { name: "離開", exact: true }).click({ timeout: 10_000 });
    step = "PUBLISH";
    if (!await runPublishStage(page, result, { funnelPath, onPublishClick: () => { publishClicked = true; } })) return result;
    result.published = true;
    }

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
    activePage = publicPage;
    publicPage.on("pageerror", () => { result.pageErrors += 1; });
    result.stage = "PUBLIC_DESKTOP";
    step = "PUBLIC_OPEN";
    const publicResponse = await publicPage.goto(`${origin}/lp/${slug}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    result.publicStatus = publicResponse?.status() ?? null;
    result.publicRouteMatched = PUBLIC_PATH.test(new URL(publicPage.url()).pathname);
    result.publicRendererVisible = await visible(publicPage.locator("[data-funnel-renderer]"));
    result.publicSurface = await inspectPublicSurface(publicPage, result.publicRendererVisible);
    result.publicDesktop = result.publicStatus === 200 && result.publicRouteMatched && result.publicRendererVisible;
    if (!result.publicDesktop) {
      if (!diagnosticOnly) result.syntheticProjectStatus = await inspectSyntheticProjectStatus(page);
      result.reason = "PUBLIC_DESKTOP_FAILED"; return result;
    }
    result.stage = "PUBLIC_MOBILE";
    step = "PUBLIC_MOBILE_RELOAD";
    await publicPage.setViewportSize({ width: 390, height: 844 });
    await publicPage.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    result.publicMobile = PUBLIC_PATH.test(new URL(publicPage.url()).pathname)
      && await visible(publicPage.locator("[data-funnel-renderer]"))
      && await publicPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1);
    result.stage = "COMPLETE";
    // Read-only diagnostics cannot attest the create/save/publish journey.
    if (diagnosticOnly) { result.reason = "DIAGNOSTIC_ONLY"; return result; }
    result.result = result.publicMobile && result.pageErrors === 0 && result.blockedWrites === 0
      && result.sideEffects.funnelCreates === 1 && result.sideEffects.funnelWrites >= 3 ? "PASS" : "BLOCKED";
    result.reason = result.result === "PASS" ? "NONE" : "FUNNEL_JOURNEY_FAILED";
  } catch (error) {
    result.reason = "BROWSER_EXECUTION_FAILED";
    result.failureStep = FUNNEL_STEPS.has(step) ? step : "UNKNOWN";
    result.failureCategory = classifyBrowserExecutionFailure(error);
    try { result.failurePage = activePage ? funnelRouteCategory(activePage.url()) : "NOT_OBSERVED"; }
    catch { result.failurePage = "INVALID_URL"; }
  }
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

/** One grep-able line for the publish stage; fixed enums only. */
export function formatPublishSummary(result) {
  const safe = (value) => (typeof value === "string" && /^[A-Z_]{1,40}$/u.test(value) ? value : "UNKNOWN");
  return `staging_funnel_publish=preflight=${safe(result.publishPreflight)}; outcome=${safe(result.publishOutcome)}; reason=${safe(result.reason)}; failureStep=${safe(result.failureStep)}`;
}

async function main() {
  const result = await runStagingFunnelSmoke();
  if (result.stage === "PUBLISH") process.stdout.write(`${formatPublishSummary(result)}\n`);
  if (process.env.RUNNER_TEMP) await writeFile(`${process.env.RUNNER_TEMP}/celebratedeal-staging-funnel-smoke.json`, `${JSON.stringify(result)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.result === "PASS" ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
