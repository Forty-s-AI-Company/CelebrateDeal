import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
const emailPii = vi.hoisted(() => ({ protect: vi.fn(() => ({ payloadEncryptedEnvelope: "encrypted-envelope", recipientHash: "recipient-hash", recipientMaskedEmail: "st***@example.test" })) }));
vi.mock("@/lib/email-delivery-pii", () => ({ createEmailUnsubscribeUrl: () => "https://app.example.test/unsubscribe?token=signed", protectEmailDeliveryPayload: emailPii.protect }));
vi.mock("@/lib/live-interaction", () => ({ hashInteractionBearer: () => "hashed-bearer" }));
vi.mock("@/lib/line-notification", () => ({ stableLineIdempotencyKey: (parts: string[]) => parts.join(":") }));

import { issueManualCustomerVoucher } from "./customer-voucher";

describe("manual customer voucher delivery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists only the bearer hash and queues an encrypted email atomically", async () => {
    const grantCreate = vi.fn(async () => ({ id: "grant" }));
    const emailCreate = vi.fn(async () => ({ id: "delivery" }));
    const result = await issueManualCustomerVoucher({
      db: { automationVoucherGrant: { create: grantCreate }, emailDelivery: { create: emailCreate } },
      vendorId: "vendor-1", customerKeyHash: "customer-hash", product: { id: "product-1", name: "實戰班", currency: "TWD" },
      recipientEmail: "student@example.test", expiresAt: new Date("2026-09-10T00:00:00Z"),
    });
    expect(grantCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ claimTokenHash: "hashed-bearer", customerKeyHash: "customer-hash" }) }));
    expect(emailCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payloadEncryptedEnvelope: "encrypted-envelope", status: "queued", trigger: "manual_customer_voucher" }) }));
    expect(emailPii.protect).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("退訂：https://app.example.test/unsubscribe?token=signed") }), expect.any(Object));
    expect(JSON.stringify(grantCreate.mock.calls)).not.toContain("token=");
    expect(result).toMatchObject({ expiresAt: new Date("2026-09-10T00:00:00Z") });
  });
});
