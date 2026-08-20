import { describe, expect, it } from "vitest";
import {
  resolveSmokeTarget,
  summarizeSmokeFailure,
  summarizeSmokeResponse,
} from "./external-smoke-safety";

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

  it("summarizes an untrusted provider payload without exposing its values", () => {
    const secretSentinel = "https://provider.example.test/upload?token=secret-sentinel";
    const summary = summarizeSmokeResponse({
      status: 401,
      ok: false,
      payload: {
        ok: false,
        error: secretSentinel,
        token: "token-sentinel",
        orderNumber: "order-sentinel",
      },
    });

    expect(summary).toBe("HTTP 401; transport=client_error; payload=json; application=not_ok");
    expect(summary).not.toContain(secretSentinel);
    expect(summary).not.toContain("token-sentinel");
    expect(summary).not.toContain("order-sentinel");
  });

  it("classifies text, empty, invalid status, and successful responses with fixed enums", () => {
    expect(summarizeSmokeResponse({ status: 204, ok: true, payload: null })).toBe(
      "HTTP 204; transport=success; payload=empty; application=unknown",
    );
    expect(summarizeSmokeResponse({ status: 200, ok: true, payload: "opaque response body" })).toBe(
      "HTTP 200; transport=success; payload=text; application=unknown",
    );
    expect(summarizeSmokeResponse({ status: 700, ok: false, payload: ["untrusted"] })).toBe(
      "HTTP unknown; transport=unknown; payload=other; application=unknown",
    );
  });

  it("discards arbitrary error messages before creating evidence output", () => {
    const error = new Error("https://provider.example.test/?token=secret-sentinel");
    expect(summarizeSmokeFailure(error)).toBe("error=runner_failure");
    expect(summarizeSmokeFailure(new TypeError("customer@example.test"))).toBe("error=network_failure");
    expect(summarizeSmokeFailure({ message: "raw provider response" })).toBe("error=runner_failure");
  });
});
