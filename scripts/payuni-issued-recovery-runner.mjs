import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { defaultRequest, readFixedInputs, validateInvocation, verifyMvpPayUniLineage, prepareIssuedRecoveryCheckout, fixedBrowserEnvironment } from "./mvp-payuni-sandbox-e2e.mjs";
import { observeIssuedRecoveryBrowser } from "./payuni-issued-recovery-browser.mjs";
import { createPendingRefundHandoff, writePaymentHandoff } from "./payuni-sandbox-payment-handoff.mjs";
import { assertProofMatchesHandoff, consumePendingRefund } from "./payuni-sandbox-pending-refund-consumer.mjs";

const APP = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const PATHS = new Set(["/api/admin/ops/payuni/wp4-fixture", "/api/payments/checkout/admission",
  "/api/payments/checkout", "/api/admin/ops/payuni/wp4-payment-attempt"]);
function requireSafe(condition) {
  if (!condition) throw new Error("PAYUNI_ISSUED_RECOVERY_RUNNER_REJECTED");
}

/** One fixed synthetic checkout; exact source and Sandbox server preflight
 * precede all fixture/provider writes. No latest order or recovery fallback.
 */
export async function runIssuedRecoveryProbe(input, dependencies) {
  const invocation = validateInvocation(input);
  requireSafe(invocation.ok && dependencies && typeof dependencies.queryProvider === "function");
  const request = dependencies.request ?? defaultRequest;
  const preflight = await request({ url: `${APP}/api/admin/ops/payuni/wp4-preflight`, body: undefined,
    headers: { authorization: `Bearer ${invocation.jobSecret}`, "x-celebratedeal-source-sha": invocation.sourceSha } });
  requireSafe(preflight?.status === 200 && preflight.body?.ready === true && preflight.body?.buyerOrder === true);
  const prepared = await prepareIssuedRecoveryCheckout(input, {
    request: operation => {
      const url = new URL(operation.url);
      requireSafe(url.origin === `https://${invocation.previewHost}` && PATHS.has(url.pathname) && url.search === "");
      const headers = { ...operation.headers };
      if (headers.origin !== undefined) {
        requireSafe(headers.origin === url.origin);
        headers.origin = APP;
      }
      return request({ ...operation, url: `${APP}${url.pathname}`, headers });
    },
  });
  if (dependencies.onPrepared) await dependencies.onPrepared(prepared);
  const observe = dependencies.observeBrowser ?? observeIssuedRecoveryBrowser;
  return observe({ prepared: { ...prepared, canonicalStagingOrigin: true }, queryProvider: dependencies.queryProvider });
}

/** Paid observations must be handed to the existing exact refund UI. Finance
 * session readiness is checked before checkout; no provider refund fallback.
 */
export async function runIssuedRecoveryQa(input, dependencies) {
  requireSafe(validateInvocation(input).ok && dependencies?.context
    && typeof dependencies.verifyFinanceSession === "function" && typeof dependencies.loadProof === "function");
  requireSafe(await dependencies.verifyFinanceSession() === true);
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let prepared;
  const observation = await runIssuedRecoveryProbe(input, {
    ...dependencies, onPrepared: value => { requireSafe(prepared === undefined); prepared = value; },
  });
  if (observation.result !== "SAME_TRADE_PAYMENT_OBSERVED") return { observation, refundCleanupVerified: false };
  requireSafe(observation.sameTrade === true && observation.paid === true && prepared);
  const checkout = prepared.checkout;
  requireSafe(/^[A-Za-z0-9_-]{1,128}$/.test(checkout.transactionId ?? "")
    && Number.isSafeInteger(checkout.amountCents) && checkout.amountCents > 0 && checkout.amountCents % 100 === 0);
  const paid = await dependencies.queryProvider(checkout.orderNumber);
  requireSafe(paid?.MerTradeNo === checkout.orderNumber && String(paid.PaymentType) === "1"
    && /^[A-Za-z0-9_-]{1,128}$/.test(paid.TradeNo ?? ""));
  const receipt = createPendingRefundHandoff({ startedAt, completedAt: now().toISOString(), appUrl: APP,
    checkout: { ...checkout, amount: checkout.amountCents / 100 }, paid });
  // Match the provider identity from the observed original trade, not just the
  // order. A replacement trade can never be selected for refund acceptance.
  const { createHash } = await import("node:crypto");
  requireSafe(observation.tradeRef === `sha256:${createHash("sha256").update(String(paid.TradeNo)).digest("hex")}`);
  const proof = await dependencies.loadProof(checkout.transactionId, input.sourceSha);
  assertProofMatchesHandoff(receipt, proof, checkout.transactionId, input.sourceSha, now());
  requireSafe(proof.status === "paid" && proof.refundRecordCount === 0 && proof.refundedAmountCents === 0);
  await (dependencies.writeHandoff ?? writePaymentHandoff)({ ...receipt, sourceCommit: input.sourceSha });
  const cleanup = await (dependencies.consumeRefund ?? consumePendingRefund)({ receipt,
    transactionId: checkout.transactionId, expectedSourceSha: input.sourceSha, context: dependencies.context,
    loadProof: dependencies.loadProof, queryProvider: () => dependencies.queryProvider(checkout.orderNumber), now });
  requireSafe(cleanup?.status === "COMPLETED" && cleanup.transactionRef === receipt.transactionRef
    && cleanup.tradeRef === receipt.tradeRef && cleanup.sourceCommit === input.sourceSha);
  for (const check of ["sandboxRefundAccepted", "refundVisibleInProviderQuery", "refundIdempotency",
    "paymentTransactionRefunded", "refundRecordProcessed", "singleRefundRecord"])
    requireSafe(cleanup.checks?.[check] === "passed");
  return { observation, cleanup, refundCleanupVerified: true };
}

export async function executeIssuedRecoveryProbe() {
  let stage = "configuration";
  let browser;
  try {
    requireSafe(process.argv.length === 2 && process.env.GITHUB_ACTIONS === "true"
      && process.env.GITHUB_REF === "refs/heads/master" && process.env.GITHUB_REF_PROTECTED === "true"
      && process.env.PAYUNI_ENV === "sandbox" && process.env.PAYUNI_SANDBOX_QA_ENABLED === "true"
      && process.env.PAYUNI_SANDBOX_REFUND_ENABLED === "true"
      && process.env.PAYUNI_QA_FINANCE_EMAIL === "q1-synthetic-finance-v1@invalid.example");
    for (const name of ["JOB_SECRET", "PAYUNI_SANDBOX_MERCHANT_ID", "PAYUNI_SANDBOX_HASH_KEY", "PAYUNI_SANDBOX_HASH_IV", "PAYUNI_QA_FINANCE_PASSWORD"])
      requireSafe(Boolean(process.env[name]?.trim()));
    const input = readFixedInputs();
    requireSafe(validateInvocation(input).ok);
    stage = "deployment-lineage";
    requireSafe(await verifyMvpPayUniLineage({ CELEBRATEDEAL_SOURCE_SHA: input.sourceSha,
      CELEBRATEDEAL_DEPLOYMENT_HOST: input.previewHost, GITHUB_TOKEN: process.env.GITHUB_TOKEN }));
    stage = "canonical-runtime-preflight";
    const readiness = await defaultRequest({ url: `${APP}/api/admin/ops/payuni/wp4-preflight`, body: undefined,
      headers: { authorization: `Bearer ${input.jobSecret}`, "x-celebratedeal-source-sha": input.sourceSha } });
    requireSafe(readiness?.status === 200 && readiness.body?.ready === true && readiness.body?.buyerOrder === true);
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ headless: true, env: fixedBrowserEnvironment() });
    const context = await browser.newContext({ locale: "zh-TW" });
    context.setDefaultTimeout(15000);
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      return url.origin === APP ? route.continue() : route.abort();
    });
    stage = "fixed-synthetic-finance-login";
    const page = await context.newPage();
    await page.goto(`${APP}/login?next=/admin/billing/dashboard`);
    requireSafe(new URL(page.url()).origin === APP);
    await page.locator('input[name="email"]').fill(process.env.PAYUNI_QA_FINANCE_EMAIL);
    await page.locator('input[name="password"]').fill(process.env.PAYUNI_QA_FINANCE_PASSWORD);
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await page.waitForURL(url => url.origin === APP && url.pathname !== "/login");
    if (new URL(page.url()).pathname === "/mfa/verify") {
      requireSafe(/^\d{6}$/.test(process.env.PAYUNI_QA_FINANCE_OTP ?? ""));
      await page.locator('input[name="code"]').fill(process.env.PAYUNI_QA_FINANCE_OTP);
      await page.getByRole("button", { name: "確認並繼續", exact: true }).click();
      await page.waitForURL(url => url.origin === APP && !url.pathname.startsWith("/mfa/"));
    }
    requireSafe(new URL(page.url()).pathname === "/admin/billing/dashboard");
    await page.close();
    const loadProof = async (transactionId, sourceSha) => {
      const url = new URL("/api/admin/ops/payuni/pending-refund-proof", APP);
      url.searchParams.set("transactionId", transactionId);
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { authorization: `Bearer ${input.jobSecret}`, "x-celebratedeal-source-sha": sourceSha } });
      requireSafe(response.status === 200 && response.headers.get("content-type")?.includes("application/json"));
      const body = await response.text();
      requireSafe(body.length <= 16384);
      return JSON.parse(body);
    };
    const { queryTransaction } = await import("./payuni-sandbox-external-qa.mjs");
    stage = "sandbox-failure-original-retry";
    const receipt = await runIssuedRecoveryQa(input, { context, loadProof,
      verifyFinanceSession: async () => {
        const check = await context.newPage();
        try { await check.goto(`${APP}/admin/billing/dashboard`); return check.url() === `${APP}/admin/billing/dashboard`; }
        finally { await check.close(); }
      }, queryProvider: order => queryTransaction(order, { signal: AbortSignal.timeout(10000) }) });
    console.log(JSON.stringify({ ...receipt, acceptanceScope: "provider_original_trade_observation_only",
      applicationRecoveryAccepted: false }));
    // A provider observation alone never marks commerce acceptance READY.
    if (receipt.observation.result !== "SAME_TRADE_PAYMENT_OBSERVED" || receipt.refundCleanupVerified !== true) process.exitCode = 2;
  } catch {
    console.log(JSON.stringify({ schemaVersion: "celebratedeal-payuni-issued-recovery-observation/v1",
      status: "BLOCKED_OR_FAILED", stage, productionOperations: false, applicationRecoveryAccepted: false }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await executeIssuedRecoveryProbe();
