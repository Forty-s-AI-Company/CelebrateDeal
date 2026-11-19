import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { ensureCommerceOrderPaidDelivery } from "@/lib/commerce-order-email";
import { protectCommerceOrderPii } from "@/lib/commerce-order-pii";
import { revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import {
  expectNoFormatting,
  expectNoPhishingTrace,
  NORMAL_NAMES,
  PHISHING_NAMES,
  renderedForms,
  STACKED_FORMAT_NAME,
} from "@/test/recipient-name-cases";

/**
 * A2-13: the paid-order receipt goes to the address typed at checkout, which
 * nobody confirmed, and greets the buyer by the name typed with it.
 */

const vendorId = "vendor-1";
const orderId = "order-1";

function fakeDb(buyerName: string) {
  const pii = protectCommerceOrderPii({ buyer: { name: buyerName, email: "buyer@example.test", phone: "0912345678" }, shipping: null }, { vendorId, orderId });
  const create = vi.fn(async ({ data }: { data: { id: string } }) => ({ id: data.id }));
  const db = {
    commerceOrder: {
      findFirst: vi.fn(async () => ({
        id: orderId,
        orderNumber: "CD-0001",
        buyerEncryptedEnvelope: pii.buyerEncrypted,
        shippingEncryptedEnvelope: pii.shippingEncrypted,
        items: [{ productName: "合成課程" }],
        vendor: { name: "測試商家", senderName: "測試品牌", supportEmail: "support@example.test", contactUrl: "https://example.test/contact" },
        postPurchaseCreditReceived: null,
      })),
    },
    emailDelivery: { findUnique: vi.fn(async () => null), create },
  };
  return { db: db as unknown as Prisma.TransactionClient, create };
}

async function receiptFor(buyerName: string) {
  const { db, create } = fakeDb(buyerName);
  await expect(ensureCommerceOrderPaidDelivery(db, { vendorId, paymentTransactionId: "txn-1", occurredAt: new Date() })).resolves.toMatchObject({ status: "queued" });
  const data = create.mock.calls[0]![0].data as unknown as { id: string; payloadEncryptedEnvelope: string };
  const payload = revealEmailDeliveryPayload(data.payloadEncryptedEnvelope, { vendorId, deliveryId: data.id });
  return { subject: payload.subject, body: payload.body };
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "a2-13-commerce-receipt-test-secret-longer-than-32-bytes");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("paid-order receipt greeting (A2-13)", () => {
  it.each(PHISHING_NAMES)("greets without the name when it reads as a web address: $label", async ({ name }) => {
    const mail = await receiptFor(name);
    expectNoPhishingTrace(mail);
    expect(mail.body.startsWith("您好：\n")).toBe(true);
  });

  it("removes a stacked line-start format prefix", async () => {
    const mail = await receiptFor(STACKED_FORMAT_NAME.name);
    expectNoFormatting(mail);
    expect(mail.body.startsWith(`${STACKED_FORMAT_NAME.cleaned} 您好：`)).toBe(true);
  });

  it.each(NORMAL_NAMES)("keeps an ordinary name: %s", async (name) => {
    const mail = await receiptFor(name);
    expect(mail.body.startsWith(`${name} 您好：`)).toBe(true);
    expect(renderedForms(mail).text).toContain(name);
  });
});
