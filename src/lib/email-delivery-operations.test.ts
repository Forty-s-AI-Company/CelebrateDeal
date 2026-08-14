import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEmailDeliveryWhere,
  canManuallyRequeueEmailDelivery,
  loadEmailDeliverySearchResult,
  parseEmailDeliverySearchInput,
  requeueEmailDelivery,
} from "./email-delivery-operations";

function formData(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "g7-55-email-operations-secret-at-least-32-bytes");
});

afterEach(() => vi.unstubAllEnvs());

describe("email delivery merchant operations", () => {
  it("parses allowlisted POST filters, retry operations and reset without putting PII in a URL", () => {
    expect(parseEmailDeliverySearchInput(formData({
      query: "Lead@Example.Test",
      status: "ATTENTION",
      trigger: "live_reminder",
      operation: "retry:email_0123456789abcdef0123456789abcdef",
      currentPage: "3",
    }))).toEqual({
      success: true,
      data: { query: "Lead@Example.Test", status: "ATTENTION", trigger: "live_reminder", page: 3 },
      retryDeliveryId: "email_0123456789abcdef0123456789abcdef",
    });
    expect(parseEmailDeliverySearchInput(formData({
      query: "lead@example.test",
      status: "sent",
      trigger: "live_reminder",
      operation: "reset",
      page: "9",
    }))).toEqual({
      success: true,
      data: { query: "", status: "ALL", trigger: "ALL", page: 1 },
      retryDeliveryId: null,
    });
    expect(parseEmailDeliverySearchInput(formData({ query: "partial recipient" }))).toMatchObject({ success: false });
  });

  it("hashes an exact recipient per tenant and never builds a decrypted email predicate", () => {
    const vendorA = buildEmailDeliveryWhere("vendor-a", {
      query: "Lead@Example.Test",
      status: "ATTENTION",
      trigger: "ALL",
      page: 1,
    });
    const vendorB = buildEmailDeliveryWhere("vendor-b", {
      query: "lead@example.test",
      status: "ALL",
      trigger: "ALL",
      page: 1,
    });
    expect(vendorA).toMatchObject({
      vendorId: "vendor-a",
      recipientHash: expect.any(String),
      status: { in: ["failed", "exhausted"] },
    });
    expect(vendorA.recipientHash).not.toBe(vendorB.recipientHash);
    expect(JSON.stringify(vendorA)).not.toContain("Lead@Example.Test");
    expect(JSON.stringify(vendorA)).not.toContain("lead@example.test");
  });

  it("returns a bounded masked projection, stable ordering, counts and pagination", async () => {
    const database = {
      emailDelivery: {
        count: vi.fn().mockResolvedValue(51),
        groupBy: vi.fn().mockResolvedValue([
          { status: "sent", _count: { _all: 40 } },
          { status: "failed", _count: { _all: 11 } },
        ]),
        findMany: vi.fn().mockResolvedValue([{
          id: "email_0123456789abcdef0123456789abcdef",
          recipientMaskedEmail: "l***@example.test",
          status: "failed",
          trigger: "registration_confirmed",
          attemptCount: 2,
          maxAttempts: 5,
          manualRetryCount: 1,
          createdAt: new Date("2026-08-10T00:00:00.000Z"),
          sentAt: null,
          nextAttemptAt: new Date("2026-08-10T00:15:00.000Z"),
          lastManualRetryAt: new Date("2026-08-09T23:00:00.000Z"),
          lastErrorCode: "network",
        }]),
      },
      emailSuppression: { count: vi.fn().mockResolvedValue(3) },
    };

    const result = await loadEmailDeliverySearchResult("vendor-1", {
      query: "",
      status: "ALL",
      trigger: "ALL",
      page: 3,
    }, database as never);
    expect(result).toMatchObject({
      totalItems: 51,
      totalPages: 3,
      page: 3,
      pageSize: 25,
      counts: { sent: 40, failed: 11, activeSuppressions: 3 },
      items: [{ recipientMaskedEmail: "l***@example.test", canRetry: true, manualRetryCount: 1 }],
    });
    expect(database.emailDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 50,
      take: 25,
      select: expect.not.objectContaining({ payloadEncryptedEnvelope: true, providerMessageId: true }),
    }));
  });

  it("allows bounded failed retries but keeps permanent exhausted rejections fail-closed", () => {
    expect(canManuallyRequeueEmailDelivery("failed", "provider_rejected")).toBe(true);
    expect(canManuallyRequeueEmailDelivery("exhausted", "network")).toBe(true);
    expect(canManuallyRequeueEmailDelivery("exhausted", "provider_rejected")).toBe(false);
    expect(canManuallyRequeueEmailDelivery("suppressed", "recipient_suppressed")).toBe(false);
    expect(canManuallyRequeueEmailDelivery("sent", null)).toBe(false);
  });

  it("requeues only tenant-owned durable state with CAS, audit and a preserved provider identity", async () => {
    const now = new Date("2026-08-10T01:00:00.000Z");
    const tx = {
      emailDelivery: {
        findFirst: vi.fn().mockResolvedValue({
          id: "email_0123456789abcdef0123456789abcdef",
          vendorId: "vendor-1",
          sourceLiveId: null,
          sourceFormSubmissionId: "submission-1",
          trigger: "registration_confirmed",
          status: "exhausted",
          attemptCount: 5,
          maxAttempts: 5,
          lastErrorCode: "network",
          updatedAt: new Date("2026-08-10T00:00:00.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      live: { findFirst: vi.fn() },
      formSubmission: { findFirst: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    };
    const database = {
      $transaction: vi.fn().mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(requeueEmailDelivery({
      vendorId: "vendor-1",
      deliveryId: "email_0123456789abcdef0123456789abcdef",
      actorId: "member-1",
      actorLabel: "owner",
      now,
      database: database as never,
    })).resolves.toEqual({ status: "requeued", previousStatus: "exhausted" });
    expect(tx.emailDelivery.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "email_0123456789abcdef0123456789abcdef", vendorId: "vendor-1" },
    }));
    const mutation = tx.emailDelivery.updateMany.mock.calls[0]?.[0];
    expect(mutation).toMatchObject({
      where: expect.objectContaining({ vendorId: "vendor-1", status: "exhausted", updatedAt: expect.any(Date) }),
      data: {
        status: "queued",
        attemptCount: 0,
        nextAttemptAt: now,
        claimedAt: null,
        failedAt: null,
        lastErrorCode: null,
        manualRetryCount: { increment: 1 },
        lastManualRetryAt: now,
      },
    });
    expect(JSON.stringify(mutation)).not.toContain("idempotencyKey");
    expect(JSON.stringify(mutation)).not.toContain("payloadEncryptedEnvelope");
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "email_delivery_requeued", targetId: "email_0123456789abcdef0123456789abcdef" }),
    }));
  });

  it("marks an expired verification snapshot superseded instead of requeueing an invalid link", async () => {
    const now = new Date("2026-08-10T01:00:00.000Z");
    const tx = {
      emailDelivery: {
        findFirst: vi.fn().mockResolvedValue({
          id: "email_0123456789abcdef0123456789abcdef",
          vendorId: "vendor-1",
          sourceLiveId: null,
          sourceFormSubmissionId: "submission-1",
          trigger: "form_submission_verification",
          status: "failed",
          attemptCount: 2,
          maxAttempts: 5,
          lastErrorCode: "network",
          updatedAt: new Date("2026-08-10T00:00:00.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      live: { findFirst: vi.fn() },
      formSubmission: {
        findFirst: vi.fn().mockResolvedValue({
          id: "submission-1",
          verificationStatus: "UNVERIFIED",
          verificationVersion: 1,
          verificationExpiresAt: new Date("2026-08-09T00:00:00.000Z"),
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    };
    const database = { $transaction: vi.fn().mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx)) };

    await expect(requeueEmailDelivery({
      vendorId: "vendor-1",
      deliveryId: "email_0123456789abcdef0123456789abcdef",
      actorId: "member-1",
      actorLabel: "owner",
      now,
      database: database as never,
    })).resolves.toEqual({ status: "stale" });
    expect(tx.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "superseded", lastErrorCode: "verification_superseded" }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "email_delivery_retry_rejected_stale" }),
    }));
  });
});
