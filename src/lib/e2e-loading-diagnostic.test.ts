import { afterEach, describe, expect, it, vi } from "vitest";

const mockedHeaders = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({ headers: mockedHeaders }));

import { applyE2eLoadingDelay } from "./e2e-loading-diagnostic";

const headerStore = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  mockedHeaders.mockReset();
});

describe("applyE2eLoadingDelay", () => {
  it("does nothing when E2E diagnostics are disabled", async () => {
    vi.stubEnv("E2E_TEST_MODE", "false");

    await expect(applyE2eLoadingDelay()).resolves.toBeUndefined();
    expect(mockedHeaders).not.toHaveBeenCalled();
  });

  it("fails safe when a direct render has no Next request scope", async () => {
    vi.stubEnv("E2E_TEST_MODE", "true");
    mockedHeaders.mockRejectedValue(new Error("headers was called outside a request scope"));

    await expect(applyE2eLoadingDelay()).resolves.toBeUndefined();
  });

  it("waits only for a bounded loopback diagnostic delay", async () => {
    vi.stubEnv("E2E_TEST_MODE", "true");
    vi.useFakeTimers();
    mockedHeaders.mockResolvedValue(headerStore({
      host: "127.0.0.1:31023",
      "x-e2e-loading-delay-ms": "5",
    }));

    const pending = applyE2eLoadingDelay();
    await vi.advanceTimersByTimeAsync(5);
    await expect(pending).resolves.toBeUndefined();
  });
});
