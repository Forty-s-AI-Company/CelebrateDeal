import { describe, expect, it } from "vitest";
import { getCanonicalAppUrl, getPaymentReturnAppUrl, isExplicitLocalE2eRuntime } from "@/lib/app-url";

describe("getCanonicalAppUrl", () => {
  it("returns only the trusted origin from the configured URL", () => {
    expect(getCanonicalAppUrl({
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://app.example.test/ignored/path?query=1",
    })).toBe("https://app.example.test");
  });

  it("uses the local development URL outside production", () => {
    expect(getCanonicalAppUrl({ NODE_ENV: "test" })).toBe("http://localhost:31023");
  });

  it("allows HTTP only for an explicit local E2E production-server process", () => {
    const localEvidenceEnv: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      E2E_TEST_MODE: "true",
      E2E_BASE_URL: "http://127.0.0.1:31023",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31023",
    };
    expect(getCanonicalAppUrl(localEvidenceEnv)).toBe("http://127.0.0.1:31023");
    expect(isExplicitLocalE2eRuntime(localEvidenceEnv)).toBe(true);

    expect(() => getCanonicalAppUrl({
      NODE_ENV: "production",
      E2E_TEST_MODE: "true",
      E2E_BASE_URL: "http://localhost:31023",
      NEXT_PUBLIC_APP_URL: "http://example.test",
    })).toThrow("HTTPS in production");
  });

  it("does not treat a flag alone, a mismatched origin, or a non-loopback URL as local E2E", () => {
    expect(isExplicitLocalE2eRuntime({ NODE_ENV: "production", E2E_TEST_MODE: "true" })).toBe(false);
    expect(isExplicitLocalE2eRuntime({
      NODE_ENV: "production",
      E2E_TEST_MODE: "true",
      E2E_BASE_URL: "http://127.0.0.1:31024",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31023",
    })).toBe(false);
    expect(isExplicitLocalE2eRuntime({
      NODE_ENV: "production",
      E2E_TEST_MODE: "true",
      E2E_BASE_URL: "http://example.test",
      NEXT_PUBLIC_APP_URL: "http://example.test",
    })).toBe(false);
  });

  const unsafeProductionEnvironments: Array<[NodeJS.ProcessEnv, string]> = [
    [{ NODE_ENV: "production" }, "required in production"],
    [{ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "not-a-url" }, "valid absolute URL"],
    [{ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "javascript:alert(1)" }, "HTTP or HTTPS"],
    [{ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://app.example.test" }, "HTTPS in production"],
    [{ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://user:pass@app.example.test" }, "must not contain credentials"],
  ];

  it.each(unsafeProductionEnvironments)("fails closed for an unsafe production URL", (env, error) => {
    expect(() => getCanonicalAppUrl(env)).toThrow(error);
  });
});

describe("getPaymentReturnAppUrl", () => {
  const env = {
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    VERCEL_URL: "preview.example.test",
    NEXT_PUBLIC_APP_URL: "https://staging.example.test",
  } as NodeJS.ProcessEnv;

  it("keeps an exact Vercel Preview checkout on its cookie origin", () => {
    expect(getPaymentReturnAppUrl(new Request("https://preview.example.test/api/payments/checkout"), env))
      .toBe("https://preview.example.test");
  });

  it("uses the canonical origin for its public alias", () => {
    expect(getPaymentReturnAppUrl(new Request("https://staging.example.test/api/payments/checkout"), env))
      .toBe("https://staging.example.test");
  });

  it("rejects an untrusted request host as a payment return destination", () => {
    expect(getPaymentReturnAppUrl(new Request("https://attacker.example.test/api/payments/checkout"), env))
      .toBe("https://staging.example.test");
  });
});
