import { createCipheriv, createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { payUniPaymentProvider } from "@/lib/payment-providers/payuni";
import { processPaymentWebhook } from "@/lib/payment-webhooks";

// Synthetic Sandbox key material for this disposable test only.
const hashKey = "12345678901234567890123456789012";
const hashIv = "1234567890123456";
const db = getDb();
const vendorIds: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

function stubPayUniSandbox() {
  vi.stubEnv("PAYUNI_SANDBOX_HASH_KEY", hashKey);
  vi.stubEnv("PAYUNI_SANDBOX_HASH_IV", hashIv);
  vi.stubEnv("PAYUNI_SANDBOX_MERCHANT_ID", "TESTMER");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("CSRF_SECRET", "payuni-signed-rejection-test-secret-longer-than-32-bytes");
}

function signedCallback(fields: Record<string, string>, outerStatus: string) {
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hashKey), Buffer.from(hashIv), { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(new URLSearchParams(fields).toString(), "utf8"), cipher.final()]).toString("base64");
  const encryptInfo = Buffer.from(`${encrypted}:::${cipher.getAuthTag().toString("base64")}`).toString("hex");
  return new URLSearchParams({
    MerID: "TESTMER",
    Version: "2.0",
    Status: outerStatus,
    EncryptInfo: encryptInfo,
    HashInfo: createHash("sha256").update(`${hashKey}${encryptInfo}${hashIv}`).digest("hex").toUpperCase(),
  }).toString();
}

describe("F-047 signed non-SUCCESS PayUni callback", () => {
  it("marks the checkout failed and releases its reserved stock", async () => {
    stubPayUniSandbox();
    const suffix = randomUUID();
    const vendor = await db.vendor.create({
      data: { name: "Rejected", slug: `rejected-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" },
    });
    vendorIds.push(vendor.id);
    const product = await db.product.create({
      data: { vendorId: vendor.id, name: "Rejected product", slug: `rejected-product-${suffix}`, priceCents: 199_000, inventory: 1 },
    });
    const orderNumber = `CD-REJ-${suffix.replaceAll("-", "").slice(0, 12)}`;
    const checkout = await createReservedPaymentTransaction({
      vendorId: vendor.id,
      productId: product.id,
      transactionData: {
        vendorId: vendor.id, purpose: "buyer_order", providerName: "payuni", orderNumber, paymentMode: "platform",
        grossAmountCents: 199_000, netAmountCents: 199_000, currency: "TWD", status: "pending", metadata: { productId: product.id },
      },
    });
    await expect(db.product.findUniqueOrThrow({ where: { id: product.id } })).resolves.toMatchObject({ inventory: 0 });

    const body = signedCallback({ MerID: "TESTMER", Status: "UPP02005", Message: "UPP02005", MerTradeNo: orderNumber, TradeAmt: "1990" }, "UPP02005");
    await expect(payUniPaymentProvider.verifySignature(new Request("https://app.example.test"), body)).resolves.toBe(true);
    const { payload } = await payUniPaymentProvider.normalizePayload(body);
    expect(payload).toMatchObject({ eventType: "failed", metadata: { providerResult: { status: "UPP02005" } } });

    await processPaymentWebhook(payload);

    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: checkout.id } })).resolves.toMatchObject({ status: "failed" });
    await expect(db.product.findUniqueOrThrow({ where: { id: product.id } })).resolves.toMatchObject({ inventory: 1 });
    await expect(db.inventoryReservation.findUniqueOrThrow({ where: { paymentTransactionId: checkout.id } }))
      .resolves.toMatchObject({ status: "released" });
  });
});
