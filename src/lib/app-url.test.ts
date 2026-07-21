import { describe, expect, it } from "vitest";
import { getCanonicalAppUrl } from "@/lib/app-url";

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
