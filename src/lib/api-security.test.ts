import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_REQUEST_HEADER,
  CLIENT_REQUEST_HEADER_VALUE,
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
