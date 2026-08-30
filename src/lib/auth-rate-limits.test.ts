import { describe, expect, it } from "vitest";
import { getLoginSourceLimit } from "@/lib/auth-rate-limits";

describe("getLoginSourceLimit", () => {
  it("allows the larger limit only for the strict local loopback E2E runtime", () => {
    expect(getLoginSourceLimit({
      NODE_ENV: "production",
      E2E_TEST_MODE: "true",
      E2E_BASE_URL: "http://127.0.0.1:31023",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31023",
    })).toBe(200);
  });

  const strictDefaultCases: Array<[string, NodeJS.ProcessEnv]> = [
    ["a production HTTPS URL", {
      NODE_ENV: "production",
      E2E_TEST_MODE: "true",
      E2E_BASE_URL: "https://app.example.test",
      NEXT_PUBLIC_APP_URL: "https://app.example.test",
    }],
    ["a preview URL", {
      NODE_ENV: "production",
      E2E_TEST_MODE: "true",
      E2E_BASE_URL: "https://celebrate-deal-preview.vercel.app",
      NEXT_PUBLIC_APP_URL: "https://celebrate-deal-preview.vercel.app",
    }],
    ["only the E2E flag", {
      NODE_ENV: "production",
      E2E_TEST_MODE: "true",
    }],
    ["a mismatched origin", {
      NODE_ENV: "production",
      E2E_TEST_MODE: "true",
      E2E_BASE_URL: "http://127.0.0.1:31024",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31023",
    }],
    ["a non-loopback URL", {
      NODE_ENV: "production",
      E2E_TEST_MODE: "true",
      E2E_BASE_URL: "http://example.test",
      NEXT_PUBLIC_APP_URL: "http://example.test",
    }],
  ];

  it.each(strictDefaultCases)(
    "returns the strict default limit for %s",
    (_description, env) => {
      expect(getLoginSourceLimit(env)).toBe(20);
    },
  );
});
