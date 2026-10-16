import { describe, expect, it } from "vitest";
import { isPasswordResetSmokeEnabled } from "@/lib/password-reset-smoke-policy";

describe("isPasswordResetSmokeEnabled", () => {
  it("allows non-production runtimes", () => {
    expect(isPasswordResetSmokeEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isPasswordResetSmokeEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("allows the explicitly matched local production-mode E2E runtime", () => {
    expect(isPasswordResetSmokeEnabled({
      NODE_ENV: "production",
      E2E_TEST_MODE: "true",
      E2E_BASE_URL: "http://127.0.0.1:31023",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31023",
    })).toBe(true);
  });

  it("blocks deployed production even when a smoke recipient is configured", () => {
    expect(isPasswordResetSmokeEnabled({
      NODE_ENV: "production",
      E2E_TEST_MODE: "true",
      E2E_BASE_URL: "https://app.example.test",
      NEXT_PUBLIC_APP_URL: "https://app.example.test",
      SMOKE_TEST_EMAIL: "smoke@example.test",
    })).toBe(false);
  });
});
