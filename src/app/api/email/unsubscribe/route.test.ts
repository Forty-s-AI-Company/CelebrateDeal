import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  emailDelivery: { findUnique: vi.fn(), updateMany: vi.fn() },
  emailSuppression: { upsert: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => db }));

import { createEmailUnsubscribeToken } from "@/lib/email-delivery-pii";
import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "g7-07-unsubscribe-test-secret-longer-than-32-bytes");
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  db.emailDelivery.updateMany.mockResolvedValue({ count: 2 });
  db.emailSuppression.upsert.mockResolvedValue({ id: "suppression-1" });
});

afterEach(() => vi.unstubAllEnvs());

function request(token: string, origin = "https://app.example.test") {
  return new Request("https://app.example.test/api/email/unsubscribe", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token }),
  });
}

describe("POST /api/email/unsubscribe", () => {
  it("rejects cross-origin mutation before reading delivery state", async () => {
    const response = await POST(request(createEmailUnsubscribeToken("delivery-1"), "https://attacker.example.test"));
    expect(response.status).toBe(403);
    expect(db.emailDelivery.findUnique).not.toHaveBeenCalled();
  });

  it("redirects a tampered token to a generic invalid state", async () => {
    const response = await POST(request(`${createEmailUnsubscribeToken("delivery-1")}x`));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/unsubscribe?status=invalid");
    expect(db.emailDelivery.findUnique).not.toHaveBeenCalled();
  });

  it("upserts a vendor-scoped suppression and cancels queued retries", async () => {
    db.emailDelivery.findUnique.mockResolvedValue({
      vendorId: "vendor-1",
      recipientHash: "recipient-hash",
      recipientMaskedEmail: "l***@example.test",
    });
    const response = await POST(request(createEmailUnsubscribeToken("delivery-1")));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/unsubscribe?status=done");
    expect(db.emailSuppression.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId_recipientHash: { vendorId: "vendor-1", recipientHash: "recipient-hash" } },
      create: expect.objectContaining({ reason: "recipient_request", source: "unsubscribe_link" }),
    }));
    expect(db.emailDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        recipientHash: "recipient-hash",
        status: { in: ["queued", "failed"] },
      },
      data: {
        status: "suppressed",
        nextAttemptAt: null,
        lastErrorCode: "recipient_suppressed",
      },
    });
  });
});
