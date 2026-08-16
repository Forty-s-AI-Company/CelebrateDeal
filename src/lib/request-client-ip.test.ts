import { describe, expect, it } from "vitest";
import {
  getRequestClientIp,
  getRequestClientIpWithSource,
  LIVE_CHAT_INGRESS_PROOF_HEADER,
  LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH,
  normalizeClientIp,
} from "@/lib/request-client-ip";

const ingressSecret = "test-live-chat-ingress-secret-value-longer-than-32";
const cloudflare = { trustMode: "cloudflare", deploymentSource: "cloudflare", ingressSecret } as const;
const proxy = { trustMode: "trusted-proxy", deploymentSource: "vercel", ingressSecret } as const;
const runtime = { trustMode: "runtime", deploymentSource: "node" } as const;
const none = { trustMode: "none", deploymentSource: "none" } as const;

function request(headers: Record<string, string>, ip?: string) {
  const result = new Request("https://app.example.test/api/live-chat/messages", { headers });
  if (ip) Object.defineProperty(result, "ip", { value: ip });
  return result;
}

function rawHeaderRequest(headers: Record<string, string>) {
  return {
    headers: {
      get(name: string) {
        return headers[name] ?? null;
      },
    },
  } as unknown as Request;
}

describe("request client IP boundary", () => {
  it("accepts Cloudflare only with the dedicated secret proof", () => {
    const result = getRequestClientIpWithSource(request({
      "cf-ray": "forged-ray-is-not-proof",
      [LIVE_CHAT_INGRESS_PROOF_HEADER]: ingressSecret,
      "cf-connecting-ip": " 203.0.113.7 ",
      "x-forwarded-for": "198.51.100.4, 198.51.100.5",
    }), cloudflare);

    expect(result).toEqual({ ip: "203.0.113.7", source: "cf-connecting-ip" });
    expect(getRequestClientIp(request({ "cf-connecting-ip": "203.0.113.7" }), cloudflare)).toBeNull();
    expect(getRequestClientIp(request({
      "cf-ray": "8f2b2c3d4e5f6a7b-TPE",
      "cf-connecting-ip": "203.0.113.7",
    }), cloudflare)).toBeNull();
  });

  it.each([
    ["wrong proof", "wrong-proof"],
    ["short proof", ingressSecret.slice(0, -1)],
    ["long proof", `${ingressSecret}x`],
  ])("rejects Cloudflare IP when %s is supplied", (_label, proof) => {
    expect(getRequestClientIp(request({
      "cf-ray": "8f2b2c3d4e5f6a7b-TPE",
      [LIVE_CHAT_INGRESS_PROOF_HEADER]: proof,
      "cf-connecting-ip": "203.0.113.7",
    }), cloudflare)).toBeNull();
  });

  it.each([
    ["overlong ASCII proof", "x".repeat(LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH + 1)],
    ["overlong multibyte proof", "測".repeat(Math.ceil(LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH / 3))],
  ])("rejects %s before secret comparison", (_label, proof) => {
    const createRequest = proof.includes("測") ? rawHeaderRequest : request;
    expect(getRequestClientIp(createRequest({
      [LIVE_CHAT_INGRESS_PROOF_HEADER]: proof,
      "cf-connecting-ip": "203.0.113.7",
    }), cloudflare)).toBeNull();
  });

  it("rejects a secret whose characters or UTF-8 bytes exceed the bound", () => {
    for (const secret of [
      "x".repeat(LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH + 1),
      "測".repeat(Math.ceil(LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH / 3)),
    ]) {
      expect(getRequestClientIp(request({
        [LIVE_CHAT_INGRESS_PROOF_HEADER]: ingressSecret,
        "cf-connecting-ip": "203.0.113.7",
      }), { ...cloudflare, ingressSecret: secret })).toBeNull();
    }
  });

  it("rejects different proof byte lengths before timingSafeEqual", () => {
    expect(getRequestClientIp(rawHeaderRequest({
      [LIVE_CHAT_INGRESS_PROOF_HEADER]: `${ingressSecret}測`,
      "cf-connecting-ip": "203.0.113.7",
    }), cloudflare)).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["short", "short"],
  ])("fails closed when the server ingress secret is %s", (_label, secret) => {
    const config = { ...cloudflare, ingressSecret: secret };
    expect(getRequestClientIp(request({
      [LIVE_CHAT_INGRESS_PROOF_HEADER]: ingressSecret,
      "cf-connecting-ip": "203.0.113.7",
    }), config)).toBeNull();
  });

  it("uses the explicit trusted-proxy convention and canonicalizes IPv4/IPv6", () => {
    expect(normalizeClientIp("2001:0DB8:0:0:0:0:0:1")).toBe("2001:db8::1");
    expect(getRequestClientIpWithSource(request({
      [LIVE_CHAT_INGRESS_PROOF_HEADER]: ingressSecret,
      "x-real-ip": "2001:0DB8:0:0:0:0:0:1",
      "x-forwarded-for": "2001:db8::1, 198.51.100.4, 198.51.100.5",
    }), proxy)).toEqual({ ip: "2001:db8::1", source: "x-real-ip" });
    expect(getRequestClientIp(request({ "x-forwarded-for": "198.51.100.4" }), proxy)).toBeNull();
    expect(getRequestClientIp(request({
      [LIVE_CHAT_INGRESS_PROOF_HEADER]: ingressSecret,
      "x-real-ip": "198.51.100.4",
      "x-forwarded-for": "198.51.100.5, 198.51.100.6",
    }), proxy)).toBeNull();
  });

  it("uses a runtime-provided address and ignores direct header spoofing", () => {
    expect(getRequestClientIpWithSource(request({
      "cf-connecting-ip": "198.51.100.7",
      "x-forwarded-for": "198.51.100.8",
      "x-real-ip": "198.51.100.9",
    }, "2001:db8::2"), runtime)).toEqual({ ip: "2001:db8::2", source: "runtime-ip" });
    expect(getRequestClientIp(request({ "x-forwarded-for": "198.51.100.8" }), runtime)).toBeNull();
    expect(getRequestClientIp(request({ "x-forwarded-for": "198.51.100.8" }), none)).toBeNull();
  });

  it("fails closed for malformed IP values and overlong chains", () => {
    expect(getRequestClientIp(request({
      [LIVE_CHAT_INGRESS_PROOF_HEADER]: ingressSecret,
      "cf-connecting-ip": "203.0.113.7, 198.51.100.4",
    }), cloudflare)).toBeNull();
    expect(getRequestClientIp(request({
      [LIVE_CHAT_INGRESS_PROOF_HEADER]: ingressSecret,
      "cf-connecting-ip": "not-an-ip",
    }), cloudflare)).toBeNull();
    expect(getRequestClientIp(request({
      [LIVE_CHAT_INGRESS_PROOF_HEADER]: ingressSecret,
      "x-real-ip": "198.51.100.4",
      "x-forwarded-for": "198.51.100.4, attacker",
    }), proxy)).toBeNull();
    expect(getRequestClientIp(request({
      [LIVE_CHAT_INGRESS_PROOF_HEADER]: ingressSecret,
      "x-real-ip": "198.51.100.4",
      "x-forwarded-for": Array.from({ length: 17 }, () => "198.51.100.4").join(","),
    }), proxy)).toBeNull();
  });
});
