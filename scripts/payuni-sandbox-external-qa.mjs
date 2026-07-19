import { createCipheriv, createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { chromium } from "playwright";

const SCHEMA = "celebratedeal-payuni-sandbox-qa/v1";
const APP_HOST = "celebratedeal.carry-digital-nomad.in.net";
const PAYUNI_HOST = "sandbox-api.payuni.com.tw";
const PAYUNI_API_ORIGIN = `https://${PAYUNI_HOST}`;
const DEFAULT_APP_URL = `https://${APP_HOST}`;
const DEFAULT_LIVE_PATH = "/live/summer-glow-live";

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactHttpsHost(rawUrl, expectedHost, label) {
  const url = new URL(rawUrl);
  assert(url.protocol === "https:" && url.hostname === expectedHost, `${label} 必須使用核准的 HTTPS 網域。`);
  return url;
}

function reference(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function keyMaterial() {
  const key = env("PAYUNI_HASH_KEY");
  const iv = env("PAYUNI_HASH_IV");
  assert(Buffer.byteLength(key) === 32, "PAYUNI_HASH_KEY 必須是 32 bytes。");
  assert(Buffer.byteLength(iv) === 16, "PAYUNI_HASH_IV 必須是 16 bytes。");
  return { key, iv };
}

function encryptInfo(payload) {
  const { key, iv } = keyMaterial();
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv), { authTagLength: 16 });
  const query = new URLSearchParams(
    Object.entries(payload).map(([payloadKey, value]) => [payloadKey, String(value)]),
  ).toString();
  const encrypted = Buffer.concat([cipher.update(query, "utf8"), cipher.final()]).toString("base64");
  const tag = cipher.getAuthTag().toString("base64");
  return Buffer.from(`${encrypted}:::${tag}`).toString("hex");
}

function decryptInfo(value) {
  const { key, iv } = keyMaterial();
  const [encrypted, tag] = Buffer.from(value, "hex").toString("utf8").split(":::");
  assert(encrypted && tag, "PayUni 回應缺少有效的 EncryptInfo。");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return Object.fromEntries(new URLSearchParams(plaintext));
}

function hashInfo(value) {
  const { key, iv } = keyMaterial();
  return createHash("sha256").update(`${key}${value}${iv}`).digest("hex").toUpperCase();
}

function parseOuterPayload(text) {
  try {
    return JSON.parse(text);
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

async function payUniRequest(path, version, payload) {
  assert(path === "/api/trade/query" || path === "/api/trade/close", "未核准的 PayUni API 路徑。");
  const url = assertExactHttpsHost(`${PAYUNI_API_ORIGIN}${path}`, PAYUNI_HOST, "PayUni API");
  const merId = env("PAYUNI_MERCHANT_ID");
  assert(merId, "缺少 PAYUNI_MERCHANT_ID。");
  const encrypted = encryptInfo({ MerID: merId, ...payload });
  const body = new URLSearchParams({
    MerID: merId,
    Version: version,
    EncryptInfo: encrypted,
    HashInfo: hashInfo(encrypted),
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "CelebrateDeal-AI-Team-Sandbox-QA/1.0",
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `PayUni API 回應 HTTP ${response.status}。`);
  const outer = parseOuterPayload(await response.text());
  const responseEncrypted = String(outer.EncryptInfo ?? "");
  const responseHash = String(outer.HashInfo ?? "").trim();
  assert(responseEncrypted && responseHash, "PayUni API 回應缺少加密資料或簽章。");
  assert(safeEqual(hashInfo(responseEncrypted), responseHash), "PayUni API 回應簽章驗證失敗。");
  return decryptInfo(responseEncrypted);
}

function resultRow(queryResponse) {
  if (Array.isArray(queryResponse.Result)) return queryResponse.Result[0];
  if (typeof queryResponse.Result === "string") {
    try {
      const parsed = JSON.parse(queryResponse.Result);
      return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
      return null;
    }
  }
  return queryResponse;
}

async function queryTransaction(orderNumber) {
  const response = await payUniRequest("/api/trade/query", "2.0", {
    MerTradeNo: orderNumber,
    Timestamp: Math.floor(Date.now() / 1000),
  });
  assert(response.Status === "SUCCESS", `PayUni 交易查詢失敗：${response.Status ?? "UNKNOWN"}`);
  const row = resultRow(response);
  assert(row && String(row.MerTradeNo) === orderNumber, "PayUni 查詢結果與本次訂單不一致。");
  return row;
}

async function refundTransaction(tradeNo, amount) {
  const response = await payUniRequest("/api/trade/close", "1.0", {
    TradeNo: tradeNo,
    Timestamp: Math.floor(Date.now() / 1000),
    CloseType: 2,
    TradeAmt: amount,
  });
  assert(response.Status === "SUCCESS", `PayUni Sandbox 退款失敗：${response.Status ?? "UNKNOWN"}`);
  assert(String(response.TradeNo) === tradeNo, "PayUni 退款回應與本次交易不一致。");
  assert(String(response.CloseType) === "2", "PayUni 退款回應不是退款類型。");
}

async function waitForRefund(orderNumber) {
  let row = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    row = await queryTransaction(orderNumber);
    if (["1", "2", "8"].includes(String(row.RefundStatus ?? ""))) return row;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return row;
}

async function runCheckout(appUrl) {
  const cardNumber = env("PAYUNI_TEST_CARD_NUMBER", env("PAYUNI_SANDBOX_ONETIME_CARD_NO")).replace(/\D/g, "");
  const expiry = env("PAYUNI_TEST_EXPIRY").replace(/\D/g, "");
  const cvv = env("PAYUNI_TEST_CVV").replace(/\D/g, "");
  assert(/^\d{16,19}$/.test(cardNumber), "缺少有效的 Sandbox 測試卡號。");
  assert(/^\d{4}$/.test(expiry), "PAYUNI_TEST_EXPIRY 必須是 MMYY。");
  assert(/^\d{3}$/.test(cvv), "PAYUNI_TEST_CVV 必須是三碼。");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: "zh-TW" });
  try {
    const livePath = env("PAYUNI_TEST_LIVE_PATH", DEFAULT_LIVE_PATH);
    assert(livePath.startsWith("/"), "PAYUNI_TEST_LIVE_PATH 必須是站內絕對路徑。");
    await page.goto(new URL(livePath, appUrl).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    const checkoutResponsePromise = page.waitForResponse(
      (response) => response.url() === `${appUrl}/api/payments/checkout` && response.request().method() === "POST",
      { timeout: 45_000 },
    );
    await page.getByRole("button", { name: "立即搶購" }).click();
    const checkoutResponse = await checkoutResponsePromise;
    assert(checkoutResponse.ok(), `CelebrateDeal checkout 回應 HTTP ${checkoutResponse.status()}。`);
    const checkout = await checkoutResponse.json();
    assert(checkout?.ok === true && checkout?.provider === "payuni", "CelebrateDeal 未建立 PayUni 結帳。");
    assertExactHttpsHost(String(checkout.formAction ?? ""), PAYUNI_HOST, "PayUni 結帳頁");
    assert(typeof checkout.orderNumber === "string" && checkout.orderNumber.length > 0, "結帳回應缺少訂單編號。");
    assert(typeof checkout.transactionId === "string" && checkout.transactionId.length > 0, "結帳回應缺少交易識別。");

    await page.waitForURL((url) => url.protocol === "https:" && url.hostname === PAYUNI_HOST, { timeout: 45_000 });
    await page.getByText("一次付清", { exact: true }).click();
    await page.locator('input[name="radioOptionpayGroupCredit"]').check({ force: true });
    await page.getByPlaceholder("16 碼或 19 碼").fill(cardNumber);
    await page.getByPlaceholder("MM/YY").fill(expiry);
    await page.getByPlaceholder("***").fill(cvv);
    await page.getByPlaceholder("example@example.com").fill("qa-sandbox@example.com");
    await page.getByRole("button", { name: "確認送出", exact: true }).click();
    const confirmButton = page.getByRole("button", { name: "確定", exact: true });
    if (await confirmButton.isVisible({ timeout: 5_000 }).catch(() => false)) await confirmButton.click();

    await page.waitForURL((url) => url.protocol === "https:" && url.hostname === APP_HOST, { timeout: 60_000 });
    const callback = JSON.parse((await page.locator("body").innerText()).trim());
    assert(callback?.ok === true, "CelebrateDeal 未接受 PayUni 付款通知。");
    assert(callback.transactionId === checkout.transactionId, "付款通知與結帳交易識別不一致。");
    return {
      orderNumber: checkout.orderNumber,
      transactionId: checkout.transactionId,
      amount: Math.round(Number(checkout.amountCents) / 100),
      callbackEventId: String(callback.eventId ?? ""),
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const appUrl = assertExactHttpsHost(env("PAYUNI_TEST_APP_URL", DEFAULT_APP_URL), APP_HOST, "CelebrateDeal Staging").origin;
  assert(env("PAYUNI_ENV") === "sandbox", "此命令只允許 PAYUNI_ENV=sandbox。");
  assert(env("PAYUNI_SANDBOX_QA_ENABLED") === "true", "需明確設定 PAYUNI_SANDBOX_QA_ENABLED=true。");
  assert(env("PAYUNI_SANDBOX_REFUND_ENABLED") === "true", "需明確設定 PAYUNI_SANDBOX_REFUND_ENABLED=true。");

  const checkout = await runCheckout(appUrl);
  assert(Number.isInteger(checkout.amount) && checkout.amount > 0, "Sandbox 退款金額無效。");
  const paid = await queryTransaction(checkout.orderNumber);
  assert(String(paid.TradeStatus) === "1", "PayUni 後台查詢尚未顯示已付款。");
  assert(String(paid.TradeNo ?? "") === checkout.callbackEventId, "PayUni 後台序號與付款通知不一致。");
  assert(Number(paid.TradeAmt) === checkout.amount, "PayUni 後台金額與 CelebrateDeal 結帳金額不一致。");

  await refundTransaction(String(paid.TradeNo), checkout.amount);
  const refunded = await waitForRefund(checkout.orderNumber);
  const refundStatus = String(refunded?.RefundStatus ?? "");
  assert(["1", "2", "8"].includes(refundStatus), "PayUni 後台尚未記錄 Sandbox 退款。");

  return {
    schema: SCHEMA,
    success: true,
    environment: "sandbox",
    appHost: APP_HOST,
    providerHost: PAYUNI_HOST,
    projectRevision: env("AI_TEAM_PROJECT_REVISION") || null,
    startedAt,
    completedAt: new Date().toISOString(),
    orderRef: reference(checkout.orderNumber),
    tradeRef: reference(paid.TradeNo),
    transactionRef: reference(checkout.transactionId),
    checks: {
      browserCheckout: "passed",
      paymentCallbackMatched: "passed",
      providerReconciliation: "passed",
      sandboxRefundAccepted: "passed",
      refundVisibleInProviderQuery: "passed",
    },
    providerState: {
      tradeStatus: String(refunded.TradeStatus ?? ""),
      paymentType: String(refunded.PaymentType ?? ""),
      refundStatus,
      refundAmount: Number(refunded.RefundAmt ?? checkout.amount),
    },
    productionValidation: {
      status: "human-approval-required",
      automatedChargeAllowed: false,
    },
  };
}

try {
  console.log(JSON.stringify(await main()));
} catch (error) {
  console.log(JSON.stringify({
    schema: SCHEMA,
    success: false,
    environment: "sandbox",
    completedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : "未知錯誤",
    productionValidation: {
      status: "human-approval-required",
      automatedChargeAllowed: false,
    },
  }));
  process.exitCode = 1;
}
