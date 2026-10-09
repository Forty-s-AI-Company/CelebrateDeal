import { defaultRequest, defaultBrowserSubmit, fixedBrowserEnvironment, runMvpPayUniPaymentOnly, validateInvocation, validatePaymentOnlyReceipt, readFixedInputs, verifyMvpPayUniLineage } from "./mvp-payuni-sandbox-e2e.mjs";
import { createPendingRefundHandoff, writePaymentHandoff } from "./payuni-sandbox-payment-handoff.mjs";
import { assertProofMatchesHandoff, consumePendingRefund } from "./payuni-sandbox-pending-refund-consumer.mjs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const APP_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const APP_ORIGIN = `https://${APP_HOST}`;
const PAYMENT_PATHS = new Set([
  "/api/admin/ops/payuni/wp4-fixture",
  "/api/payments/checkout/admission",
  "/api/payments/checkout",
  "/api/admin/ops/payuni/wp4-payment-attempt",
  "/api/admin/ops/payuni/wp4-buyer-order-proof",
  "/api/webhooks/payments",
]);

function requireSafe(condition) {
  // Never include raw responses, identifiers, credentials or browser errors.
  if (!condition) throw new Error("Current-source Sandbox refund QA rejected.");
}

/** Connect the existing fixed synthetic payment runner to the exact refund UI.
 * The immutable Preview identifies the source; application requests use only
 * the existing canonical staging origin. Its server checks the source, project,
 * database and synthetic tenant before fixture/payment writes. Identifiers and
 * session cookies stay in memory; only the sanitized completion is returned.
 */
export async function runCurrentSourceRefundQa({ input, context, loadProof, queryProvider }, dependencies = {}) {
  const invocation = validateInvocation(input);
  requireSafe(invocation.ok && context && typeof loadProof === "function" && typeof queryProvider === "function");
  const request = dependencies.request ?? defaultRequest;
  const browserSubmit = dependencies.browserSubmit ?? defaultBrowserSubmit;
  const runPayment = dependencies.runPayment ?? runMvpPayUniPaymentOnly;
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let exactCheckout;

  const payment = await runPayment(input, {
    request: async (operation) => {
      const original = new URL(operation.url);
      requireSafe(original.origin === `https://${invocation.previewHost}` && PAYMENT_PATHS.has(original.pathname)
        && (original.search === "" || (original.pathname === "/api/webhooks/payments"
          && original.search === "?provider=payuni&source=notify")));
      const headers = { ...operation.headers };
      if (headers.origin !== undefined) {
        requireSafe(headers.origin === original.origin);
        headers.origin = APP_ORIGIN;
      }
      const result = await request({ ...operation, url: `${APP_ORIGIN}${original.pathname}${original.search}`, headers });
      if (original.pathname === "/api/payments/checkout") {
        requireSafe(exactCheckout === undefined);
        exactCheckout = result?.body;
      }
      return result;
    },
    browserSubmit: (operation) => {
      requireSafe(operation.previewHost === invocation.previewHost);
      return browserSubmit({ ...operation, previewHost: APP_HOST });
    },
  });
  requireSafe(validatePaymentOnlyReceipt(payment).ok && payment?.result === "PASS" && payment.sourceSha === invocation.sourceSha
    && payment.checks?.returnCallbackMapped === true && payment.checks?.duplicateCallbackVerified === true);
  requireSafe(typeof exactCheckout?.transactionId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(exactCheckout.transactionId)
    && typeof exactCheckout.orderNumber === "string" && exactCheckout.orderNumber.length > 0
    && Number.isSafeInteger(exactCheckout.amountCents) && exactCheckout.amountCents > 0
    && exactCheckout.amountCents % 100 === 0);

  const paid = await queryProvider(exactCheckout.orderNumber);
  requireSafe(paid?.MerTradeNo === exactCheckout.orderNumber && typeof paid.TradeNo === "string" && paid.TradeNo.length > 0);
  const receipt = createPendingRefundHandoff({ startedAt, completedAt: now().toISOString(), appUrl: APP_ORIGIN,
    checkout: { ...exactCheckout, amount: exactCheckout.amountCents / 100 }, paid });
  const proof = await loadProof(exactCheckout.transactionId, invocation.sourceSha);
  assertProofMatchesHandoff(receipt, proof, exactCheckout.transactionId, invocation.sourceSha, now());
  requireSafe(proof.status === "paid" && proof.refundRecordCount === 0 && proof.refundedAmountCents === 0);
  if (dependencies.writeHandoff) await dependencies.writeHandoff({ ...receipt, sourceCommit: invocation.sourceSha });

  // No catch-and-retry checkout, direct provider refund or alternate selection.
  return consumePendingRefund({ receipt, transactionId: exactCheckout.transactionId, expectedSourceSha: invocation.sourceSha,
    context, loadProof, queryProvider: () => queryProvider(exactCheckout.orderNumber), now,
    ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}) });
}

/** Credentials remain in Node; Chromium receives only static OS necessities. */
export function launchRefundBrowser(chromium) {
  return chromium.launch({ headless: true, env: fixedBrowserEnvironment() });
}

/** Protected CI entry point: process injection only; no dotenv or raw logs. */
export async function executeCurrentSourceRefundQa() {
  let browser;
  let stage = "configuration";
  try {
    requireSafe(process.argv.length === 2 && process.env.GITHUB_ACTIONS === "true"
      && process.env.PAYUNI_ENV === "sandbox" && process.env.PAYUNI_SANDBOX_QA_ENABLED === "true"
      && process.env.PAYUNI_SANDBOX_REFUND_ENABLED === "true");
    for (const name of ["JOB_SECRET", "PAYUNI_SANDBOX_MERCHANT_ID", "PAYUNI_SANDBOX_HASH_KEY", "PAYUNI_SANDBOX_HASH_IV",
      "PAYUNI_QA_FINANCE_EMAIL", "PAYUNI_QA_FINANCE_PASSWORD"]) requireSafe(Boolean(process.env[name]?.trim()));
    const input = readFixedInputs();
    requireSafe(validateInvocation(input).ok);
    stage = "deployment-lineage";
    requireSafe(await verifyMvpPayUniLineage({ CELEBRATEDEAL_SOURCE_SHA: input.sourceSha,
      CELEBRATEDEAL_DEPLOYMENT_HOST: input.previewHost, GITHUB_TOKEN: process.env.GITHUB_TOKEN }));
    // The mutable canonical alias must independently prove the same runtime
    // identity before finance credentials are entered or a payment is created.
    stage = "canonical-runtime-preflight";
    const preflight = await fetch(`${APP_ORIGIN}/api/admin/ops/payuni/wp4-preflight`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${input.jobSecret}`, "x-celebratedeal-source-sha": input.sourceSha },
    });
    requireSafe(preflight.status === 200);
    const readiness = await preflight.json();
    requireSafe(readiness.ready === true && readiness.buyerOrder === true);
    const { chromium } = await import("@playwright/test");
    const { queryTransaction } = await import("./payuni-sandbox-external-qa.mjs");
    browser = await launchRefundBrowser(chromium);
    const context = await browser.newContext({ locale: "zh-TW" });
    context.setDefaultTimeout(15000);
    stage = "platform-login";
    const page = await context.newPage();
    await page.goto(`${APP_ORIGIN}/login?next=/admin/billing/dashboard`);
    requireSafe(new URL(page.url()).origin === APP_ORIGIN);
    await page.locator('input[name="email"]').fill(process.env.PAYUNI_QA_FINANCE_EMAIL);
    await page.locator('input[name="password"]').fill(process.env.PAYUNI_QA_FINANCE_PASSWORD);
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await page.waitForURL((url) => url.origin === APP_ORIGIN && url.pathname !== "/login");
    if (new URL(page.url()).pathname === "/mfa/verify") {
      stage = "platform-mfa";
      requireSafe(/^\d{6}$/.test(process.env.PAYUNI_QA_FINANCE_OTP ?? ""));
      await page.locator('input[name="code"]').fill(process.env.PAYUNI_QA_FINANCE_OTP);
      await page.getByRole("button", { name: "確認並繼續", exact: true }).click();
      await page.waitForURL((url) => url.origin === APP_ORIGIN && !url.pathname.startsWith("/mfa/"));
    }
    requireSafe(new URL(page.url()).pathname === "/admin/billing/dashboard");
    await page.close();
    const loadProof = async (transactionId, sourceSha) => {
      const url = new URL("/api/admin/ops/payuni/pending-refund-proof", APP_ORIGIN);
      url.searchParams.set("transactionId", transactionId);
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { authorization: `Bearer ${input.jobSecret}`, "x-celebratedeal-source-sha": sourceSha } });
      requireSafe(response.status === 200 && response.headers.get("content-type")?.includes("application/json"));
      const body = await response.text();
      requireSafe(body.length <= 16384);
      return JSON.parse(body);
    };
    stage = "exact-payment-and-refund";
    const receipt = await runCurrentSourceRefundQa({ input, context, loadProof,
      queryProvider: (orderNumber) => queryTransaction(orderNumber, { signal: AbortSignal.timeout(10000) }) },
    { writeHandoff: writePaymentHandoff });
    console.log(JSON.stringify(receipt));
  } catch {
    console.log(JSON.stringify({ schemaVersion: "celebratedeal-current-source-refund-qa/v1", status: "BLOCKED_OR_FAILED", stage,
      productionOperations: false, alternateTransactionSelected: false }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await executeCurrentSourceRefundQa();
