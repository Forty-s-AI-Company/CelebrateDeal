import { expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyFinanceLoginFailure, currentSourceFailureReceipt, diagnoseCurrentSourcePayment, executeCurrentSourceRefundQa, launchRefundBrowser, openFinanceLoginPage, runCurrentSourceRefundQa, waitFinanceLoginRedirect } from "./payuni-current-source-refund-qa.mjs";
import { reference } from "./payuni-sandbox-payment-handoff.mjs";

const host = "celebrate-deal-staging.carry-digital-nomad.in.net";
const source = "a".repeat(40);
const order = "CD-SYNTHETIC-Q1";
const transaction = "wp4-synthetic-q1";
const trade = "synthetic-provider-q1";
const clock = () => new Date("2026-10-09T02:00:00Z");
it.each([
  [true, true, 200, "VERIFIED", true],
  [true, true, 404, "FIXTURE_UNAVAILABLE", true],
  [true, true, 409, "STATE_MISMATCH", true],
  [true, true, 404, undefined, false],
  [true, false, 200, "VERIFIED", false],
  [false, true, 200, "VERIFIED", false],
])("keeps read-only state separate from purchase readiness (diagnostic=%s,lineage=%s,status=%s/%s)",
  async (diagnostic, lineage, status, proofStatus, boundaryVerified) => {
    const input = setup().options.input;
    const previousArgv = process.argv, previousExit = process.exitCode;
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const preflightFetch = vi.fn(async () => ({ status: 404 })); // e.g. exhausted inventory
    const diagnosticRequest = vi.fn(async operation => {
      expect(operation.url).toBe(`https://${host}/api/admin/ops/payuni/wp4-buyer-order-proof`);
      expect(operation.headers["x-celebratedeal-source-sha"]).toBe(source);
      expect(operation.body).toBeUndefined();
      return { status, body: { status: proofStatus, private: "synthetic-private" } };
    });
    try {
      process.argv = [process.execPath, "fixed-qa-entry.mjs"];
      process.exitCode = undefined;
      for (const [name, value] of Object.entries({ GITHUB_ACTIONS: "true", PAYUNI_ENV: "sandbox",
        PAYUNI_SANDBOX_QA_ENABLED: "true", PAYUNI_SANDBOX_REFUND_ENABLED: "true",
        Q1_EXISTING_STATE_DIAGNOSTIC: String(diagnostic), CELEBRATEDEAL_SOURCE_SHA: source,
        CELEBRATEDEAL_DEPLOYMENT_HOST: input.previewHost, JOB_SECRET: input.jobSecret,
        PAYUNI_SANDBOX_ONETIME_CARD_NO: input.cardNumber, PAYUNI_TEST_EXPIRY: input.cardExpiry,
        PAYUNI_TEST_CVV: input.cardCvv, PAYUNI_SANDBOX_MERCHANT_ID: "synthetic-merchant",
        PAYUNI_SANDBOX_HASH_KEY: "synthetic-key", PAYUNI_SANDBOX_HASH_IV: "synthetic-iv",
        PAYUNI_QA_FINANCE_EMAIL: "synthetic-finance@invalid.example", PAYUNI_QA_FINANCE_PASSWORD: "synthetic-private" })) {
        vi.stubEnv(name, value);
      }
      await executeCurrentSourceRefundQa({ verifyLineage: vi.fn(async () => lineage), diagnosticRequest, preflightFetch });
      expect(output).toHaveBeenCalledTimes(1);
      const receipt = JSON.parse(output.mock.calls[0][0]);
      if (diagnostic && lineage) {
        expect(preflightFetch).not.toHaveBeenCalled();
        expect(diagnosticRequest).toHaveBeenCalledTimes(1);
        expect(receipt).toMatchObject({ status: "READ_ONLY_DIAGNOSTIC", canonicalSandboxBoundaryVerified: boundaryVerified,
          paymentSubmitted: false, refundSubmitted: false, alternateTransactionSelected: false });
      } else {
        expect(diagnosticRequest).not.toHaveBeenCalled();
        expect(preflightFetch).toHaveBeenCalledTimes(lineage ? 1 : 0);
        expect(receipt).toMatchObject({ status: "BLOCKED_OR_FAILED",
          stage: lineage ? "canonical-runtime-preflight" : "deployment-lineage" });
      }
      expect(process.exitCode).toBe(boundaryVerified ? undefined : 1);
      expect(JSON.stringify(receipt)).not.toContain("synthetic-private");
    } finally {
      process.argv = previousArgv; process.exitCode = previousExit;
      output.mockRestore(); vi.unstubAllEnvs();
    }
  });
it.each([undefined, null, {}, { paymentReceipt: null }, { paymentReceipt: {} },
  { paymentReceipt: { result: "PASS", private: "synthetic-private" } }])(
  "always emits closed failure evidence for an absent or malformed receipt %j", error => {
    const receipt = currentSourceFailureReceipt("exact-existing-state-diagnostic", error);
    expect(receipt).toEqual({ schemaVersion: "celebratedeal-current-source-refund-qa/v1",
      status: "BLOCKED_OR_FAILED", stage: "exact-existing-state-diagnostic",
      productionOperations: false, alternateTransactionSelected: false });
    expect(JSON.stringify(receipt)).not.toContain("synthetic-private");
  });
it("never copies an unrecognized stage, raw error or login URL into failure evidence", () => {
  const receipt = currentSourceFailureReceipt("synthetic-private", new Error("synthetic-private"),
    `https://${host}/login?error=mfa_required&private=synthetic-private`);
  expect(receipt.stage).toBe("configuration");
  expect(receipt.failureCategory).toBe("MFA_REQUIRED");
  expect(JSON.stringify(receipt)).not.toContain("synthetic-private");
});
it("writes a parseable failure receipt from the real CLI without any injected credentials", () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("./payuni-current-source-refund-qa.mjs", import.meta.url))],
    { env: { GITHUB_ACTIONS: "false", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
      encoding: "utf8", timeout: 10000, windowsHide: true });
  expect(child.status).toBe(1);
  expect(child.stderr).toBe("");
  expect(JSON.parse(child.stdout)).toMatchObject({ status: "BLOCKED_OR_FAILED", stage: "configuration",
    productionOperations: false, alternateTransactionSelected: false });
});
it.each([[200,"VERIFIED","EXACT_PAID_ORDER_VERIFIED"],[404,"FIXTURE_UNAVAILABLE","EXACT_FIXTURE_ABSENT"],
  [409,"CANDIDATE_AMBIGUOUS","EXACT_FIXTURE_AMBIGUOUS"],[409,"STATE_MISMATCH","EXACT_STATE_MISMATCH"],
  [200,"synthetic-private","EXACT_STATE_UNAVAILABLE"],[409,"VERIFIED","EXACT_STATE_UNAVAILABLE"]])(
  "diagnoses only the fixed existing state with status %s/%s", async (httpStatus, status, category) => {
    const run=setup();
    const request=vi.fn(async operation=>{
      expect(operation.url).toBe(`https://${host}/api/admin/ops/payuni/wp4-buyer-order-proof`);
      expect(operation.body).toBeUndefined();
      expect(operation.headers["x-celebratedeal-source-sha"]).toBe(source);
      return {status:httpStatus,body:{status,private:"synthetic-private"}};
    });
    const receipt=await diagnoseCurrentSourcePayment(run.options.input,{request});
    expect(receipt).toMatchObject({category,paymentSubmitted:false,refundSubmitted:false,sourceCommit:source});
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(receipt)).not.toContain("synthetic-private");
    expect(run.dependencies.browserSubmit).not.toHaveBeenCalled();
  });
it("rejects invalid source before a diagnostic request and propagates network failure",async()=>{
  const run=setup(); const request=vi.fn(async()=>{throw new Error("synthetic transport failure");});
  await expect(diagnoseCurrentSourcePayment({...run.options.input,sourceSha:"invalid"},{request})).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  await expect(diagnoseCurrentSourcePayment(run.options.input,{request})).rejects.toThrow("synthetic transport failure");
  expect(request).toHaveBeenCalledTimes(1);
});
it("opens the fixed login DOM without requiring unrelated asset completion", async () => {
  const page = { goto: vi.fn(async (_url, options) => {
    if (options.waitUntil !== "domcontentloaded") throw new Error("synthetic stalled external asset");
  }), url: () => `https://${host}/login` };
  await expect(openFinanceLoginPage(page)).resolves.toBeUndefined();
  expect(page.goto).toHaveBeenCalledWith(`https://${host}/login?next=/admin/billing/dashboard`, { waitUntil: "domcontentloaded" });
});
it("rejects a foreign login redirect and preserves navigation failure", async () => {
  const page = { goto: vi.fn(), url: () => "https://attacker.example/login" };
  await expect(openFinanceLoginPage(page)).rejects.toThrow();
  const error = new Error("synthetic blocked navigation");
  page.goto.mockRejectedValueOnce(error);
  await expect(openFinanceLoginPage(page)).rejects.toBe(error);
});
it.each([false, true])("waits for a same-origin login redirect DOM with MFA=%s", async (afterMfa) => {
  const page = { url: () => `https://${host}/admin/billing/dashboard`, waitForURL: vi.fn(async (predicate, options) => {
    expect(options.waitUntil).toBe("domcontentloaded");
    expect(predicate(new URL(`https://${host}/admin/billing/dashboard`))).toBe(true);
    expect(predicate(new URL("https://attacker.example/admin/billing/dashboard"))).toBe(false);
    expect(predicate(new URL(`https://${host}${afterMfa ? "/mfa/verify" : "/login"}`))).toBe(false);
  }) };
  await expect(waitFinanceLoginRedirect(page, afterMfa)).resolves.toBeUndefined();
  expect(page.waitForURL).toHaveBeenCalledTimes(1);
});
it("rejects a foreign final redirect and preserves redirect timeout", async () => {
  const page = { url: () => "https://attacker.example/dashboard", waitForURL: vi.fn() };
  await expect(waitFinanceLoginRedirect(page)).rejects.toThrow();
  const error = new Error("synthetic redirect timeout");
  page.waitForURL.mockRejectedValueOnce(error);
  await expect(waitFinanceLoginRedirect(page, true)).rejects.toBe(error);
});
it.each([
  ["/login?error=1", "AUTHENTICATION_REJECTED"],
  ["/login?error=rate_limited", "LOGIN_RATE_LIMITED"],
  ["/login?error=temporarily_unavailable", "LOGIN_PROTECTION_UNAVAILABLE"],
  ["/login?error=no_vendor", "FINANCE_PERMISSION_REJECTED"],
  ["/mfa/verify", "MFA_NOT_COMPLETED"],
  ["/admin/billing/dashboard", "FINANCE_DASHBOARD_NOT_VERIFIED"],
  ["/login?error=__proto__&private=synthetic-private", "LOGIN_NOT_COMPLETED"],
  ["/login?error=synthetic-private", "LOGIN_NOT_COMPLETED"],
])("returns only a closed login category for %s", (path, expected) => {
  expect(classifyFinanceLoginFailure(`https://${host}${path}`)).toBe(expected);
});
it("never trusts foreign destinations or emits private query values", () => {
  expect(classifyFinanceLoginFailure("https://attacker.example/login?error=1")).toBe("LOGIN_DESTINATION_REJECTED");
  expect(classifyFinanceLoginFailure("synthetic-private")).toBe("LOGIN_NOT_COMPLETED");
  expect(classifyFinanceLoginFailure(`https://${host}/unexpected?token=synthetic-private`)).toBe("LOGIN_DESTINATION_REJECTED");
});
function setup() {
  let refunded = false;
  const clicks = [];
  const page = () => ({ goto: vi.fn(), waitForURL: vi.fn(), close: vi.fn(), getByTestId: vi.fn((id) => {
    expect(id).toBe(`billing-refund-${transaction}`);
    return { count: async () => 1, locator: (selector) => ({ inputValue: async () => selector.includes('name="id"') ? transaction : "synthetic-csrf", fill: vi.fn() }),
      getByRole: () => ({ click: async () => { clicks.push(transaction); refunded = true; } }) };
  }) });
  const options = { input: { sourceSha: source, previewHost: "celebrate-deal-staging-synthetic.vercel.app", payuniEnv: "sandbox",
    jobSecret: "synthetic-job", cardNumber: "4111111111111111", cardExpiry: "1230", cardCvv: "123" },
  context: { newPage: vi.fn(async () => page()) },
  loadProof: vi.fn(async () => ({ schemaVersion: "celebratedeal-payuni-pending-refund-proof/v1", environment: "preview",
    payuniEnvironment: "sandbox", providerHost: "sandbox-api.payuni.com.tw", appHost: host, sourceCommit: source,
    databaseBound: true, nonProductionScope: "fixed-staging-project", paymentCallbackMatched: true,
    transactionRef: reference(transaction), orderRef: reference(order), tradeRef: reference(trade), grossAmountCents: 100,
    refundedAmountCents: refunded ? 100 : 0, refundRecordCount: refunded ? 1 : 0, status: refunded ? "refunded" : "paid",
    singleProcessedRefund: refunded, refundPersistencePassed: refunded })),
  queryProvider: vi.fn(async (exactOrder) => {
    expect(exactOrder).toBe(order);
    return { MerTradeNo: order, TradeNo: trade, TradeAmt: 1, TradeStatus: "1", PaymentType: "1", DataSource: "A",
      RefundStatus: refunded ? "2" : "0", RefundAmt: refunded ? 1 : 0, RemainAmt: refunded ? 0 : 1 };
  }) };
  const dependencies = { now: clock, sleep: vi.fn(), browserSubmit: vi.fn(async (input) => {
    expect(input.previewHost).toBe(host);
    expect(input.transactionId).toBe(transaction);
    return { mapped: true, firstStatus: 303, signedReturnBody: Buffer.from("synthetic-callback"), contentType: "application/x-www-form-urlencoded" };
  }), request: vi.fn(async ({ url, headers }) => {
    expect(new URL(url).origin).toBe(`https://${host}`);
    if (headers.origin) expect(headers.origin).toBe(`https://${host}`);
    if (url.endsWith("/wp4-fixture")) return { status: 200, body: { ready: true, createdCount: 6, reusedCount: 0 } };
    if (url.endsWith("/checkout/admission")) return { status: 200, body: {
      admissionToken: `ca1.${"a".repeat(64)}.${"b".repeat(43)}`, idempotencyKey: "11111111-1111-4111-8111-111111111111",
      expiresAt: "2030-01-01T00:00:00.000Z" }, sessionCookie: "celebratedeal_checkout_session=synthetic" };
    if (url.endsWith("/api/payments/checkout")) return { status: 200, body: { ok: true, provider: "payuni", orderNumber: order,
      transactionId: transaction, amountCents: 100, currency: "TWD", checkoutUrl: null, formAction: "https://sandbox-api.payuni.com.tw/api/upp",
      formMethod: "POST", formPayload: { MerID: "synthetic", Version: "2.0", EncryptInfo: "synthetic", HashInfo: "synthetic" },
      nextAction: "submit_payuni_upp_form", externalRequired: false }, supportCookie: "celebrate_support_wp4=synthetic" };
    if (url.endsWith("/wp4-payment-attempt")) return { status: 200, body: { status: "SUBMIT_ALLOWED", reservationCreated: true } };
    if (url.endsWith("/wp4-buyer-order-proof")) return { status: 200, body: { status: "VERIFIED", paymentStatus: "paid",
      orderStatus: "paid", orderCount: 1, paidEventCount: 1, orderEventCount: 1, reservationStatus: "committed", remainingInventory: 2 } };
    if (url.endsWith("?provider=payuni&source=notify")) return { status: 200, body: { ok: true, duplicate: true, eventId: "synthetic-event" } };
    throw new Error("unexpected synthetic request");
  }) };
  return { options, dependencies, clicks };
}

it("connects the real payment runner and refund consumer using only the captured exact transaction", async () => {
  const run = setup();
  const result = await runCurrentSourceRefundQa(run.options, run.dependencies);
  expect(result).toMatchObject({ status: "COMPLETED", sourceCommit: source, transactionRef: reference(transaction) });
  expect(run.clicks).toEqual([transaction, transaction]);
  expect(run.dependencies.browserSubmit).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain(transaction);
  expect(JSON.stringify(result)).not.toContain(order);
  expect(run.options.loadProof).toHaveBeenCalledWith(transaction, source);
});
it.each([{ sourceSha: "bad" }, { payuniEnv: "production" }, { previewHost: "attacker.example" }])("rejects invalid invocation before any external request: %j", async (patch) => {
  const run = setup(); Object.assign(run.options.input, patch);
  await expect(runCurrentSourceRefundQa(run.options, run.dependencies)).rejects.toThrow();
  expect(run.dependencies.request).not.toHaveBeenCalled();
  expect(run.dependencies.browserSubmit).not.toHaveBeenCalled();
});
it("does not select a replacement or query the provider after an ambiguous payment", async () => {
  const run = setup(); run.dependencies.browserSubmit.mockResolvedValue("PAYMENT_CONFIRMATION_AMBIGUOUS");
  await expect(runCurrentSourceRefundQa(run.options, run.dependencies)).rejects.toThrow();
  expect(run.dependencies.browserSubmit).toHaveBeenCalledTimes(1);
  expect(run.options.queryProvider).not.toHaveBeenCalled();
  expect(run.options.context.newPage).not.toHaveBeenCalled();
});
it("rejects a different provider order before proof or refund UI", async () => {
  const run = setup(); run.options.queryProvider.mockResolvedValue({ MerTradeNo: "different-order", TradeNo: trade, TradeAmt: 1, TradeStatus: "1" });
  await expect(runCurrentSourceRefundQa(run.options, run.dependencies)).rejects.toThrow();
  expect(run.options.loadProof).not.toHaveBeenCalled();
  expect(run.clicks).toEqual([]);
});
it("rejects stale deployment proof before opening any refund page", async () => {
  const run = setup(); run.options.loadProof.mockResolvedValue({ sourceCommit: "b".repeat(40) });
  await expect(runCurrentSourceRefundQa(run.options, run.dependencies)).rejects.toThrow();
  expect(run.options.context.newPage).not.toHaveBeenCalled();
});
it("stops on rejected source/tenant fixture before checkout or provider submission", async () => {
  const run = setup(); run.dependencies.request.mockResolvedValue({ status: 404, body: { error: "Not found" } });
  await expect(runCurrentSourceRefundQa(run.options, run.dependencies)).rejects.toThrow();
  expect(run.dependencies.request).toHaveBeenCalledTimes(1);
  expect(run.dependencies.browserSubmit).not.toHaveBeenCalled();
  expect(run.options.queryProvider).not.toHaveBeenCalled();
});
it("retains the validated closed payment failure receipt without response bodies or secrets",async()=>{
  const run=setup();run.dependencies.request.mockResolvedValue({status:404,body:{error:"synthetic-private"}});
  let failure;try{await runCurrentSourceRefundQa(run.options,run.dependencies);}catch(error){failure=error;}
  expect(failure.paymentReceipt).toMatchObject({result:"BLOCKED",sourceSha:source,sideEffects:{fixturePosts:1,checkoutPosts:0,browserPaymentSubmissions:0}});
  expect(JSON.stringify(failure.paymentReceipt)).not.toContain("synthetic-private");
  expect(currentSourceFailureReceipt("exact-payment-and-refund", failure).paymentReceipt).toEqual(failure.paymentReceipt);
  expect(run.dependencies.browserSubmit).not.toHaveBeenCalled();
});
it("persists only the exact sanitized handoff before the refund consumer writes", async () => {
  const run = setup();
  const writeHandoff = vi.fn(async (receipt) => {
    expect(run.clicks).toEqual([]);
    expect(receipt).toMatchObject({ sourceCommit: source, transactionRef: reference(transaction), orderRef: reference(order) });
    expect(JSON.stringify(receipt)).not.toContain(transaction);
  });
  await runCurrentSourceRefundQa(run.options, { ...run.dependencies, writeHandoff });
  expect(writeHandoff).toHaveBeenCalledTimes(1);
});
it("rejects an injected request to another host before transmitting any header or cookie", async () => {
  const run = setup();
  const runPayment = async (_input, adapters) => adapters.request({ url: "https://attacker.example/api/payments/checkout", headers: {} });
  await expect(runCurrentSourceRefundQa(run.options, { ...run.dependencies, runPayment })).rejects.toThrow();
  expect(run.dependencies.request).not.toHaveBeenCalled();
});
it("launches the refund browser with an explicit minimal environment and no CI credentials", async () => {
  const names = ["JOB_SECRET", "GITHUB_TOKEN", "PAYUNI_SANDBOX_HASH_KEY", "PAYUNI_SANDBOX_HASH_IV",
    "PAYUNI_QA_FINANCE_EMAIL", "PAYUNI_QA_FINANCE_PASSWORD", "PAYUNI_QA_FINANCE_OTP"];
  try {
    for (const name of names) vi.stubEnv(name, "synthetic-secret-sentinel");
    const chromium = { launch: vi.fn(async (options) => {
      expect(options.headless).toBe(true);
      expect(options.env).toBeDefined();
      expect(Object.keys(options.env).sort()).toEqual(process.platform === "win32"
        ? ["PATH", "SystemRoot", "TEMP", "TMP"].sort() : ["PATH", "HOME", "TMPDIR"].sort());
      for (const name of names) expect(options.env).not.toHaveProperty(name);
      expect(JSON.stringify(options.env)).not.toContain("synthetic-secret-sentinel");
      return "mocked-browser";
    }) };
    await expect(launchRefundBrowser(chromium)).resolves.toBe("mocked-browser");
    expect(chromium.launch).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllEnvs(); }
});
