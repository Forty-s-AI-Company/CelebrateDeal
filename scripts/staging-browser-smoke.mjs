import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// These values identify the already attested, immutable staging deployment.
const SOURCE_SHA = "9193326824b8b6bf774bdfa28e4783a1a1b8f304";
const PREVIEW_HOST = "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app";
const STAGING_ALIAS = "celebrate-deal-staging.carry-digital-nomad.in.net";
const PRODUCT_ID = "wp4_synthetic_product_v1";
const ROUTES = [
  { id: "dashboard", path: "/dashboard", heading: "Dashboard" },
  { id: "products", path: "/products", heading: "商品管理" },
  { id: "product_preview", path: `/products/${PRODUCT_ID}/preview`, heading: "商品預覽" },
  { id: "billing_plans", path: "/billing/plans", heading: "方案" },
];

function emptyReport(reason = "NOT_RUN") {
  return {
    schemaVersion: "celebratedeal-staging-browser-smoke/v1",
    sourceSha: SOURCE_SHA,
    result: "BLOCKED",
    reason,
    session: "NOT_RUN",
    journeys: [],
    browser: { pageErrors: 0, sameHost5xx: 0, externalRequestsBlocked: 0, unsafeRequestsBlocked: 0, webSocketsBlocked: 0 },
    sideEffects: { syntheticSessionCreated: 0, checkoutPosts: 0, paymentSubmissions: 0, uploads: 0, emails: 0 },
  };
}

export function validateBrowserSmokeBinding(env) {
  return env.CELEBRATEDEAL_SOURCE_SHA === SOURCE_SHA
    && env.CELEBRATEDEAL_DEPLOYMENT_HOST === PREVIEW_HOST
    && typeof env.JOB_SECRET === "string"
    && env.JOB_SECRET.length >= 16;
}

export function classifySessionStatus(status) {
  if (status === 204) return "ISSUED";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 404) return "FIXTURE_UNAVAILABLE";
  if (status === 503) return "SERVICE_UNAVAILABLE";
  return "HTTP_REJECTED";
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
  const report = emptyReport();
  if (!validateBrowserSmokeBinding(env)) {
    report.reason = "INVALID_BINDING";
    return report;
  }
  // Exercise the URL people actually open. The session endpoint checks the source SHA.
  const origin = `https://${STAGING_ALIAS}`;
  const { chromium } = dependencies.playwright ?? await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    env: browserEnvironment(),
    args: ["--no-proxy-server", "--disable-quic"],
  });
  try {
    for (const viewport of [{ id: "desktop", width: 1365, height: 768 }, { id: "mobile", width: 390, height: 844 }]) {
      const context = await browser.newContext({
        locale: "zh-TW",
        viewport: { width: viewport.width, height: viewport.height },
        serviceWorkers: "block",
      });
      try {
        // Block third-party traffic while the synthetic owner is signed in.
        await context.route("**/*", (route) => {
          let requestUrl;
          try {
            requestUrl = new URL(route.request().url());
          } catch {
            report.browser.externalRequestsBlocked += 1;
            return route.abort();
          }
          if (requestUrl.protocol !== "https:" || requestUrl.hostname !== STAGING_ALIAS) {
            report.browser.externalRequestsBlocked += 1;
            return route.abort();
          }
          if (!["GET", "HEAD"].includes(route.request().method())) {
            report.browser.unsafeRequestsBlocked += 1;
            return route.abort();
          }
          return route.continue();
        });
        // WebSocket handshakes use a separate Playwright interception path.
        await context.routeWebSocket("**/*", (webSocket) => {
          report.browser.webSocketsBlocked += 1;
          return webSocket.close();
        });
        const session = await context.request.post(`${origin}/api/admin/ops/payuni/wp4-session`, {
          headers: {
            Authorization: `Bearer ${env.JOB_SECRET}`,
            "x-celebratedeal-source-sha": SOURCE_SHA,
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
        const page = await context.newPage();
        page.on("pageerror", () => { report.browser.pageErrors += 1; });
        page.on("response", (response) => {
          if (new URL(response.url()).hostname === STAGING_ALIAS && response.status() >= 500) report.browser.sameHost5xx += 1;
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
          report.journeys.push({ viewport: viewport.id, route: route.id, status, headingVisible, productVisible, checkoutLinkVisible, dashboardDataVisible });
        }
      } finally {
        await context.close();
      }
    }
    const routesPass = report.journeys.length === ROUTES.length * 2
      && report.journeys.every((item) => item.status === 200 && item.headingVisible && item.productVisible && item.checkoutLinkVisible && item.dashboardDataVisible);
    report.result = routesPass && report.browser.pageErrors === 0 && report.browser.sameHost5xx === 0
      && report.browser.unsafeRequestsBlocked === 0 && report.browser.webSocketsBlocked === 0 ? "PASS" : "BLOCKED";
    report.reason = report.result === "PASS" ? "NONE" : "BROWSER_JOURNEY_FAILED";
  } catch {
    report.reason = "BROWSER_EXECUTION_FAILED";
  } finally {
    await browser.close();
  }
  return report;
}

async function main() {
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
