import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { marker: "line-cron-db" },
  materializeLineNotifications: vi.fn(),
  processDueLineDeliveries: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/line-notification-materializer", () => ({
  materializeLineNotifications: mocks.materializeLineNotifications,
}));
vi.mock("@/lib/line-notification", () => ({ processDueLineDeliveries: mocks.processDueLineDeliveries }));

import { GET } from "./route";

function request(secret?: string) {
  return new Request("https://app.example.test/api/cron/line-notifications", {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

describe("GET /api/cron/line-notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "line-cron-test-secret-at-least-32-bytes");
    mocks.materializeLineNotifications.mockResolvedValue([]);
    mocks.processDueLineDeliveries.mockResolvedValue([]);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects missing, malformed, and invalid bearer tokens before touching the queue", async () => {
    for (const secret of [undefined, "wrong-secret"]) {
      expect((await GET(request(secret))).status).toBe(401);
    }
    const malformed = new Request("https://app.example.test/api/cron/line-notifications", {
      headers: { authorization: "Token line-cron-test-secret-at-least-32-bytes" },
    });
    expect((await GET(malformed)).status).toBe(401);
    expect(mocks.materializeLineNotifications).not.toHaveBeenCalled();
    expect(mocks.processDueLineDeliveries).not.toHaveBeenCalled();
  });

  it("materializes before dispatching with one injected database handle and returns sanitized counts only", async () => {
    mocks.materializeLineNotifications.mockResolvedValue([
      { status: "queued", deliveryId: "private-delivery-1" },
      { status: "unexpected", deliveryId: "private-delivery-2" },
    ]);
    mocks.processDueLineDeliveries.mockResolvedValue([
      { id: "private-delivery-3", status: "sent" },
      { id: "private-delivery-4", status: "claimed_elsewhere" },
    ]);

    const response = await GET(request("line-cron-test-secret-at-least-32-bytes"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      materialized: 2,
      materializedStatuses: { queued: 1, unknown: 1 },
      processed: 2,
      processedStatuses: { sent: 1, claimed_elsewhere: 1 },
    });
    expect(JSON.stringify(body)).not.toContain("private-delivery");
    expect(mocks.materializeLineNotifications).toHaveBeenCalledWith(mocks.db, expect.any(Date));
    expect(mocks.processDueLineDeliveries).toHaveBeenCalledWith(mocks.db, undefined, expect.any(Date));
    expect(mocks.materializeLineNotifications.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.processDueLineDeliveries.mock.invocationCallOrder[0]);
  });

  it("fails closed when the cron secret is absent or a worker fails", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    expect((await GET(request("line-cron-test-secret-at-least-32-bytes"))).status).toBe(401);
    expect(mocks.materializeLineNotifications).not.toHaveBeenCalled();

    vi.stubEnv("CRON_SECRET", "line-cron-test-secret-at-least-32-bytes");
    mocks.materializeLineNotifications.mockRejectedValue(new Error("private-provider-detail"));
    const response = await GET(request("line-cron-test-secret-at-least-32-bytes"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, materialized: 0, processed: 0 });
  });
});
