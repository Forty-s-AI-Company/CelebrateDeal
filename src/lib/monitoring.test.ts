import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
}));

import { captureOperationalError } from "./monitoring";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("captureOperationalError", () => {
  it.each([
    ["TLS handshake failed", "tls"],
    ["password authentication failed", "authentication"],
    ["request timed out", "network-timeout"],
    ["ECONNREFUSED", "connection-refused"],
    ["provider_rejected:429", "provider-rejected"],
    ["unexpected failure", "unknown"],
  ] as const)("maps %s to the safe %s category", (message, category) => {
    vi.stubEnv("SENTRY_DSN", "test-fixture-dsn");

    captureOperationalError(new Error(message), { source: "unit_test" });

    expect(mocks.captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "OperationalError",
        message: "Operational error",
      }),
      {
        extra: {
          event: "operational_error",
          category,
          code: "unavailable",
          source: "unit_test",
        },
      },
    );
  });

  it("sends only an allowlisted diagnostic to Sentry", () => {
    vi.stubEnv("SENTRY_DSN", "test-fixture-dsn");
    const sensitiveMessage = "failed at postgresql://user:password@private-host";
    const sensitiveToken = "test-fixture-provider-token";
    const error = Object.assign(new Error(sensitiveMessage), {
      code: "P1001",
      meta: { token: sensitiveToken },
    });

    captureOperationalError(error, {
      source: "admin_ops",
      checkedAt: "2026-07-25T13:00:00.000Z",
      token: sensitiveToken,
      endpoint: "https://private-host.example",
      provider: "value with spaces is rejected",
    });

    const serialized = JSON.stringify(mocks.captureException.mock.calls);
    expect(serialized).not.toContain(sensitiveMessage);
    expect(serialized).not.toContain(sensitiveToken);
    expect(serialized).not.toContain("private-host");
    expect(mocks.captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "OperationalError",
        message: "Operational error",
      }),
      {
        extra: {
          event: "operational_error",
          category: "unknown",
          code: "P1001",
          source: "admin_ops",
          checkedAt: "2026-07-25T13:00:00.000Z",
        },
      },
    );
  });

  it("uses the same safe payload for the local fallback logger", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_DSN", undefined);
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", undefined);
    const sensitiveMessage = "request timed out with token=test-fixture-token";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    captureOperationalError(new Error(sensitiveMessage), {
      source: "admin_ops",
      password: "test-fixture-password",
    });

    expect(errorLog).toHaveBeenCalledExactlyOnceWith("operational_error", {
      event: "operational_error",
      category: "network-timeout",
      code: "unavailable",
      source: "admin_ops",
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(sensitiveMessage);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("test-fixture-password");
  });
});
