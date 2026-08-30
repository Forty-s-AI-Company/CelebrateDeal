import { describe, expect, it } from "vitest";
import { resolveSentryEnvironment } from "@/lib/sentry-environment";

describe("resolveSentryEnvironment", () => {
  it("prefers an explicit staging environment", () => {
    expect(resolveSentryEnvironment("staging", "preview", "production")).toBe("staging");
  });

  it("falls back to the first valid platform environment", () => {
    expect(resolveSentryEnvironment("", "preview", "production")).toBe("preview");
  });

  it("rejects unbounded or unsafe tag values", () => {
    expect(resolveSentryEnvironment("staging\nsecret=value", "x".repeat(65))).toBeUndefined();
  });
});
