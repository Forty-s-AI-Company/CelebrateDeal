import { describe, expect, it } from "vitest";
import { parseArguments, percentile, summarizeLatencies, syntheticEnvironment } from "./lp-load-probe.mjs";

describe("lp load probe helpers", () => {
  it("parses bounded options and rejects unknown or oversized runs", () => {
    expect(parseArguments([])).toMatchObject({ build: false, port: 31043, concurrency: 100, requests: 2000 });
    expect(parseArguments(["--build", "--concurrency", "20", "--requests", "200", "--label", "after"])).toMatchObject({
      build: true,
      concurrency: 20,
      requests: 200,
      label: "after",
    });
    expect(() => parseArguments(["--unknown"])).toThrow();
    expect(() => parseArguments(["--concurrency", "0"])).toThrow();
    expect(() => parseArguments(["--concurrency", "501"])).toThrow();
    expect(() => parseArguments(["--port"])).toThrow();
  });

  it("uses nearest-rank percentiles", () => {
    const sorted = Array.from({ length: 100 }, (_value, index) => index + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile([], 50)).toBeNull();
    expect(summarizeLatencies([3, 1, 2])).toEqual({ p50: 2, p95: 3, p99: 3, max: 3 });
  });

  it("builds a synthetic loopback environment that never forwards shell secrets", () => {
    const previous = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = "https://example.invalid/should-not-leak";
    try {
      const env = syntheticEnvironment("postgresql://postgres:postgres@127.0.0.1:5433/celebratedeal_e2e?schema=public", 31043);
      expect(env.SENTRY_DSN).toBe("");
      expect(env.NEXT_PUBLIC_APP_URL).toBe("http://127.0.0.1:31043");
      expect(env.CELEBRATEDEAL_PRISMA_QUERY_LOG).toBe("stdout");
      expect(env.NODE_ENV).toBe("production");
      expect(Object.keys(env)).not.toContain("RESEND_API_KEY");
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = previous;
    }
  });
});
