import { afterEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => {
  const db = {
    webhookEvent: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    db,
    processPaymentWebhook: vi.fn(),
    auditSnapshot: vi.fn(() => ({ snapshot: "redacted" })),
    writeAuditLog: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ getDb: () => dependencies.db }));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: dependencies.auditSnapshot,
  writeAuditLog: dependencies.writeAuditLog,
}));
vi.mock("@/lib/payment-webhooks", () => ({
  PaymentWebhookPayload: {
    safeParse: (value: unknown) => {
      if (typeof value === "object" && value !== null && "provider" in value && "eventId" in value) {
        return { success: true, data: value };
      }
      return { success: false, error: new Error("invalid payload") };
    },
  },
  processPaymentWebhook: dependencies.processPaymentWebhook,
}));

import { processDueWebhookRetries, retryWebhookEvent } from "@/lib/webhook-retry";

const now = new Date("2025-01-01T00:00:00.000Z");

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    vendorId: "vendor-1",
    provider: "demo",
    eventId: "event-reference-1",
    eventType: "paid",
    status: "failed",
    retryCount: 0,
    maxRetries: 3,
    nextRetryAt: new Date("2024-12-31T23:59:00.000Z"),
    errorMessage: "prior failure",
    payload: { normalized: { provider: "demo", eventId: "event-reference-1" } },
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("webhook retry worker", () => {
  it("returns missing without writing when the event does not exist", async () => {
    dependencies.db.webhookEvent.findUnique.mockResolvedValue(null);

    await expect(retryWebhookEvent("absent-event")).resolves.toEqual({ status: "missing" });
    expect(dependencies.db.webhookEvent.update).not.toHaveBeenCalled();
  });

  it("exhausts an event already at its retry limit and clears its next retry time", async () => {
    const storedEvent = event({ retryCount: 3 });
    dependencies.db.webhookEvent.findUnique.mockResolvedValue(storedEvent);
    dependencies.db.webhookEvent.update.mockResolvedValue(storedEvent);

    await expect(retryWebhookEvent(storedEvent.id)).resolves.toMatchObject({ status: "exhausted", event: storedEvent });
    expect(dependencies.db.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: storedEvent.id },
      data: { status: "exhausted", nextRetryAt: null },
    });
  });

  it("increments invalid stored payload retries, scheduling or exhausting at the limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const retryable = event({ id: "invalid-retryable", retryCount: 1, payload: { normalized: {} } });
    const finalAttempt = event({ id: "invalid-final", retryCount: 2, payload: { normalized: {} } });
    dependencies.db.webhookEvent.findUnique.mockResolvedValueOnce(retryable).mockResolvedValueOnce(finalAttempt);
    dependencies.db.webhookEvent.update.mockResolvedValue({});

    await expect(retryWebhookEvent(retryable.id)).resolves.toMatchObject({ status: "failed" });
    await expect(retryWebhookEvent(finalAttempt.id)).resolves.toMatchObject({ status: "exhausted" });

    expect(dependencies.db.webhookEvent.update).toHaveBeenNthCalledWith(1, {
      where: { id: retryable.id },
      data: {
        status: "failed",
        errorMessage: "Stored payload is invalid",
        retryCount: { increment: 1 },
        nextRetryAt: new Date("2025-01-01T00:15:00.000Z"),
      },
    });
    expect(dependencies.db.webhookEvent.update).toHaveBeenNthCalledWith(2, {
      where: { id: finalAttempt.id },
      data: {
        status: "exhausted",
        errorMessage: "Stored payload is invalid",
        retryCount: { increment: 1 },
        nextRetryAt: null,
      },
    });
  });

  it("marks successful retries processed, clears prior failure data, and writes an audit entry", async () => {
    const storedEvent = event();
    const result = { vendor: { id: "vendor-1" }, transaction: { id: "transaction-1" } };
    dependencies.db.webhookEvent.findUnique.mockResolvedValue(storedEvent);
    dependencies.db.webhookEvent.update.mockResolvedValue({});
    dependencies.processPaymentWebhook.mockResolvedValue(result);

    await expect(retryWebhookEvent(storedEvent.id, "job:test")).resolves.toMatchObject({ status: "processed", event: storedEvent, result });

    expect(dependencies.db.webhookEvent.update).toHaveBeenNthCalledWith(1, {
      where: { id: storedEvent.id },
      data: { status: "retrying" },
    });
    expect(dependencies.db.webhookEvent.update).toHaveBeenNthCalledWith(2, {
      where: { id: storedEvent.id },
      data: { status: "processed", nextRetryAt: null, errorMessage: null },
    });
    expect(dependencies.processPaymentWebhook).toHaveBeenCalledWith(storedEvent.payload.normalized, storedEvent);
    expect(dependencies.writeAuditLog).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      actorLabel: "job:test",
      action: "retry_webhook_event",
      targetType: "WebhookEvent",
      targetId: storedEvent.id,
      before: { snapshot: "redacted" },
      after: { snapshot: "redacted" },
    });
  });

  it("records failed and exhausted processing attempts with safe audit entries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const retryable = event({ id: "processing-failed", retryCount: 1 });
    const finalAttempt = event({ id: "processing-exhausted", retryCount: 2 });
    dependencies.db.webhookEvent.findUnique.mockResolvedValueOnce(retryable).mockResolvedValueOnce(finalAttempt);
    dependencies.db.webhookEvent.update.mockResolvedValue({});
    dependencies.processPaymentWebhook.mockRejectedValueOnce(new Error("temporary failure")).mockRejectedValueOnce(new Error("final failure"));

    await expect(retryWebhookEvent(retryable.id)).resolves.toMatchObject({ status: "failed", error: "temporary failure" });
    await expect(retryWebhookEvent(finalAttempt.id)).resolves.toMatchObject({ status: "exhausted", error: "final failure" });

    expect(dependencies.db.webhookEvent.update).toHaveBeenNthCalledWith(2, {
      where: { id: retryable.id },
      data: { status: "failed", errorMessage: "temporary failure", retryCount: { increment: 1 }, nextRetryAt: new Date("2025-01-01T00:15:00.000Z") },
    });
    expect(dependencies.db.webhookEvent.update).toHaveBeenNthCalledWith(4, {
      where: { id: finalAttempt.id },
      data: { status: "exhausted", errorMessage: "final failure", retryCount: { increment: 1 }, nextRetryAt: null },
    });
    expect(dependencies.writeAuditLog).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: "webhook_retry_failed", targetId: retryable.id }));
    expect(dependencies.writeAuditLog).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: "webhook_retry_exhausted", targetId: finalAttempt.id }));
    expect(dependencies.auditSnapshot).toHaveBeenCalledTimes(4);
  });

  it("fetches only due failed events in next-retry order, obeys the limit, and returns that order", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const first = event({ id: "oldest", retryCount: 3, nextRetryAt: new Date("2024-12-31T23:58:00.000Z") });
    const second = event({ id: "newer", retryCount: 3, nextRetryAt: new Date("2024-12-31T23:59:00.000Z") });
    dependencies.db.webhookEvent.findMany.mockResolvedValue([first, second]);
    dependencies.db.webhookEvent.update.mockResolvedValue({});

    await expect(processDueWebhookRetries(2)).resolves.toEqual([
      { eventId: first.id, status: "exhausted" },
      { eventId: second.id, status: "exhausted" },
    ]);
    expect(dependencies.db.webhookEvent.findMany).toHaveBeenCalledWith({
      where: { status: "failed", nextRetryAt: { lte: now } },
      orderBy: { nextRetryAt: "asc" },
      take: 2,
    });
  });
});
