import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

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
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["TLS handshake failed for postgresql://user:secret@private-host.example", "tls"],
    ["password authentication failed for user postgres", "authentication"],
    ["Timed out fetching a new connection", "network_timeout"],
    ["Connection refused by database server", "connection_refused"],
    ["unclassified failure with secret=do-not-log", "unknown"],
  ] as const)("logs only the safe %s classification in Preview", async (sensitiveError, category) => {
    const error = new Prisma.PrismaClientInitializationError(sensitiveError, "6.19.3", "P1001");
    mocks.queryRaw.mockRejectedValue(error);
    vi.stubEnv("VERCEL_ENV", "preview");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(warn).toHaveBeenCalledExactlyOnceWith("health_database_error", { category, code: "P1001" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(sensitiveError);
  });

  it("classifies a known Prisma pool timeout without logging its message or metadata", async () => {
    const sensitiveError = "pool timeout at a private database endpoint";
    const error = new Prisma.PrismaClientKnownRequestError(sensitiveError, {
      code: "P2024",
      clientVersion: "6.19.3",
      meta: { connection_limit: 1, secret: "do-not-log" },
    });
    mocks.queryRaw.mockRejectedValue(error);
    vi.stubEnv("VERCEL_ENV", "preview");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(warn).toHaveBeenCalledExactlyOnceWith("health_database_error", {
      category: "network_timeout",
      code: "P2024",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(sensitiveError);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("do-not-log");
  });
});
