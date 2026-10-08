import { SCHEMA_VERSION, reference } from "./payuni-sandbox-payment-handoff.mjs";
import { isCompletedFullCreditRefund } from "./payuni-credit-refund-query-contract.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STAGING_ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const PROVIDER_HOST = "sandbox-api.payuni.com.tw";

function requireCondition(condition) {
  if (!condition) throw new Error("Pending refund acceptance failed; no alternate transaction may be selected.");
}

/** Verify authenticated server evidence, keeping raw identifiers out of receipts. */
function assertProofMatchesHandoff(receipt, proof, transactionId, expectedSourceSha, now = new Date()) {
  requireCondition(receipt?.schemaVersion === SCHEMA_VERSION && receipt.status === "PENDING_REFUND"
    && receipt.environment === "sandbox" && receipt.appHost === new URL(STAGING_ORIGIN).hostname
    && receipt.providerHost === PROVIDER_HOST);
  requireCondition(/^[a-f0-9]{40}$/.test(expectedSourceSha ?? "")
    && proof?.schemaVersion === "celebratedeal-payuni-pending-refund-proof/v1"
    && proof.environment === "preview" && proof.payuniEnvironment === "sandbox"
    && proof.appHost === receipt.appHost && proof.providerHost === PROVIDER_HOST
    && proof.sourceCommit === expectedSourceSha && proof.paymentCallbackMatched === true
    && proof.databaseBound === true && proof.nonProductionScope === "fixed-staging-project");
  const completed = new Date(receipt.completedAt).getTime();
  const started = new Date(receipt.startedAt).getTime();
  requireCondition(Number.isFinite(completed) && Number.isFinite(started) && started <= completed
    && completed <= now.getTime() && now.getTime() - completed <= 86400000);
  requireCondition(Number.isSafeInteger(receipt.amount) && receipt.amount > 0
    && Number.isSafeInteger(receipt.amount * 100) && proof.grossAmountCents === receipt.amount * 100);
  for (const key of ["transactionRef", "orderRef", "tradeRef"]) {
    requireCondition(/^[a-f0-9]{12}$/.test(receipt[key] ?? "") && proof[key] === receipt[key]);
  }
  requireCondition(reference(transactionId) === receipt.transactionRef);
  for (const key of ["browserCheckout", "paymentCallbackMatched", "providerReconciliation"]) {
    requireCondition(receipt.checks?.[key] === "passed");
  }
}

async function fillExactRefundForm(page, transactionId, amount) {
  await page.goto(`${STAGING_ORIGIN}/admin/billing/dashboard`);
  const form = page.getByTestId(`billing-refund-${transactionId}`);
  // If login/MFA or the bounded dashboard omits this transaction, stop here.
  // Never widen the selector to a latest/refundable transaction.
  requireCondition(await form.count() === 1);
  requireCondition(await form.locator('input[name="id"]').inputValue() === transactionId);
  requireCondition(Boolean(await form.locator('input[name="_csrf"]').inputValue()));
  await form.locator('input[name="refundAmount"]').fill(String(amount));
  await form.locator('input[name="gatewayFeeRefund"]').fill("0");
  await form.locator('input[name="platformFeeRefund"]').fill("0");
  await form.locator('input[name="reason"]').fill("pending_sandbox_refund_handoff");
  return form;
}

/** Consume one pending handoff through the existing CSRF-protected admin UI.
 * loadProof must use the authenticated exact-source proof endpoint; queryProvider
 * must use the signed sandbox query. Neither adapter may fabricate successful QA.
 */
async function consumePendingRefund({ receipt, transactionId, expectedSourceSha, context, loadProof, queryProvider,
  now = () => new Date(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const initial = await loadProof(transactionId, expectedSourceSha);
  assertProofMatchesHandoff(receipt, initial, transactionId, expectedSourceSha, now());
  requireCondition(initial.status === "paid" && initial.refundedAmountCents === 0 && initial.refundRecordCount === 0);
  const first = await context.newPage();
  const duplicate = await context.newPage();
  try {
    const firstForm = await fillExactRefundForm(first, transactionId, receipt.amount);
    const duplicateForm = await fillExactRefundForm(duplicate, transactionId, receipt.amount);
    await firstForm.getByRole("button", { name: "退款", exact: true }).click();
    let completed;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const proof = await loadProof(transactionId, expectedSourceSha);
      assertProofMatchesHandoff(receipt, proof, transactionId, expectedSourceSha, now());
      if (proof.refundPersistencePassed === true) { completed = proof; break; }
      // A reserved/ambiguous refund is polled, never submitted again.
      await sleep(1000);
    }
    requireCondition(completed?.singleProcessedRefund === true && completed.refundRecordCount === 1
      && completed.status === "refunded" && completed.refundedAmountCents === completed.grossAmountCents);
    let providerCompleted = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (isCompletedFullCreditRefund(await queryProvider(), receipt)) { providerCompleted = true; break; }
      // Poll the exact provider trade; never submit a second refund while pending.
      await sleep(1000);
    }
    requireCondition(providerCompleted);
    await duplicateForm.getByRole("button", { name: "退款", exact: true }).click();
    await duplicate.waitForURL(`${STAGING_ORIGIN}/admin/billing/dashboard?error=refund_already_processed`);
    const final = await loadProof(transactionId, expectedSourceSha);
    assertProofMatchesHandoff(receipt, final, transactionId, expectedSourceSha, now());
    requireCondition(final.refundPersistencePassed === true && final.refundRecordCount === 1
      && final.refundedAmountCents === completed.refundedAmountCents);
    return Object.freeze({ schemaVersion: "celebratedeal-payuni-refund-completion/v1", status: "COMPLETED",
      sourceCommit: expectedSourceSha, transactionRef: receipt.transactionRef, orderRef: receipt.orderRef,
      tradeRef: receipt.tradeRef, amount: receipt.amount, environment: "sandbox", appHost: receipt.appHost,
      completedAt: now().toISOString(), checks: { sandboxRefundAccepted: "passed", refundVisibleInProviderQuery: "passed",
        refundIdempotency: "passed", paymentTransactionRefunded: "passed", refundRecordProcessed: "passed", singleRefundRecord: "passed" } });
  } finally {
    await first.close();
    await duplicate.close();
  }
}

export { assertProofMatchesHandoff, consumePendingRefund, fillExactRefundForm };

/** Explicit CLI handoff; credentials are injected into this process only.
 * No dotenv, cookie export, payment checkout, direct refund or recovery code.
 */
async function executePendingRefund() {
  let browser;
  let stage = "configuration";
  try {
    requireCondition(process.env.PAYUNI_ENV === "sandbox" && process.env.PAYUNI_SANDBOX_QA_ENABLED === "true"
      && process.env.PAYUNI_SANDBOX_REFUND_ENABLED === "true");
    for (const key of ["JOB_SECRET", "PAYUNI_SANDBOX_MERCHANT_ID", "PAYUNI_SANDBOX_HASH_KEY", "PAYUNI_SANDBOX_HASH_IV",
      "PAYUNI_QA_FINANCE_EMAIL", "PAYUNI_QA_FINANCE_PASSWORD"]) requireCondition(Boolean(process.env[key]?.trim()));
    const options = new Map();
    const args = process.argv.slice(2);
    requireCondition(args.length === 8);
    for (let index = 0; index < args.length; index += 2) {
      requireCondition(["--handoff-name", "--transaction-id", "--order-number", "--source-sha"].includes(args[index]) && !options.has(args[index]));
      options.set(args[index], args[index + 1]);
    }
    const name = options.get("--handoff-name");
    requireCondition(/^[0-9TZ]+-[a-f0-9]{12}\.json$/.test(name ?? ""));
    const directory = await fs.realpath(path.resolve(".ai-team/reports/payuni-payment-handoff"));
    const receiptPath = await fs.realpath(path.join(directory, name));
    requireCondition(path.dirname(receiptPath) === directory && (await fs.stat(receiptPath)).size <= 16384);
    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
    const transactionId = options.get("--transaction-id");
    const orderNumber = options.get("--order-number");
    const sourceSha = options.get("--source-sha");
    requireCondition(/^[a-zA-Z0-9_-]{1,128}$/.test(transactionId ?? "") && /^[a-f0-9]{40}$/.test(sourceSha ?? "")
      && reference(orderNumber) === receipt.orderRef);
    const loadProof = async () => {
      const url = new URL("/api/admin/ops/payuni/pending-refund-proof", STAGING_ORIGIN);
      url.searchParams.set("transactionId", transactionId);
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { authorization: `Bearer ${process.env.JOB_SECRET}`, "x-celebratedeal-source-sha": sourceSha } });
      requireCondition(response.status === 200 && response.headers.get("content-type")?.includes("application/json"));
      const body = await response.text();
      requireCondition(body.length <= 16384);
      return JSON.parse(body);
    };
    stage = "runtime-and-target-binding";
    assertProofMatchesHandoff(receipt, await loadProof(), transactionId, sourceSha);
    const { chromium } = await import("@playwright/test");
    const { queryTransaction } = await import("./payuni-sandbox-external-qa.mjs");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: "zh-TW" });
    context.setDefaultTimeout(15000);
    const login = await context.newPage();
    stage = "platform-login-and-mfa";
    await login.goto(`${STAGING_ORIGIN}/login?next=/admin/billing/dashboard`);
    await login.locator('input[name="email"]').fill(process.env.PAYUNI_QA_FINANCE_EMAIL);
    await login.locator('input[name="password"]').fill(process.env.PAYUNI_QA_FINANCE_PASSWORD);
    await login.getByRole("button", { name: "登入", exact: true }).click();
    await login.waitForURL((url) => url.pathname !== "/login");
    if (new URL(login.url()).pathname === "/mfa/verify") {
      requireCondition(/^\d{6}$/.test(process.env.PAYUNI_QA_FINANCE_OTP ?? ""));
      await login.locator('input[name="code"]').fill(process.env.PAYUNI_QA_FINANCE_OTP);
      await login.getByRole("button", { name: "確認並繼續", exact: true }).click();
      await login.waitForURL((url) => !url.pathname.startsWith("/mfa/"));
    }
    await login.close();
    stage = "refund-ui-and-persistence";
    const completed = await consumePendingRefund({ receipt, transactionId, expectedSourceSha: sourceSha, context, loadProof,
      queryProvider: () => queryTransaction(orderNumber, { signal: AbortSignal.timeout(10000) }) });
    stage = "completion-artifact";
    const output = path.join(directory, `completed-${Date.now()}-${receipt.transactionRef}.json`);
    await fs.writeFile(output, `${JSON.stringify(completed)}\n`, { flag: "wx", encoding: "utf8" });
    console.log(JSON.stringify(completed));
  } catch {
    // No exception text, raw identifiers, provider responses or login data.
    console.log(JSON.stringify({ schemaVersion: "celebratedeal-payuni-refund-completion/v1", status: "BLOCKED_OR_FAILED", stage,
      productionOperations: false, alternateTransactionSelected: false }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await executePendingRefund();
export { executePendingRefund };
