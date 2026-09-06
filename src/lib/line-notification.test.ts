import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LineMessagingError, MockLineMessagingClient } from "@/lib/line-client";
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
    expect(db.lineUserIdentity.findUnique).toHaveBeenCalledWith({
      where: {
        vendorId_subjectType_subjectId: {
          vendorId: "vendor-1",
          subjectType: "promoter",
          subjectId: "affiliate-1",
        },
      },
      select: { id: true, revokedAt: true },
    });
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
    const db = {
      lineDelivery: {
        findMany: vi.fn().mockResolvedValue([due]),
        findFirst: vi.fn().mockResolvedValue(due),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const client = new MockLineMessagingClient();
    const results = await processDueLineDeliveries(db as never, () => client, new Date("2026-09-05T00:00:00Z"));
    expect(results).toEqual([{ id: deliveryId, status: "sent" }]);
    expect(db.lineDelivery.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ status: "sending", claimedAt: { lt: new Date("2026-09-04T23:55:00Z") } }),
    }));
    expect(client.calls).toEqual([{ to: "U123", messages, retryKey: deliveryId }]);
    expect(db.lineDelivery.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: deliveryId, vendorId: "vendor-1" },
    }));
    expect(db.lineDelivery.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: deliveryId, vendorId: "vendor-1" }),
    }));
    expect(db.lineDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: deliveryId, vendorId: "vendor-1", status: "sending" }),
      data: expect.objectContaining({ status: "sent" }),
    }));
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
    const db = { lineDelivery: {
      findMany: vi.fn().mockResolvedValue([due]),
      findFirst: vi.fn().mockResolvedValue(due),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    } };
    const client = new MockLineMessagingClient();
    await expect(processDueLineDeliveries(db as never, () => client, new Date("2026-09-05T00:00:00Z")))
      .resolves.toEqual([{ id: "123e4567-e89b-42d3-a456-426614174001", status: "suppressed" }]);
    expect(client.calls).toHaveLength(0);
    expect(db.lineDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: due.id, vendorId: "vendor-1", status: "sending" }),
      data: expect.objectContaining({ status: "suppressed", lastErrorCode: "line_consent_unavailable" }),
    }));
  });

  it("treats a concurrent, tenant-scoped claim as unavailable without looking up or sending the delivery", async () => {
    const db = {
      lineDelivery: {
        findMany: vi.fn().mockResolvedValue([{
          id: "delivery-1", vendorId: "vendor-1", status: "queued", attemptCount: 0,
        }]),
        findFirst: vi.fn(),
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 0 }) // lease recovery is allowed to have nothing to recover
          .mockResolvedValueOnce({ count: 0 }), // another worker claimed this same version
      },
    };

    await expect(processDueLineDeliveries(db as never, () => new MockLineMessagingClient(), new Date("2026-09-05T00:00:00Z")))
      .resolves.toEqual([{ id: "delivery-1", status: "claimed_elsewhere" }]);
    expect(db.lineDelivery.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        id: "delivery-1",
        vendorId: "vendor-1",
        status: { in: ["queued", "failed"] },
        attemptCount: 0,
      },
    }));
    expect(db.lineDelivery.findFirst).not.toHaveBeenCalled();
  });

  it("limits lease recovery and due selection to an explicit vendor and delivery IDs", async () => {
    const db = {
      lineDelivery: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const now = new Date("2026-09-05T00:00:00Z");

    await expect(processDueLineDeliveries(db as never, () => new MockLineMessagingClient(), now, {
      vendorId: "vendor-1",
      deliveryIds: ["delivery-1", "delivery-2"],
    })).resolves.toEqual([]);

    expect(db.lineDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendorId: "vendor-1", id: { in: ["delivery-1", "delivery-2"] } }),
    }));
    expect(db.lineDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendorId: "vendor-1", id: { in: ["delivery-1", "delivery-2"] } }),
    }));
  });

  it("rejects a delivery-ID-only scope because it cannot establish tenant ownership", async () => {
    const db = { lineDelivery: { findMany: vi.fn(), updateMany: vi.fn() } };
    await expect(processDueLineDeliveries(db as never, () => new MockLineMessagingClient(), new Date(), {
      deliveryIds: ["delivery-1"],
    })).rejects.toThrow("LINE delivery ID scopes require a vendor ID.");
    expect(db.lineDelivery.updateMany).not.toHaveBeenCalled();
    expect(db.lineDelivery.findMany).not.toHaveBeenCalled();
  });

  it("records a retry-key conflict as sent because LINE already accepted the request", async () => {
    const due = {
      id: "123e4567-e89b-42d3-a456-426614174009",
      vendorId: "vendor-1",
      status: "failed",
      attemptCount: 1,
      maxAttempts: 5,
      payloadEncrypted: encryptSensitiveValue(JSON.stringify([{ type: "text", text: "安全測試" }]), "line-delivery:vendor-1:123e4567-e89b-42d3-a456-426614174009"),
      account: {
        vendorId: "vendor-1",
        status: "active",
        ...protectLineOfficialAccountCredentials("vendor-1", {
          messagingChannelId: "2000123456",
          messagingChannelSecret: "messaging-secret-1234567890",
          messagingAccessToken: "access-token-with-at-least-thirty-two-characters",
          loginChannelId: null,
          loginChannelSecret: null,
        }),
      },
      identity: { vendorId: "vendor-1", revokedAt: null, lineUserIdEncrypted: protectLineProfileValue("vendor-1", "userId", "U123") },
    };
    const updates = vi.fn().mockResolvedValue({ count: 1 });
    const db = { lineDelivery: {
      findMany: vi.fn().mockResolvedValue([due]),
      findFirst: vi.fn().mockResolvedValue(due),
      updateMany: updates,
    } };
    const client = new MockLineMessagingClient(new LineMessagingError("already accepted", 409));

    await expect(processDueLineDeliveries(db as never, () => client, new Date("2026-09-05T00:00:00Z")))
      .resolves.toEqual([{ id: due.id, status: "sent" }]);
    expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: due.id, vendorId: "vendor-1", status: "sending" },
      data: expect.objectContaining({ status: "sent", lastErrorCode: null }),
    }));
  });
});
