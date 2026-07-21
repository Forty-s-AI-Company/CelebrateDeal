import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_REQUEST_HEADER,
  CLIENT_REQUEST_HEADER_VALUE,
  MAX_JSON_BODY_BYTES,
  readFormDataBody,
  readJsonBody,
  requireSameOriginRequest,
} from "@/lib/api-security";

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

  it.each([
    { header: "origin", value: "https://public.example.test" },
    { header: "referer", value: "https://public.example.test/form" },
  ])("allows a $header matching the forwarded request origin", ({ header, value }) => {
    expect(requireSameOriginRequest(trustedRequest({
      [header]: value,
      "x-forwarded-host": "public.example.test",
      "x-forwarded-proto": "https",
    }), { requireClientHeader: true })).toBeNull();
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
