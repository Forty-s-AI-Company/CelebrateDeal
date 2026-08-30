import { createCipheriv, createHash } from "node:crypto";

export type PayUniSandboxFixtureName = "paid" | "refunded" | "duplicate_paid";

export const payUniSandboxPlainFixtures: Record<PayUniSandboxFixtureName, Record<string, string | number>> = {
  paid: {
    EventId: "payuni-sandbox-paid-001",
    EventType: "paid",
    MerTradeNo: "CD-SANDBOX-PAID-001",
    TradeNo: "PAYUNI-SANDBOX-TRADE-001",
    TradeAmt: 1990,
    GatewayFee: 35,
    PlatformFee: 0,
    NetAmount: 1955,
    PayStatus: "paid",
    ReferralCode: "DEMOREF",
    OccurredAt: "2026-07-09T10:00:00.000Z",
  },
  refunded: {
    EventId: "payuni-sandbox-refunded-001",
    EventType: "refunded",
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
  duplicate_paid: {
    EventId: "payuni-sandbox-paid-001",
    EventType: "paid",
    MerTradeNo: "CD-SANDBOX-PAID-001",
    TradeNo: "PAYUNI-SANDBOX-TRADE-001",
    TradeAmt: 1990,
    GatewayFee: 35,
    PlatformFee: 0,
    NetAmount: 1955,
    PayStatus: "paid",
    ReferralCode: "DEMOREF",
    OccurredAt: "2026-07-09T10:00:00.000Z",
  },
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
  const payload = {
    MerID: merchantId,
    ...payUniSandboxPlainFixtures[fixture],
    ...(overrides ?? {}),
  };
  const encryptInfo = encryptPayUniInfo(payload, hashKey, hashIv);
  const hashInfo = createHash("sha256").update(`${hashKey}${encryptInfo}${hashIv}`).digest("hex").toUpperCase();
  return new URLSearchParams({
    MerID: merchantId,
    Version: "2.0",
    EncryptInfo: encryptInfo,
    HashInfo: hashInfo,
  }).toString();
}
