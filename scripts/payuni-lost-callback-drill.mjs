import { createCipheriv, createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  attestOperationHost,
  defaultRequest,
  fixedBrowserEnvironment,
  prepareIssuedRecoveryCheckout,
  readFixedInputs,
  validateInvocation,
} from "./mvp-payuni-sandbox-e2e.mjs";
import { STAGING_ALIAS_HOST } from "./secure-staging-runner.mjs";

/**
 * A4-05: PayUni Sandbox drill for "the Notify never arrived" (A-2 05,
 * `/api/jobs/payment-reconcile`).
 *
 * Phase `pay` (this file) creates the fixed WP4 synthetic buyer checkout for
 * the attested staging deployment (one per source SHA, NT$1, server-priced),
 * then pays it in PayUni Sandbox with the callback targets withheld: before
 * the UPP form is posted, the runner decrypts the server-built EncryptInfo with
 * the Sandbox key, proves every field is the one the application built
 * (merchant, order number, server amount, card-only flag, the two staging
 * callback URLs), and replaces only NotifyURL and ReturnURL with a path that
 * has no route on staging. PayUni's Notify then gets a 404 and the payer's
 * Return POST is answered inside the isolated browser, so the application
 * never learns about the payment. Amount, order number and merchant are never
 * changed. The signed Return is decrypted in memory only to prove PayUni
 * reported the payment as paid; it is never forwarded.
 *
 * Phase `verify` lives in `payuni-lost-callback-proof.ts` (read-only staging
 * database snapshot plus a read-only PayUni query); it runs once right after
 * this step (expecting the callback to be missing) and again after the
 * reconcile job (expecting exactly one reconciled posting).
 *
 * The receipt carries fixed enums, booleans, counts and the sanitized PayUni
 * settlement codes (TradeStatus/CloseStatus/RemainAmt...) only: no order
 * number, trade number, URL, card value, key or provider text.
 */

export const LOST_CALLBACK_PAY_SCHEMA = "celebratedeal-payuni-lost-callback-pay/v1";
export const PAYUNI_UPP_URL = "https://sandbox-api.payuni.com.tw/api/upp";
export const PAYUNI_QUERY_URL = "https://sandbox-api.payuni.com.tw/api/trade/query";
const PAYUNI_HOSTS = new Set(["sandbox-api.payuni.com.tw", "sandbox-vendor.payuni.com.tw"]);
/** No route exists here on staging: a Notify sent to it is a 404 and changes nothing. */
export const LOST_CALLBACK_SINK_PATH = "/api/qa/payuni-lost-callback-sink";
const APP_CALLBACK_PATH = "/api/webhooks/payments";
/** Exactly the fields `createCheckoutSession` encrypts for a PayUni UPP checkout (payuni.ts). */
export const UPP_ENCRYPTED_FIELDS = Object.freeze(["MerID", "MerTradeNo", "TradeAmt", "Timestamp", "ProdDesc", "Credit", "ReturnURL", "NotifyURL"]);
const FORM_FIELDS = Object.freeze(["MerID", "Version", "EncryptInfo", "HashInfo"]);
const FIXED_AMOUNT_CENTS = 100;
const SYNTHETIC_PAYER_EMAIL = "wp4-buyer-v1@invalid.example";
const REQUEST_TIMEOUT_MS = 30_000;
const RETURN_WAIT_MS = 90_000;
const PROVIDER_QUERY_ATTEMPTS = 6;
const PROVIDER_QUERY_INTERVAL_MS = 10_000;
const RECEIPT_DIRECTORY = "payuni-lost-callback";
const PAY_RECEIPT_FILENAME = "pay.json";

export const PAY_FAILURE_CODES = Object.freeze([
  "NONE",
  "INPUT_REJECTED",
  "KEYS_REJECTED",
  "ALIAS_ATTESTATION_FAILED",
  "CHECKOUT_PREPARATION_REJECTED",
  "CHECKOUT_SHAPE_REJECTED",
  "FORM_SIGNATURE_REJECTED",
  "FORM_FIELDS_REJECTED",
  "PAYMENT_PROVIDER_HTTP_REJECTED",
  "PAYMENT_PAGE_REJECTED",
  "PAYMENT_CONFIRMATION_DIALOG",
  "PAYMENT_RETURN_UNOBSERVED",
  "PAYMENT_RETURN_REJECTED",
  "PAYMENT_NOT_PAID",
  "APP_CALLBACK_ATTEMPTED",
  "PROVIDER_QUERY_UNCONFIRMED",
  "INTERNAL_REJECTED",
]);
const FAILURES = new Set(PAY_FAILURE_CODES);

class DrillError extends Error {
  constructor(code) {
    super(FAILURES.has(code) ? code : "INTERNAL_REJECTED");
    this.name = "DrillError";
    this.code = FAILURES.has(code) ? code : "INTERNAL_REJECTED";
  }
}

function reject(code) {
  throw new DrillError(code);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

/**
 * The PayUni AES-256-GCM envelope with the Sandbox key material (same scheme
 * as `src/lib/payment-providers/payuni.ts`). Field order is kept so a
 * re-encrypted payload differs from the original only in the replaced values.
 */
export function payUniSandboxCrypto({ key, iv } = {}) {
  if (typeof key !== "string" || typeof iv !== "string" || Buffer.byteLength(key) !== 32 || Buffer.byteLength(iv) !== 16) {
    reject("KEYS_REJECTED");
  }
  return Object.freeze({
    encrypt(entries) {
      const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv), { authTagLength: 16 });
      const plaintext = new URLSearchParams(entries.map(([name, value]) => [name, String(value)])).toString();
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
      return Buffer.from(`${encrypted}:::${cipher.getAuthTag().toString("base64")}`).toString("hex");
    },
    /** Ordered [name, value] pairs; throws on a wrong key, a forged tag or a malformed envelope. */
    decrypt(value) {
      if (typeof value !== "string" || !/^[0-9a-f]+$/iu.test(value) || value.length > 16_384) throw new Error("envelope");
      const [encrypted, tag] = Buffer.from(value, "hex").toString("utf8").split(":::");
      if (!encrypted || !tag) throw new Error("envelope");
      const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
      return [...new URLSearchParams(plaintext).entries()];
    },
    hash(value) {
      return createHash("sha256").update(`${key}${value}${iv}`).digest("hex").toUpperCase();
    },
  });
}

/** Process inputs for the pay phase. Never enumerates the environment. */
export function readSandboxKeyInputs(source = process.env) {
  return {
    merchantId: source.PAYUNI_SANDBOX_MERCHANT_ID,
    key: source.PAYUNI_SANDBOX_HASH_KEY,
    iv: source.PAYUNI_SANDBOX_HASH_IV,
  };
}

function wholeUnits(value) {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^(?:0|[1-9]\d{0,8})(?:\.0{1,2})?$/u.test(text)) return null;
  return Number(text.split(".")[0]);
}

export function appCallbackUrl(appOrigin, source) {
  const url = new URL(APP_CALLBACK_PATH, appOrigin);
  url.searchParams.set("provider", "payuni");
  url.searchParams.set("source", source);
  return url.toString();
}

export function sinkCallbackUrl(appOrigin, source) {
  const url = new URL(LOST_CALLBACK_SINK_PATH, appOrigin);
  url.searchParams.set("source", source);
  return url.toString();
}

/**
 * Replaces only NotifyURL and ReturnURL of the server-built UPP form. Every
 * other field must already be exactly what the application built for this
 * checkout, and the original HashInfo must verify with the Sandbox key, so a
 * wrong key, a production form or a changed amount fails closed before
 * anything is sent to PayUni.
 */
export function withheldCallbackForm({ formPayload, expected, crypto }) {
  if (!exactKeys(formPayload, FORM_FIELDS) || FORM_FIELDS.some((name) => typeof formPayload[name] !== "string" || !formPayload[name])) {
    reject("CHECKOUT_SHAPE_REJECTED");
  }
  const { merchantId, orderNumber, amountCents, appOrigin } = expected ?? {};
  if (typeof merchantId !== "string" || !merchantId || typeof orderNumber !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(orderNumber)
    || amountCents !== FIXED_AMOUNT_CENTS || appOrigin !== `https://${STAGING_ALIAS_HOST}`) {
    reject("CHECKOUT_SHAPE_REJECTED");
  }
  if (!safeEqual(formPayload.MerID, merchantId) || !safeEqual(crypto.hash(formPayload.EncryptInfo), formPayload.HashInfo)) {
    reject("FORM_SIGNATURE_REJECTED");
  }
  let entries;
  try {
    entries = crypto.decrypt(formPayload.EncryptInfo);
  } catch {
    reject("FORM_SIGNATURE_REJECTED");
  }
  const fields = new Map(entries);
  if (fields.size !== entries.length || fields.size !== UPP_ENCRYPTED_FIELDS.length
    || UPP_ENCRYPTED_FIELDS.some((name) => !fields.has(name))) reject("FORM_FIELDS_REJECTED");
  if (fields.get("MerID") !== merchantId
    || fields.get("MerTradeNo") !== orderNumber
    || wholeUnits(fields.get("TradeAmt")) !== amountCents / 100
    || fields.get("Credit") !== "1"
    || !/^\d{9,11}$/u.test(fields.get("Timestamp") ?? "")
    || fields.get("NotifyURL") !== appCallbackUrl(appOrigin, "notify")
    || fields.get("ReturnURL") !== appCallbackUrl(appOrigin, "return")) {
    reject("FORM_FIELDS_REJECTED");
  }
  const replacements = { NotifyURL: sinkCallbackUrl(appOrigin, "notify"), ReturnURL: sinkCallbackUrl(appOrigin, "return") };
  const encryptInfo = crypto.encrypt(entries.map(([name, value]) => [name, replacements[name] ?? value]));
  return Object.freeze({
    formPayload: Object.freeze({ MerID: formPayload.MerID, Version: formPayload.Version, EncryptInfo: encryptInfo, HashInfo: crypto.hash(encryptInfo) }),
    sinkReturnUrl: replacements.ReturnURL,
  });
}

/**
 * The signed UPP Return PayUni posted to the browser, reduced to one enum.
 * PAID needs a valid HashInfo, Status SUCCESS, TradeStatus 1, this order and
 * the server amount.
 */
export function classifySignedReturn(body, expected, crypto) {
  try {
    const text = Buffer.isBuffer(body) ? body.toString("utf8") : typeof body === "string" ? body : "";
    if (!text || text.length > 16_384) return "REJECTED";
    const outer = Object.fromEntries(new URLSearchParams(text).entries());
    if (typeof outer.EncryptInfo !== "string" || typeof outer.HashInfo !== "string"
      || !safeEqual(crypto.hash(outer.EncryptInfo), outer.HashInfo.trim())) return "REJECTED";
    const inner = Object.fromEntries(crypto.decrypt(outer.EncryptInfo));
    if (inner.MerTradeNo !== expected.orderNumber || wholeUnits(inner.TradeAmt) !== expected.amountCents / 100) return "REJECTED";
    return inner.Status === "SUCCESS" && String(inner.TradeStatus) === "1" ? "PAID" : "NOT_PAID";
  } catch {
    return "REJECTED";
  }
}

const SETTLEMENT_CODE_FIELDS = Object.freeze(["TradeStatus", "CloseStatus", "RefundStatus", "RefundType", "DataSource", "PaymentType"]);
const SETTLEMENT_AMOUNT_FIELDS = Object.freeze(["TradeAmt", "RemainAmt", "CloseAmt", "RefundAmt"]);

/** Only the PayUni settlement codes and the synthetic NT$1 amounts; any other value becomes OTHER. */
export function sanitizeSettlementRow(row) {
  const source = row && typeof row === "object" && !Array.isArray(row) ? row : {};
  const value = (name, pattern) => {
    const raw = source[name];
    if (raw === undefined || raw === null || raw === "") return "ABSENT";
    const text = String(raw).trim();
    return pattern.test(text) ? text : "OTHER";
  };
  return Object.freeze(Object.fromEntries([
    ...SETTLEMENT_CODE_FIELDS.map((name) => [name, value(name, /^[0-9A-Z]{1,4}$/u)]),
    ...SETTLEMENT_AMOUNT_FIELDS.map((name) => [name, value(name, /^\d{1,9}(?:\.\d{1,2})?$/u)]),
  ]));
}

function payUniResultRows(response) {
  const result = response.Result;
  if (Array.isArray(result)) return result;
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      const parsed = Object.fromEntries(new URLSearchParams(result).entries());
      return Object.keys(parsed).length ? [parsed] : [];
    }
  }
  if (result && typeof result === "object") return [result];
  return [];
}

/**
 * Read-only PayUni trade query (Ver 2.0) for one order number. Returns the
 * sanitized settlement of the single row, or a fixed status. Never returns
 * the order or trade number.
 *
 * @param {string} orderNumber
 * @param {{ crypto: ReturnType<typeof payUniSandboxCrypto>, merchantId: string, fetchImpl?: typeof fetch, now?: () => number }} options
 */
export async function queryProviderSettlement(orderNumber, { crypto, merchantId, fetchImpl = fetch, now = () => Date.now() }) {
  if (typeof orderNumber !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(orderNumber) || typeof merchantId !== "string" || !merchantId) {
    return Object.freeze({ status: "QUERY_INPUT_REJECTED", rows: 0, settlement: null });
  }
  try {
    const encryptInfo = crypto.encrypt([["MerID", merchantId], ["MerTradeNo", orderNumber], ["Timestamp", Math.floor(now() / 1000)]]);
    const response = await fetchImpl(PAYUNI_QUERY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "payuni" },
      body: new URLSearchParams({ MerID: merchantId, Version: "2.0", EncryptInfo: encryptInfo, HashInfo: crypto.hash(encryptInfo) }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return Object.freeze({ status: "QUERY_HTTP_REJECTED", rows: 0, settlement: null });
    const text = await response.text();
    let outer;
    try {
      outer = JSON.parse(text);
    } catch {
      outer = Object.fromEntries(new URLSearchParams(text).entries());
    }
    if (typeof outer?.EncryptInfo !== "string" || typeof outer.HashInfo !== "string"
      || !safeEqual(crypto.hash(outer.EncryptInfo), outer.HashInfo.trim())) {
      return Object.freeze({ status: "QUERY_SIGNATURE_REJECTED", rows: 0, settlement: null });
    }
    const inner = Object.fromEntries(crypto.decrypt(outer.EncryptInfo));
    if (inner.Status !== "SUCCESS") {
      const code = typeof inner.Status === "string" && /^[A-Z]{2,10}\d{2,10}$/u.test(inner.Status) ? inner.Status : "OTHER";
      return Object.freeze({ status: code === "QUERY03001" ? "NOT_FOUND" : "PROVIDER_STATUS_OTHER", providerCode: code, rows: 0, settlement: null });
    }
    const rows = payUniResultRows(inner);
    if (rows.length !== 1 || String(rows[0]?.MerTradeNo ?? "") !== orderNumber) {
      return Object.freeze({ status: rows.length > 1 ? "MULTIPLE_ROWS" : "ROW_REJECTED", rows: Math.min(rows.length, 99), settlement: null });
    }
    return Object.freeze({ status: "FOUND", rows: 1, settlement: sanitizeSettlementRow(rows[0]) });
  } catch {
    return Object.freeze({ status: "QUERY_FAILED", rows: 0, settlement: null });
  }
}

/** True once PayUni reports a complete (DataSource A) collected card trade. */
export function providerReportsPaid(snapshot) {
  return snapshot?.status === "FOUND" && snapshot.settlement?.TradeStatus === "1"
    && snapshot.settlement.DataSource === "A" && snapshot.settlement.PaymentType === "1";
}

export function createPayReceipt(sourceSha = null) {
  return {
    schemaVersion: LOST_CALLBACK_PAY_SCHEMA,
    sourceSha: typeof sourceSha === "string" && /^[a-f0-9]{40}$/u.test(sourceSha) ? sourceSha : null,
    environment: "sandbox",
    result: "BLOCKED",
    failure: "INPUT_REJECTED",
    checks: {
      aliasAttested: false,
      checkoutCreated: false,
      paymentAttemptReserved: false,
      callbackTargetsWithheld: false,
      providerReturnedPaid: false,
      appCallbacksBlockedInBrowser: 0,
      providerQueryPaid: false,
    },
    provider: { afterPayment: null, queryAttempts: 0 },
    sideEffects: { fixturePosts: 0, admissionPosts: 0, checkoutPosts: 0, paymentAttemptPosts: 0, paymentSubmissions: 0, refundSubmissions: 0 },
    safety: { rawIdentifiersPersisted: false, rawUrlsPersisted: false, secretsPersisted: false, productionOperations: false },
  };
}

function fail(receipt, code) {
  receipt.result = "BLOCKED";
  receipt.failure = FAILURES.has(code) ? code : "INTERNAL_REJECTED";
  return receipt;
}

/**
 * The isolated payer browser. It reaches only the two PayUni Sandbox hosts;
 * the withheld Return is answered locally and an application callback URL is
 * never allowed through (counted, then aborted).
 */
export async function defaultLostCallbackBrowser(input, dependencies = {}) {
  const { chromium } = dependencies.playwright ?? await import("playwright");
  const browser = await chromium.launch({ headless: true, env: fixedBrowserEnvironment(), args: ["--no-proxy-server", "--disable-quic"] });
  let returnBody = null;
  let returnPosts = 0;
  let appCallbackRequests = 0;
  try {
    const context = await browser.newContext({ locale: "zh-TW" });
    const appOrigin = new URL(input.sinkReturnUrl).origin;
    await context.route("**/*", (route) => {
      const request = route.request();
      let url;
      try { url = new URL(request.url()); } catch { return route.abort(); }
      if (url.href === input.sinkReturnUrl) {
        if (request.method() === "POST") {
          returnPosts += 1;
          const body = request.postDataBuffer();
          if (returnPosts === 1 && Buffer.isBuffer(body)) returnBody = body;
        }
        return route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: "Sandbox return withheld by the lost-callback drill." });
      }
      if (url.origin === appOrigin && url.pathname === APP_CALLBACK_PATH) {
        appCallbackRequests += 1;
        return route.abort();
      }
      return url.protocol === "https:" && PAYUNI_HOSTS.has(url.hostname) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    // Same document handling as the WP4 runner: post the UPP form once through
    // the isolated request context, then serve that exact response to the page.
    const document = await context.request.post(PAYUNI_UPP_URL, {
      form: input.formPayload, failOnStatusCode: false, maxRedirects: 0, timeout: REQUEST_TIMEOUT_MS,
    });
    if (!document.ok()) return { code: "PAYMENT_PROVIDER_HTTP_REJECTED", appCallbackRequests };
    await page.route(PAYUNI_UPP_URL, (route) => route.fulfill({ response: document }), { times: 1 });
    await page.goto(PAYUNI_UPP_URL, { waitUntil: "commit", timeout: REQUEST_TIMEOUT_MS });
    try {
      await page.getByText("一次付清", { exact: true }).click({ timeout: 20_000 });
      await page.locator('input[name="radioOptionpayGroupCredit"]').check({ force: true, timeout: 10_000 });
      const card = page.getByPlaceholder("**** **** **** ****", { exact: true }).or(page.getByPlaceholder("16 碼或 19 碼", { exact: true }));
      await card.pressSequentially(input.cardNumber, { timeout: 20_000 });
      await page.getByPlaceholder("MM/YY", { exact: true }).pressSequentially(input.cardExpiry, { timeout: 20_000 });
      await page.getByPlaceholder("***", { exact: true }).pressSequentially(input.cardCvv, { timeout: 20_000 });
      await page.getByPlaceholder("example@example.com", { exact: true }).fill(SYNTHETIC_PAYER_EMAIL, { timeout: 20_000 });
      await page.getByRole("button", { name: "確認送出", exact: true }).click({ timeout: 20_000 });
    } catch {
      return { code: "PAYMENT_PAGE_REJECTED", appCallbackRequests };
    }
    const deadline = Date.now() + (Number.isSafeInteger(dependencies.returnWaitMs) ? dependencies.returnWaitMs : RETURN_WAIT_MS);
    const confirmation = page.getByRole("button", { name: "確定", exact: true });
    while (returnPosts === 0 && Date.now() < deadline) {
      // A second confirmation is never clicked (same rule as the WP4 runner).
      if (await confirmation.isVisible().catch(() => false)) return { code: "PAYMENT_CONFIRMATION_DIALOG", appCallbackRequests };
      await page.waitForTimeout(1_000);
    }
    if (returnPosts === 0 || !returnBody) return { code: "PAYMENT_RETURN_UNOBSERVED", appCallbackRequests };
    return { code: "RETURN_CAPTURED", returnBody, returnPosts, appCallbackRequests };
  } finally {
    await browser.close();
  }
}

/**
 * Phase `pay`. One fixed synthetic checkout and at most one card submission
 * for the attested source SHA; the WP4 reservation refuses a second one.
 */
export async function runLostCallbackPayment(input, dependencies = {}) {
  const invocation = validateInvocation(input);
  const receipt = createPayReceipt(invocation.ok ? invocation.sourceSha : null);
  if (!invocation.ok) return fail(receipt, "INPUT_REJECTED");
  let crypto;
  try {
    crypto = payUniSandboxCrypto(dependencies.keys ?? {});
  } catch {
    return fail(receipt, "KEYS_REJECTED");
  }
  const merchantId = dependencies.keys?.merchantId;
  if (typeof merchantId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(merchantId)) return fail(receipt, "KEYS_REJECTED");
  const request = dependencies.request ?? defaultRequest;
  const wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  try {
    const attestation = await (dependencies.attest ?? attestOperationHost)(
      { sourceSha: invocation.sourceSha, previewHost: invocation.previewHost }, dependencies.attestDependencies ?? {});
    if (attestation?.ok !== true || attestation.operationHost !== STAGING_ALIAS_HOST) return fail(receipt, "ALIAS_ATTESTATION_FAILED");
    receipt.checks.aliasAttested = true;
    const appOrigin = `https://${STAGING_ALIAS_HOST}`;

    let prepared;
    try {
      prepared = await (dependencies.prepareCheckout ?? prepareIssuedRecoveryCheckout)(input, { request, operationHost: STAGING_ALIAS_HOST });
    } catch {
      // The preparation may have created the checkout and reserved the one submission.
      Object.assign(receipt.sideEffects, { fixturePosts: 1, admissionPosts: 1, checkoutPosts: 1, paymentAttemptPosts: 1 });
      return fail(receipt, "CHECKOUT_PREPARATION_REJECTED");
    }
    Object.assign(receipt.sideEffects, prepared.sideEffects);
    receipt.checks.checkoutCreated = true;
    receipt.checks.paymentAttemptReserved = true;
    const checkout = prepared.checkout;
    if (checkout?.formAction !== PAYUNI_UPP_URL || checkout.formMethod !== "POST" || checkout.amountCents !== FIXED_AMOUNT_CENTS
      || checkout.currency !== "TWD") return fail(receipt, "CHECKOUT_SHAPE_REJECTED");
    const expected = { merchantId, orderNumber: checkout.orderNumber, amountCents: checkout.amountCents, appOrigin };

    let withheld;
    try {
      withheld = withheldCallbackForm({ formPayload: checkout.formPayload, expected, crypto });
    } catch (error) {
      return fail(receipt, error instanceof DrillError ? error.code : "INTERNAL_REJECTED");
    }
    receipt.checks.callbackTargetsWithheld = true;

    receipt.sideEffects.paymentSubmissions = 1;
    let browserResult;
    try {
      browserResult = await (dependencies.browser ?? defaultLostCallbackBrowser)({
        formPayload: withheld.formPayload,
        sinkReturnUrl: withheld.sinkReturnUrl,
        cardNumber: invocation.cardNumber,
        cardExpiry: invocation.cardExpiry,
        cardCvv: invocation.cardCvv,
      });
    } catch {
      return fail(receipt, "PAYMENT_PAGE_REJECTED");
    }
    const blocked = Number.isSafeInteger(browserResult?.appCallbackRequests) ? Math.min(browserResult.appCallbackRequests, 99) : 0;
    receipt.checks.appCallbacksBlockedInBrowser = blocked;
    if (blocked !== 0) return fail(receipt, "APP_CALLBACK_ATTEMPTED");
    if (browserResult?.code !== "RETURN_CAPTURED") {
      return fail(receipt, FAILURES.has(browserResult?.code) ? browserResult.code : "PAYMENT_PAGE_REJECTED");
    }
    const signedReturn = classifySignedReturn(browserResult.returnBody, expected, crypto);
    if (signedReturn === "NOT_PAID") return fail(receipt, "PAYMENT_NOT_PAID");
    if (signedReturn !== "PAID") return fail(receipt, "PAYMENT_RETURN_REJECTED");
    receipt.checks.providerReturnedPaid = true;

    const query = dependencies.queryProvider
      ?? ((orderNumber) => queryProviderSettlement(orderNumber, { crypto, merchantId, fetchImpl: dependencies.fetchImpl ?? fetch }));
    let snapshot = null;
    for (let attempt = 1; attempt <= PROVIDER_QUERY_ATTEMPTS; attempt += 1) {
      receipt.provider.queryAttempts = attempt;
      snapshot = await query(checkout.orderNumber);
      if (providerReportsPaid(snapshot)) break;
      if (attempt < PROVIDER_QUERY_ATTEMPTS) await wait(PROVIDER_QUERY_INTERVAL_MS);
    }
    receipt.provider.afterPayment = snapshot ? { status: snapshot.status, settlement: snapshot.settlement } : null;
    if (!providerReportsPaid(snapshot)) return fail(receipt, "PROVIDER_QUERY_UNCONFIRMED");
    receipt.checks.providerQueryPaid = true;
    receipt.result = "PAID_CALLBACK_WITHHELD";
    receipt.failure = "NONE";
    return receipt;
  } catch {
    return fail(receipt, "INTERNAL_REJECTED");
  }
}

const RECEIPT_TOP_KEYS = ["schemaVersion", "sourceSha", "environment", "result", "failure", "checks", "provider", "sideEffects", "safety"];

/** The receipt may hold only the fixed shape; a stray identifier or URL fails validation. */
export function validatePayReceipt(receipt) {
  if (!exactKeys(receipt, RECEIPT_TOP_KEYS) || receipt.schemaVersion !== LOST_CALLBACK_PAY_SCHEMA) return false;
  if (!FAILURES.has(receipt.failure) || !["BLOCKED", "PAID_CALLBACK_WITHHELD"].includes(receipt.result)) return false;
  if ((receipt.result === "PAID_CALLBACK_WITHHELD") !== (receipt.failure === "NONE")) return false;
  const text = JSON.stringify(receipt);
  if (/https?:|@|EncryptInfo|HashInfo/iu.test(text)) return false;
  const settlement = receipt.provider?.afterPayment?.settlement;
  if (settlement && !exactKeys(settlement, [...SETTLEMENT_CODE_FIELDS, ...SETTLEMENT_AMOUNT_FIELDS])) return false;
  return receipt.sideEffects.paymentSubmissions <= 1 && receipt.sideEffects.refundSubmissions === 0
    && receipt.safety.productionOperations === false && receipt.safety.secretsPersisted === false;
}

export async function writePayReceipt(receipt, runnerTemp) {
  if (typeof runnerTemp !== "string" || !path.isAbsolute(runnerTemp)) throw new Error("RECEIPT_PATH_REJECTED");
  if (!validatePayReceipt(receipt)) throw new Error("RECEIPT_REJECTED");
  const directory = path.join(runnerTemp, RECEIPT_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, PAY_RECEIPT_FILENAME);
  await writeFile(file, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", mode: 0o600 });
  return file;
}

const RUN_ID = /^[1-9]\d{0,19}$/u;
const WORKFLOW_PATH = ".github/workflows/staging-payuni-lost-callback.yml";

/**
 * Verify phase gate (before any secret): the pay run must be a successful
 * protected-master run of this workflow, and its downloaded `pay.json` must be
 * a valid PAID_CALLBACK_WITHHELD receipt for the same source SHA. Returns a
 * fixed code; never throws.
 */
export async function verifyPayRunReceipt({ sourceSha, runId, repository, token, receiptText }, fetchImpl = fetch) {
  if (typeof sourceSha !== "string" || !/^[a-f0-9]{40}$/u.test(sourceSha) || typeof runId !== "string" || !RUN_ID.test(runId)
    || typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) || typeof token !== "string" || !token) {
    return "PAY_RUN_INPUT_REJECTED";
  }
  let receipt;
  try {
    if (typeof receiptText !== "string" || receiptText.length > 16_384) return "PAY_RECEIPT_MISSING";
    receipt = JSON.parse(receiptText);
  } catch {
    return "PAY_RECEIPT_MISSING";
  }
  if (!validatePayReceipt(receipt)) return "PAY_RECEIPT_REJECTED";
  if (receipt.result !== "PAID_CALLBACK_WITHHELD" || receipt.failure !== "NONE") return "PAY_RECEIPT_NOT_PAID";
  if (receipt.sourceSha !== sourceSha) return "PAY_RECEIPT_SOURCE_MISMATCH";
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) return "PAY_RUN_UNAVAILABLE";
    const run = await response.json();
    if (run?.path !== WORKFLOW_PATH || run.head_branch !== "master" || run.event !== "workflow_dispatch"
      || run.status !== "completed" || run.conclusion !== "success") return "PAY_RUN_REJECTED";
  } catch {
    return "PAY_RUN_UNAVAILABLE";
  }
  return "VERIFIED";
}

async function verifyPayRunMain() {
  const protectedCi = process.argv.length === 3 && process.env.GITHUB_ACTIONS === "true"
    && process.env.GITHUB_REF === "refs/heads/master" && process.env.GITHUB_REF_PROTECTED === "true";
  let receiptText;
  try {
    receiptText = await readFile(path.join(process.env.RUNNER_TEMP ?? "", "payuni-lost-callback-pay-input", PAY_RECEIPT_FILENAME), "utf8");
  } catch {
    receiptText = undefined;
  }
  const code = protectedCi
    ? await verifyPayRunReceipt({
      sourceSha: process.env.CELEBRATEDEAL_SOURCE_SHA?.trim().toLowerCase(),
      runId: process.env.PAY_RUN_ID?.trim(),
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
      receiptText,
    })
    : "PAY_RUN_INPUT_REJECTED";
  console.log(`payuni_lost_callback_pay_run=${code}`);
  if (code !== "VERIFIED") process.exitCode = 2;
}

async function main() {
  const protectedCi = process.argv.length === 2 && process.env.GITHUB_ACTIONS === "true"
    && process.env.GITHUB_REF === "refs/heads/master" && process.env.GITHUB_REF_PROTECTED === "true"
    && process.env.PAYUNI_ENV === "sandbox";
  const input = readFixedInputs();
  const receipt = protectedCi
    ? await runLostCallbackPayment(input, { keys: readSandboxKeyInputs() })
    : fail(createPayReceipt(null), "INPUT_REJECTED");
  const safe = validatePayReceipt(receipt) ? receipt : fail(createPayReceipt(null), "INTERNAL_REJECTED");
  if (process.env.RUNNER_TEMP) await writePayReceipt(safe, process.env.RUNNER_TEMP);
  console.log(`payuni_lost_callback_pay=${safe.result}; failure=${safe.failure}`);
  console.log(JSON.stringify(safe));
  if (safe.result !== "PAID_CALLBACK_WITHHELD") process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === "--verify-pay-run") await verifyPayRunMain();
  else await main();
}
