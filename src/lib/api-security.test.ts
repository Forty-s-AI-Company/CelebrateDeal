import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_REQUEST_HEADER,
  CLIENT_REQUEST_HEADER_VALUE,
  MAX_JSON_BODY_BYTES,
  isAuthorizedBearer,
  readFormDataBody,
  readJsonBody,
  readTextBody,
  requireJobSecret,
  requireOpsSmokeSecret,
  requireSameOriginRequest,
} from "@/lib/api-security";
import { opsSmokeSecret } from "@/lib/ops-smoke-config";

function request(headers: Record<string, string> = {}) {
  return new Request("https://request.example.test/api/test", {
    method: "POST",
    headers,
  });
}

function trustedRequest(headers: Record<string, string> = {}) {
  return request({
    [CLIENT_REQUEST_HEADER]: CLIENT_REQUEST_HEADER_VALUE,
    ...headers,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
});

describe("requireSameOriginRequest", () => {
  it("rejects a request missing the trusted client marker", async () => {
    const response = requireSameOriginRequest(request(), { requireClientHeader: true });

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: "Missing trusted client header" });
  });

  it("rejects a request with an incorrect trusted client marker", async () => {
    const response = requireSameOriginRequest(request({ [CLIENT_REQUEST_HEADER]: "mobile" }), {
      requireClientHeader: true,
    });

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: "Missing trusted client header" });
  });

  it("rejects a trusted client marker when both Origin and Referer are missing", async () => {
    const response = requireSameOriginRequest(trustedRequest(), { requireClientHeader: true });

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: "Missing request origin" });
  });

  it("rejects a cross-origin Origin even with the trusted client marker", async () => {
    const response = requireSameOriginRequest(trustedRequest({ origin: "https://attacker.example.test" }), {
      requireClientHeader: true,
    });

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: "Invalid request origin" });
  });

  it("rejects a cross-origin Referer even with the trusted client marker", async () => {
    const response = requireSameOriginRequest(trustedRequest({ referer: "https://attacker.example.test/form" }), {
      requireClientHeader: true,
    });

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: "Invalid request origin" });
  });

  it.each([
    { header: "origin", value: "https://request.example.test" },
    { header: "referer", value: "https://request.example.test/form" },
  ])("allows a $header matching the request URL origin", ({ header, value }) => {
    expect(requireSameOriginRequest(trustedRequest({ [header]: value }), { requireClientHeader: true })).toBeNull();
  });

  it.each([
    { header: "origin", value: "https://app.example.test" },
    { header: "referer", value: "https://app.example.test/form" },
  ])("allows a $header matching the configured app origin", ({ header, value }) => {
    expect(requireSameOriginRequest(trustedRequest({ [header]: value }), { requireClientHeader: true })).toBeNull();
  });

  it("allows the browser origin matching the actual Host when request.url uses an internal origin", () => {
    const response = requireSameOriginRequest(new Request("https://internal-loopback.test/api/test", {
      method: "POST",
      headers: {
        [CLIENT_REQUEST_HEADER]: CLIENT_REQUEST_HEADER_VALUE,
        host: "127.0.0.1:31124",
        origin: "http://127.0.0.1:31124",
      },
    }), { requireClientHeader: true });

    expect(response).toBeNull();
  });

  it("does not let forwarded host headers expand the origin allowlist", async () => {
    const response = requireSameOriginRequest(trustedRequest({
      origin: "https://attacker.example.test",
      "x-forwarded-host": "attacker.example.test",
      "x-forwarded-proto": "https",
    }), { requireClientHeader: true });

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: "Invalid request origin" });
  });
});

describe("isAuthorizedBearer", () => {
  const secret = "test-fixture-job-secret";

  it.each([
    ["Bearer test-fixture-job-secret", true],
    ["bearer test-fixture-job-secret", true],
    ["Bearer test-fixture-job-secret trailing", false],
    ["Bearer", false],
    ["Basic test-fixture-job-secret", false],
  ])("accepts only an exact two-part Bearer authorization value", (authorization, expected) => {
    const request = new Request("https://request.example.test/api/test", {
      headers: { authorization },
    });

    expect(isAuthorizedBearer(request, secret)).toBe(expected);
  });
});

describe("readJsonBody", () => {
  it("parses valid JSON within the request-size limit", async () => {
    const body = { event: "page_view", payload: { slug: "demo" } };
    const parsed = await readJsonBody(new Request("https://request.example.test/api/test", {
      method: "POST",
      body: JSON.stringify(body),
    }));

    expect(parsed).toEqual(body);
  });

  it("rejects a declared oversized request before parsing it", async () => {
    const parsed = await readJsonBody(new Request("https://request.example.test/api/test", {
      method: "POST",
      headers: { "content-length": String(MAX_JSON_BODY_BYTES + 1) },
      body: "{}",
    }));

    expect(parsed).toEqual({});
  });

  it("stops streaming an oversized request even when content-length is absent", async () => {
    const parsed = await readJsonBody(new Request("https://request.example.test/api/test", {
      method: "POST",
      body: JSON.stringify({ payload: "x".repeat(MAX_JSON_BODY_BYTES) }),
    }));

    expect(parsed).toEqual({});
  });

  it("normalizes malformed or empty JSON to an empty object", async () => {
    const malformed = await readJsonBody(new Request("https://request.example.test/api/test", {
      method: "POST",
      body: "{not-json}",
    }));
    const empty = await readJsonBody(new Request("https://request.example.test/api/test", {
      method: "POST",
    }));

    expect(malformed).toEqual({});
    expect(empty).toEqual({});
  });
});

describe("readFormDataBody", () => {
  it("parses a bounded native form request", async () => {
    const request = new Request("https://request.example.test/api/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ formId: "form-1", email: "lead@example.test" }),
    });

    const formData = await readFormDataBody(request);

    expect(formData?.get("formId")).toBe("form-1");
    expect(formData?.get("email")).toBe("lead@example.test");
  });

  it("rejects an oversized native form before parsing", async () => {
    const request = new Request("https://request.example.test/api/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ payload: "x".repeat(MAX_JSON_BODY_BYTES) }),
    });

    await expect(readFormDataBody(request)).resolves.toBeNull();
  });
});

describe("readTextBody", () => {
  it("preserves a bounded webhook body for signature verification", async () => {
    const body = '{"event":"ready"}';

    await expect(readTextBody(new Request("https://request.example.test/api/webhook", {
      method: "POST",
      body,
    }))).resolves.toBe(body);
  });

  it("rejects oversized webhook bodies without returning partial content", async () => {
    const request = new Request("https://request.example.test/api/webhook", {
      method: "POST",
      headers: { "content-length": String(MAX_JSON_BODY_BYTES + 1) },
      body: "signed-body",
    });

    await expect(readTextBody(request)).resolves.toBeNull();
  });
});

describe("OPS_SMOKE_SECRET (F-016)", () => {
  const smokeSecret = "ops-smoke-fixture-secret-0123456789abcdef";
  const jobSecret = "job-fixture-secret-0123456789abcdef";
  const bearer = (token: string) => request({ authorization: `Bearer ${token}` });

  it("accepts only the dedicated smoke bearer, never JOB_SECRET", () => {
    vi.stubEnv("OPS_SMOKE_SECRET", smokeSecret);
    vi.stubEnv("JOB_SECRET", jobSecret);

    expect(requireOpsSmokeSecret(bearer(smokeSecret))).toBe(true);
    expect(requireOpsSmokeSecret(bearer(jobSecret))).toBe(false);
    expect(requireJobSecret(bearer(smokeSecret))).toBe(false);
  });

  it("stays closed when OPS_SMOKE_SECRET is missing instead of falling back to JOB_SECRET", () => {
    vi.stubEnv("OPS_SMOKE_SECRET", undefined);
    vi.stubEnv("JOB_SECRET", jobSecret);

    expect(opsSmokeSecret()).toBeUndefined();
    expect(requireOpsSmokeSecret(bearer(jobSecret))).toBe(false);
    expect(requireOpsSmokeSecret(request())).toBe(false);
  });

  it.each([
    ["shorter than 32 characters", { OPS_SMOKE_SECRET: "short-smoke-secret" }],
    ["padded with whitespace", { OPS_SMOKE_SECRET: ` ${smokeSecret}` }],
    ["equal to JOB_SECRET", { OPS_SMOKE_SECRET: smokeSecret, JOB_SECRET: smokeSecret }],
    ["equal to CRON_SECRET", { OPS_SMOKE_SECRET: smokeSecret, CRON_SECRET: smokeSecret }],
    ["equal to CSRF_SECRET", { OPS_SMOKE_SECRET: smokeSecret, CSRF_SECRET: smokeSecret }],
    ["equal to LIVE_CHAT_INGRESS_SECRET", { OPS_SMOKE_SECRET: smokeSecret, LIVE_CHAT_INGRESS_SECRET: smokeSecret }],
    ["equal to PAYUNI_LIVE_PROBE_JOB_SECRET", { OPS_SMOKE_SECRET: smokeSecret, PAYUNI_LIVE_PROBE_JOB_SECRET: smokeSecret }],
  ])("treats a value %s as unconfigured", (_label, env) => {
    expect(opsSmokeSecret(env)).toBeUndefined();
  });
});
