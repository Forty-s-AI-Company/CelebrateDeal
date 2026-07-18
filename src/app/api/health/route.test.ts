import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockReturnValue({ $queryRaw: mocks.queryRaw });
});

describe("GET /api/health", () => {
  it("returns a healthy database status and non-negative latency when the database is reachable", async () => {
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      database: "ok",
      latencyMs: expect.any(Number),
    });
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(mocks.getDb).toHaveBeenCalledOnce();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });

  it("returns a generic service-unavailable error without leaking database details", async () => {
    const sensitiveError = "test-fixture-sensitive database connection failure";
    mocks.queryRaw.mockRejectedValue(new Error(sensitiveError));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      database: "failed",
      latencyMs: expect.any(Number),
      error: "Database health check failed",
    });
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(body)).not.toContain(sensitiveError);
  });
});
