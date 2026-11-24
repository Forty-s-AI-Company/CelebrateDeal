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
  printBrowserDiagnostic,
  providerReportsPaid,
  queryProviderSettlement,
  runLostCallbackPayment,
  sanitizeSettlementRow,
  sinkCallbackUrl,
  validatePayReceipt,
  withheldCallbackForm,
  writePayReceipt,
} from "./payuni-lost-callback-drill.mjs";
import {
  PAYUNI_MISSING_INFO_TEXT,
  collectPayUniFormFieldsInPage,
  formatPayUniDialogDiagnostic,
  formatPayUniFormFieldDiagnostic,
  payUniFieldMatchesInPage,
} from "./mvp-payuni-sandbox-e2e.mjs";

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

/** PayUni's own encoding: PHP http_build_query of { Status, Result: [row, ...] } (Result[0][Field]=...). */
function bracketQueryResponse(rows, { status = "SUCCESS", indexed = true } = {}) {
  const entries = [["Status", status], ["MerID", KEYS.merchantId]];
  rows.forEach((row, index) => {
    for (const [name, value] of Object.entries(row)) entries.push([indexed ? `Result[${index}][${name}]` : `Result[${name}]`, value]);
  });
  const encryptInfo = crypto.encrypt(entries);
  return new Response(new URLSearchParams({ MerID: KEYS.merchantId, Version: "2.0", EncryptInfo: encryptInfo, HashInfo: crypto.hash(encryptInfo) }).toString());
}

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

test("A4-05: PayUni's bracket-encoded Result rows (http_build_query) are read like the application reads them", async () => {
  const query = (response) => queryProviderSettlement(ORDER, { crypto, merchantId: KEYS.merchantId, fetchImpl: async () => response });
  // Run 45376157147: a signed paid Return, then six queries whose only Result was Result[0][...] fields.
  const found = await query(bracketQueryResponse([PAID_ROW]));
  assert.deepEqual(found, { status: "FOUND", rows: 1, resultShape: "BRACKET_FIELDS", rowCheck: "MATCHED", settlement: sanitizeSettlementRow(PAID_ROW) });
  assert.equal(providerReportsPaid(found), true);
  const unindexed = await query(bracketQueryResponse([PAID_ROW], { indexed: false }));
  assert.equal(unindexed.status, "FOUND");
  assert.equal(unindexed.resultShape, "BRACKET_FIELDS");

  // The same rules as any other encoding: two trades, another order or no order is never FOUND.
  assert.deepEqual(await query(bracketQueryResponse([PAID_ROW, { ...PAID_ROW, TradeNo: "SYNTHTRADE2" }])),
    { status: "MULTIPLE_ROWS", rows: 2, resultShape: "BRACKET_FIELDS", rowCheck: "MULTIPLE_ROWS", settlement: null });
  assert.deepEqual(await query(bracketQueryResponse([{ ...PAID_ROW, MerTradeNo: "CDOTHER" }])),
    { status: "ROW_REJECTED", rows: 1, resultShape: "BRACKET_FIELDS", rowCheck: "ORDER_MISMATCH", settlement: null });
  const withoutOrder = Object.fromEntries(Object.entries(PAID_ROW).filter(([name]) => name !== "MerTradeNo"));
  assert.deepEqual(await query(bracketQueryResponse([withoutOrder])),
    { status: "ROW_REJECTED", rows: 1, resultShape: "BRACKET_FIELDS", rowCheck: "ORDER_ABSENT", settlement: null });
  assert.deepEqual(await query(bracketQueryResponse([])),
    { status: "ROW_REJECTED", rows: 0, resultShape: "ABSENT", rowCheck: "NO_ROWS", settlement: null });
  assert.deepEqual(await query(queryResponse({ Status: "SUCCESS", Result: { ...PAID_ROW, MerTradeNo: "CDOTHER" } })),
    { status: "ROW_REJECTED", rows: 1, resultShape: "JSON_STRING", rowCheck: "ORDER_MISMATCH", settlement: null });
  // Like the application (optionalPayloadText): only a string or number counts, trimmed; never an
  // array or object that merely stringifies to the order number.
  assert.deepEqual(await query(queryResponse({ Status: "SUCCESS", Result: { ...PAID_ROW, MerTradeNo: [ORDER] } })),
    { status: "ROW_REJECTED", rows: 1, resultShape: "JSON_STRING", rowCheck: "ORDER_MISMATCH", settlement: null });
  assert.equal((await query(queryResponse({ Status: "SUCCESS", Result: { ...PAID_ROW, MerTradeNo: { value: ORDER } } }))).rowCheck, "ORDER_MISMATCH");
  assert.equal((await query(bracketQueryResponse([{ ...PAID_ROW, MerTradeNo: "   " }]))).rowCheck, "ORDER_ABSENT");
  assert.equal((await query(bracketQueryResponse([{ ...PAID_ROW, MerTradeNo: ` ${ORDER} ` }]))).rowCheck, "MATCHED");
  // A bracket field outside the Result namespace or with a nested key is ignored, never merged into a row.
  const strayInfo = crypto.encrypt([["Status", "SUCCESS"], ["Other[0][MerTradeNo]", ORDER], ["Result[0][Card][MerTradeNo]", ORDER]]);
  const stray = await query(new Response(new URLSearchParams({ MerID: KEYS.merchantId, EncryptInfo: strayInfo, HashInfo: crypto.hash(strayInfo) }).toString()));
  assert.deepEqual(stray,{ status: "ROW_REJECTED", rows: 0, resultShape: "ABSENT", rowCheck: "NO_ROWS", settlement: null });

  // The diagnostic carries enums and counts only.
  for (const result of [found, await query(bracketQueryResponse([{ ...PAID_ROW, MerTradeNo: "CDOTHER" }]))]) {
    const text = JSON.stringify(result);
    for (const value of [ORDER, "CDOTHER", "SYNTHTRADE1", KEYS.merchantId]) assert.equal(text.includes(value), false, value);
  }
});

test("A4-05: the pay phase confirms a bracket-encoded paid query with the real query reader", async () => {
  const requests = { n: 0 };
  const fetchImpl = async () => { requests.n += 1; return bracketQueryResponse([PAID_ROW]); };
  const { deps } = dependencies({ fetchImpl });
  delete deps.queryProvider;
  const receipt = await runLostCallbackPayment(INPUT, deps);
  assert.equal(receipt.result, "PAID_CALLBACK_WITHHELD");
  assert.equal(requests.n, 1);
  assert.deepEqual(receipt.provider.afterPayment, { status: "FOUND", resultShape: "BRACKET_FIELDS", rowCheck: "MATCHED", settlement: sanitizeSettlementRow(PAID_ROW) });
  assert.equal(validatePayReceipt(receipt), true);
  for (const value of [ORDER, "SYNTHTRADE1", KEYS.merchantId]) assert.equal(JSON.stringify(receipt).includes(value), false, value);

  // An unrecognised encoding still fails closed, now with the reason in the receipt.
  const absent = dependencies({ fetchImpl: async () => bracketQueryResponse([]) });
  delete absent.deps.queryProvider;
  const blocked = await runLostCallbackPayment(INPUT, absent.deps);
  assert.equal(blocked.failure, "PROVIDER_QUERY_UNCONFIRMED");
  assert.deepEqual(blocked.provider.afterPayment, { status: "ROW_REJECTED", resultShape: "ABSENT", rowCheck: "NO_ROWS", settlement: null });
  assert.equal(validatePayReceipt(blocked), true);
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

/** What queryProviderSettlement returns for PayUni's own paid answer. */
const MATCHED_PAID_QUERY = Object.freeze({ status: "FOUND", rows: 1, resultShape: "BRACKET_FIELDS", rowCheck: "MATCHED", settlement: sanitizeSettlementRow(PAID_ROW) });

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
    queryProvider: async () => { calls.queries += 1; return MATCHED_PAID_QUERY; },
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
  assert.deepEqual(receipt.provider.afterPayment, { status: "FOUND", resultShape: "BRACKET_FIELDS", rowCheck: "MATCHED", settlement: sanitizeSettlementRow(PAID_ROW) });
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
  const eventually = dependencies({ queryProvider: async () => (++lateFound.n < 3 ? { status: "NOT_FOUND", rows: 0, settlement: null } : MATCHED_PAID_QUERY) });
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
  // The query evidence holds fixed enums only: an extra key, a free-text status or an unknown shape is refused.
  const evidence = { status: "ROW_REJECTED", resultShape: "ABSENT", rowCheck: "NO_ROWS", settlement: null };
  assert.equal(validatePayReceipt({ ...valid, provider: { afterPayment: evidence, queryAttempts: 6 } }), true);
  assert.equal(validatePayReceipt({ ...valid, provider: { afterPayment: { ...evidence, merTradeNo: ORDER }, queryAttempts: 6 } }), false);
  assert.equal(validatePayReceipt({ ...valid, provider: { afterPayment: { ...evidence, status: "row rejected" }, queryAttempts: 6 } }), false);
  assert.equal(validatePayReceipt({ ...valid, provider: { afterPayment: { ...evidence, resultShape: "PHP" }, queryAttempts: 6 } }), false);
  assert.equal(validatePayReceipt({ ...valid, provider: { afterPayment: { ...evidence, rowCheck: ORDER }, queryAttempts: 6 } }), false);
  assert.equal(validatePayReceipt({ ...valid, provider: { afterPayment: { status: "FOUND", settlement: null }, queryAttempts: 6 } }), false);
  // v1 receipts (no resultShape/rowCheck) are a different schema.
  assert.equal(validatePayReceipt({ ...valid, schemaVersion: "celebratedeal-payuni-lost-callback-pay/v1" }), false);
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

test("v2: a PAID_CALLBACK_WITHHELD receipt must agree with its own matched, found query and providerQueryPaid", async () => {
  const paid = await runLostCallbackPayment(INPUT, dependencies().deps);
  assert.equal(paid.schemaVersion, "celebratedeal-payuni-lost-callback-pay/v2");
  assert.equal(validatePayReceipt(paid), true);
  const afterPayment = paid.provider.afterPayment;
  for (const forged of [
    { ...paid, provider: { ...paid.provider, afterPayment: { ...afterPayment, status: "ROW_REJECTED" } } },
    { ...paid, provider: { ...paid.provider, afterPayment: { ...afterPayment, rowCheck: "NONE" } } },
    { ...paid, provider: { ...paid.provider, afterPayment: { ...afterPayment, rowCheck: "ORDER_MISMATCH" } } },
    { ...paid, provider: { ...paid.provider, afterPayment: null } },
    { ...paid, checks: { ...paid.checks, providerQueryPaid: false } },
  ]) {
    assert.equal(validatePayReceipt(forged), false);
    const base = { sourceSha: SHA, runId: "4500000001", repository: "example-org/example-repo", token: "synthetic-token", receiptText: JSON.stringify(forged) };
    assert.equal(await verifyPayRunReceipt(base, async () => { throw new Error("must not be called"); }), "PAY_RECEIPT_REJECTED");
  }
  // A query answer without a row check (anything but queryProviderSettlement's own shape) never becomes a writable paid receipt.
  const unchecked = await runLostCallbackPayment(INPUT, dependencies({ queryProvider: async () => ({ status: "FOUND", rows: 1, settlement: sanitizeSettlementRow(PAID_ROW) }) }).deps);
  assert.equal(validatePayReceipt(unchecked), false);
});

/** The four fields the drill fills, by their exact placeholders; anything else typed is a contract break. */
const KNOWN_FIELD_PLACEHOLDERS = ["**** **** **** ****", "MM/YY", "***", "example@example.com"];

/**
 * A fake Playwright: records clicks, the UPP post, what each routed request became, and the order of
 * typing, blurs, pre-submit checks and the submit click in `log.events`. `fieldMatches(placeholder,
 * check)` is what the in-page value comparison answers; `pendingPayUniRequest` leaves one PayUni XHR
 * in flight for the whole run.
 */
function fakePlaywright({ dialogVisible = false, dialogRaw = null, nativeDialog = null, uppOk = true, onSubmit = async () => {}, onWait = async () => {}, frames = null,
  fieldMatches = () => true, submitEnabled = true, pendingPayUniRequest = false, loadState = async () => {} } = {}) {
  const log = { clicks: [], routes: [], uppPosts: [], launched: 0, closed: 0, evaluated: 0, nativeDismissed: 0, nativeAccepted: 0, nativeOrder: [], waits: 0,
    typed: [], typeOptions: [], frameEvaluations: [], events: [], fieldChecks: [], loadStates: [] };
  let contextHandler = null;
  let dialogHandler = null;
  const pageHandlers = new Map();
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
    click: async () => {
      log.clicks.push(name);
      if (name !== "確認送出") return;
      log.events.push("submit");
      await onSubmit(dispatch);
      if (nativeDialog && dialogHandler) {
        await dialogHandler({
          type: () => { log.nativeOrder.push("type"); return nativeDialog.type; },
          message: () => { log.nativeOrder.push("message"); if (nativeDialog.broken) throw new Error("gone"); return nativeDialog.message; },
          dismiss: () => {
            log.nativeOrder.push("dismiss");
            log.nativeDismissed += 1;
            if (nativeDialog.broken) throw new Error("already closed");
            return Promise.resolve();
          },
          accept: async () => { log.nativeAccepted += 1; },
        });
      }
    },
    check: async () => { log.clicks.push(`check:${name}`); },
    pressSequentially: async (_value, options) => { log.typed.push(name); log.typeOptions.push(options); log.events.push(`type:${name}`); },
    fill: async () => { log.typed.push(name); log.events.push(`fill:${name}`); },
    blur: async () => { log.events.push(`blur:${name}`); },
    isVisible: async () => (name === "確定" ? dialogVisible : true),
    isEnabled: async () => { log.events.push(`enabled:${name}`); return submitEnabled; },
    evaluate: async (fn, arg) => {
      if (name === "確定") { log.evaluated += 1; return dialogRaw; }
      // The in-page value comparison: it gets the expected value and answers only true/false.
      log.fieldChecks.push({ name, fn, step: arg?.step });
      log.events.push(`check:${name}`);
      return fieldMatches(name, log.fieldChecks.filter((item) => item.name === name).length);
    },
    or: () => locator(name),
  });
  const page = {
    on: (event, handler) => {
      if (event === "dialog") dialogHandler = handler;
      else pageHandlers.set(event, handler);
    },
    waitForLoadState: async (state) => { log.loadStates.push(state); await loadState(state); },
    route: async () => {},
    goto: async () => {
      if (!pendingPayUniRequest) return;
      // A PayUni XHR that starts after the document and never finishes.
      pageHandlers.get("request")?.({ url: () => "https://sandbox-api.payuni.com.tw/api/upp/bin", resourceType: () => "xhr" });
    },
    getByText: (text) => locator(text),
    locator: (selector) => locator(selector),
    getByPlaceholder: (text) => locator(text),
    getByRole: (_role, options) => locator(options.name),
    waitForTimeout: async () => { log.waits += 1; await onWait(dispatch, log.waits); },
  };
  if (frames) {
    page.frames = () => frames.map((frame) => ({
      url: () => frame.url,
      evaluate: async (fn, limit) => {
        log.frameEvaluations.push({ fn, limit });
        if (frame.onEvaluate) await frame.onEvaluate(dispatch);
        return frame.raw;
      },
    }));
  }
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
const DIAGNOSTIC_KEYS = ["afterSubmitSeconds", "dialogs", "externalHosts", "formFields", "payuniPostsAfterSubmit", "presubmit"];
/** A settled page: loaded, all four fields match, button enabled, no PayUni request in flight, two checks in a row. */
const SETTLED_PRESUBMIT = Object.freeze({
  status: "SETTLED", pageLoad: "LOADED", fields: { CARD_NUMBER: true, CARD_EXPIRY: true, CARD_CVV: true, EMAIL: true },
  submitEnabled: true, payuniInflight: 0, settleMs: 0, checks: 2,
});
/** The field list of a fake page without frames: still a status, never null. */
const noFrames = (missingInfoDialog = false) => ({ status: "NO_FRAMES", missingInfoDialog, frames: [], outcomes: [] });
/** Short settle timing for the fakes; production uses PAYUNI_SETTLE. */
const FAST = Object.freeze({ pollMs: 5, quietMs: 0, timeoutMs: 300 });
/** The whole diagnostic, with only the wall-clock seconds normalised. */
const fixedSeconds = (diagnostic) => {
  assert.deepEqual(Object.keys(diagnostic).sort(), DIAGNOSTIC_KEYS);
  assert.equal(diagnostic.afterSubmitSeconds === null || Number.isSafeInteger(diagnostic.afterSubmitSeconds), true);
  assert.equal(Number.isSafeInteger(diagnostic.presubmit.settleMs), true);
  return {
    ...diagnostic,
    afterSubmitSeconds: diagnostic.afterSubmitSeconds === null ? null : 0,
    presubmit: { ...diagnostic.presubmit, settleMs: 0 },
  };
};
/** Every field check and the enabled check come after the last typed key and blur, and before the one submit. */
const assertCheckedBeforeSubmit = (log) => {
  const submitAt = log.events.indexOf("submit");
  assert.equal(log.events.filter((event) => event === "submit").length, 1, "submitted exactly once");
  const lastFill = Math.max(...log.events.map((event, index) => (/^(?:type|fill|blur):/u.test(event) ? index : -1)));
  for (const name of KNOWN_FIELD_PLACEHOLDERS) {
    const checks = log.events.map((event, index) => (event === `check:${name}` ? index : -1)).filter((index) => index >= 0);
    assert.ok(checks.length >= 2, `${name} is checked twice in a row before the submit`);
    assert.ok(checks.every((index) => index > lastFill && index < submitAt), `${name} is checked after filling and before the submit`);
  }
  assert.ok(log.events.indexOf("enabled:確認送出") > lastFill && log.events.indexOf("enabled:確認送出") < submitAt);
};

test("browser: a confirmation dialog is never clicked and the card form is submitted once", async () => {
  const { playwright, log } = fakePlaywright({ dialogVisible: true });
  const result = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright });
  assert.deepEqual(Object.keys(result).sort(), ["appCallbackRequests", "code", "diagnostic"]);
  assert.deepEqual({ ...result, diagnostic: fixedSeconds(result.diagnostic) }, {
    code: "PAYMENT_CONFIRMATION_DIALOG", appCallbackRequests: 0,
    diagnostic: { dialogs: [{ kind: "UNREADABLE", text: "", buttons: [] }], externalHosts: [], payuniPostsAfterSubmit: 0, afterSubmitSeconds: 0,
      presubmit: SETTLED_PRESUBMIT, formFields: noFrames() },
  });
  assert.equal(submitClicks(log), 1);
  assert.equal(log.clicks.includes("確定"), false);
  assertCheckedBeforeSubmit(log);
  assert.deepEqual(log.uppPosts, [{ url: PAYUNI_UPP_URL, form: BROWSER_INPUT.formPayload }]);
  assert.equal(log.closed, 1);
});

test("browser: the unknown 確定 modal is read as de-identified text only, never clicked, and the drill stops", async () => {
  const dialogRaw = {
    kind: "MODAL_CLASS",
    text: `交易失敗 卡號 ${INPUT.cardNumber} 有效期 12/30 安全碼 ${INPUT.cardCvv} wp4-buyer-v1@invalid.example 訂單 ${ORDER} ${PAYUNI_UPP_URL}`,
    buttons: ["確定"],
  };
  const { playwright, log } = fakePlaywright({ dialogVisible: true, dialogRaw, onSubmit: async (dispatch) => {
    await dispatch("https://sandbox-api.payuni.com.tw/api/upp/pay", "POST", Buffer.from("x"));
    await dispatch("https://www.recaptcha-cdn.example/api.js?k=1", "GET");
    await dispatch("https://www.recaptcha-cdn.example/other.js", "GET");
    await dispatch("https://d1a2b3c4.cloudfront.net/x.js", "GET");
  } });
  const result = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright });
  assert.deepEqual({ ...result, diagnostic: fixedSeconds(result.diagnostic) }, {
    code: "PAYMENT_CONFIRMATION_DIALOG", appCallbackRequests: 0,
    diagnostic: {
      dialogs: [{ kind: "MODAL_CLASS", text: "交易失敗 卡號 # 有效期 # 安全碼 # EMAIL 訂單 ID URL", buttons: ["確定"] }],
      externalHosts: ["www.recaptcha-cdn.example", "*.cloudfront.net"], payuniPostsAfterSubmit: 1, afterSubmitSeconds: 0,
      presubmit: SETTLED_PRESUBMIT, formFields: noFrames(),
    },
  });
  assert.equal(submitClicks(log), 1);
  assert.equal(log.clicks.includes("確定"), false, "the dialog button is never clicked");
  assert.equal(log.evaluated, 1, "the dialog is read once");
  const line = formatPayUniDialogDiagnostic(result.diagnostic);
  for (const secret of [INPUT.cardNumber, INPUT.cardCvv, "12/30", "invalid.example", ORDER, "https:", "payuni.com.tw", "k=1", "d1a2b3c4"]) {
    assert.equal(line.includes(secret), false, `leaked ${secret}`);
  }
});

test("browser: a native dialog is dismissed before it is read, never accepted, and stops the drill after the grace", async () => {
  const stopped = fakePlaywright({ nativeDialog: { type: "alert", message: `交易失敗 ${INPUT.cardNumber}` } });
  const blocked = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright: stopped.playwright, nativeDialogGraceMs: 0 });
  assert.deepEqual({ ...blocked, diagnostic: fixedSeconds(blocked.diagnostic) }, {
    code: "PAYMENT_CONFIRMATION_DIALOG", appCallbackRequests: 0,
    diagnostic: { dialogs: [{ kind: "NATIVE_ALERT", text: "交易失敗 #", buttons: [] }], externalHosts: [], payuniPostsAfterSubmit: 0, afterSubmitSeconds: 0,
      presubmit: SETTLED_PRESUBMIT, formFields: noFrames() },
  });
  assert.equal(stopped.log.nativeOrder[0], "dismiss", "the dialog is dismissed before anything is read");
  assert.deepEqual(stopped.log.nativeOrder.slice(1).sort(), ["message", "type"]);
  assert.equal(stopped.log.nativeDismissed, 1);
  assert.equal(stopped.log.nativeAccepted, 0);
  assert.equal(submitClicks(stopped.log), 1);
  assert.equal(stopped.log.clicks.includes("確定"), false);

  // The overall Return deadline also ends the grace with the dialog code, not RETURN_UNOBSERVED.
  const late = fakePlaywright({ nativeDialog: { type: "confirm", message: "確定付款?" } });
  const ended = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright: late.playwright, returnWaitMs: 0 });
  assert.equal(ended.code, "PAYMENT_CONFIRMATION_DIALOG");
  assert.deepEqual(ended.diagnostic.dialogs, [{ kind: "NATIVE_CONFIRM", text: "確定付款?", buttons: [] }]);

  // A dialog whose dismiss and message throw still stops the drill with an empty, typed record.
  const broken = fakePlaywright({ nativeDialog: { type: "alert", message: "x", broken: true } });
  const brokenResult = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright: broken.playwright, nativeDialogGraceMs: 0 });
  assert.equal(brokenResult.code, "PAYMENT_CONFIRMATION_DIALOG");
  assert.deepEqual(brokenResult.diagnostic.dialogs, [{ kind: "NATIVE_ALERT", text: "", buttons: [] }]);
  assert.equal(broken.log.nativeDismissed, 1);
  assert.equal(broken.log.nativeAccepted, 0);
});

test("browser: a Return that arrives within the grace after a dismissed native dialog is captured and verified as usual", async () => {
  const returnBody = Buffer.from("EncryptInfo=aa&HashInfo=bb");
  const { playwright, log } = fakePlaywright({
    nativeDialog: { type: "confirm", message: `確定付款 NT$1？卡號 ${INPUT.cardNumber}` },
    onWait: async (dispatch, count) => { if (count === 2) await dispatch(BROWSER_INPUT.sinkReturnUrl, "POST", returnBody); },
  });
  const result = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright, nativeDialogGraceMs: 60_000 });
  assert.deepEqual(Object.keys(result).sort(), ["appCallbackRequests", "code", "diagnostic", "returnBody", "returnPosts"]);
  assert.deepEqual({ ...result, diagnostic: fixedSeconds(result.diagnostic) }, {
    code: "RETURN_CAPTURED", returnBody, returnPosts: 1, appCallbackRequests: 0,
    diagnostic: { dialogs: [{ kind: "NATIVE_CONFIRM", text: "確定付款 NT$1?卡號 #", buttons: [] }], externalHosts: [], payuniPostsAfterSubmit: 0, afterSubmitSeconds: 0,
      presubmit: SETTLED_PRESUBMIT, formFields: null },
  });
  assert.equal(log.waits, 2, "it kept waiting after the dialog until the Return arrived");
  assert.equal(log.nativeDismissed, 1);
  assert.equal(log.nativeAccepted, 0);
  assert.equal(submitClicks(log), 1);
  assert.equal(log.clicks.includes("確定"), false);
});

test("pay phase hands the browser diagnostic to the CLI printer only; the receipt keeps its fixed shape", async () => {
  const printed = [];
  const diagnostic = { dialogs: [{ kind: "MODAL_CLASS", text: "交易失敗", buttons: ["確定"] }], externalHosts: [], payuniPostsAfterSubmit: 0, afterSubmitSeconds: 3 };
  const { deps } = dependencies({
    browser: async () => ({ code: "PAYMENT_CONFIRMATION_DIALOG", appCallbackRequests: 0, diagnostic }),
    onBrowserDiagnostic: (value) => { printed.push(value); throw new Error("printer failure never changes the result"); },
  });
  const receipt = await runLostCallbackPayment(INPUT, deps);
  assert.equal(receipt.failure, "PAYMENT_CONFIRMATION_DIALOG");
  assert.deepEqual(printed, [diagnostic]);
  assert.equal(validatePayReceipt(receipt), true);
  assert.equal(JSON.stringify(receipt).includes("交易失敗"), false);
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
  // No dialog: the capture still carries the pre-submit state (printed on a pass too), no field list.
  assert.deepEqual({ ...result, diagnostic: fixedSeconds(result.diagnostic) }, {
    code: "RETURN_CAPTURED", returnBody, returnPosts: 1, appCallbackRequests: 2,
    diagnostic: { dialogs: [], externalHosts: ["evil.example", "sandbox-api.payuni.com.tw"], payuniPostsAfterSubmit: 0, afterSubmitSeconds: 0, presubmit: SETTLED_PRESUBMIT, formFields: null },
  });
  assert.equal(submitClicks(log), 1);
  assertCheckedBeforeSubmit(log);
  assert.deepEqual(log.routes.map((route) => route.action), ["abort", "abort", "abort", "abort", "abort", "abort", "abort", "continue", "fulfill"]);
  assert.equal(log.closed, 1);
});

test("browser: on the missing-info modal the drill lists the page's fields read-only, fills only the known four, submits once and stops", async () => {
  const frames = [
    { url: PAYUNI_UPP_URL, raw: { total: 2, fields: [
      { tag: "input", type: "text", placeholder: "**** **** **** ****", empty: false, value: INPUT.cardNumber, visible: true },
      { tag: "input", type: "checkbox", name: "agree", label: "我已閱讀並同意 隱私權政策", required: true, checked: false, visible: true },
    ] } },
    { url: "https://a1b2c3.hosted.example/field?card=1", raw: { fields: [{ tag: "input", type: "tel", placeholder: "手機號碼", empty: true }] } },
  ];
  const { playwright, log } = fakePlaywright({
    dialogVisible: true, frames,
    dialogRaw: { kind: "FIXED_LAYER", text: `${PAYUNI_MISSING_INFO_TEXT} 確定`, buttons: ["確定"] },
    onSubmit: async (dispatch) => { await dispatch("https://sandbox-api.payuni.com.tw/api/upp/pay", "POST", Buffer.from("x")); },
  });
  const result = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright });
  assert.equal(result.code, "PAYMENT_CONFIRMATION_DIALOG", "an unknown dialog still stops the drill");
  assert.equal(submitClicks(log), 1);
  assert.equal(log.clicks.includes("確定"), false, "the modal is never clicked");
  assert.deepEqual(log.typed, KNOWN_FIELD_PLACEHOLDERS, "only the four known fields are typed into");
  assert.ok(log.frameEvaluations.length === 2 && log.frameEvaluations.every(({ fn, limit }) => fn === collectPayUniFormFieldsInPage && limit === 25));
  assertCheckedBeforeSubmit(log);
  const { formFields } = result.diagnostic;
  assert.equal(formFields.status, "CAPTURED");
  assert.deepEqual(formFields.outcomes, [
    { frame: 0, host: "MAIN", outcome: "CAPTURED", stageErrors: [] },
    { frame: 1, host: "*.hosted.example", outcome: "CAPTURED", stageErrors: [] },
  ]);
  assert.equal(formFields.missingInfoDialog, true);
  assert.deepEqual(formFields.frames.map((frame) => frame.host), ["MAIN", "*.hosted.example"]);
  assert.deepEqual(formFields.frames[0].fields[1], { tag: "input", type: "checkbox", name: "agree", id: "", label: "我已閱讀並同意 隱私權政策",
    placeholder: "", autocomplete: "", visible: true, required: true, ariaRequired: false, empty: null, checked: false, invalid: false, disabled: false, shadow: false });
  const line = formatPayUniFormFieldDiagnostic(formFields);
  for (const secret of [INPUT.cardNumber, INPUT.cardCvv, "card=1", "a1b2c3", "https:"]) assert.equal(line.includes(secret), false, `leaked ${secret}`);
  // The dialog line keeps its fixed shape; the field list travels beside it.
  assert.deepEqual(Object.keys(JSON.parse(formatPayUniDialogDiagnostic(result.diagnostic))).sort(),
    ["afterSubmitSeconds", "dialogs", "externalHosts", "payuniPostsAfterSubmit"]);

  // A native dialog stop lists fields too; a page that cannot be read keeps the code and says why (never null).
  const native = fakePlaywright({ nativeDialog: { type: "alert", message: PAYUNI_MISSING_INFO_TEXT }, frames });
  const nativeResult = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright: native.playwright, nativeDialogGraceMs: 0 });
  assert.equal(nativeResult.code, "PAYMENT_CONFIRMATION_DIALOG");
  assert.equal(nativeResult.diagnostic.formFields.missingInfoDialog, true);
  assert.equal(native.log.nativeAccepted, 0);
  assert.deepEqual(native.log.typed, KNOWN_FIELD_PLACEHOLDERS);
  const unreadable = fakePlaywright({ dialogVisible: true });
  const unreadableResult = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright: unreadable.playwright });
  assert.equal(unreadableResult.code, "PAYMENT_CONFIRMATION_DIALOG");
  assert.deepEqual(unreadableResult.diagnostic.formFields, noFrames());
});

test("A4-05: a field list that cannot be read prints its fixed reason instead of disappearing", async () => {
  const dialogRaw = { kind: "FIXED_LAYER", text: `${PAYUNI_MISSING_INFO_TEXT} 確定`, buttons: ["確定"] };
  const pageError = Object.assign(new Error(`frame.evaluate: TypeError: Cannot read properties of undefined (reading 'x') at ${INPUT.cardNumber}`), { name: "Error" });
  const frames = [
    // The main frame throws inside the PayUni page; a child frame never answers.
    { url: PAYUNI_UPP_URL, raw: null, onEvaluate: async () => { throw pageError; } },
    { url: "https://sandbox-vendor.payuni.com.tw/x", raw: null, onEvaluate: () => new Promise(() => {}) },
  ];
  const { playwright, log } = fakePlaywright({ dialogVisible: true, frames, dialogRaw });
  const result = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright, formFieldBudget: { mainFrameMs: 50, childFrameMs: 50, totalMs: 500 } });
  assert.equal(result.code, "PAYMENT_CONFIRMATION_DIALOG");
  assert.equal(submitClicks(log), 1);
  assert.equal(log.clicks.includes("確定"), false);
  assert.deepEqual(result.diagnostic.formFields, {
    status: "SCRIPT_ERROR", missingInfoDialog: true, frames: [],
    outcomes: [
      { frame: 0, host: "MAIN", outcome: "SCRIPT_ERROR", stageErrors: [] },
      { frame: 1, host: "sandbox-vendor.payuni.com.tw", outcome: "TIMEOUT", stageErrors: [] },
    ],
  });
  const printed = [];
  printBrowserDiagnostic(result.diagnostic, (line) => printed.push(line));
  const fields = printed.find((line) => line.startsWith("payuni_lost_callback_form_fields="));
  assert.ok(fields, "the field line is printed even though no frame was readable");
  assert.equal(JSON.parse(fields.slice(fields.indexOf("=") + 1)).status, "SCRIPT_ERROR");
  for (const line of printed) {
    for (const secret of [INPUT.cardNumber, "Cannot read", "reading"]) assert.equal(line.includes(secret), false, `leaked ${secret}`);
  }

  // A page script that breaks one stage of the in-page reader still returns the rest, marked PARTIAL.
  const partial = fakePlaywright({ dialogVisible: true, dialogRaw, frames: [{ url: PAYUNI_UPP_URL,
    raw: { fields: [{ tag: "input", type: "checkbox", name: "agree" }], stageErrors: ["AGREEMENT:TypeError", "free text 4000221111111111"] } }] });
  const partialResult = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright: partial.playwright });
  assert.equal(partialResult.diagnostic.formFields.status, "PARTIAL");
  assert.deepEqual(partialResult.diagnostic.formFields.outcomes, [{ frame: 0, host: "MAIN", outcome: "PARTIAL", stageErrors: ["AGREEMENT:TypeError"] }]);

  // A formatter that throws prints FORMAT_FAILED for its own line; the other lines still print.
  const broken = { ...result.diagnostic };
  Object.defineProperty(broken, "formFields", { enumerable: true, get() { throw new Error("broken"); } });
  const brokenLines = [];
  printBrowserDiagnostic(broken, (line) => brokenLines.push(line));
  assert.ok(brokenLines.includes('payuni_lost_callback_form_fields={"status":"FORMAT_FAILED"}'));
  assert.ok(brokenLines.some((line) => line.startsWith("payuni_lost_callback_dialog=")));
  assert.ok(brokenLines.some((line) => line.startsWith("payuni_lost_callback_presubmit=")));
});

test("A4-05: every known field is typed key by key and blurred after the page loaded; fill() is never used", async () => {
  const { playwright, log } = fakePlaywright({ dialogVisible: true });
  await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright });
  assert.deepEqual(log.loadStates, ["domcontentloaded", "load"]);
  assert.deepEqual(log.typed, KNOWN_FIELD_PLACEHOLDERS, "only the four known fields, in order");
  assert.equal(log.events.some((event) => event.startsWith("fill:")), false);
  assert.ok(log.typeOptions.every((options) => Number.isSafeInteger(options?.delay) && options.delay > 0), "typed with a per-key delay");
  const typing = log.events.filter((event) => /^(?:type|blur):/u.test(event));
  assert.deepEqual(typing, KNOWN_FIELD_PLACEHOLDERS.flatMap((name) => [`type:${name}`, `blur:${name}`]), "each field is blurred right after it is typed");
  assert.ok(log.fieldChecks.every(({ fn }) => fn === payUniFieldMatchesInPage), "values are compared in the page only");
  assert.deepEqual([...new Set(log.fieldChecks.map(({ step }) => step))], ["CARD_NUMBER", "CARD_EXPIRY", "CARD_CVV", "EMAIL"]);
});

test("A4-05: a field that settles late is submitted once after it settles; one that never settles is never submitted", async () => {
  // The expiry field reads empty for the first two checks (a late formatter), then matches.
  const late = fakePlaywright({ dialogVisible: true, fieldMatches: (name, check) => name !== "MM/YY" || check > 2 });
  const lateResult = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright: late.playwright, payuniSettle: FAST });
  assert.equal(lateResult.code, "PAYMENT_CONFIRMATION_DIALOG");
  assert.equal(submitClicks(late.log), 1);
  assertCheckedBeforeSubmit(late.log);
  assert.equal(lateResult.diagnostic.presubmit.status, "SETTLED");
  assert.equal(lateResult.diagnostic.presubmit.checks, 4);

  for (const [options, status] of [
    [{ fieldMatches: (name) => name !== "MM/YY" }, "FIELDS_UNSETTLED"],
    [{ submitEnabled: false }, "SUBMIT_DISABLED"],
    [{ pendingPayUniRequest: true }, "NETWORK_BUSY"],
  ]) {
    const { playwright, log } = fakePlaywright({ dialogVisible: true, ...options });
    const result = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright, payuniSettle: { ...FAST, quietMs: 50 } });
    assert.equal(result.code, "PAYMENT_FIELDS_UNSETTLED", status);
    assert.equal(submitClicks(log), 0, `${status}: never submitted`);
    assert.equal(log.clicks.includes("確定"), false);
    assert.equal(result.diagnostic.presubmit.status, status);
    assert.equal(result.diagnostic.payuniPostsAfterSubmit, null, "nothing was submitted");
    assert.equal(log.closed, 1);
    const printed = [];
    printBrowserDiagnostic(result.diagnostic, (line) => printed.push(line));
    assert.deepEqual(printed.map((line) => line.slice(0, line.indexOf("="))), ["payuni_lost_callback_presubmit"]);
    for (const secret of [INPUT.cardNumber, INPUT.cardCvv, "wp4-buyer"]) assert.equal(printed[0].includes(secret), false);
  }
  const unsettled = fakePlaywright({ fieldMatches: () => false });
  const unsettledResult = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright: unsettled.playwright, payuniSettle: FAST });
  assert.deepEqual(unsettledResult.diagnostic.presubmit.fields, { CARD_NUMBER: false, CARD_EXPIRY: false, CARD_CVV: false, EMAIL: false });

  // The pay phase records no card submission for a page that never settled.
  const { deps } = dependencies({ browser: async () => unsettledResult });
  const receipt = await runLostCallbackPayment(INPUT, deps);
  assert.equal(receipt.failure, "PAYMENT_FIELDS_UNSETTLED");
  assert.equal(receipt.sideEffects.paymentSubmissions, 0);
  assert.equal(validatePayReceipt(receipt), true);
});

test("browser: the dialog result is fixed before the field list is read; a callback during the read changes nothing", async () => {
  const frames = [{
    url: PAYUNI_UPP_URL,
    raw: { fields: [{ tag: "input", type: "checkbox", name: "agree", required: true, checked: false }] },
    onEvaluate: async (dispatch) => {
      // A slow read during which the page fires an application callback.
      await new Promise((resolve) => { setTimeout(resolve, 1_600); });
      assert.equal(await dispatch(`${ALIAS_ORIGIN}/api/webhooks/payments?provider=payuni&source=notify`, "POST", Buffer.from("x")), "abort");
    },
  }];
  const { playwright, log } = fakePlaywright({
    dialogVisible: true, frames, dialogRaw: { kind: "FIXED_LAYER", text: `${PAYUNI_MISSING_INFO_TEXT} 確定`, buttons: ["確定"] },
  });
  const result = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright });
  assert.equal(result.code, "PAYMENT_CONFIRMATION_DIALOG");
  assert.equal(result.appCallbackRequests, 0, "the callback count was fixed before the read");
  assert.equal(result.diagnostic.afterSubmitSeconds, 0, "the seconds were fixed before the 1.6 s read");
  assert.equal(result.diagnostic.formFields.missingInfoDialog, true);
  assert.equal(result.diagnostic.formFields.frames[0].fields[0].name, "agree");
  assert.equal(log.routes.at(-1).action, "abort", "the late callback is still aborted");
  assert.equal(submitClicks(log), 1);
  assert.equal(log.clicks.includes("確定"), false);

  // The pay phase therefore still reports the dialog, not APP_CALLBACK_ATTEMPTED.
  const { deps } = dependencies({ browser: async () => result });
  assert.equal((await runLostCallbackPayment(INPUT, deps)).failure, "PAYMENT_CONFIRMATION_DIALOG");
});

test("browser: no Return or a rejected UPP document ends without a capture", async () => {
  const silent = fakePlaywright();
  const unobserved = await defaultLostCallbackBrowser(BROWSER_INPUT, { playwright: silent.playwright, returnWaitMs: 0 });
  assert.deepEqual({ ...unobserved, diagnostic: fixedSeconds(unobserved.diagnostic) }, {
    code: "PAYMENT_RETURN_UNOBSERVED", appCallbackRequests: 0,
    diagnostic: { dialogs: [], externalHosts: [], payuniPostsAfterSubmit: 0, afterSubmitSeconds: 0, presubmit: SETTLED_PRESUBMIT, formFields: null },
  });
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
