import test from "node:test";
import assert from "node:assert/strict";
import { observeIssuedRecoveryBrowser, PUBLIC_FAILURE_CARD } from "./payuni-issued-recovery-browser.mjs";

const prepared = { invocation: { sourceSha: "a".repeat(40), previewHost: "synthetic-preview.vercel.app",
  payuniEnv: "sandbox", jobSecret: "synthetic-job", cardNumber: "4147631000000001", cardExpiry: "1230", cardCvv: "123" },
checkout: { formAction: "https://sandbox-api.payuni.com.tw/api/upp", formMethod: "POST", amountCents: 100,
  orderNumber: "synthetic_order", formPayload: { MerID: "synthetic", Version: "2.0", EncryptInfo: "synthetic", HashInfo: "synthetic" } },
supportCookie: "celebrate_support_synthetic=synthetic" };
function fixture({ available = true, status = "1", tradeNo = "synthetic_trade", httpOk = true, queryFails = false } = {}) {
  const state = { uppPosts: 0, cardSubmissions: 0, closed: 0, cards: [], queries: 0, launch: null };
  const locator = { click: async () => {}, check: async () => {}, fill: async () => {}, pressSequentially: async () => {},
    isVisible: async () => available, isEnabled: async () => available };
  const card = { ...locator, pressSequentially: async value => state.cards.push(value) };
  const submit = { ...locator, click: async () => { state.cardSubmissions++; } };
  const page = { setDefaultTimeout() {}, route: async () => {}, goto: async () => {},
    url: () => prepared.checkout.formAction, getByText: () => locator, getByRole: () => submit,
    getByPlaceholder: label => label === "16 碼或 19 碼" ? card : locator,
    locator: () => ({ ...locator, filter: () => ({ count: async () => 0 }) }), waitForTimeout: async () => {} };
  const context = { route: async () => {}, addCookies: async () => {}, newPage: async () => page,
    request: { post: async () => { state.uppPosts++; return { ok: () => httpOk }; } } };
  const chromium = { launch: async input => { state.launch = input; return { newContext: async () => context,
    close: async () => { state.closed++; } }; } };
  const queryProvider = async () => {
    state.queries++;
    if (queryFails && state.queries === 2) throw new Error("private provider diagnostic");
    return { MerTradeNo: "synthetic_order", TradeNo: state.queries === 1 ? "synthetic_trade" : tradeNo,
      TradeAmt: "1", PaymentType: "1", TradeStatus: state.queries === 1 ? "3" : status };
  };
  return { state, input: { prepared, queryProvider }, dependencies: { playwright: { chromium } } };
}
test("keeps one UPP page and makes only one original-form retry", async () => {
  const f = fixture();
  const receipt = await observeIssuedRecoveryBrowser(f.input, f.dependencies);
  assert.equal(receipt.result, "SAME_TRADE_PAYMENT_OBSERVED");
  assert.equal(f.state.uppPosts, 1);
  assert.equal(f.state.cardSubmissions, 2);
  assert.deepEqual(f.state.cards, [PUBLIC_FAILURE_CARD, prepared.invocation.cardNumber]);
  assert.equal(f.state.queries, 2);
  assert.equal(f.state.closed, 1);
  assert.equal(Object.hasOwn(f.state.launch.env, "JOB_SECRET"), false);
  assert.equal(JSON.stringify(receipt).includes(prepared.invocation.cardNumber), false);
});
test("does not recreate a checkout when the original retry form is unavailable", async () => {
  const f = fixture({ available: false });
  assert.equal((await observeIssuedRecoveryBrowser(f.input, f.dependencies)).result, "ORIGINAL_PAGE_RETRY_UNAVAILABLE");
  assert.equal(f.state.uppPosts, 1);
  assert.equal(f.state.cardSubmissions, 1);
  assert.equal(f.state.closed, 1);
});
test("reports a paid replacement as a failed original-trade requirement", async () => {
  const f = fixture({ tradeNo: "replacement_trade" });
  assert.equal((await observeIssuedRecoveryBrowser(f.input, f.dependencies)).result, "REPLACEMENT_TRADE_DETECTED");
  assert.equal(f.state.uppPosts, 1);
});
test("does not repeat a retry after an ambiguous final query failure", async () => {
  const f = fixture({ queryFails: true });
  await assert.rejects(observeIssuedRecoveryBrowser(f.input, f.dependencies), /^Error: PAYUNI_ISSUED_RECOVERY_BROWSER_REJECTED$/);
  assert.equal(f.state.cardSubmissions, 2);
  assert.equal(f.state.closed, 1);
});
test("does not submit a card after the initial provider HTTP request fails", async () => {
  const f = fixture({ httpOk: false });
  await assert.rejects(observeIssuedRecoveryBrowser(f.input, f.dependencies), /BROWSER_REJECTED/);
  assert.equal(f.state.uppPosts, 1);
  assert.equal(f.state.cardSubmissions, 0);
  assert.equal(f.state.queries, 0);
  assert.equal(f.state.closed, 1);
});
test("rejects Production invocation before launching a browser", async () => {
  const f = fixture();
  f.input.prepared = { ...prepared, invocation: { ...prepared.invocation, payuniEnv: "production" } };
  await assert.rejects(observeIssuedRecoveryBrowser(f.input, f.dependencies), /BROWSER_REJECTED/);
  assert.equal(f.state.launch, null);
});
