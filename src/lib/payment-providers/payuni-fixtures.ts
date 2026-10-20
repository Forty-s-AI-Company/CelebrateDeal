import { createCipheriv, createHash } from "node:crypto";

export type PayUniSandboxFixtureName = "paid" | "refunded" | "duplicate_paid";

/**
 * `paid` and `duplicate_paid` use only documented PayUni UPP 2.0 Notify/Return
 * fields (Status, TradeStatus, PaymentType, TradeNo, MerTradeNo, TradeAmt); there
 * is no EventType, EventId, NetAmount, GatewayFee, ReferralCode or VendorId
 * (F-037). Replace them with a de-identified Sandbox sample when one exists.
 * `refunded` is a synthetic refund notice for the internal webhook pipeline,
 * not a PayUni callback format; PayUni refunds are confirmed through the
 * refund and query APIs. It carries a refund serial (CloseNo): a refund notice
 * without one is never applied automatically (PR #454 A-1).
 */
const payUniUppPaidCallback = {
  Status: "SUCCESS",
  TradeStatus: "1",
  PaymentType: "1",
  MerTradeNo: "CD-SANDBOX-PAID-001",
  TradeNo: "PAYUNI-SANDBOX-TRADE-001",
  TradeAmt: 1990,
};

export const payUniSandboxPlainFixtures: Record<PayUniSandboxFixtureName, Record<string, string | number>> = {
  paid: { ...payUniUppPaidCallback },
  refunded: {
    EventId: "payuni-sandbox-refunded-001",
    EventType: "refunded",
    CloseNo: "PAYUNI-SANDBOX-CLOSE-001",
    MerTradeNo: "CD-SANDBOX-PAID-001",
    TradeNo: "PAYUNI-SANDBOX-TRADE-001",
    TradeAmt: 1990,
    RefundAmount: 1990,
    GatewayFeeRefund: 35,
    PlatformFeeRefund: 0,
    RefundReason: "sandbox refund test",
    PayStatus: "refunded",
    OccurredAt: "2026-07-09T10:10:00.000Z",
  },
  // PayUni delivers the same signed result to both ReturnURL and NotifyURL.
  duplicate_paid: { ...payUniUppPaidCallback },
};

function encryptPayUniInfo(payload: Record<string, string | number>, hashKey: string, hashIv: string) {
  const tagLength = 16;
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hashKey), Buffer.from(hashIv), { authTagLength: tagLength });
  const query = new URLSearchParams(Object.entries(payload).map(([key, value]) => [key, String(value)])).toString();
  const encrypted = Buffer.concat([cipher.update(query, "utf8"), cipher.final()]).toString("base64");
  const tag = cipher.getAuthTag().toString("base64");
  return Buffer.from(`${encrypted}:::${tag}`).toString("hex");
}

export function buildPayUniSandboxWebhookFixture({
  fixture,
  merchantId,
  hashKey,
  hashIv,
  overrides,
}: {
  fixture: PayUniSandboxFixtureName;
  merchantId: string;
  hashKey: string;
  hashIv: string;
  overrides?: Record<string, string | number>;
}) {
  const payload: Record<string, string | number> = {
    MerID: merchantId,
    ...payUniSandboxPlainFixtures[fixture],
    ...(overrides ?? {}),
  };
  const encryptInfo = encryptPayUniInfo(payload, hashKey, hashIv);
  const hashInfo = createHash("sha256").update(`${hashKey}${encryptInfo}${hashIv}`).digest("hex").toUpperCase();
  // PayUni repeats the result Status outside EncryptInfo (unsigned).
  const outerStatus: Record<string, string> = typeof payload.Status === "string" ? { Status: payload.Status } : {};
  return new URLSearchParams({
    MerID: merchantId,
    Version: "2.0",
    ...outerStatus,
    EncryptInfo: encryptInfo,
    HashInfo: hashInfo,
  }).toString();
}
