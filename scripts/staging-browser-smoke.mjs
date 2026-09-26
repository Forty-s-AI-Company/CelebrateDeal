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
      criticalResourceFailureCategories: { http4xxScript: 0, http4xxStylesheet: 0, http5xxScript: 0, http5xxStylesheet: 0, abortedScript: 0, abortedStylesheet: 0, networkScript: 0, networkStylesheet: 0 },
      firstCriticalResourceFailure: null,
      firstCriticalResourceFailureKind: null,
      navigationFailure: null,
      hydrationInteractionsPassed: 0,
      externalRequestsBlocked: 0, unsafeRequestsBlocked: 0,
      safeAttributionResets: 0,
      observabilitySuppressed: { sentryTunnel: 0, cspReportApi: 0 },
      unsafeRequestCategories: { next: 0, api: 0, page: 0, other: 0 }, webSocketsBlocked: 0,
      unsafeRequestDetails: { vercelTelemetry: 0, sentryTunnel: 0, cspReportApi: 0, analyticsApi: 0, authApi: 0, otherApi: 0, other: 0 },
      executionPhase: "NOT_STARTED", failureCategory: "NONE",
      activeViewport: "NONE", activeRoute: "NONE",
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

/** Emit only a fixed category; the failing resource URL and network error stay private. */
export function classifyCriticalResourceResponse(response) {
  try {
    const url = new URL(response.url());
    const type = response.request().resourceType();
    if (url.hostname !== STAGING_ALIAS || response.status() < 400 || !["script", "stylesheet"].includes(type)) return null;
    return `http${response.status() < 500 ? "4xx" : "5xx"}${type === "script" ? "Script" : "Stylesheet"}`;
  } catch { return null; }
}

export function classifyCriticalResourceRequestFailure(request) {
  try {
    const type = request.resourceType();
    if (new URL(request.url()).hostname !== STAGING_ALIAS || !["script", "stylesheet"].includes(type)) return null;
    const aborted = classifyCriticalResourceFailureKind(request) === "ABORTED";
    return `${aborted ? "aborted" : "network"}${type === "script" ? "Script" : "Stylesheet"}`;
  } catch { return null; }
}

/** Playwright returns { errorText }; persist only a fixed network-error class. */
export function classifyCriticalResourceFailureKind(request) {
  const failure = request.failure?.();
  const errorText = typeof failure === "string" ? failure : failure?.errorText;
  if (typeof errorText !== "string") return "UNKNOWN";
  if (errorText.includes("net::ERR_ABORTED")) return "ABORTED";
  if (errorText.includes("net::ERR_TIMED_OUT")) return "TIMEOUT";
  if (errorText.includes("net::ERR_CONNECTION_RESET")) return "CONNECTION_RESET";
  if (errorText.includes("net::ERR_NAME_NOT_RESOLVED")) return "DNS";
  return "OTHER_NETWORK";
}

/** A failed same-host JavaScript or stylesheet request invalidates SSR-only success. */
export function isCriticalResourceFailure(response) {
  return classifyCriticalResourceResponse(response) !== null;
}

export function isFailedCriticalResourceRequest(request) {
  return classifyCriticalResourceRequestFailure(request) !== null;
}

/** Permit only known same-host browser telemetry and the mount-time attribution reset as local no-ops. */
export function classifyBrowserRequest(request) {
  let url;
  try { url = new URL(request.url()); } catch { return "EXTERNAL"; }
  if (url.protocol !== "https:" || url.hostname !== STAGING_ALIAS) return "EXTERNAL";
  if (["GET", "HEAD"].includes(request.method())) return "READ";
  if (request.method() === "POST" && url.pathname === "/monitoring") return "SENTRY_TUNNEL";
  if (request.method() === "POST" && url.search === "" && url.pathname === "/api/security/csp-report") return "CSP_REPORT";
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

/** Record only fixed DOM milestones after a timed-out document navigation. */
async function capturePartialNavigation(page) {
  try {
    const snapshot = await Promise.race([
      page.evaluate(() => ({
        readyState: document.readyState,
        bodyPresent: Boolean(document.body),
        dashboardShellPresent: Boolean(document.querySelector('[data-dashboard-region="kpis"]')),
        kpisReady: Boolean(document.querySelector('[data-dashboard-scope="kpis"]')),
        detailsReady: Boolean(document.querySelector('[data-dashboard-scope="details"]')),
      })),
      new Promise((resolve) => setTimeout(() => resolve(null), 1_000)),
    ]);
    if (!snapshot) return null;
    return {
      readyState: ["loading", "interactive", "complete"].includes(snapshot.readyState) ? snapshot.readyState : "OTHER",
      bodyPresent: snapshot.bodyPresent === true,
      dashboardShellPresent: snapshot.dashboardShellPresent === true,
      kpisReady: snapshot.kpisReady === true,
      detailsReady: snapshot.detailsReady === true,
    };
  } catch { return null; }
}

/** Group blocked requests without logging paths, bodies, headers, or cookies. */
export function classifyUnsafeRequestPath(pathname) {
  if (pathname.startsWith("/_next/")) return "next";
  if (pathname.startsWith("/api/")) return "api";
  if (pathname === "/" || ROUTES.some((route) => pathname === route.path)) return "page";
  return "other";
}

/** Only fixed route families are reported; never serialize a request URL. */
export function classifyUnsafeRequestDetail(pathname) {
  if (/^\/_+vercel\//u.test(pathname)) return "vercelTelemetry";
  if (pathname === "/monitoring") return "sentryTunnel";
  if (pathname === "/api/security/csp-report") return "cspReportApi";
  if (pathname === "/api/analytics") return "analyticsApi";
  if (pathname.startsWith("/api/auth/")) return "authApi";
  if (pathname.startsWith("/api/")) return "otherApi";
  return "other";
}

function boundedDashboardReadCount(value, maxCount) {
  const count = Number(value);
  return value !== null && Number.isSafeInteger(count) && count >= 0 && count <= maxCount ? count : null;
}

/** Next's shadow-DOM route announcer is an accessibility alert, not a Dashboard error. */
export function hasActionableDashboardAlert(totalAlerts, frameworkAlerts) {
  if (!Number.isSafeInteger(totalAlerts) || !Number.isSafeInteger(frameworkAlerts)
    || totalAlerts < 0 || frameworkAlerts < 0 || frameworkAlerts > totalAlerts) return true;
  return totalAlerts > frameworkAlerts;
}

/** Keep browser errors in a fixed vocabulary; exception messages can contain URLs. */
export function classifyBrowserExecutionFailure(error) {
  if (!(error instanceof Error)) return "OTHER";
  if (error.name === "TimeoutError" || /Timeout .*exceeded/iu.test(error.message)) return "TIMEOUT";
  if (/net::ERR_ABORTED/iu.test(error.message)) return "NAVIGATION_ABORTED";
  if (/net::ERR_FAILED/iu.test(error.message)) return "NETWORK_FAILED";
  if (/TargetClosedError|Target page, context or browser has been closed/iu.test(error.message)) return "TARGET_CLOSED";
  return "OTHER";
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
      report.browser.activeViewport = viewport.id;
      report.browser.executionPhase = "CONTEXT_SETUP";
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
            report.browser.unsafeRequestDetails[classifyUnsafeRequestDetail(requestUrl.pathname)] += 1;
            return route.abort();
          }
          if (requestClass === "SENTRY_TUNNEL" || requestClass === "CSP_REPORT") {
            // Synthetic browser telemetry stays local; business writes remain blocked.
            const category = requestClass === "SENTRY_TUNNEL" ? "sentryTunnel" : "cspReportApi";
            report.browser.observabilitySuppressed[category] += 1;
            return route.fulfill({ status: 204 });
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
        report.browser.executionPhase = "SESSION_ISSUE";
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
        report.browser.executionPhase = "PAGE_OPEN";
        const page = await context.newPage();
        let navigationProgress = null;
        page.on("pageerror", () => { report.browser.pageErrors += 1; });
        // Record only fixed milestones; document URLs and browser errors may contain private data.
        page.on("request", (request) => {
          if (navigationProgress && request.resourceType() === "document"
            && new URL(request.url()).hostname === STAGING_ALIAS) navigationProgress.documentRequestSeen = true;
        });
        page.on("domcontentloaded", () => {
          if (navigationProgress) navigationProgress.domContentLoadedSeen = true;
        });
        const recordCriticalResourceFailure = (category) => {
          if (!category) return;
          report.browser.criticalResourceFailures += 1;
          report.browser.criticalResourceFailureCategories[category] += 1;
          report.browser.firstCriticalResourceFailure ??= {
            category, phase: report.browser.executionPhase,
            viewport: report.browser.activeViewport, route: report.browser.activeRoute,
          };
        };
        page.on("response", (response) => {
          if (new URL(response.url()).hostname === STAGING_ALIAS && response.status() >= 500) report.browser.sameHost5xx += 1;
          if (navigationProgress && response.request().resourceType() === "document"
            && new URL(response.url()).hostname === STAGING_ALIAS) {
            const status = response.status();
            navigationProgress.documentResponseClass = status >= 500 ? "5XX"
              : status >= 400 ? "4XX" : status >= 300 ? "3XX" : status >= 200 ? "2XX" : "OTHER";
          }
          recordCriticalResourceFailure(classifyCriticalResourceResponse(response));
        });
        page.on("requestfailed", (request) => {
          const category = classifyCriticalResourceRequestFailure(request);
          if (category && report.browser.firstCriticalResourceFailure === null) {
            report.browser.firstCriticalResourceFailureKind = classifyCriticalResourceFailureKind(request);
          }
          recordCriticalResourceFailure(category);
        });
        for (const route of ROUTES) {
          report.browser.activeRoute = route.id;
          report.browser.executionPhase = "PAGE_NAVIGATION";
          navigationProgress = { documentRequestSeen: false, documentResponseClass: "NONE", domContentLoadedSeen: false };
          let response;
          try {
            response = await page.goto(`${origin}${route.path}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
          } catch (error) {
            report.browser.navigationFailure = {
              viewport: viewport.id, route: route.id, ...navigationProgress,
              finalPath: classifyFinalPath(page.url(), route.path),
              partialDom: route.id === "dashboard" ? await capturePartialNavigation(page) : null,
            };
            throw error;
          } finally {
            navigationProgress = null;
          }
          report.browser.executionPhase = "PAGE_ASSERTIONS";
          const status = response?.status() ?? 0;
          const headingVisible = await visible(page.getByRole("heading", { name: route.heading, exact: true }));
          const productVisible = route.id === "products" || route.id === "product_preview"
            ? await visible(page.getByText("WP4 Synthetic Sandbox Product", { exact: true }))
            : true;
          const checkoutLinkVisible = route.id === "product_preview"
            ? await visible(page.locator(`a[href="/checkout/wp4_synthetic_vendor_v1/${PRODUCT_ID}"]`))
            : true;
          const dashboardKpisVisible = route.id === "dashboard"
            ? await visible(page.locator('[data-dashboard-scope="kpis"]')) : true;
          const dashboardDetailsVisible = route.id === "dashboard"
            ? await visible(page.locator('[data-dashboard-scope="details"]')) : true;
          const dashboardFrameworkAlertCount = route.id === "dashboard"
            ? await page.locator('next-route-announcer [role="alert"]').count() : 0;
          const dashboardAlertVisible = route.id === "dashboard"
            ? hasActionableDashboardAlert(await page.getByRole("alert").count(), dashboardFrameworkAlertCount) : false;
          const dashboardKpiAlertVisible = route.id === "dashboard" && dashboardKpisVisible
            ? await page.locator('[data-dashboard-scope="kpis"] [role="alert"]').count() > 0 : false;
          const dashboardDetailsAlertVisible = route.id === "dashboard" && dashboardDetailsVisible
            ? await page.locator('[data-dashboard-scope="details"] [role="alert"]').count() > 0 : false;
          const dashboardRouteErrorVisible = route.id === "dashboard"
            ? await page.getByRole("heading", { name: "營運資料暫時無法載入", exact: true }).count() > 0 : false;
          const dashboardMainAlertVisible = route.id === "dashboard"
            ? await page.locator('#main-content [role="alert"]').count() > 0 : false;
          const dashboardReadOperationCount = route.id === "dashboard" && dashboardKpisVisible
            ? boundedDashboardReadCount(await page.locator('[data-dashboard-scope="kpis"]').getAttribute("data-dashboard-read-operation-count"), 6)
            : null;
          const dashboardDetailsReadOperationCount = route.id === "dashboard" && dashboardDetailsVisible
            ? boundedDashboardReadCount(await page.locator('[data-dashboard-scope="details"]').getAttribute("data-dashboard-read-operation-count"), 13)
            : null;
          const dashboardDataVisible = dashboardKpisVisible && dashboardDetailsVisible && !dashboardAlertVisible;
          const appNavigationVisible = await visible(page.locator(appNavigationSelectorForViewport(viewport.id)));
          const contentVisible = await visible(page.locator("#main-content"));
          const finalPath = classifyFinalPath(page.url(), route.path);
          report.journeys.push({ viewport: viewport.id, route: route.id, status, finalPath, headingVisible, productVisible, checkoutLinkVisible, dashboardDataVisible, dashboardKpisVisible, dashboardDetailsVisible, dashboardAlertVisible, dashboardFrameworkAlertVisible: dashboardFrameworkAlertCount > 0, dashboardKpiAlertVisible, dashboardDetailsAlertVisible, dashboardRouteErrorVisible, dashboardMainAlertVisible, dashboardReadOperationCount, dashboardDetailsReadOperationCount, appNavigationVisible, contentVisible });
          if (route.id === "product_edit") {
            report.browser.executionPhase = "HYDRATION_INTERACTION";
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
        report.browser.executionPhase = "APP_NAVIGATION";
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
    report.browser.executionPhase = "COMPLETE";
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
  } catch (error) {
    report.reason = "BROWSER_EXECUTION_FAILED";
    report.browser.failureCategory = classifyBrowserExecutionFailure(error);
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
