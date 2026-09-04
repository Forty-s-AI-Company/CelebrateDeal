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
  const canonicalEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
  };
  const previewHost = "celebratedeal-git-safe-preview.vercel.app";

  it("keeps an exact verified Preview Sandbox callback on its issuing origin", () => {
    expect(getPaymentReturnAppUrl(
      new Request(`https://${previewHost}/api/payments/checkout`),
      { ...canonicalEnvironment, VERCEL_ENV: "preview", PAYUNI_ENV: "sandbox", VERCEL_URL: previewHost },
    )).toBe(`https://${previewHost}`);
  });

  it("uses the canonical origin for canonical, default, and production requests", () => {
    expect(getPaymentReturnAppUrl(
      new Request("https://app.example.test/api/payments/checkout"),
      { ...canonicalEnvironment, VERCEL_ENV: "preview", PAYUNI_ENV: "sandbox", VERCEL_URL: previewHost },
    )).toBe("https://app.example.test");
    expect(getPaymentReturnAppUrl(
      new Request(`https://${previewHost}/api/payments/checkout`),
      canonicalEnvironment,
    )).toBe("https://app.example.test");
    expect(getPaymentReturnAppUrl(
      new Request(`https://${previewHost}/api/payments/checkout`),
      { ...canonicalEnvironment, VERCEL_ENV: "production", PAYUNI_ENV: "sandbox", VERCEL_URL: previewHost },
    )).toBe("https://app.example.test");
  });

  it("does not use Preview returns for PayUni Production", () => {
    expect(getPaymentReturnAppUrl(
      new Request(`https://${previewHost}/api/payments/checkout`),
      { ...canonicalEnvironment, VERCEL_ENV: "preview", PAYUNI_ENV: "production", VERCEL_URL: previewHost },
    )).toBe("https://app.example.test");
  });

  const malformedBindings = [
    "https://celebratedeal-git-safe-preview.vercel.app",
    "celebratedeal-git-safe-preview.vercel.app:443",
    "celebratedeal-git-safe-preview.vercel.app/path",
    "celebratedeal-git-safe-preview.vercel.app?query=1",
    "user@celebratedeal-git-safe-preview.vercel.app",
    "celebratedeal-git-safe-preview.preview.vercel.app",
    "celebratedeal-git-safe-preview.vercel.app.evil.example",
    " celebratedeal-git-safe-preview.vercel.app",
  ];

  it.each(malformedBindings)("fails closed for malformed server deployment binding %s", (binding) => {
    expect(getPaymentReturnAppUrl(
      new Request(`https://${previewHost}/api/payments/checkout`),
      { ...canonicalEnvironment, VERCEL_ENV: "preview", PAYUNI_ENV: "sandbox", VERCEL_URL: binding },
    )).toBe("https://app.example.test");
  });

  it("rejects a hostile request-origin lookalike even with a valid server binding", () => {
    expect(getPaymentReturnAppUrl(
      new Request(`https://${previewHost}.evil.example/api/payments/checkout`),
      { ...canonicalEnvironment, VERCEL_ENV: "preview", PAYUNI_ENV: "sandbox", VERCEL_URL: previewHost },
    )).toBe("https://app.example.test");
  });
});
