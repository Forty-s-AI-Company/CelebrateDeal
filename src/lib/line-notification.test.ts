import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockLineMessagingClient } from "@/lib/line-client";
import { protectLineOfficialAccountCredentials, protectLineProfileValue } from "@/lib/line-credentials";
import {
  buildCommissionLineMessage,
  buildLiveLineMessage,
  buildOrderLineMessage,
  enqueueLineNotification,
  processDueLineDeliveries,
  stableLineIdempotencyKey,
} from "@/lib/line-notification";
import { encryptSensitiveValue } from "@/lib/sensitive-data";

describe("LINE notification outbox", () => {
  beforeEach(() => vi.stubEnv("CSRF_SECRET", "line-notification-test-secret-at-least-32-bytes"));
  afterEach(() => vi.unstubAllEnvs());

  it("builds live, receipt, and commission messages with the required content", () => {
    expect(buildLiveLineMessage({
      kind: "started",
      liveTitle: "AI 實戰直播",
      startsAtText: "今晚 20:00",
      viewerUrl: "https://celebratedeal.example/live/ai",
    })).toMatchObject({ type: "flex", contents: { footer: { contents: [{ action: { label: "立即進場" } }] } } });
    expect(buildOrderLineMessage({
      kind: "paid",
      orderNumber: "CD-001",
      amountCents: 128_000,
      currency: "TWD",
      orderUrl: "https://celebratedeal.example/support/orders",
    })).toMatchObject({ type: "flex", altText: expect.stringContaining("付款成功電子收據") });
    expect(buildCommissionLineMessage({ amountCents: 12_800, currency: "TWD", orderNumber: "CD-001" }))
      .toMatchObject({ type: "text", text: expect.stringContaining("佣金已入帳") });
  });

  it("queues one encrypted delivery for a linked identity", async () => {
    const create = vi.fn().mockResolvedValue({ id: "delivery-1" });
    const db = {
      lineOfficialAccount: { findUnique: vi.fn().mockResolvedValue({ id: "account-1", status: "active" }) },
      lineUserIdentity: { findUnique: vi.fn().mockResolvedValue({ id: "identity-1", revokedAt: null }) },
      lineDelivery: { create, findUnique: vi.fn() },
    };
    await expect(enqueueLineNotification(db as never, {
      vendorId: "vendor-1",
      subjectType: "promoter",
      subjectId: "affiliate-1",
      trigger: "commission_credited",
      idempotencyKey: stableLineIdempotencyKey(["commission", "commission-1"]),
      messages: [buildCommissionLineMessage({ amountCents: 5_000, currency: "TWD", orderNumber: null })],
    })).resolves.toEqual({ status: "queued", deliveryId: "delivery-1" });
    const payload = create.mock.calls[0]?.[0].data;
    expect(payload.payloadEncrypted).toMatch(/^v1\./u);
    expect(JSON.stringify(payload)).not.toContain("佣金已入帳");
  });

  it("claims and sends a due delivery through the offline mock client", async () => {
    const deliveryId = "123e4567-e89b-42d3-a456-426614174000";
    const account = {
      id: "account-1",
      vendorId: "vendor-1",
      status: "active",
      ...protectLineOfficialAccountCredentials("vendor-1", {
        messagingChannelId: "2000123456",
        messagingChannelSecret: "messaging-secret-1234567890",
        messagingAccessToken: "access-token-with-at-least-thirty-two-characters",
        loginChannelId: null,
        loginChannelSecret: null,
      }),
    };
    const messages = [buildCommissionLineMessage({ amountCents: 5_000, currency: "TWD", orderNumber: null })];
    const due = {
      id: deliveryId,
      vendorId: "vendor-1",
      status: "queued",
      attemptCount: 0,
      maxAttempts: 5,
      payloadEncrypted: encryptSensitiveValue(JSON.stringify(messages), `line-delivery:vendor-1:${deliveryId}`),
      account,
      identity: { vendorId: "vendor-1", revokedAt: null, lineUserIdEncrypted: protectLineProfileValue("vendor-1", "userId", "U123") },
    };
    const update = vi.fn().mockResolvedValue({});
    const db = {
      lineDelivery: {
        findMany: vi.fn().mockResolvedValue([due]),
        findUnique: vi.fn().mockResolvedValue(due),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update,
      },
    };
    const client = new MockLineMessagingClient();
    const results = await processDueLineDeliveries(db as never, () => client, new Date("2026-09-05T00:00:00Z"));
    expect(results).toEqual([{ id: deliveryId, status: "sent" }]);
    expect(db.lineDelivery.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ status: "sending", claimedAt: { lt: new Date("2026-09-04T23:55:00Z") } }),
    }));
    expect(client.calls).toEqual([{ to: "U123", messages, retryKey: deliveryId }]);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "sent" }) }));
  });

  it("suppresses an already queued delivery when the account is disabled before send", async () => {
    const due = {
      id: "123e4567-e89b-42d3-a456-426614174001",
      vendorId: "vendor-1",
      status: "queued",
      attemptCount: 0,
      maxAttempts: 5,
      payloadEncrypted: "unused",
      account: { vendorId: "vendor-1", status: "disabled" },
      identity: { vendorId: "vendor-1", revokedAt: null, lineUserIdEncrypted: "unused" },
    };
    const update = vi.fn().mockResolvedValue({});
    const db = { lineDelivery: {
      findMany: vi.fn().mockResolvedValue([due]),
      findUnique: vi.fn().mockResolvedValue(due),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update,
    } };
    const client = new MockLineMessagingClient();
    await expect(processDueLineDeliveries(db as never, () => client, new Date("2026-09-05T00:00:00Z")))
      .resolves.toEqual([{ id: "123e4567-e89b-42d3-a456-426614174001", status: "suppressed" }]);
    expect(client.calls).toHaveLength(0);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "suppressed", lastErrorCode: "line_consent_unavailable" }),
    }));
  });
});
