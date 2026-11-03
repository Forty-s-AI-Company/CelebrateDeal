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

const NO_IDENTITY = { commitSha: null, deploymentId: null, vercelUrl: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockReturnValue({ $queryRaw: mocks.queryRaw });
  // Local runs have no Vercel system variables; keep the default shape deterministic.
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
  vi.stubEnv("VERCEL_DEPLOYMENT_ID", "");
  vi.stubEnv("VERCEL_URL", "");
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
      deployment: NO_IDENTITY,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
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
      deployment: NO_IDENTITY,
    });
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(body)).not.toContain(sensitiveError);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["TLS handshake failed for postgresql://user:secret@private-host.example", "tls"],
    ["password authentication failed for user postgres", "authentication"],
    ["Timed out fetching a new connection", "network-timeout"],
    ["Connection refused by database server", "connection-refused"],
    ["unclassified failure with secret=do-not-log", "unknown"],
  ] as const)(
    "logs only the safe %s classification in Preview and Production",
    async (sensitiveError, category) => {
      for (const environment of ["preview", "production"] as const) {
        vi.clearAllMocks();
        mocks.getDb.mockReturnValue({ $queryRaw: mocks.queryRaw });
        const error = new Prisma.PrismaClientInitializationError(sensitiveError, "6.19.3", "P1001");
        mocks.queryRaw.mockRejectedValue(error);
        vi.stubEnv("VERCEL_ENV", environment);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const response = await GET();
        const body = await response.json();

        expect(response.status).toBe(503);
        expect(body).toEqual({
          ok: false,
          database: "failed",
          latencyMs: expect.any(Number),
          error: "Database health check failed",
          deployment: NO_IDENTITY,
        });
        expect(warn).toHaveBeenCalledExactlyOnceWith("health_database_error", {
          category,
          code: "P1001",
          environment,
        });
        expect(JSON.stringify(body)).not.toContain(sensitiveError);
        expect(JSON.stringify(warn.mock.calls)).not.toContain(sensitiveError);
        warn.mockRestore();
      }
    },
  );

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
      category: "network-timeout",
      code: "P2024",
      environment: "preview",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(sensitiveError);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("do-not-log");
  });

  it("does not log diagnostics for an unrecognized runtime environment", async () => {
    const error = new Prisma.PrismaClientInitializationError(
      "password authentication failed for postgresql://user:secret@private-host.example",
      "6.19.3",
      "P1000",
    );
    mocks.queryRaw.mockRejectedValue(error);
    vi.stubEnv("VERCEL_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports the Vercel-injected deployment identity used by the staging alias attestation", async () => {
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_Fixture123");
    vi.stubEnv("VERCEL_URL", "celebrate-deal-staging-abc123-a25814740s-projects.vercel.app");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      database: "ok",
      latencyMs: expect.any(Number),
      deployment: {
        commitSha: "a".repeat(40),
        deploymentId: "dpl_Fixture123",
        vercelUrl: "celebrate-deal-staging-abc123-a25814740s-projects.vercel.app",
      },
    });
  });

  it("keeps the identity on a failed database probe so drift stays diagnosable", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("unreachable"));
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "b".repeat(40));
    vi.stubEnv("VERCEL_URL", "celebrate-deal-staging-def456-a25814740s-projects.vercel.app");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.deployment).toEqual({
      commitSha: "b".repeat(40),
      deploymentId: null,
      vercelUrl: "celebrate-deal-staging-def456-a25814740s-projects.vercel.app",
    });
  });

  it.each([
    ["VERCEL_GIT_COMMIT_SHA", "HEAD; DATABASE_URL=postgresql://user:secret@private-host.example"],
    ["VERCEL_GIT_COMMIT_SHA", "A".repeat(40)],
    ["VERCEL_DEPLOYMENT_ID", "dpl_<script>"],
    ["VERCEL_URL", "https://celebrate-deal-staging.vercel.app/path"],
    ["VERCEL_URL", "celebrate-deal-staging.carry-digital-nomad.in.net"],
    ["VERCEL_URL", "user:secret@celebrate-deal-staging.vercel.app"],
  ] as const)("never echoes an out-of-shape %s value", async (name, value) => {
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    vi.stubEnv(name, value);

    const response = await GET();
    const body = await response.json();

    expect(body.deployment).toEqual(NO_IDENTITY);
    expect(JSON.stringify(body)).not.toContain(value);
  });

  it("never includes server secrets or database configuration in the response", async () => {
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    vi.stubEnv("DATABASE_URL", "postgresql://user:test-fixture-secret@private-host.example");
    vi.stubEnv("JOB_SECRET", "test-fixture-job-secret");

    const response = await GET();
    const serialized = JSON.stringify(await response.json());

    expect(serialized).not.toContain("test-fixture-secret");
    expect(serialized).not.toContain("test-fixture-job-secret");
    expect(serialized).not.toContain("private-host.example");
  });
});
