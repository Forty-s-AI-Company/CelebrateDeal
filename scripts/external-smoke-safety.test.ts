import { describe, expect, it } from "vitest";
import { resolveSmokeTarget } from "./external-smoke-safety";

describe("resolveSmokeTarget", () => {
  it("defaults to the local smoke server without extra authorization", () => {
    expect(resolveSmokeTarget({})).toBe("http://localhost:31023");
  });

  it("accepts an explicit loopback target", () => {
    expect(resolveSmokeTarget({ targetAppUrl: "http://127.0.0.1:4000/" })).toBe("http://127.0.0.1:4000");
  });

  it("rejects credentials embedded in the target URL", () => {
    expect(() => resolveSmokeTarget({ targetAppUrl: "https://user:secret@preview.example.test" })).toThrow(
      "must not contain credentials",
    );
  });

  it("rejects an insecure remote target", () => {
    expect(() =>
      resolveSmokeTarget({
        targetAppUrl: "http://preview.example.test",
        smokeEnvironment: "preview",
        allowStagingSmoke: "true",
        expectedHostname: "preview.example.test",
      }),
    ).toThrow("must use HTTPS");
  });

  it("requires an explicit non-production environment for remote targets", () => {
    expect(() =>
      resolveSmokeTarget({
        targetAppUrl: "https://preview.example.test",
        allowStagingSmoke: "true",
        expectedHostname: "preview.example.test",
      }),
    ).toThrow("SMOKE_ENVIRONMENT=preview or staging");
  });

  it("requires explicit remote smoke authorization", () => {
    expect(() =>
      resolveSmokeTarget({
        targetAppUrl: "https://preview.example.test",
        smokeEnvironment: "preview",
        expectedHostname: "preview.example.test",
      }),
    ).toThrow("ALLOW_STAGING_SMOKE=true");
  });

  it("requires the exact expected remote hostname", () => {
    expect(() =>
      resolveSmokeTarget({
        targetAppUrl: "https://production.example.test",
        smokeEnvironment: "staging",
        allowStagingSmoke: "true",
        expectedHostname: "staging.example.test",
      }),
    ).toThrow("does not match SMOKE_EXPECTED_HOSTNAME");
  });

  it("accepts a fully confirmed staging target and removes paths, queries, and fragments", () => {
    expect(
      resolveSmokeTarget({
        targetAppUrl: "https://staging.example.test/app/?debug=true#section",
        smokeEnvironment: "staging",
        allowStagingSmoke: "true",
        expectedHostname: "staging.example.test",
      }),
    ).toBe("https://staging.example.test");
  });
});
