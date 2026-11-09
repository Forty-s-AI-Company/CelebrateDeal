import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classifyBrowserExecutionFailure, validateBrowserSmokeBinding, verifyStagingAliasBinding } from "./staging-browser-smoke.mjs";
import { verifyMvpPayUniLineage } from "./mvp-payuni-sandbox-e2e.mjs";

/**
 * O-13 first-success journey on the fixed staging alias (GO-NO-GO.md §3 steps 1–6), synthetic only:
 * invite → register → welcome → product → registration form → video → email template → live
 * (建立並排程) → project publish → anonymous registration → buyer email confirmation.
 *
 * Mailboxes are Resend test addresses issued by the staging-only ops route; the runner never reads a
 * real inbox. Delivery is read back from the provider by /api/admin/ops/first-success/status, which
 * returns fixed categories plus this run's own verification link paths.
 *
 * It never opens a checkout, payment or refund (each source SHA allows one buyer_order run, kept for
 * the refund reconciliation drill). The receipt holds fixed enums, booleans, counts and durations:
 * no email, name, slug, id, URL or page text.
 */
export const ALIAS = "celebrate-deal-staging.carry-digital-nomad.in.net";
const ORIGIN = `https://${ALIAS}`;

export const STEPS = Object.freeze([
  "INVITE", "REGISTER", "MERCHANT_VERIFICATION_EMAIL", "MERCHANT_EMAIL_VERIFY", "WELCOME",
  "PRODUCT", "FORM", "VIDEO", "EMAIL_TEMPLATE", "LIVE", "PROJECT_PUBLISH", "PUBLIC_REGISTRATION",
  "BUYER_VERIFICATION_EMAIL", "BUYER_VERIFY", "REGISTRATION_CONFIRMATION_EMAIL",
]);
/** Steps whose outcome is evidence only; a NOT_VERIFIABLE result there does not stop the journey. */
const EVIDENCE_STEPS = new Set(["MERCHANT_VERIFICATION_EMAIL", "MERCHANT_EMAIL_VERIFY", "REGISTRATION_CONFIRMATION_EMAIL"]);
const STEP_STATUSES = new Set(["PASS", "FAIL", "NOT_VERIFIABLE", "SKIPPED", "NOT_RUN"]);

const PROVIDER_EVENTS = new Set([
  "NOT_LOOKED_UP", "LOOKUP_UNAVAILABLE", "OTHER", "QUEUED", "SCHEDULED", "SENT", "DELIVERED", "DELIVERY_DELAYED",
  "BOUNCED", "COMPLAINED", "OPENED", "CLICKED", "FAILED", "CANCELED", "SUPPRESSED",
]);
const DELIVERY_STATUSES = new Set(["NOT_FOUND", "OTHER", "SENT", "FAILED", "SUPPRESSED", "QUEUED", "SENDING", "EXHAUSTED", "SUPERSEDED", "RECOVERED"]);
const LINK_SOURCES = new Set(["PROVIDER", "LOCAL_ENVELOPE", "NONE"]);
const RUN_ID = /^[a-f0-9]{24}$/u;
const INVITE_PATH = /^\/register\?invite=[A-Za-z0-9._%~-]{20,1200}$/u;
const MERCHANT_LINK = /^\/verify-email\?token=[A-Za-z0-9._%~-]{16,2048}$/u;
const BUYER_LINK = /^\/verify-registration\?token=[A-Za-z0-9._%~-]{16,2048}$/u;

function emptyEmail() { return { status: "NOT_FOUND", providerEvent: "NOT_LOOKED_UP" }; }

export function createReceipt(sourceSha) {
  return {
    schemaVersion: "celebratedeal-staging-first-success/v1",
    scope: "o13_steps_1_to_6_without_checkout",
    sourceSha: /^[a-f0-9]{40}$/u.test(sourceSha ?? "") ? sourceSha : null,
    result: "BLOCKED", reason: "INVALID_BINDING",
    lineage: "NOT_VERIFIED", aliasBinding: "NOT_VERIFIED",
    startedAt: null, totalDurationMs: null,
    steps: STEPS.map((step) => ({ step, status: "NOT_RUN", durationMs: null })),
    failureStep: "NONE", failureCategory: "NONE", failurePage: "NOT_OBSERVED",
    evidence: {
      ownerConsentRecorded: false, ownerEmailVerified: false, verificationBannerHidden: false,
      productActive: false, livePublishReady: false, liveScheduled: false, projectPublished: false,
      buyerSubmissionAccepted: false, buyerSubmissions: 0, buyerVerifiedSubmissions: 0, liveEntryLinkVisible: false,
    },
    emails: {
      merchantVerification: emptyEmail(),
      buyerVerification: { ...emptyEmail(), linkSource: "NONE" },
      registrationConfirmation: emptyEmail(),
    },
    pageErrors: 0, blockedWrites: 0, blockedExternal: 0, emailJobRuns: 0,
    sideEffects: {
      invitesIssued: 0, registrations: 0, productCreates: 0, formCreates: 0, videoCreates: 0, templateCreates: 0,
      liveCreates: 0, projectPublishes: 0, publicSubmissions: 0, paymentSubmissions: 0, refundSubmissions: 0,
    },
  };
}

/** Fixed route categories only; never a full URL, id or slug. */
export function routeCategory(value) {
  let url;
  try { url = new URL(value); } catch { return "INVALID_URL"; }
  if (url.hostname !== ALIAS) return "EXTERNAL";
  const path = url.pathname;
  const fixed = {
    "/register": "REGISTER", "/welcome": "WELCOME", "/welcome/preparing": "WELCOME_PREPARING", "/dashboard": "DASHBOARD",
    "/login": "LOGIN", "/products": "PRODUCTS", "/products/new": "PRODUCT_NEW", "/forms": "FORMS", "/forms/new": "FORM_NEW",
    "/videos": "VIDEOS", "/videos/new": "VIDEO_NEW", "/messages/templates": "TEMPLATES", "/messages/templates/new": "TEMPLATE_NEW",
    "/lives/new": "LIVE_NEW", "/projects": "PROJECTS", "/verify-email": "VERIFY_EMAIL", "/verify-registration": "VERIFY_REGISTRATION",
  };
  if (fixed[path]) return fixed[path];
  if (/^\/lives\/[a-z0-9]+\/preview$/u.test(path)) return "LIVE_PREVIEW";
  if (/^\/lives\/[a-z0-9]+(?:\/edit)?$/u.test(path)) return "LIVE";
  if (/^\/projects\/[a-z0-9]+$/u.test(path)) return "PROJECT";
  if (/^\/form\/[^/]+$/u.test(path)) return "PUBLIC_FORM";
  if (/^\/live\/[^/]+$/u.test(path)) return "PUBLIC_LIVE";
  return "OTHER";
}

/** Owner-side writes the journey needs. Anything else (payments, checkout, refunds, admin) is aborted. */
const OWNER_WRITE_PATHS = [
  /^\/register$/u, /^\/welcome$/u, /^\/welcome\/preparing$/u, /^\/products\/new$/u, /^\/api\/products\/upsert$/u,
  /^\/forms\/new$/u, /^\/videos\/new$/u, /^\/messages\/templates\/new$/u, /^\/lives\/new$/u, /^\/api\/live-studio\/drafts$/u,
  /^\/projects\/[a-z0-9]+$/u, /^\/api\/auth\/email-verification\/confirm$/u,
];
const BUYER_WRITE_PATHS = [/^\/api\/form-submissions$/u, /^\/api\/form-submissions\/verify$/u];
const FORBIDDEN = /\/(?:checkout|payments?|refunds?|orders?|billing|payuni|subscriptions?)(?:\/|$)|^\/api\/admin\//u;

export function classifyRequest(request, actor) {
  let url;
  try { url = new URL(request.url()); } catch { return "EXTERNAL"; }
  if (url.protocol !== "https:" || url.hostname !== ALIAS) return "EXTERNAL";
  const method = request.method();
  if (["GET", "HEAD"].includes(method)) return "READ";
  if (method === "POST" && ["/monitoring", "/api/security/csp-report"].includes(url.pathname)) return "TELEMETRY";
  if (method === "POST" && url.pathname === "/api/affiliate-attribution/direct-entry" && !request.postData()) return "ATTRIBUTION_RESET";
  if (FORBIDDEN.test(url.pathname)) return method === "POST" && /payment|checkout/u.test(url.pathname) ? "PAYMENT" : method === "POST" && /refund/u.test(url.pathname) ? "REFUND" : "BLOCK";
  const allowed = actor === "owner" ? OWNER_WRITE_PATHS : BUYER_WRITE_PATHS;
  if (method === "POST" && allowed.some((pattern) => pattern.test(url.pathname))) return "WRITE";
  return "BLOCK";
}

/** Keep only the fixed categories of a status-route answer; anything unexpected becomes OTHER. */
export function sanitizeStatus(body) {
  const pick = (value, allowed, fallback = "OTHER") => (typeof value === "string" && allowed.has(value) ? value : fallback);
  const email = (value) => ({ status: pick(value?.status, DELIVERY_STATUSES), providerEvent: pick(value?.providerEvent, PROVIDER_EVENTS) });
  const count = (value) => (Number.isSafeInteger(value) && value >= 0 && value < 100 ? value : 0);
  return {
    ownerRegistered: body?.ownerRegistered === true,
    ownerConsentRecorded: body?.ownerConsentRecorded === true,
    ownerEmailVerified: body?.ownerEmailVerified === true,
    merchantVerificationEmail: email(body?.merchantVerificationEmail),
    merchantVerificationLinkPath: typeof body?.merchantVerificationLinkPath === "string" && MERCHANT_LINK.test(body.merchantVerificationLinkPath) ? body.merchantVerificationLinkPath : null,
    buyerSubmissions: count(body?.buyerSubmissions),
    buyerVerifiedSubmissions: count(body?.buyerVerifiedSubmissions),
    buyerVerificationEmail: { ...email(body?.buyerVerificationEmail), linkSource: pick(body?.buyerVerificationEmail?.linkSource, LINK_SOURCES, "NONE") },
    buyerVerificationLinkPath: typeof body?.buyerVerificationLinkPath === "string" && BUYER_LINK.test(body.buyerVerificationLinkPath) ? body.buyerVerificationLinkPath : null,
    registrationConfirmationEmail: email(body?.registrationConfirmationEmail),
  };
}

/** PASS needs every journey step, provider-confirmed delivery of all three emails and no blocked or failed request. */
export function finalVerdict(receipt) {
  const failed = receipt.steps.find((entry) => entry.status !== "PASS");
  if (failed) return { result: "BLOCKED", reason: `STEP_${failed.step}_${failed.status}` };
  if (receipt.pageErrors > 0) return { result: "BLOCKED", reason: "PAGE_ERRORS" };
  if (receipt.blockedWrites > 0) return { result: "BLOCKED", reason: "UNEXPECTED_WRITE_BLOCKED" };
  if (receipt.sideEffects.paymentSubmissions > 0 || receipt.sideEffects.refundSubmissions > 0) return { result: "BLOCKED", reason: "PAYMENT_ATTEMPTED" };
  return { result: "PASS", reason: "NONE" };
}

/** Asia/Taipei `YYYY-MM-DDTHH:mm` for the live's datetime-local field (Taiwan has no DST). */
export function taipeiDateTimeLocal(date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 16);
}

function browserEnvironment() {
  return process.platform === "win32"
    ? { PATH: "C:\\Windows\\System32;C:\\Windows", SystemRoot: "C:\\Windows", TEMP: "C:\\Windows\\Temp", TMP: "C:\\Windows\\Temp" }
    : { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/tmp", TMPDIR: "/tmp" };
}

async function visible(locator, timeout = 15_000) {
  try { await locator.first().waitFor({ state: "visible", timeout }); return true; } catch { return false; }
}

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Select the one option whose text contains our synthetic marker; works on hidden stepper panels too. */
async function selectOptionContaining(select, marker) {
  const value = await select.evaluate((element, text) => {
    const option = [...element.options].find((candidate) => candidate.textContent.includes(text) && !candidate.disabled);
    return option ? option.value : null;
  }, marker);
  if (!value) throw new Error("CONDITION_NOT_MET option");
  await select.selectOption(value);
}

class ConditionNotMet extends Error {
  constructor() { super("CONDITION_NOT_MET"); this.name = "ConditionNotMet"; }
}
function ensure(condition) { if (!condition) throw new ConditionNotMet(); }

export async function runStagingFirstSuccess(env = process.env, dependencies = {}) {
  const result = createReceipt(env.CELEBRATEDEAL_SOURCE_SHA);
  if (!validateBrowserSmokeBinding(env)) return result;
  const verifyLineage = dependencies.verifyLineage ?? verifyMvpPayUniLineage;
  const verifyAlias = dependencies.verifyAlias ?? verifyStagingAliasBinding;
  const now = dependencies.now ?? (() => Date.now());
  const wait = dependencies.pause ?? pause;
  try {
    if (!await verifyLineage(env)) { result.reason = "LINEAGE_NOT_VERIFIED"; return result; }
    result.lineage = "VERIFIED";
    if (!await verifyAlias(env)) { result.reason = "ALIAS_NOT_VERIFIED"; return result; }
    result.aliasBinding = "VERIFIED";
  } catch { result.reason = "BINDING_CHECK_FAILED"; return result; }

  const opsHeaders = (extra = {}) => ({ Authorization: `Bearer ${env.JOB_SECRET}`, "x-celebratedeal-source-sha": env.CELEBRATEDEAL_SOURCE_SHA, ...extra });
  const { chromium } = dependencies.playwright ?? await import("playwright");
  let browser;
  try { browser = await chromium.launch({ headless: true, env: browserEnvironment(), args: ["--no-proxy-server", "--disable-quic"] }); }
  catch { result.reason = "BROWSER_LAUNCH_FAILED"; return result; }

  const started = now();
  result.startedAt = new Date(started).toISOString();
  let ownerContext;
  let buyerContext;
  let activePage = null;
  let currentStep = "INVITE";
  const entry = (step) => result.steps.find((candidate) => candidate.step === step);
  /** Run one fixed step, recording its status and duration. Throws to stop the journey on FAIL. */
  const step = async (name, body) => {
    currentStep = name;
    const record = entry(name);
    const t0 = now();
    try {
      const outcome = await body();
      record.status = STEP_STATUSES.has(outcome) ? outcome : "PASS";
    } catch (error) {
      record.status = "FAIL";
      record.durationMs = now() - t0;
      throw error;
    }
    record.durationMs = now() - t0;
    if (record.status !== "PASS" && !EVIDENCE_STEPS.has(name)) throw new ConditionNotMet();
  };

  const guard = (context, actor) => context.route("**/*", (route) => {
    const kind = classifyRequest(route.request(), actor);
    if (kind === "READ" || kind === "WRITE") return route.continue();
    if (kind === "TELEMETRY") return route.fulfill({ status: 204 });
    if (kind === "ATTRIBUTION_RESET") return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    if (kind === "EXTERNAL") result.blockedExternal += 1;
    else if (kind === "PAYMENT") { result.sideEffects.paymentSubmissions += 1; result.blockedWrites += 1; }
    else if (kind === "REFUND") { result.sideEffects.refundSubmissions += 1; result.blockedWrites += 1; }
    else result.blockedWrites += 1;
    return route.abort();
  });

  let runId = null;
  const readStatus = async () => {
    const response = await ownerContext.request.post(`${ORIGIN}/api/admin/ops/first-success/status`, {
      headers: opsHeaders({ "x-celebratedeal-first-success-run": runId }), maxRedirects: 0, timeout: 30_000, failOnStatusCode: false,
    });
    try { return response.status() === 200 ? sanitizeStatus(await response.json()) : null; }
    finally { await response.dispose(); }
  };
  const pollStatus = async (done, { attempts = 20, intervalMs = 5_000, onAttempt } = {}) => {
    let last = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await wait(intervalMs);
      if (onAttempt) await onAttempt(attempt);
      last = await readStatus();
      if (last && done(last)) return last;
    }
    return last;
  };
  const runEmailJob = async () => {
    const response = await ownerContext.request.post(`${ORIGIN}/api/jobs/email-deliveries`, {
      headers: { Authorization: `Bearer ${env.JOB_SECRET}` }, maxRedirects: 0, timeout: 60_000, failOnStatusCode: false,
    });
    result.emailJobRuns += 1;
    await response.dispose();
  };

  try {
    ownerContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei", viewport: { width: 1365, height: 900 }, serviceWorkers: "block" });
    await guard(ownerContext, "owner");
    await ownerContext.routeWebSocket("**/*", (socket) => socket.close());
    if (!await verifyAlias(env)) { result.reason = "ALIAS_DRIFT"; return result; }
    const page = await ownerContext.newPage();
    activePage = page;
    page.on("pageerror", () => { result.pageErrors += 1; });
    page.on("dialog", (dialog) => { void dialog.dismiss().catch(() => {}); });

    // Unique, non-personal markers for this run; never written to the receipt.
    let marker;
    let invitePath;
    await step("INVITE", async () => {
      const response = await ownerContext.request.post(`${ORIGIN}/api/admin/ops/first-success/invite`, {
        headers: opsHeaders(), maxRedirects: 0, timeout: 30_000, failOnStatusCode: false,
      });
      try {
        ensure(response.status() === 201);
        const body = await response.json();
        ensure(RUN_ID.test(body?.runId ?? "") && INVITE_PATH.test(body?.invitePath ?? ""));
        runId = body.runId;
        invitePath = body.invitePath;
        marker = `CDFS ${runId.slice(0, 8)}`;
        result.sideEffects.invitesIssued = 1;
      } finally { await response.dispose(); }
    });
    const short = runId.slice(0, 10);

    await step("REGISTER", async () => {
      await page.goto(`${ORIGIN}${invitePath}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      ensure(await visible(page.getByRole("heading", { name: "建立你的商家帳號" })));
      const email = page.locator('input[name="email"]');
      ensure(await email.getAttribute("readonly") !== null && (await email.inputValue()).endsWith("@resend.dev"));
      await page.locator('input[name="name"]').fill(`Synthetic owner ${short}`);
      await page.locator('input[name="workspaceName"]').fill(`Synthetic workspace ${short}`);
      await page.locator('input[name="password"]').fill(`Synthetic-${runId}-Pw!`);
      await page.getByRole("checkbox", { name: /我已閱讀並同意/u }).check();
      await page.getByRole("button", { name: "建立帳號並開始設定", exact: true }).click({ timeout: 10_000 });
      await page.waitForURL((url) => url.pathname === "/welcome", { timeout: 45_000 });
      result.sideEffects.registrations = 1;
    });

    await step("MERCHANT_VERIFICATION_EMAIL", async () => {
      const status = await pollStatus((value) => value.merchantVerificationEmail.status !== "NOT_FOUND"
        && (["DELIVERED", "LOOKUP_UNAVAILABLE"].includes(value.merchantVerificationEmail.providerEvent) || value.merchantVerificationEmail.status !== "SENT"));
      if (!status) return "NOT_VERIFIABLE";
      result.evidence.ownerConsentRecorded = status.ownerConsentRecorded;
      result.emails.merchantVerification = status.merchantVerificationEmail;
      return status.ownerConsentRecorded && status.merchantVerificationEmail.providerEvent === "DELIVERED" ? "PASS"
        : status.merchantVerificationEmail.providerEvent === "LOOKUP_UNAVAILABLE" ? "NOT_VERIFIABLE" : "FAIL";
    });

    await step("WELCOME", async () => {
      for (let index = 0; index < 4; index += 1) {
        if (index === 2) await page.getByRole("checkbox").first().click();
        else await page.getByRole("radio").first().click();
        const next = page.getByRole("button", { name: index === 3 ? "產生我的工作空間" : "下一題", exact: true });
        await next.waitFor({ state: "visible", timeout: 15_000 });
        for (let tries = 0; tries < 40 && !await next.isEnabled(); tries += 1) await wait(250);
        await next.click({ timeout: 10_000 });
      }
      await page.waitForURL((url) => url.pathname === "/welcome/preparing", { timeout: 30_000 });
      await page.getByRole("link", { name: "進入我的工作空間" }).click({ timeout: 30_000 });
      await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 30_000 });
    });

    await step("MERCHANT_EMAIL_VERIFY", async () => {
      const status = await readStatus();
      if (!status?.merchantVerificationLinkPath) return "NOT_VERIFIABLE";
      await page.goto(`${ORIGIN}${status.merchantVerificationLinkPath}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.getByRole("button", { name: "確認驗證 Email", exact: true }).click({ timeout: 15_000 });
      await page.waitForURL((url) => url.pathname === "/verify-email" && url.searchParams.get("status") === "verified", { timeout: 30_000 });
      ensure(await visible(page.getByRole("heading", { name: "Email 已完成驗證" })));
      await page.goto(`${ORIGIN}/dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      result.evidence.verificationBannerHidden = await page.locator("[data-email-verification-banner]").count() === 0;
      result.evidence.ownerEmailVerified = (await readStatus())?.ownerEmailVerified === true;
      return result.evidence.verificationBannerHidden && result.evidence.ownerEmailVerified ? "PASS" : "FAIL";
    });

    await step("PRODUCT", async () => {
      await page.goto(`${ORIGIN}/products/new`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.locator('input[name="name"]').fill(`${marker} 商品`);
      await page.locator('input[name="slug"]').fill(`cdfs-product-${short}`);
      await page.locator('input[name="price"]').fill("990");
      await page.locator('input[name="inventory"]').fill("10");
      await page.locator('input[name="isActive"]').check();
      await page.getByRole("button", { name: "儲存", exact: true }).click({ timeout: 10_000 });
      await page.waitForURL((url) => url.pathname === "/products" && url.searchParams.get("updated") === "created", { timeout: 30_000 });
      result.sideEffects.productCreates = 1;
      result.evidence.productActive = true;
    });

    const formSlug = `cdfs-form-${short}`;
    await step("FORM", async () => {
      await page.goto(`${ORIGIN}/forms/new`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.locator('input[name="name"]').fill(`${marker} 報名表`);
      await page.locator('input[name="slug"]').fill(formSlug);
      await page.locator('input[name="headline"]').fill(`${marker} 報名`);
      await page.getByRole("button", { name: "儲存表單", exact: true }).click({ timeout: 10_000 });
      await page.waitForURL((url) => url.pathname === "/forms", { timeout: 30_000 });
      ensure(await visible(page.getByText(`${marker} 報名表`)));
      result.sideEffects.formCreates = 1;
    });

    await step("VIDEO", async () => {
      await page.goto(`${ORIGIN}/videos/new`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.locator('input[name="title"]').fill(`${marker} 影片`);
      await page.getByText("進階：使用既有外部影片 URL", { exact: true }).click({ timeout: 10_000 });
      await page.locator('input[name="videoUrl"]').fill("https://example.com/celebratedeal-synthetic-first-success.mp4");
      await page.getByRole("button", { name: "儲存", exact: true }).click({ timeout: 10_000 });
      await page.waitForURL((url) => url.pathname === "/videos", { timeout: 30_000 });
      result.sideEffects.videoCreates = 1;
    });

    await step("EMAIL_TEMPLATE", async () => {
      await page.goto(`${ORIGIN}/messages/templates/new`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.locator('input[name="name"]').fill(`${marker} 報名成功信`);
      await page.locator('select[name="trigger"]').selectOption("registration_confirmed");
      await page.locator('input[name="subject"]').fill("{{live_title}} 報名成功");
      await page.locator('textarea[name="body"]').fill("{{name}} 您好，已收到你的報名。\n開播時間：{{live_start_at}}\n直播入口：{{live_url}}");
      await page.getByRole("button", { name: "儲存", exact: true }).click({ timeout: 10_000 });
      await page.waitForURL((url) => url.pathname === "/messages/templates", { timeout: 30_000 });
      result.sideEffects.templateCreates = 1;
    });

    let liveId = null;
    await step("LIVE", async () => {
      await page.goto(`${ORIGIN}/lives/new`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      ensure(await visible(page.getByRole("heading", { name: "建立直播間" })));
      const next = () => page.getByRole("button", { name: "下一步", exact: true }).click({ timeout: 10_000 });
      await page.locator('input[name="title"]').fill(`${marker} Live`);
      // The slug is filled from the title (GO-NO-GO §3 step 4).
      for (let tries = 0; tries < 20 && (await page.locator("input#live-slug").inputValue()) === ""; tries += 1) await wait(250);
      ensure((await page.locator("input#live-slug").inputValue()) !== "");
      await next();
      await page.locator('select[name="streamMode"]').selectOption("vod");
      await selectOptionContaining(page.locator('select[name="videoId"]'), `${marker} 影片`);
      await next();
      await page.getByRole("checkbox", { name: new RegExp(`${marker} 商品`, "u") }).check();
      await next();
      await selectOptionContaining(page.locator('select[name="formId"]'), `${marker} 報名表`);
      await next();
      await page.locator('input[name="scheduledAt"][type="datetime-local"]').fill(taipeiDateTimeLocal(new Date(now() + 3 * 24 * 60 * 60 * 1_000)));
      await next();
      await selectOptionContaining(page.locator('select[name="messageTemplateId"]'), `${marker} 報名成功信`);
      await next();
      await next();
      // Step 8: the interaction script is optional (F-113), so the check must already be complete.
      result.evidence.livePublishReady = await visible(page.getByText("發布條件已完成"), 15_000);
      ensure(result.evidence.livePublishReady);
      await page.getByRole("button", { name: "建立並排程", exact: true }).click({ timeout: 10_000 });
      const dialog = page.getByRole("alertdialog", { name: "確定要建立並排程這場直播嗎？" });
      ensure(await visible(dialog, 10_000));
      await dialog.getByRole("button", { name: "確認建立並排程", exact: true }).click({ timeout: 10_000 });
      await page.waitForURL((url) => /^\/lives\/[a-z0-9]+\/preview$/u.test(url.pathname), { timeout: 45_000 });
      liveId = new URL(page.url()).pathname.split("/")[2];
      result.sideEffects.liveCreates = 1;
      result.evidence.liveScheduled = true;
    });

    await step("PROJECT_PUBLISH", async () => {
      await page.goto(`${ORIGIN}/projects`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.getByRole("link", { name: "管理專案" }).first().click({ timeout: 15_000 });
      await page.waitForURL((url) => /^\/projects\/[a-z0-9]+$/u.test(url.pathname), { timeout: 30_000 });
      await page.getByRole("button", { name: "檢查並發布", exact: true }).click({ timeout: 10_000 });
      await page.waitForURL((url) => url.searchParams.has("published") || url.searchParams.get("error") === "not_ready", { timeout: 30_000 });
      ensure(await visible(page.getByRole("status").filter({ hasText: "專案已發布" }), 10_000));
      result.sideEffects.projectPublishes = 1;
      result.evidence.projectPublished = true;
    });

    // The buyer is a separate cookie-free context, exactly like a visitor from a shared link.
    buyerContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei", viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await guard(buyerContext, "buyer");
    await buyerContext.routeWebSocket("**/*", (socket) => socket.close());
    const buyer = await buyerContext.newPage();
    activePage = buyer;
    buyer.on("pageerror", () => { result.pageErrors += 1; });

    await step("PUBLIC_REGISTRATION", async () => {
      const response = await buyer.goto(`${ORIGIN}/form/${formSlug}?liveId=${liveId}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      ensure(response?.status() === 200);
      const session = buyer.getByRole("radio", { name: new RegExp(`${marker} Live`, "u") });
      if (await session.count() > 0 && !await session.first().isChecked()) await session.first().check();
      await buyer.getByLabel("姓名").fill(`Synthetic buyer ${short}`);
      await buyer.getByLabel("Email").fill(`delivered+cdfs-buyer-${runId}@resend.dev`);
      await buyer.getByRole("button", { name: "送出報名", exact: true }).click({ timeout: 10_000 });
      result.sideEffects.publicSubmissions = 1;
      result.evidence.buyerSubmissionAccepted = await visible(buyer.getByText("請到 Email 開啟確認連結", { exact: false }), 30_000);
      ensure(result.evidence.buyerSubmissionAccepted);
    });

    let buyerLink = null;
    await step("BUYER_VERIFICATION_EMAIL", async () => {
      // Sent right after the response; one email job run recovers a missed after() dispatch.
      const status = await pollStatus((value) => value.buyerVerificationLinkPath !== null
        && ["DELIVERED", "LOOKUP_UNAVAILABLE"].includes(value.buyerVerificationEmail.providerEvent), {
        onAttempt: async (attempt) => { if (attempt === 6) await runEmailJob(); },
      });
      if (!status) return "FAIL";
      result.evidence.buyerSubmissions = status.buyerSubmissions;
      result.emails.buyerVerification = status.buyerVerificationEmail;
      buyerLink = status.buyerVerificationLinkPath;
      ensure(buyerLink !== null && status.buyerSubmissions === 1);
      return status.buyerVerificationEmail.providerEvent === "DELIVERED" ? "PASS" : "NOT_VERIFIABLE";
    }).catch((error) => {
      // Without provider proof the journey can still finish from the sent envelope; the step stays non-PASS.
      if (!(error instanceof ConditionNotMet) || buyerLink === null) throw error;
    });

    await step("BUYER_VERIFY", async () => {
      await buyer.goto(`${ORIGIN}${buyerLink}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await buyer.getByRole("button", { name: "確認 Email 並完成報名", exact: true }).click({ timeout: 15_000 });
      await buyer.waitForURL((url) => url.pathname === "/verify-registration" && url.searchParams.get("status") === "verified", { timeout: 30_000 });
      ensure(await visible(buyer.getByRole("heading", { name: "Email 已確認" })));
      result.evidence.liveEntryLinkVisible = await visible(buyer.getByRole("region", { name: "報名後的下一步" }).getByRole("link", { name: "前往直播間" }), 10_000);
      ensure(result.evidence.liveEntryLinkVisible);
    });

    await step("REGISTRATION_CONFIRMATION_EMAIL", async () => {
      const status = await pollStatus((value) => ["DELIVERED", "LOOKUP_UNAVAILABLE"].includes(value.registrationConfirmationEmail.providerEvent)
        || ["FAILED", "EXHAUSTED", "SUPPRESSED"].includes(value.registrationConfirmationEmail.status), {
        onAttempt: async (attempt) => { if (attempt === 6) await runEmailJob(); },
      });
      if (!status) return "NOT_VERIFIABLE";
      result.evidence.buyerVerifiedSubmissions = status.buyerVerifiedSubmissions;
      result.emails.registrationConfirmation = status.registrationConfirmationEmail;
      if (status.buyerVerifiedSubmissions !== 1) return "FAIL";
      if (status.registrationConfirmationEmail.providerEvent === "DELIVERED") return "PASS";
      return status.registrationConfirmationEmail.providerEvent === "LOOKUP_UNAVAILABLE" && status.registrationConfirmationEmail.status === "SENT" ? "NOT_VERIFIABLE" : "FAIL";
    });

    Object.assign(result, finalVerdict(result));
  } catch (error) {
    result.result = "BLOCKED";
    result.failureStep = STEPS.includes(currentStep) ? currentStep : "UNKNOWN";
    result.failureCategory = error instanceof ConditionNotMet || /CONDITION_NOT_MET/u.test(error?.message ?? "") ? "CONDITION_NOT_MET" : classifyBrowserExecutionFailure(error);
    try { result.failurePage = activePage ? routeCategory(activePage.url()) : "NOT_OBSERVED"; } catch { result.failurePage = "INVALID_URL"; }
    result.reason = `STEP_${result.failureStep}_FAILED`;
  } finally {
    result.totalDurationMs = now() - started;
    await buyerContext?.close().catch(() => {});
    await ownerContext?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  return result;
}

/** One grep-able line per step; fixed enums and integers only. */
export function formatStepSummary(receipt) {
  return receipt.steps.map((entry) => `${entry.step}=${entry.status}${Number.isSafeInteger(entry.durationMs) ? `/${entry.durationMs}ms` : ""}`).join(" ");
}

async function main() {
  const result = await runStagingFirstSuccess();
  if (process.env.RUNNER_TEMP) await writeFile(`${process.env.RUNNER_TEMP}/celebratedeal-staging-first-success.json`, `${JSON.stringify(result)}\n`, { mode: 0o600 });
  process.stdout.write(`staging_first_success_steps=${formatStepSummary(result)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.result === "PASS" ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
