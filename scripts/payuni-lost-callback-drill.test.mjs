import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOST_CALLBACK_SINK_PATH,
  PAYUNI_QUERY_URL,
  PAYUNI_UPP_URL,
  UPP_ENCRYPTED_FIELDS,
  appCallbackUrl,
  classifySignedReturn,
  createPayReceipt,
  defaultLostCallbackBrowser,
  verifyPayRunReceipt,
  payUniSandboxCrypto,
  providerReportsPaid,
  queryProviderSettlement,
  runLostCallbackPayment,
  sanitizeSettlementRow,
  sinkCallbackUrl,
  validatePayReceipt,
  withheldCallbackForm,
  writePayReceipt,
} from "./payuni-lost-callback-drill.mjs";

// Synthetic key material only; never a real PayUni key.
const KEYS = Object.freeze({ key: "12345678901234567890123456789012", iv: "1234567890123456", merchantId: "SYNTHMER" });
const crypto = payUniSandboxCrypto(KEYS);
const ALIAS_ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const ORDER = "CDSYNTHETIC0001";
const SHA = "a".repeat(40);
const INPUT = Object.freeze({
  sourceSha: SHA,
  previewHost: "celebrate-deal-staging-synthetic-a25814740s-projects.vercel.app",
  jobSecret: "synthetic-job-secret",
  cardNumber: "4000221111111111",
  cardExpiry: "1230",
  cardCvv: "123",
  payuniEnv: "sandbox",
});

/** The form `createCheckoutSession` builds, encrypted exactly like payuni.ts. */
function serverForm(overrides = {}, extra = []) {
  const fields = {
    MerID: KEYS.merchantId,
    MerTradeNo: ORDER,
    TradeAmt: 1,
    Timestamp: 1_790_000_000,
    ProdDesc: "WP4 合成商品",
    Credit: 1,
    ReturnURL: appCallbackUrl(ALIAS_ORIGIN, "return"),
    NotifyURL: appCallbackUrl(ALIAS_ORIGIN, "notify"),
    ...overrides,
  };
  const encryptInfo = crypto.encrypt([...Object.entries(fields), ...extra]);
  return { MerID: KEYS.merchantId, Version: "1.0", EncryptInfo: encryptInfo, HashInfo: crypto.hash(encryptInfo) };
}
const EXPECTED = Object.freeze({ merchantId: KEYS.merchantId, orderNumber: ORDER, amountCents: 100, appOrigin: ALIAS_ORIGIN });

function signedBody(inner) {
  const encryptInfo = crypto.encrypt(Object.entries(inner));
  return Buffer.from(new URLSearchParams({ MerID: KEYS.merchantId, Status: "SUCCESS", EncryptInfo: encryptInfo, HashInfo: crypto.hash(encryptInfo) }).toString());
}
const PAID_RETURN = Object.freeze({ Status: "SUCCESS", MerID: KEYS.merchantId, MerTradeNo: ORDER, TradeNo: "SYNTHTRADE1", TradeAmt: "1", TradeStatus: "1", PaymentType: "1" });

function queryResponse(inner, { forgeHash = false } = {}) {
  const encryptInfo = crypto.encrypt(Object.entries(inner).map(([name, value]) => [name, typeof value === "string" ? value : JSON.stringify(value)]));
  return new Response(new URLSearchParams({ MerID: KEYS.merchantId, EncryptInfo: encryptInfo, HashInfo: forgeHash ? "0".repeat(64) : crypto.hash(encryptInfo) }).toString());
}
const PAID_ROW = Object.freeze({ MerTradeNo: ORDER, TradeNo: "SYNTHTRADE1", TradeAmt: "1", TradeStatus: "1", PaymentType: "1", DataSource: "A", CloseStatus: "9", RemainAmt: "0" });

test("the Sandbox envelope round-trips and refuses malformed key material", () => {
  const encrypted = crypto.encrypt([["MerID", "A"], ["MerTradeNo", "B"]]);
  assert.deepEqual(crypto.decrypt(encrypted), [["MerID", "A"], ["MerTradeNo", "B"]]);
  assert.match(crypto.hash(encrypted), /^[0-9A-F]{64}$/u);
  for (const keys of [{}, { key: "short", iv: KEYS.iv }, { key: KEYS.key, iv: "short" }]) {
    assert.throws(() => payUniSandboxCrypto(keys), /KEYS_REJECTED/u);
  }
  assert.throws(() => crypto.decrypt(payUniSandboxCrypto({ key: "x".repeat(32), iv: KEYS.iv }).encrypt([["a", "b"]])));
});

test("only NotifyURL and ReturnURL change; merchant, order, amount and every other field stay byte-identical", () => {
  const original = serverForm();
  const withheld = withheldCallbackForm({ formPayload: original, expected: EXPECTED, crypto });
  assert.deepEqual(Object.keys(withheld.formPayload).sort(), ["EncryptInfo", "HashInfo", "MerID", "Version"]);
  assert.equal(withheld.formPayload.MerID, original.MerID);
  assert.equal(withheld.formPayload.Version, original.Version);
  assert.equal(withheld.formPayload.HashInfo, crypto.hash(withheld.formPayload.EncryptInfo));
  const before = crypto.decrypt(original.EncryptInfo);
  const after = crypto.decrypt(withheld.formPayload.EncryptInfo);
  assert.deepEqual(after.map(([name]) => name), before.map(([name]) => name));
  assert.deepEqual(after.map(([name]) => name).sort(), [...UPP_ENCRYPTED_FIELDS].sort());
  for (const [index, [name, value]] of after.entries()) {
    if (name === "NotifyURL") assert.equal(value, `${ALIAS_ORIGIN}${LOST_CALLBACK_SINK_PATH}?source=notify`);
    else if (name === "ReturnURL") assert.equal(value, `${ALIAS_ORIGIN}${LOST_CALLBACK_SINK_PATH}?source=return`);
    else assert.equal(value, before[index][1]);
  }
  assert.equal(withheld.sinkReturnUrl, sinkCallbackUrl(ALIAS_ORIGIN, "return"));
  // The sink is never the application's payment callback route.
  for (const [, value] of after.filter(([name]) => name.endsWith("URL"))) assert.equal(value.includes("/api/webhooks/payments"), false);
});

test("a form that is not exactly the application's staging Sandbox checkout is refused before PayUni", () => {
  const cases = [
    [{ ...serverForm(), HashInfo: "0".repeat(64) }, EXPECTED, /FORM_SIGNATURE_REJECTED/u],
    [{ ...serverForm(), MerID: "OTHERMER" }, EXPECTED, /FORM_SIGNATURE_REJECTED/u],
    [serverForm({ TradeAmt: 2 }), EXPECTED, /FORM_FIELDS_REJECTED/u],
    [serverForm({ MerTradeNo: "CDOTHER" }), EXPECTED, /FORM_FIELDS_REJECTED/u],
    [serverForm({ MerID: "OTHERMER" }), EXPECTED, /FORM_FIELDS_REJECTED/u],
    [serverForm({ Credit: 0 }), EXPECTED, /FORM_FIELDS_REJECTED/u],
    [serverForm({ NotifyURL: appCallbackUrl("https://celebratedeal.carry-digital-nomad.in.net", "notify") }), EXPECTED, /FORM_FIELDS_REJECTED/u],
    [serverForm({ ReturnURL: appCallbackUrl(ALIAS_ORIGIN, "notify") }), EXPECTED, /FORM_FIELDS_REJECTED/u],
    [serverForm({}, [["UsrMail", "x@invalid.example"]]), EXPECTED, /FORM_FIELDS_REJECTED/u],
    [serverForm({}, [["TradeAmt", "1"]]), EXPECTED, /FORM_FIELDS_REJECTED/u],
    [serverForm(), { ...EXPECTED, amountCents: 200 }, /CHECKOUT_SHAPE_REJECTED/u],
    [serverForm(), { ...EXPECTED, appOrigin: "https://celebratedeal.carry-digital-nomad.in.net" }, /CHECKOUT_SHAPE_REJECTED/u],
    [{ ...serverForm(), Extra: "x" }, EXPECTED, /CHECKOUT_SHAPE_REJECTED/u],
  ];
  for (const [formPayload, expected, error] of cases) {
    assert.throws(() => withheldCallbackForm({ formPayload, expected, crypto }), error);
  }
  const missing = crypto.encrypt(Object.entries({ MerID: KEYS.merchantId, MerTradeNo: ORDER, TradeAmt: 1 }));
  assert.throws(() => withheldCallbackForm({ formPayload: { MerID: KEYS.merchantId, Version: "1.0", EncryptInfo: missing, HashInfo: crypto.hash(missing) }, expected: EXPECTED, crypto }), /FORM_FIELDS_REJECTED/u);
});

test("the signed Return is PAID only for a verified, successful, matching collection", () => {
  assert.equal(classifySignedReturn(signedBody(PAID_RETURN), EXPECTED, crypto), "PAID");
  assert.equal(classifySignedReturn(signedBody({ ...PAID_RETURN, Status: "UPP02001", TradeStatus: "2" }), EXPECTED, crypto), "NOT_PAID");
  assert.equal(classifySignedReturn(signedBody({ ...PAID_RETURN, TradeStatus: "0" }), EXPECTED, crypto), "NOT_PAID");
  assert.equal(classifySignedReturn(signedBody({ ...PAID_RETURN, MerTradeNo: "CDOTHER" }), EXPECTED, crypto), "REJECTED");
  assert.equal(classifySignedReturn(signedBody({ ...PAID_RETURN, TradeAmt: "2" }), EXPECTED, crypto), "REJECTED");
  const forged = new URLSearchParams(signedBody(PAID_RETURN).toString());
  forged.set("HashInfo", "0".repeat(64));
  assert.equal(classifySignedReturn(Buffer.from(forged.toString()), EXPECTED, crypto), "REJECTED");
  assert.equal(classifySignedReturn(Buffer.alloc(0), EXPECTED, crypto), "REJECTED");
});

test("settlement evidence keeps only PayUni codes and amounts, never identifiers or text", () => {
  const sanitized = sanitizeSettlementRow({ ...PAID_ROW, CloseAmt: "", RefundStatus: "<script>", Message: "free text", Card6No: "400022" });
  assert.deepEqual(sanitized, {
    TradeStatus: "1", CloseStatus: "9", RefundStatus: "OTHER", RefundType: "ABSENT", DataSource: "A", PaymentType: "1",
    TradeAmt: "1", RemainAmt: "0", CloseAmt: "ABSENT", RefundAmt: "ABSENT",
  });
  assert.equal(JSON.stringify(sanitized).includes(ORDER), false);
  assert.equal(JSON.stringify(sanitized).includes("SYNTHTRADE1"), false);
  assert.equal(providerReportsPaid({ status: "FOUND", settlement: sanitized }), true);
  assert.equal(providerReportsPaid({ status: "FOUND", settlement: { ...sanitized, DataSource: "B" } }), false);
});

test("the provider query is a read-only signed trade query for one order and reports fixed statuses", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return queryResponse({ Status: "SUCCESS", Result: PAID_ROW });
  };
  const found = await queryProviderSettlement(ORDER, { crypto, merchantId: KEYS.merchantId, fetchImpl, now: () => 1_790_000_000_000 });
  assert.equal(found.status, "FOUND");
  assert.equal(found.settlement.CloseStatus, "9");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, PAYUNI_QUERY_URL);
  assert.equal(requests[0].init.method, "POST");
  const body = requests[0].init.body;
  assert.deepEqual([...body.keys()], ["MerID", "Version", "EncryptInfo", "HashInfo"]);
  assert.equal(body.get("Version"), "2.0");
  assert.deepEqual(crypto.decrypt(body.get("EncryptInfo")), [["MerID", KEYS.merchantId], ["MerTradeNo", ORDER], ["Timestamp", "1790000000"]]);

  assert.deepEqual(await queryProviderSettlement(ORDER, { crypto, merchantId: KEYS.merchantId, fetchImpl: async () => queryResponse({ Status: "QUERY03001" }) }),
    { status: "NOT_FOUND", providerCode: "QUERY03001", rows: 0, settlement: null });
  assert.equal((await queryProviderSettlement(ORDER, { crypto, merchantId: KEYS.merchantId, fetchImpl: async () => queryResponse({ Status: "SUCCESS", Result: PAID_ROW }, { forgeHash: true }) })).status, "QUERY_SIGNATURE_REJECTED");
  assert.equal((await queryProviderSettlement(ORDER, { crypto, merchantId: KEYS.merchantId, fetchImpl: async () => queryResponse({ Status: "SUCCESS", Result: [PAID_ROW, PAID_ROW] }) })).status, "MULTIPLE_ROWS");
  assert.equal((await queryProviderSettlement(ORDER, { crypto, merchantId: KEYS.merchantId, fetchImpl: async () => queryResponse({ Status: "SUCCESS", Result: { ...PAID_ROW, MerTradeNo: "CDOTHER" } }) })).status, "ROW_REJECTED");
  assert.equal((await queryProviderSettlement(ORDER, { crypto, merchantId: KEYS.merchantId, fetchImpl: async () => { throw new Error("synthetic network"); } })).status, "QUERY_FAILED");
  assert.equal((await queryProviderSettlement(ORDER, { crypto, merchantId: KEYS.merchantId, fetchImpl: async () => new Response("", { status: 502 }) })).status, "QUERY_HTTP_REJECTED");
  assert.equal((await queryProviderSettlement("bad order!", { crypto, merchantId: KEYS.merchantId, fetchImpl })).status, "QUERY_INPUT_REJECTED");
});

function preparedCheckout() {
  return {
    invocation: INPUT,
    checkout: {
      ok: true, provider: "payuni", orderNumber: ORDER, transactionId: "synthetic_tx", amountCents: 100, currency: "TWD",
      checkoutUrl: null, formAction: "https://sandbox-api.payuni.com.tw/api/upp", formMethod: "POST", formPayload: serverForm(),
      nextAction: "submit_payuni_upp_form", externalRequired: false,
    },
    supportCookie: "celebrate_support_synthetic=value",
    sideEffects: { fixturePosts: 1, admissionPosts: 1, checkoutPosts: 1, paymentAttemptPosts: 1 },
  };
}

function dependencies(overrides = {}) {
  const calls = { attest: 0, prepare: 0, browser: [], queries: 0, waits: 0 };
  const deps = {
    keys: KEYS,
    attest: async () => { calls.attest += 1; return { ok: true, operationHost: "celebrate-deal-staging.carry-digital-nomad.in.net" }; },
    prepareCheckout: async (input, options) => {
      calls.prepare += 1;
      assert.equal(options.operationHost, "celebrate-deal-staging.carry-digital-nomad.in.net");
      return preparedCheckout();
    },
    browser: async (input) => { calls.browser.push(input); return { code: "RETURN_CAPTURED", returnBody: signedBody(PAID_RETURN), returnPosts: 1, appCallbackRequests: 0 }; },
    queryProvider: async () => { calls.queries += 1; return { status: "FOUND", rows: 1, settlement: sanitizeSettlementRow(PAID_ROW) }; },
    wait: async () => { calls.waits += 1; },
    ...overrides,
  };
  return { deps, calls };
}

test("pay phase: one attested checkout, one withheld-callback submission, paid at PayUni, sanitized receipt", async () => {
  const { deps, calls } = dependencies();
  const receipt = await runLostCallbackPayment(INPUT, deps);
  assert.equal(receipt.result, "PAID_CALLBACK_WITHHELD");
  assert.equal(receipt.failure, "NONE");
  assert.equal(calls.attest, 1);
  assert.equal(calls.prepare, 1);
  assert.equal(calls.browser.length, 1);
  const submitted = calls.browser[0];
  assert.equal(submitted.sinkReturnUrl, sinkCallbackUrl(ALIAS_ORIGIN, "return"));
  const fields = new Map(crypto.decrypt(submitted.formPayload.EncryptInfo));
  assert.equal(fields.get("NotifyURL"), sinkCallbackUrl(ALIAS_ORIGIN, "notify"));
  assert.equal(fields.get("TradeAmt"), "1");
  assert.equal(fields.get("MerTradeNo"), ORDER);
  assert.deepEqual(receipt.sideEffects, { fixturePosts: 1, admissionPosts: 1, checkoutPosts: 1, paymentAttemptPosts: 1, paymentSubmissions: 1, refundSubmissions: 0 });
  assert.deepEqual(receipt.provider.afterPayment, { status: "FOUND", settlement: sanitizeSettlementRow(PAID_ROW) });
  assert.equal(validatePayReceipt(receipt), true);
  const text = JSON.stringify(receipt);
  for (const secret of [ORDER, "SYNTHTRADE1", "synthetic_tx", INPUT.cardNumber, INPUT.jobSecret, KEYS.key, KEYS.iv, "celebrate_support_", "https:"]) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test("pay phase refuses production or malformed input and an unattested alias before any write", async () => {
  for (const input of [{ ...INPUT, payuniEnv: "production" }, { ...INPUT, sourceSha: "main" }, { ...INPUT, cardCvv: "" }]) {
    const { deps, calls } = dependencies();
    const receipt = await runLostCallbackPayment(input, deps);
    assert.equal(receipt.failure, "INPUT_REJECTED");
    assert.equal(calls.attest + calls.prepare + calls.browser.length, 0);
  }
  const { deps, calls } = dependencies({ attest: async () => ({ ok: false, code: "ALIAS_ATTESTATION_HTTP_REJECTED" }) });
  assert.equal((await runLostCallbackPayment(INPUT, deps)).failure, "ALIAS_ATTESTATION_FAILED");
  assert.equal(calls.prepare + calls.browser.length, 0);
  const noKeys = dependencies({ keys: { ...KEYS, key: "" } });
  assert.equal((await runLostCallbackPayment(INPUT, noKeys.deps)).failure, "KEYS_REJECTED");
  assert.equal(noKeys.calls.attest, 0);
});

test("pay phase never submits a form that fails the field proof", async () => {
  const { deps, calls } = dependencies({
    prepareCheckout: async () => ({ ...preparedCheckout(), checkout: { ...preparedCheckout().checkout, formPayload: serverForm({ TradeAmt: 5 }) } }),
  });
  const receipt = await runLostCallbackPayment(INPUT, deps);
  assert.equal(receipt.failure, "FORM_FIELDS_REJECTED");
  assert.equal(receipt.sideEffects.paymentSubmissions, 0);
  assert.equal(calls.browser.length, 0);
});

test("pay phase fails closed on a browser callback attempt, a not-paid Return or an unconfirmed provider query", async () => {
  const attempted = dependencies({ browser: async () => ({ code: "RETURN_CAPTURED", returnBody: signedBody(PAID_RETURN), appCallbackRequests: 1 }) });
  assert.equal((await runLostCallbackPayment(INPUT, attempted.deps)).failure, "APP_CALLBACK_ATTEMPTED");

  const declined = dependencies({ browser: async () => ({ code: "RETURN_CAPTURED", returnBody: signedBody({ ...PAID_RETURN, Status: "UPP02001", TradeStatus: "2" }), appCallbackRequests: 0 }) });
  assert.equal((await runLostCallbackPayment(INPUT, declined.deps)).failure, "PAYMENT_NOT_PAID");
  assert.equal(declined.calls.queries, 0);

  const dialog = dependencies({ browser: async () => ({ code: "PAYMENT_CONFIRMATION_DIALOG", appCallbackRequests: 0 }) });
  assert.equal((await runLostCallbackPayment(INPUT, dialog.deps)).failure, "PAYMENT_CONFIRMATION_DIALOG");

  const pendingQueries = { n: 0 };
  const pending = dependencies({ queryProvider: async () => {
    pendingQueries.n += 1;
    return { status: "FOUND", rows: 1, settlement: sanitizeSettlementRow({ ...PAID_ROW, DataSource: "B" }) };
  } });
  const receipt = await runLostCallbackPayment(INPUT, pending.deps);
  assert.equal(receipt.failure, "PROVIDER_QUERY_UNCONFIRMED");
  assert.equal(pendingQueries.n, 6);
  assert.equal(pending.calls.waits, 5);
  assert.equal(receipt.provider.queryAttempts, 6);
  assert.equal(validatePayReceipt(receipt), true);

  const lateFound = { n: 0 };
  const eventually = dependencies({ queryProvider: async () => (++lateFound.n < 3 ? { status: "NOT_FOUND", rows: 0, settlement: null } : { status: "FOUND", rows: 1, settlement: sanitizeSettlementRow(PAID_ROW) }) });
  assert.equal((await runLostCallbackPayment(INPUT, eventually.deps)).result, "PAID_CALLBACK_WITHHELD");
  assert.equal(lateFound.n, 3);
});

test("a receipt that gained an identifier, URL or refund cannot be validated or written", async () => {
  const valid = createPayReceipt(SHA);
  assert.equal(validatePayReceipt(valid), true);
  assert.equal(validatePayReceipt({ ...valid, orderNumber: ORDER }), false);
  assert.equal(validatePayReceipt({ ...valid, checks: { ...valid.checks, note: ALIAS_ORIGIN } }), false);
  assert.equal(validatePayReceipt({ ...valid, sideEffects: { ...valid.sideEffects, refundSubmissions: 1 } }), false);
  assert.equal(validatePayReceipt({ ...valid, result: "PAID_CALLBACK_WITHHELD" }), false);
  const directory = await mkdtemp(join(tmpdir(), "lost-callback-receipt-"));
  try {
    const file = await writePayReceipt(valid, directory);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), valid);
    await assert.rejects(writePayReceipt({ ...valid, orderNumber: ORDER }, directory), /RECEIPT_REJECTED/u);
    await assert.rejects(writePayReceipt(valid, "relative"), /RECEIPT_PATH_REJECTED/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** A fake Playwright: records clicks, the UPP post and what each routed request became. */
function fakePlaywright({ dialogVisible = false, uppOk = true, onSubmit = async () => {} } = {}) {
  const log = { clicks: [], routes: [], uppPosts: [], launched: 0, closed: 0 };
  let contextHandler = null;
  async function dispatch(url, method = "GET", body = null) {
    const outcome = { action: null };
    await contextHandler({
      request: () => ({ url: () => url, method: () => method, postDataBuffer: () => body }),
      abort: async () => { outcome.action = "abort"; },
      continue: async () => { outcome.action = "continue"; },
      fulfill: async () => { outcome.action = "fulfill"; },
    });
    log.routes.push({ url, method, action: outcome.action });
    return outcome.action;
  }
  const locator = (name) => ({
    click: async () => { log.clicks.push(name); if (name === "確認送出") await onSubmit(dispatch); },
    check: async () => { log.clicks.push(`check:${name}`); },
    pressSequentially: async () => {},
    fill: async () => {},
    isVisible: async () => (name === "確定" ? dialogVisible : true),
    or: () => locator(name),
  });
  const page = {
    route: async () => {},
    goto: async () => {},
    getByText: (text) => locator(text),
    locator: (selector) => locator(selector),
    getByPlaceholder: (text) => locator(text),
    getByRole: (_role, options) => locator(options.name),
    waitForTimeout: async () => {},
  };
  const context = {
    route: async (_pattern, handler) => { contextHandler = handler; },
    newPage: async () => page,
    request: { post: async (url, options) => { log.uppPosts.push({ url, form: options.form }); return { ok: () => uppOk }; } },
  };
  const playwright = { chromium: { launch: async () => {
    log.launched += 1;
    return { newContext: async () => context, close: async () => { log.closed += 1; } };
  } } };
  return { playwright, log };
}

const BROWSER_INPUT = Object.freeze({
  formPayload: Object.freeze({ MerID: KEYS.merchantId, Version: "1.0", EncryptInfo: "00", HashInfo: "11" }),
  sinkReturnUrl: sinkCallbackUrl(ALIAS_ORIGIN, "return"),
  cardNumber: INPUT.cardNumber, cardExpiry: INPUT.cardExpiry, cardCvv: INPUT.cardCvv,
});
const submitClicks = (log) => log.clicks.filter((name) => name === "確認送出").length;

test("browser: a confirmation dialog is never clicked and the card form is submitted once", async () => {
  const { playwright, log } = fakePlaywright({ dialogVisible: true });
  const result = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright });
  assert.deepEqual(result, { code: "PAYMENT_CONFIRMATION_DIALOG", appCallbackRequests: 0 });
  assert.equal(submitClicks(log), 1);
  assert.equal(log.clicks.includes("確定"), false);
  assert.deepEqual(log.uppPosts, [{ url: PAYUNI_UPP_URL, form: BROWSER_INPUT.formPayload }]);
  assert.equal(log.closed, 1);
});

test("browser: app callbacks and foreign hosts are aborted; only the exact sink Return is captured", async () => {
  const returnBody = Buffer.from("EncryptInfo=aa&HashInfo=bb");
  const { playwright, log } = fakePlaywright({ onSubmit: async (dispatch) => {
    await dispatch(`${ALIAS_ORIGIN}/api/webhooks/payments?provider=payuni&source=notify`, "POST", Buffer.from("x"));
    await dispatch(`${ALIAS_ORIGIN}/api/webhooks/payments?provider=payuni&source=return`, "POST", Buffer.from("x"));
    await dispatch("https://evil.example/collect", "GET");
    await dispatch(`${ALIAS_ORIGIN}/checkout/result`, "GET");
    await dispatch(`${BROWSER_INPUT.sinkReturnUrl}&extra=1`, "POST", Buffer.from("not-this"));
    await dispatch(`${ALIAS_ORIGIN}${LOST_CALLBACK_SINK_PATH}?source=notify`, "POST", Buffer.from("not-this"));
    await dispatch("http://sandbox-api.payuni.com.tw/api/upp", "GET");
    await dispatch("https://sandbox-vendor.payuni.com.tw/static/app.js", "GET");
    await dispatch(BROWSER_INPUT.sinkReturnUrl, "POST", returnBody);
  } });
  const result = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright });
  assert.equal(result.code, "RETURN_CAPTURED");
  assert.equal(result.returnBody, returnBody);
  assert.equal(result.returnPosts, 1);
  assert.equal(result.appCallbackRequests, 2);
  assert.equal(submitClicks(log), 1);
  assert.deepEqual(log.routes.map((route) => route.action), ["abort", "abort", "abort", "abort", "abort", "abort", "abort", "continue", "fulfill"]);
  assert.equal(log.closed, 1);
});

test("browser: no Return or a rejected UPP document ends without a capture", async () => {
  const silent = fakePlaywright();
  assert.deepEqual(await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright: silent.playwright, returnWaitMs: 0 }),
    { code: "PAYMENT_RETURN_UNOBSERVED", appCallbackRequests: 0 });
  assert.equal(submitClicks(silent.log), 1);
  const rejected = fakePlaywright({ uppOk: false });
  assert.deepEqual(await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright: rejected.playwright }),
    { code: "PAYMENT_PROVIDER_HTTP_REJECTED", appCallbackRequests: 0 });
  assert.equal(submitClicks(rejected.log), 0);
  assert.equal(rejected.log.closed, 1);
});

const APP_DIRECTORY = fileURLToPath(new URL("../src/app/", import.meta.url));

/** Every page/route file under src/app as URL segment patterns (route groups, slots and private folders removed). */
function appRoutePatterns(directory = APP_DIRECTORY, segments = []) {
  const patterns = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_") || entry.name.startsWith("@")) continue;
      const routeGroup = /^\(.+\)$/u.test(entry.name);
      patterns.push(...appRoutePatterns(join(directory, entry.name), routeGroup ? segments : [...segments, entry.name]));
    } else if (/^(?:page|route)\.(?:tsx?|jsx?)$/u.test(entry.name)) {
      patterns.push(segments);
    }
  }
  return patterns;
}

function patternMatches(pattern, path) {
  if (pattern.length === 0) return path.length === 0;
  const [head, ...rest] = pattern;
  if (/^\[\[\.\.\..+\]\]$/u.test(head)) return true;
  if (/^\[\.\.\..+\]$/u.test(head)) return path.length >= 1;
  if (path.length === 0) return false;
  if (/^\[.+\]$/u.test(head)) return patternMatches(rest, path.slice(1));
  return head === path[0] && patternMatches(rest, path.slice(1));
}

test("the callback sink has no route on staging: no sink folder and no dynamic or catch-all route matches it", () => {
  assert.equal(LOST_CALLBACK_SINK_PATH, "/api/qa/payuni-lost-callback-sink");
  assert.equal(existsSync(join(APP_DIRECTORY, "api", "qa")), false);
  assert.equal(existsSync(join(APP_DIRECTORY, "api", "qa", "payuni-lost-callback-sink")), false);
  const patterns = appRoutePatterns();
  // The matcher itself is live: the real payment callback route is found.
  assert.equal(patterns.some((pattern) => patternMatches(pattern, ["api", "webhooks", "payments"])), true);
  for (const path of [["api", "qa"], ["api", "qa", "payuni-lost-callback-sink"]]) {
    assert.deepEqual(patterns.filter((pattern) => patternMatches(pattern, path)), [], path.join("/"));
  }
});

function runResponse(overrides = {}) {
  return new Response(JSON.stringify({ path: ".github/workflows/staging-payuni-lost-callback.yml", head_branch: "master",
    event: "workflow_dispatch", status: "completed", conclusion: "success", ...overrides }), { status: 200 });
}

test("verify gate: only a successful protected pay run's PAID_CALLBACK_WITHHELD receipt for the same SHA passes", async () => {
  const { deps } = dependencies();
  const paid = await runLostCallbackPayment(INPUT, deps);
  const receiptText = JSON.stringify(paid);
  const base = { sourceSha: SHA, runId: "4500000001", repository: "example-org/example-repo", token: "synthetic-token", receiptText };
  const requests = [];
  const fetchImpl = async (url, init) => { requests.push({ url, init }); return runResponse(); };
  assert.equal(await verifyPayRunReceipt(base, fetchImpl), "VERIFIED");
  assert.equal(requests[0].url, "https://api.github.com/repos/example-org/example-repo/actions/runs/4500000001");
  assert.equal(requests[0].init.headers.authorization, "Bearer synthetic-token");

  assert.equal(await verifyPayRunReceipt({ ...base, sourceSha: "b".repeat(40) }, fetchImpl), "PAY_RECEIPT_SOURCE_MISMATCH");
  assert.equal(await verifyPayRunReceipt({ ...base, receiptText: JSON.stringify(createPayReceipt(SHA)) }, fetchImpl), "PAY_RECEIPT_NOT_PAID");
  assert.equal(await verifyPayRunReceipt({ ...base, receiptText: JSON.stringify({ ...paid, orderNumber: ORDER }) }, fetchImpl), "PAY_RECEIPT_REJECTED");
  assert.equal(await verifyPayRunReceipt({ ...base, receiptText: undefined }, fetchImpl), "PAY_RECEIPT_MISSING");
  assert.equal(await verifyPayRunReceipt({ ...base, receiptText: "{" }, fetchImpl), "PAY_RECEIPT_MISSING");
  for (const runId of ["", "0", "12a", "1".repeat(21)]) {
    assert.equal(await verifyPayRunReceipt({ ...base, runId }, fetchImpl), "PAY_RUN_INPUT_REJECTED");
  }
  for (const overrides of [{ path: ".github/workflows/other.yml" }, { head_branch: "feature" }, { conclusion: "failure" }, { event: "push" }, { status: "in_progress" }]) {
    assert.equal(await verifyPayRunReceipt(base, async () => runResponse(overrides)), "PAY_RUN_REJECTED");
  }
  assert.equal(await verifyPayRunReceipt(base, async () => new Response("{}", { status: 404 })), "PAY_RUN_UNAVAILABLE");
  assert.equal(await verifyPayRunReceipt(base, async () => { throw new Error("synthetic network"); }), "PAY_RUN_UNAVAILABLE");
});
