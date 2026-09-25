import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { verifyMvpPayUniLineage } from "./mvp-payuni-sandbox-e2e.mjs";

const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const PREVIEW_HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/u;
const STAGING_ALIAS = "celebrate-deal-staging.carry-digital-nomad.in.net";
const VERCEL_SCOPE = "a25814740s-projects";
const VERCEL_PROJECT = "celebrate-deal-staging";
const PRODUCT_ID = "wp4_synthetic_product_v1";
const ROUTES = [
  { id: "dashboard", path: "/dashboard", heading: "Dashboard" },
  { id: "products", path: "/products", heading: "商品管理" },
  { id: "product_preview", path: `/products/${PRODUCT_ID}/preview`, heading: "商品預覽" },
  { id: "product_edit", path: `/products/${PRODUCT_ID}/edit`, heading: "編輯商品" },
  { id: "billing_plans", path: "/billing/plans", heading: "方案" },
];

function emptyReport(reason = "NOT_RUN", sourceSha = null) {
  return {
    schemaVersion: "celebratedeal-staging-browser-smoke/v2",
    sourceSha: SOURCE_SHA.test(sourceSha ?? "") ? sourceSha : null,
    deploymentHost: null,
    result: "BLOCKED",
    reason,
    lineage: "NOT_VERIFIED",
    aliasBinding: "NOT_VERIFIED",
    session: "NOT_RUN",
    journeys: [],
    browser: {
      pageErrors: 0, sameHost5xx: 0, criticalResourceFailures: 0, navigationInteractionsPassed: 0,
      hydrationInteractionsPassed: 0,
      externalRequestsBlocked: 0, unsafeRequestsBlocked: 0,
      safeAttributionResets: 0,
      unsafeRequestCategories: { next: 0, api: 0, page: 0, other: 0 }, webSocketsBlocked: 0,
    },
    sideEffects: { syntheticSessionCreated: 0, syntheticSessionRevoked: 0, checkoutPosts: 0, paymentSubmissions: 0, uploads: 0, emails: 0 },
  };
}

export function validateBrowserSmokeBinding(env) {
  return SOURCE_SHA.test(env.CELEBRATEDEAL_SOURCE_SHA ?? "")
    && PREVIEW_HOST.test(env.CELEBRATEDEAL_DEPLOYMENT_HOST ?? "")
    && typeof env.GITHUB_TOKEN === "string" && env.GITHUB_TOKEN.length > 0
    && typeof env.VERCEL_TOKEN === "string" && env.VERCEL_TOKEN.length > 0
    && typeof env.JOB_SECRET === "string"
    && env.JOB_SECRET.length >= 16;
}

function vercelApiFailure(response, resource) {
  if (response.status === 401) return `${resource}_AUTH_REJECTED`;
  if (response.status === 403) return `${resource}_PERMISSION_DENIED`;
  if (response.status === 404) return `${resource}_NOT_FOUND`;
  return `${resource}_API_ERROR`;
}

/** Return only a fixed reason code; never include the token or provider response. */
export async function diagnoseStagingAliasBinding(env, fetchImpl = fetch) {
  if (!SOURCE_SHA.test(env.CELEBRATEDEAL_SOURCE_SHA ?? "")
    || !PREVIEW_HOST.test(env.CELEBRATEDEAL_DEPLOYMENT_HOST ?? "")) return "SOURCE_BINDING_INVALID";
  if (typeof env.VERCEL_TOKEN !== "string" || env.VERCEL_TOKEN.length === 0) return "VERCEL_TOKEN_MISSING";
  const headers = { Authorization: `Bearer ${env.VERCEL_TOKEN}` };
  const options = { headers, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) };
  try {
    const aliasResponse = await fetchImpl(`https://api.vercel.com/v4/aliases/${STAGING_ALIAS}?slug=${VERCEL_SCOPE}`, options);
    if (aliasResponse.status !== 200) return vercelApiFailure(aliasResponse, "ALIAS");
    const alias = await aliasResponse.json();
    if (alias.alias !== STAGING_ALIAS || alias.redirect || alias.deletedAt || !/^dpl_[a-zA-Z0-9]+$/u.test(alias.deploymentId)) return "ALIAS_METADATA_INVALID";
    const deploymentResponse = await fetchImpl(`https://api.vercel.com/v13/deployments/${env.CELEBRATEDEAL_DEPLOYMENT_HOST}?slug=${VERCEL_SCOPE}`, options);
    if (deploymentResponse.status !== 200) return vercelApiFailure(deploymentResponse, "DEPLOYMENT");
    const deployment = await deploymentResponse.json();
    if (alias.deploymentId !== deployment.id) return "ALIAS_DEPLOYMENT_MISMATCH";
    if (alias.projectId !== deployment.projectId) return "ALIAS_PROJECT_MISMATCH";
    if (deployment.url !== env.CELEBRATEDEAL_DEPLOYMENT_HOST
      || deployment.name !== VERCEL_PROJECT || deployment.target !== null || deployment.readyState !== "READY") return "DEPLOYMENT_METADATA_INVALID";
    return "VERIFIED";
  } catch {
    return "VERCEL_API_EXCEPTION";
  }
}

/** Compare trusted Vercel alias metadata with the exact immutable Preview deployment. */
export async function verifyStagingAliasBinding(env, fetchImpl = fetch) {
  return await diagnoseStagingAliasBinding(env, fetchImpl) === "VERIFIED";
}

/** A failed same-host JavaScript or stylesheet request invalidates SSR-only success. */
export function isCriticalResourceFailure(response) {
  try {
    const url = new URL(response.url());
    return url.hostname === STAGING_ALIAS && response.status() >= 400
      && ["script", "stylesheet"].includes(response.request().resourceType());
  } catch { return false; }
}

export function isFailedCriticalResourceRequest(request) {
  try {
    return new URL(request.url()).hostname === STAGING_ALIAS
      && ["script", "stylesheet"].includes(request.resourceType());
  } catch { return false; }
}

/** Only this mount-time attribution reset may receive a local no-op response. */
export function classifyBrowserRequest(request) {
  let url;
  try { url = new URL(request.url()); } catch { return "EXTERNAL"; }
  if (url.protocol !== "https:" || url.hostname !== STAGING_ALIAS) return "EXTERNAL";
  if (["GET", "HEAD"].includes(request.method())) return "READ";
  if (request.method() === "POST"
    && url.pathname === "/api/affiliate-attribution/direct-entry"
    && url.search === ""
    && request.headers()["x-celebratedeal-client"] === "web"
    && request.headers()["content-type"]?.startsWith("application/json")
    && !request.postData()) return "ATTRIBUTION_RESET";
  return "UNSAFE";
}

export function classifySessionStatus(status) {
  if (status === 204) return "ISSUED";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 404) return "FIXTURE_UNAVAILABLE";
  if (status === 503) return "SERVICE_UNAVAILABLE";
  return "HTTP_REJECTED";
}

/** The app shell renders separate navigation landmarks at mobile width. */
export function appNavigationSelectorForViewport(viewportId) {
  return viewportId === "mobile"
    ? 'nav[aria-label="行動版主要導覽"]:visible'
    : 'nav[aria-label="主要導覽"]:visible';
}

/** Persist only a fixed category; redirected URLs may contain private query data. */
export function classifyFinalPath(url, expectedPath) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== STAGING_ALIAS) return "OFF_HOST";
    if (parsed.pathname === expectedPath) return "EXPECTED";
    if (/^\/(?:login|mfa)(?:\/|$)/u.test(parsed.pathname)) return "AUTH_REDIRECT";
    return "OTHER_SAME_HOST";
  } catch {
    return "INVALID_URL";
  }
}

/** Group blocked requests without logging paths, bodies, headers, or cookies. */
export function classifyUnsafeRequestPath(pathname) {
  if (pathname.startsWith("/_next/")) return "next";
  if (pathname.startsWith("/api/")) return "api";
  if (pathname === "/" || ROUTES.some((route) => pathname === route.path)) return "page";
  return "other";
}

function browserEnvironment() {
  return process.platform === "win32"
    ? { PATH: "C:\\Windows\\System32;C:\\Windows", SystemRoot: "C:\\Windows", TEMP: "C:\\Windows\\Temp", TMP: "C:\\Windows\\Temp" }
    : { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/tmp", TMPDIR: "/tmp" };
}

async function visible(locator) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

/** Exercise read-only owner pages with a fixed synthetic session, never a buyer checkout. */
export async function runBrowserSmoke(env = process.env, dependencies = {}) {
  const report = emptyReport("NOT_RUN", env.CELEBRATEDEAL_SOURCE_SHA);
  if (!validateBrowserSmokeBinding(env)) {
    report.reason = "INVALID_BINDING";
    return report;
  }
  report.deploymentHost = env.CELEBRATEDEAL_DEPLOYMENT_HOST;
  // Recheck immutable Preview lineage at execution time; an alias may have moved.
  const verifyLineage = dependencies.verifyLineage ?? verifyMvpPayUniLineage;
  let lineageVerified = false;
  try { lineageVerified = await verifyLineage(env); } catch { /* A lookup failure is not attestation. */ }
  if (!lineageVerified) {
    report.reason = "LINEAGE_NOT_VERIFIED";
    return report;
  }
  report.lineage = "VERIFIED";
  const verifyAlias = dependencies.verifyAlias ?? verifyStagingAliasBinding;
  let aliasVerified = false;
  try { aliasVerified = await verifyAlias(env); } catch { /* An API failure is not attestation. */ }
  if (!aliasVerified) {
    report.reason = "ALIAS_NOT_VERIFIED";
    return report;
  }
  report.aliasBinding = "VERIFIED";
  // Exercise the URL people actually open. The session endpoint checks the source SHA.
  const origin = `https://${STAGING_ALIAS}`;
  const { chromium } = dependencies.playwright ?? await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    env: browserEnvironment(),
    args: ["--no-proxy-server", "--disable-quic"],
  });
  let cleanupFailed = false;
  try {
    for (const viewport of [{ id: "desktop", width: 1365, height: 768 }, { id: "mobile", width: 390, height: 844 }]) {
      const context = await browser.newContext({
        locale: "zh-TW",
        viewport: { width: viewport.width, height: viewport.height },
        serviceWorkers: "block",
      });
      let sessionIssued = false;
      try {
        // Block third-party traffic while the synthetic owner is signed in.
        await context.route("**/*", (route) => {
          const request = route.request();
          const requestClass = classifyBrowserRequest(request);
          if (requestClass === "EXTERNAL") {
            report.browser.externalRequestsBlocked += 1;
            return route.abort();
          }
          if (requestClass === "UNSAFE") {
            const requestUrl = new URL(request.url());
            report.browser.unsafeRequestsBlocked += 1;
            report.browser.unsafeRequestCategories[classifyUnsafeRequestPath(requestUrl.pathname)] += 1;
            return route.abort();
          }
          if (requestClass === "ATTRIBUTION_RESET") {
            // This page-mount request clears cookies and touches the rate limiter.
            // Fulfill it inside Chromium; no staging write is needed for this journey.
            report.browser.safeAttributionResets += 1;
            return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
          }
          return route.continue();
        });
        // WebSocket handshakes use a separate Playwright interception path.
        await context.routeWebSocket("**/*", (webSocket) => {
          report.browser.webSocketsBlocked += 1;
          return webSocket.close();
        });
        // Recheck immediately before each credential-bearing request, including mobile.
        if (!await verifyAlias(env)) {
          report.aliasBinding = "DRIFT";
          report.reason = "ALIAS_NOT_VERIFIED";
          return report;
        }
        const session = await context.request.post(`${origin}/api/admin/ops/payuni/wp4-session`, {
          headers: {
            Authorization: `Bearer ${env.JOB_SECRET}`,
            "x-celebratedeal-source-sha": env.CELEBRATEDEAL_SOURCE_SHA,
          },
          maxRedirects: 0,
          timeout: 15_000,
          failOnStatusCode: false,
        });
        report.session = classifySessionStatus(session.status());
        await session.dispose();
        if (report.session !== "ISSUED") {
          report.reason = "SESSION_NOT_ISSUED";
          return report;
        }
        report.sideEffects.syntheticSessionCreated += 1;
        sessionIssued = true;
        const page = await context.newPage();
        page.on("pageerror", () => { report.browser.pageErrors += 1; });
        page.on("response", (response) => {
          if (new URL(response.url()).hostname === STAGING_ALIAS && response.status() >= 500) report.browser.sameHost5xx += 1;
          if (isCriticalResourceFailure(response)) report.browser.criticalResourceFailures += 1;
        });
        page.on("requestfailed", (request) => {
          if (isFailedCriticalResourceRequest(request)) report.browser.criticalResourceFailures += 1;
        });
        for (const route of ROUTES) {
          const response = await page.goto(`${origin}${route.path}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
          const status = response?.status() ?? 0;
          const headingVisible = await visible(page.getByRole("heading", { name: route.heading, exact: true }));
          const productVisible = route.id === "products" || route.id === "product_preview"
            ? await visible(page.getByText("WP4 Synthetic Sandbox Product", { exact: true }))
            : true;
          const checkoutLinkVisible = route.id === "product_preview"
            ? await visible(page.locator(`a[href="/checkout/wp4_synthetic_vendor_v1/${PRODUCT_ID}"]`))
            : true;
          const dashboardDataVisible = route.id === "dashboard"
            ? await visible(page.locator('[data-dashboard-scope="kpis"]'))
              && await visible(page.locator('[data-dashboard-scope="details"]'))
              && await page.getByRole("alert").count() === 0
            : true;
          const appNavigationVisible = await visible(page.locator(appNavigationSelectorForViewport(viewport.id)));
          const contentVisible = await visible(page.locator("#main-content"));
          const finalPath = classifyFinalPath(page.url(), route.path);
          report.journeys.push({ viewport: viewport.id, route: route.id, status, finalPath, headingVisible, productVisible, checkoutLinkVisible, dashboardDataVisible, appNavigationVisible, contentVisible });
          if (route.id === "product_edit") {
            // React state alone reveals this fieldset; do not submit or persist the form.
            await page.getByLabel("交付方式").selectOption("digital", { timeout: 8_000 });
            const deliverySettings = page.getByRole("group", { name: "付款後交付設定" });
            await deliverySettings.waitFor({ state: "visible", timeout: 8_000 });
            await page.getByLabel("交付方式").selectOption("physical", { timeout: 8_000 });
            await deliverySettings.waitFor({ state: "hidden", timeout: 8_000 });
            report.browser.hydrationInteractionsPassed += 1;
          }
        }
        // This read-only navigation must work through the rendered app shell.
        await page.locator(`${appNavigationSelectorForViewport(viewport.id)} a[href="/products"]`).click({ timeout: 8_000 });
        await page.waitForURL(`${origin}/products`, { timeout: 8_000 });
        const navigationPassed = classifyFinalPath(page.url(), "/products") === "EXPECTED"
          && await visible(page.getByRole("heading", { name: "商品管理", exact: true }));
        if (navigationPassed) report.browser.navigationInteractionsPassed += 1;
      } finally {
        if (sessionIssued) {
          try {
            if (!await verifyAlias(env)) throw new Error("alias drift before session cleanup");
            const cleanup = await context.request.delete(`${origin}/api/admin/ops/payuni/wp4-session`, {
              headers: {
                Authorization: `Bearer ${env.JOB_SECRET}`,
                "x-celebratedeal-source-sha": env.CELEBRATEDEAL_SOURCE_SHA,
              },
              maxRedirects: 0,
              timeout: 15_000,
              failOnStatusCode: false,
            });
            if (cleanup.status() === 204) report.sideEffects.syntheticSessionRevoked += 1;
            else cleanupFailed = true;
            await cleanup.dispose();
          } catch { cleanupFailed = true; }
        }
        await context.close();
      }
      if (cleanupFailed) {
        report.result = "BLOCKED";
        report.reason = "SESSION_CLEANUP_FAILED";
        return report;
      }
    }
    const routesPass = report.journeys.length === ROUTES.length * 2
      && report.journeys.every((item) => item.status === 200 && item.finalPath === "EXPECTED"
        && item.headingVisible && item.productVisible && item.checkoutLinkVisible && item.dashboardDataVisible
        && item.appNavigationVisible && item.contentVisible);
    report.result = routesPass && report.browser.pageErrors === 0 && report.browser.sameHost5xx === 0
      && report.browser.criticalResourceFailures === 0 && report.browser.navigationInteractionsPassed === 2
      && report.browser.hydrationInteractionsPassed === 2
      && report.browser.unsafeRequestsBlocked === 0 && report.browser.webSocketsBlocked === 0
      && report.sideEffects.syntheticSessionCreated === report.sideEffects.syntheticSessionRevoked ? "PASS" : "BLOCKED";
    report.reason = report.result === "PASS" ? "NONE" : "BROWSER_JOURNEY_FAILED";
  } catch {
    report.reason = "BROWSER_EXECUTION_FAILED";
  } finally {
    await browser.close();
  }
  if (cleanupFailed) { report.result = "BLOCKED"; report.reason = "SESSION_CLEANUP_FAILED"; }
  return report;
}

async function main() {
  if (process.argv[2] === "--verify-alias") {
    const reason = await diagnoseStagingAliasBinding(process.env);
    process.stdout.write(`${JSON.stringify({ aliasBinding: reason === "VERIFIED" ? "VERIFIED" : "NOT_VERIFIED", reason })}\n`);
    if (reason !== "VERIFIED" && process.env.RUNNER_TEMP) {
      const report = emptyReport(reason, process.env.CELEBRATEDEAL_SOURCE_SHA);
      await writeFile(`${process.env.RUNNER_TEMP}/celebratedeal-staging-browser-smoke.json`, `${JSON.stringify(report)}\n`, { mode: 0o600 });
    }
    process.exitCode = reason === "VERIFIED" ? 0 : 2;
    return;
  }
  const report = await runBrowserSmoke();
  const serialized = `${JSON.stringify(report)}\n`;
  if (process.env.RUNNER_TEMP) {
    await writeFile(`${process.env.RUNNER_TEMP}/celebratedeal-staging-browser-smoke.json`, serialized, { mode: 0o600 });
  }
  process.stdout.write(serialized);
  process.exitCode = report.result === "PASS" ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stdout.write(`${JSON.stringify(emptyReport("BROWSER_EXECUTION_FAILED"))}\n`);
    process.exitCode = 2;
  });
}
