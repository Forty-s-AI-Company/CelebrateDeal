import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { payUniPaymentProvider } from "@/lib/payment-providers/payuni";
import type { PendingPaymentQueryInput } from "@/lib/payment-providers/types";

// A-2 05: the read-only PayUni query the pending-payment reconciler uses. Every
// response is a synthetic, locally signed envelope; no provider is called.
const hashKey = "12345678901234567890123456789012";
const hashIv = "1234567890123456";
const ORDER = "CD-RECONCILE-001";
const TRADE = "PAYUNI-RECONCILE-TRADE-001";

const transaction: PendingPaymentQueryInput["transaction"] = {
  providerName: "payuni", orderNumber: ORDER, paymentMode: "platform", grossAmountCents: 2_000, currency: "TWD",
};

function encrypt(payload: Record<string, unknown>) {
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hashKey), Buffer.from(hashIv), { authTagLength: 16 });
  const plaintext = new URLSearchParams(
    Object.entries(payload).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]),
  ).toString();
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
  return Buffer.from(`${encrypted}:::${cipher.getAuthTag().toString("base64")}`).toString("hex");
}

function hash(encryptInfo: string) {
  return createHash("sha256").update(`${hashKey}${encryptInfo}${hashIv}`).digest("hex").toUpperCase();
}

function envelope(payload: Record<string, unknown>) {
  const encryptInfo = encrypt(payload);
  return new URLSearchParams({ MerID: "TESTMER", Version: "2.0", EncryptInfo: encryptInfo, HashInfo: hash(encryptInfo) }).toString();
}

function decryptRequest(encryptInfo: string) {
  const [encrypted, tag] = Buffer.from(encryptInfo, "hex").toString("utf8").split(":::");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(hashKey), Buffer.from(hashIv));
  decipher.setAuthTag(Buffer.from(tag!, "base64"));
  return Object.fromEntries(new URLSearchParams(Buffer.concat([decipher.update(Buffer.from(encrypted!, "base64")), decipher.final()]).toString("utf8")));
}

// A captured card trade (CloseStatus 2 請款成功) with nothing refunded.
const paidRow = { MerTradeNo: ORDER, TradeNo: TRADE, TradeAmt: "20", TradeStatus: "1", PaymentType: "1", DataSource: "A", CloseStatus: "2", RemainAmt: "20" };

function respond(body: string, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function query(input: Partial<PendingPaymentQueryInput> = {}) {
  return payUniPaymentProvider.queryPendingPayment!({ transaction, ...input });
}

beforeEach(() => {
  vi.stubEnv("PAYUNI_SANDBOX_HASH_KEY", hashKey);
  vi.stubEnv("PAYUNI_SANDBOX_HASH_IV", hashIv);
  vi.stubEnv("PAYUNI_SANDBOX_MERCHANT_ID", "TESTMER");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("VERCEL_ENV", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PayUni pending-payment query (A-2 05)", () => {
  it("asks only by merchant order number on the pinned query endpoint and reports a paid trade", async () => {
    const fetchMock = respond(envelope({ Status: "SUCCESS", Result: paidRow }));
    const result = await query();
    expect(result).toMatchObject({ outcome: "paid", orderNumber: ORDER, providerTradeNo: TRADE, grossAmountCents: 2_000 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://sandbox-api.payuni.com.tw/api/trade/query");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(decryptRequest(init.body.get("EncryptInfo"))).toEqual({ MerID: "TESTMER", MerTradeNo: ORDER, Timestamp: expect.any(String) });
  });

  it("produces the same provider event as a verified paid UPP Notify for the same trade", async () => {
    respond(envelope({ Status: "SUCCESS", Result: paidRow }));
    const reconciled = await query();
    if (reconciled.outcome !== "paid") throw new Error("expected paid");
    const notify = envelope({ Status: "SUCCESS", TradeStatus: "1", PaymentType: "1", MerTradeNo: ORDER, TradeNo: TRADE, TradeAmt: 20 });
    const { payload: callback } = await payUniPaymentProvider.normalizePayload(new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(notify)), Status: "SUCCESS" }).toString());
    expect(reconciled.payload).toEqual(callback);
    expect(reconciled.payload).toMatchObject({ provider: "payuni", eventId: `${TRADE}:1`, eventType: "paid", grossAmountCents: 2_000 });
    // The tenant and money are never taken from the provider for a decision: no vendor, fees or currency.
    expect(reconciled.payload.vendorId).toBeUndefined();
    expect(reconciled.payload.currency).toBeUndefined();
    expect(reconciled.rawSnapshot).toMatchObject({ MerTradeNo: ORDER, TradeNo: TRADE, TradeStatus: "1" });
  });

  it("returns the provider amount unchanged so the caller can refuse a mismatch", async () => {
    respond(envelope({ Status: "SUCCESS", Result: { ...paidRow, TradeAmt: "21", RemainAmt: "21" } }));
    await expect(query()).resolves.toMatchObject({ outcome: "paid", grossAmountCents: 2_100 });
  });

  it.each(["2", "3"])("reports TradeStatus %s as failed with the failed callback's event identity", async (TradeStatus) => {
    respond(envelope({ Status: "SUCCESS", Result: { ...paidRow, TradeStatus } }));
    await expect(query()).resolves.toMatchObject({
      outcome: "failed", tradeStatus: TradeStatus,
      payload: { provider: "payuni", eventId: `${TRADE}:${TradeStatus}`, eventType: "failed", orderNumber: ORDER },
    });
  });

  it("reports TradeStatus 4 as expired (no money received)", async () => {
    respond(envelope({ Status: "SUCCESS", Result: { ...paidRow, TradeStatus: "4" } }));
    await expect(query()).resolves.toEqual({ outcome: "expired", orderNumber: ORDER, providerTradeNo: TRADE, tradeStatus: "4" });
  });

  it.each([
    { TradeStatus: "0" }, { TradeStatus: "8" }, { TradeStatus: "9" },
    // Incomplete data: PayUni advises to query again later.
    { DataSource: "B" },
  ])("keeps %j pending", async (patch) => {
    respond(envelope({ Status: "SUCCESS", Result: { ...paidRow, ...patch } }));
    await expect(query()).resolves.toMatchObject({ outcome: "pending", orderNumber: ORDER });
  });

  it("treats only an authenticated QUERY03001 as not found", async () => {
    respond(envelope({ Status: "QUERY03001" }));
    await expect(query()).resolves.toEqual({ outcome: "not_found", orderNumber: ORDER });
    respond(new URLSearchParams({ Status: "QUERY03001" }).toString());
    await expect(query()).rejects.toMatchObject({ category: "authentication" });
  });

  it.each([
    [{ PaymentType: "2" }, "payment_type_not_allowed"],
    [{ TradeStatus: "6" }, "trade_status_unknown"],
    // Refund evidence is RefundStatus / RefundType / RefundAmt (#664 m-1).
    [{ RefundStatus: "2", RefundAmt: "5", RemainAmt: "15" }, "refunded_at_provider"],
    [{ RefundStatus: "1", RefundAmt: "" }, "refunded_at_provider"],
    [{ RefundType: "3" }, "refunded_at_provider"],
    [{ RefundAmt: "5" }, "refunded_at_provider"],
    // RemainAmt is compared only after capture (CloseStatus 2).
    [{ RemainAmt: "0" }, "refunded_at_provider"],
    [{ CloseStatus: "3" }, "capture_cancelled"],
    [{ CloseStatus: "5" }, "close_status_unknown"],
  ])("routes %j to manual reconciliation (%s)", async (patch, reason) => {
    respond(envelope({ Status: "SUCCESS", Result: { ...paidRow, ...patch } }));
    await expect(query()).resolves.toMatchObject({ outcome: "manual_reconciliation", reason, orderNumber: ORDER, collectionReported: true });
  });

  it.each([
    { CloseStatus: "9", RemainAmt: "0" },
    { CloseStatus: "1", RemainAmt: "" },
    { CloseStatus: "7", RemainAmt: undefined },
    { CloseStatus: undefined, RemainAmt: "0" },
    { CloseStatus: "2", RemainAmt: undefined },
  ])("settles a paid card trade before or without capture data (%j) without reading RemainAmt as a refund", async (patch) => {
    const row: Record<string, unknown> = { ...paidRow, ...patch };
    for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
    respond(envelope({ Status: "SUCCESS", Result: row }));
    await expect(query()).resolves.toMatchObject({ outcome: "paid", grossAmountCents: 2_000, payload: { eventId: `${TRADE}:1` } });
  });

  it("holds two trades on one order number only when one of them reports a collection", async () => {
    respond(envelope({ Status: "SUCCESS", Result: [{ ...paidRow, TradeStatus: "2", TradeNo: "PAYUNI-FIRST" }, paidRow] }));
    await expect(query()).resolves.toMatchObject({ outcome: "manual_reconciliation", reason: "multiple_trades", collectionReported: true });
    respond(envelope({ Status: "SUCCESS", Result: [{ ...paidRow, TradeStatus: "2", TradeNo: "PAYUNI-FIRST" }, { ...paidRow, TradeStatus: "3" }] }));
    await expect(query()).resolves.toMatchObject({ outcome: "manual_reconciliation", reason: "multiple_trades", collectionReported: false });
  });

  // A4-05 (run 45376157147): PayUni encrypts a PHP http_build_query string, so
  // a Result array arrives as flat Result[0][Field] fields, not one Result value.
  function bracketEnvelope(rows: Record<string, string>[], status = "SUCCESS") {
    const fields: Record<string, string> = { Status: status, MerID: "TESTMER" };
    rows.forEach((row, index) => {
      for (const [name, value] of Object.entries(row)) fields[`Result[${index}][${name}]`] = value;
    });
    return envelope(fields);
  }

  it("reads PayUni's bracket-encoded Result row exactly like a Result value", async () => {
    respond(bracketEnvelope([paidRow]));
    const bracket = await query();
    respond(envelope({ Status: "SUCCESS", Result: paidRow }));
    expect(bracket).toEqual(await query());
    expect(bracket).toMatchObject({ outcome: "paid", orderNumber: ORDER, providerTradeNo: TRADE, grossAmountCents: 2_000, payload: { eventId: `${TRADE}:1` } });
    respond(bracketEnvelope([{ ...paidRow, DataSource: "B" }]));
    await expect(query()).resolves.toMatchObject({ outcome: "pending", orderNumber: ORDER });
  });

  it("applies the same identity and multi-trade rules to bracket-encoded rows", async () => {
    respond(bracketEnvelope([{ ...paidRow, TradeStatus: "2", TradeNo: "PAYUNI-FIRST" }, paidRow]));
    await expect(query()).resolves.toMatchObject({ outcome: "manual_reconciliation", reason: "multiple_trades", collectionReported: true });
    respond(bracketEnvelope([{ ...paidRow, MerTradeNo: "CD-OTHER" }]));
    await expect(query()).rejects.toMatchObject({ category: "provider_response" });
    respond(bracketEnvelope([]));
    await expect(query()).rejects.toMatchObject({ category: "provider_response" });
  });

  it("rejects a response whose HashInfo does not match", async () => {
    const encryptInfo = encrypt({ Status: "SUCCESS", Result: paidRow });
    respond(new URLSearchParams({ MerID: "TESTMER", Version: "2.0", EncryptInfo: encryptInfo, HashInfo: "0".repeat(64) }).toString());
    await expect(query()).rejects.toMatchObject({ category: "authentication" });
  });

  it("rejects a correctly hashed envelope that does not decrypt", async () => {
    const encryptInfo = Buffer.from("not-ciphertext:::not-a-tag").toString("hex");
    respond(new URLSearchParams({ MerID: "TESTMER", Version: "2.0", EncryptInfo: encryptInfo, HashInfo: hash(encryptInfo) }).toString());
    await expect(query()).rejects.toMatchObject({ category: "authentication" });
  });

  it.each([
    ["an authenticated error status", envelope({ Status: "QUERY01001" })],
    ["another merchant order", envelope({ Status: "SUCCESS", Result: { ...paidRow, MerTradeNo: "CD-OTHER" } })],
    ["a malformed TradeStatus", envelope({ Status: "SUCCESS", Result: { ...paidRow, TradeStatus: "paid" } })],
    ["a paid row without TradeNo", envelope({ Status: "SUCCESS", Result: { ...paidRow, TradeNo: "" } })],
    ["a paid row with a malformed amount", envelope({ Status: "SUCCESS", Result: { ...paidRow, TradeAmt: "20junk" } })],
    ["a TradeNo outside the identifier format", envelope({ Status: "SUCCESS", Result: { ...paidRow, TradeNo: "a b" } })],
    ["a malformed RefundAmt", envelope({ Status: "SUCCESS", Result: { ...paidRow, RefundAmt: "5junk" } })],
    ["a malformed RemainAmt after capture", envelope({ Status: "SUCCESS", Result: { ...paidRow, RemainAmt: "20junk" } })],
    ["an empty result", envelope({ Status: "SUCCESS" })],
  ])("fails closed on %s", async (_label, body) => {
    respond(body);
    await expect(query()).rejects.toMatchObject({ category: "provider_response" });
  });

  it("maps HTTP and transport failures to provider_response and network", async () => {
    respond("upstream error", 502);
    await expect(query()).rejects.toMatchObject({ category: "provider_response" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
    await expect(query({ timeoutMs: 5 })).rejects.toMatchObject({ category: "network" });
  });

  it.each([
    ["no PAYUNI_ENV", () => vi.stubEnv("PAYUNI_ENV", ""), {}],
    ["Preview with the live merchant", () => { vi.stubEnv("PAYUNI_ENV", "production"); vi.stubEnv("VERCEL_ENV", "preview"); }, {}],
    ["a merchant-owned (byo) payment", () => undefined, { paymentMode: "byo" }],
    ["another provider", () => undefined, { providerName: "demo" }],
    ["a non-TWD payment", () => undefined, { currency: "USD" }],
    ["an invalid order number", () => undefined, { orderNumber: "not valid!" }],
    ["a missing order number", () => undefined, { orderNumber: null }],
    ["a zero amount", () => undefined, { grossAmountCents: 0 }],
  ])("refuses %s before any network access", async (_label, setup, patch) => {
    setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(query({ transaction: { ...transaction, ...patch } })).rejects.toMatchObject({ category: "request_contract" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses with authentication when the selected merchant credentials are missing", async () => {
    vi.stubEnv("PAYUNI_SANDBOX_MERCHANT_ID", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(query()).rejects.toMatchObject({ category: "authentication" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
