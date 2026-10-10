import { mkdir, rename, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { reference } from "./payuni-sandbox-payment-handoff.mjs";
import { verifyReservedOriginalRefund } from "./q1-original-refund-verify.mjs";
import { createOriginalRefundHandoff, assertOriginalRefundProof, originalPaidQueryChecks, originalPaidQueryShape, ORIGINAL_TRANSACTION_SOURCE } from "./q1-original-refund-handoff.mjs";
import { consumePendingRefund, launchPendingRefundBrowser, fillExactRefundForm } from "./payuni-sandbox-pending-refund-consumer.mjs";
import { openFinanceLoginPage, waitFinanceLoginRedirect } from "./payuni-current-source-refund-qa.mjs";
const SOURCE = "a76330b5961a48892bc03be779438128816d1a8c";
const ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
function safe(condition) { if (!condition) throw new Error("Original refund runner rejected."); }

export async function executeOriginalRefund() {
  let db, browser, stage = "configuration";
  const receipt = { schemaVersion: "celebratedeal-q1-original-refund-completion/v1", status: "BLOCKED", executionSource: SOURCE,
    originalTransactionSource: ORIGINAL_TRANSACTION_SOURCE, paymentSubmitted: false, productionOperations: false,
    alternateTransactionSelected: false, refundSubmissionMayHaveOccurred: false, reservationWritten: false };
  const persist = async () => {
    if (process.env.RUNNER_TEMP && process.env.GITHUB_REF === "refs/heads/master" && process.env.GITHUB_REF_PROTECTED === "true") {
      const directory = resolve(process.env.RUNNER_TEMP, "q1-original-refund"); await mkdir(directory, { recursive: true });
      const temporary = resolve(directory, "completion.json.tmp");
      await writeFile(temporary, JSON.stringify({ ...receipt, stage }) + "\n", { mode: 0o600 });
      await rename(temporary, resolve(directory, "completion.json"));
    }
  };
  try {
    const env = process.env;
    safe(process.argv.length === 2 && env.GITHUB_ACTIONS === "true" && env.GITHUB_REF === "refs/heads/master"
      && env.GITHUB_REF_PROTECTED === "true" && env.GITHUB_REPOSITORY === "Forty-s-AI-Company/CelebrateDeal"
      && env.GITHUB_WORKFLOW_REF?.split("@")[0] === "Forty-s-AI-Company/CelebrateDeal/.github/workflows/q1-original-refund.yml"
      && env.PAYUNI_ENV === "sandbox" && env.CELEBRATEDEAL_SOURCE_SHA === SOURCE);
    for (const key of ["JOB_SECRET", "STAGING_DATABASE_URL", "PAYUNI_SANDBOX_MERCHANT_ID", "PAYUNI_SANDBOX_HASH_KEY",
      "PAYUNI_SANDBOX_HASH_IV", "PAYUNI_QA_FINANCE_EMAIL", "PAYUNI_QA_FINANCE_PASSWORD"]) safe(Boolean(env[key]?.trim()));
    const bootstrapModule = await import("../src/lib/staging-qa-finance-bootstrap.ts");
    const bootstrap = bootstrapModule.default ?? bootstrapModule;
    const databaseUrl = bootstrap.qaFinanceDatabaseUrl(env.STAGING_DATABASE_URL);
    bootstrap.verifyQaFinanceCertificate(await readFile(resolve("prisma", bootstrap.QA_FINANCE_CA_FILE)));
    stage = "deployment-lineage";
    const { verifyMvpPayUniLineage } = await import("./mvp-payuni-sandbox-e2e.mjs");
    safe(await verifyMvpPayUniLineage({ CELEBRATEDEAL_SOURCE_SHA: SOURCE,
      CELEBRATEDEAL_DEPLOYMENT_HOST: env.CELEBRATEDEAL_DEPLOYMENT_HOST, GITHUB_TOKEN: env.GITHUB_TOKEN }));
    const loadProof = async () => {
      const response = await fetch(`${ORIGIN}/api/admin/ops/payuni/q1-original-refund-proof`, {
        redirect: "error", signal: AbortSignal.timeout(10000), headers: { authorization: `Bearer ${env.JOB_SECRET}`,
          "x-celebratedeal-source-sha": SOURCE } });
      safe(response.status === 200 && response.headers.get("content-type")?.includes("application/json"));
      const text = await response.text(); safe(text.length <= 16384);
      const proof = JSON.parse(text); assertOriginalRefundProof(proof, SOURCE); return proof;
    };
    stage = "exact-deployed-original-proof"; await loadProof();
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const targetModule = await import("./q1-original-refund-target.ts");
    const targetFunctions = targetModule.default ?? targetModule;
    stage = "original-readonly-target";
    safe(["false", "true"].includes(env.Q1_ORIGINAL_REFUND_VERIFY_ONLY ?? "false"));
    if (env.Q1_ORIGINAL_REFUND_VERIFY_ONLY === "true") {
      stage = "reserved-original-readonly-target";
      const reserved = await targetFunctions.readReservedOriginalRefundTarget(db);
      const { queryTransaction } = await import("./payuni-sandbox-external-qa.mjs");
      receipt.completion = await verifyReservedOriginalRefund({ target: reserved, executionSource: SOURCE, loadProof,
        queryProvider: order => queryTransaction(order, { signal: AbortSignal.timeout(10000) }),
        onStage: async observation => { stage = observation.stage; await persist(); } });
      receipt.status = reserved.duplicateUIVerified ? "ORIGINAL_REFUND_VERIFIED" : "ORIGINAL_REFUND_TERMINAL_VERIFIED"; stage = "complete";
      return;
    }
    const target = await targetFunctions.readOriginalRefundTarget(db);
    const { chromium } = await import("@playwright/test");
    const { queryTransaction, callbackQueryFailure } = await import("./payuni-sandbox-external-qa.mjs");
    browser = await launchPendingRefundBrowser(chromium);
    const context = await browser.newContext({ locale: "zh-TW" }); context.setDefaultTimeout(15000);
    stage = "finance-login";
    const login = await context.newPage(); await openFinanceLoginPage(login);
    await login.locator('input[name="email"]').fill(env.PAYUNI_QA_FINANCE_EMAIL);
    await login.locator('input[name="password"]').fill(env.PAYUNI_QA_FINANCE_PASSWORD);
    await login.getByRole("button", { name: "登入", exact: true }).click(); await waitFinanceLoginRedirect(login);
    if (new URL(login.url()).pathname === "/mfa/verify") {
      safe(/^\d{6}$/.test(env.PAYUNI_QA_FINANCE_OTP ?? ""));
      await login.locator('input[name="code"]').fill(env.PAYUNI_QA_FINANCE_OTP);
      await login.getByRole("button", { name: "確認並繼續", exact: true }).click(); await waitFinanceLoginRedirect(login, true);
    }
    safe(new URL(login.url()).origin === ORIGIN && new URL(login.url()).pathname === "/admin/billing/dashboard");
    const startedAt = new Date().toISOString();
    stage = "exact-original-finance-form";
    const form = await fillExactRefundForm(login, target.transactionId, 1);
    const browserObservation = { origin: new URL(login.url()).origin, exactTransactionRef: reference(target.transactionId),
      exactRefundFormCount: await form.count(), formTransactionRef: reference(await form.locator('input[name="id"]').inputValue()),
      csrfPresent: Boolean(await form.locator('input[name="_csrf"]').inputValue()), financeAuthenticated: true };
    stage = "fresh-signed-original-query";
    let paid;
    try {
      paid = await queryTransaction(target.orderNumber, { signal: AbortSignal.timeout(10000) });
    } catch (error) {
      const diagnostic = callbackQueryFailure(error);
      receipt.originalQueryFailure = { stage: diagnostic.failureStage, category: diagnostic.errorCategory };
      throw error;
    }
    receipt.originalPaidQueryChecks = originalPaidQueryChecks(paid, target);
    receipt.originalPaidQueryShape = originalPaidQueryShape(paid);
    await persist();
    stage = "fresh-original-handoff-proof";
    const freshProof = await loadProof();
    stage = "original-handoff-validation";
    const handoff = createOriginalRefundHandoff({ proof: freshProof, paid, target, browser: browserObservation,
      executionSource: SOURCE, startedAt, completedAt: new Date().toISOString() });
    receipt.handoff = handoff;
    await login.close();
    stage = "original-refund";
    const completion = await consumePendingRefund({ receipt: handoff, transactionId: target.transactionId, expectedSourceSha: SOURCE,
      context, loadProof, queryProvider: () => queryTransaction(target.orderNumber, { signal: AbortSignal.timeout(10000) }),
      onStage: async observation => {
        stage = observation.stage;
        if (observation.refundSubmissionMayHaveOccurred && !receipt.reservationWritten) {
          // Durable artifact first, then atomic exact-original marker before any click.
          receipt.refundSubmissionMayHaveOccurred = true; await persist();
          await targetFunctions.reserveOriginalRefund(db, target.transactionId); receipt.reservationWritten = true;
        }
        if (observation.duplicateRefundRejected === true) {
          await targetFunctions.recordOriginalDuplicateVerified(db, target.transactionId);
          receipt.duplicateUIVerified = true;
        }
        await persist();
      } });
    safe(completion.status === "COMPLETED"); receipt.completion = completion; receipt.status = "ORIGINAL_REFUND_VERIFIED"; stage = "complete";
  } catch { process.exitCode = 1; }
  finally {
    try { await browser?.close(); await db?.$disconnect(); } catch { receipt.status = "BLOCKED"; stage = "cleanup"; process.exitCode = 1; }
    await persist(); console.log(JSON.stringify({ ...receipt, stage }));
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await executeOriginalRefund();
