import { describe, expect, it } from "vitest";
import { getEnvCheckReport } from "@/lib/env";

describe("production payment environment", () => {
  it("fails preflight when production selects demo payment provider", () => {
    const report = getEnvCheckReport({ NODE_ENV: "production", PAYMENT_PROVIDER: "demo" });
    expect(report.checks).toContainEqual(expect.objectContaining({
      key: "PAYMENT_PROVIDER",
      status: "fail",
      message: expect.stringContaining("禁止"),
    }));
    expect(report.ok).toBe(false);
  });

  it("requires an independent attribution secret in production", () => {
    const report = getEnvCheckReport({ NODE_ENV: "production", PAYMENT_PROVIDER: "payuni" });
    expect(report.checks).toContainEqual(expect.objectContaining({ key: "ATTRIBUTION_SECRET", status: "fail" }));
  });
});
