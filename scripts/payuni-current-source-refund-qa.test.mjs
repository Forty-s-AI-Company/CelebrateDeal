import { expect, it, vi } from "vitest";
import { classifyFinanceLoginFailure, launchRefundBrowser, runCurrentSourceRefundQa } from "./payuni-current-source-refund-qa.mjs";
import { reference } from "./payuni-sandbox-payment-handoff.mjs";

const host = "celebrate-deal-staging.carry-digital-nomad.in.net";
const source = "a".repeat(40);
const order = "CD-SYNTHETIC-Q1";
const transaction = "wp4-synthetic-q1";
const trade = "synthetic-provider-q1";
const clock = () => new Date("2026-10-09T02:00:00Z");
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
