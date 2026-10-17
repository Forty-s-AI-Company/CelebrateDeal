import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entryRateLimitHeaders } from "./entry-rate-limit-headers";
import { LIVE_CHAT_INGRESS_PROOF_HEADER } from "./request-client-ip";
import { checkRateLimit } from "./trusted-entry-rate-limit";
import { resetInMemoryRateLimitForTests } from "./rate-limit";

const proof = "synthetic-action-ingress-proof-0000000000";
function source(extra: Record<string, string> = {}) {
  return new Request("https://app.example.test", { headers: entryRateLimitHeaders(new Headers({
    "cf-connecting-ip": "192.0.2.10", [LIVE_CHAT_INGRESS_PROOF_HEADER]: proof, ...extra,
  })) });
}
beforeEach(() => {
  vi.stubEnv("RATE_LIMIT_PROVIDER", "memory");
  vi.stubEnv("ENTRY_CLIENT_IP_TRUST_MODE", "cloudflare");
  vi.stubEnv("ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE", "cloudflare");
  vi.stubEnv("ENTRY_CLIENT_IP_INGRESS_SECRET", proof);
  resetInMemoryRateLimitForTests();
});
afterEach(() => { vi.unstubAllEnvs(); resetInMemoryRateLimitForTests(); });

describe("server action source metadata", () => {
  it("copies only resolver fields and preserves empty or malformed values", () => {
    const copied = entryRateLimitHeaders(new Headers({
      "cf-connecting-ip": "", "x-real-ip": "192.0.2.3", "x-forwarded-for": "bad,chain",
      "x-vercel-forwarded-for": "192.0.2.4", [LIVE_CHAT_INGRESS_PROOF_HEADER]: proof,
      "x-unrelated": "synthetic", "user-agent": "synthetic", "host": "untrusted.example.test",
    }));
    expect([...copied.keys()].sort()).toEqual([
      "cf-connecting-ip", LIVE_CHAT_INGRESS_PROOF_HEADER, "x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for",
    ].sort());
    expect(copied.get("cf-connecting-ip")).toBe("");
    expect(copied.get("x-forwarded-for")).toBe("bad,chain");
  });
  it("retains the proof and one identity despite alternate forwarding header rotation", async () => {
    expect(await checkRateLimit(source({ "x-forwarded-for": "203.0.113.1" }), "action-proof", 2, 60000)).toBeNull();
    expect(await checkRateLimit(source({ "x-forwarded-for": "203.0.113.2" }), "action-proof", 2, 60000)).toBeNull();
    expect((await checkRateLimit(source({ "x-forwarded-for": "203.0.113.3" }), "action-proof", 2, 60000))?.status).toBe(429);
  });
  it.each(["", "synthetic-invalid"])("does not grant trust to a copied invalid proof: %s", async (value) => {
    expect((await checkRateLimit(source({ [LIVE_CHAT_INGRESS_PROOF_HEADER]: value }), "action-proof", 2, 60000))?.status).toBe(503);
  });
  it("preserves the complete trusted-proxy contract including agreement checks", async () => {
    vi.stubEnv("ENTRY_CLIENT_IP_TRUST_MODE", "trusted-proxy");
    vi.stubEnv("ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE", "vercel");
    expect(await checkRateLimit(source({ "x-real-ip": "192.0.2.20", "x-forwarded-for": "192.0.2.20, 192.0.2.21" }), "action-proxy", 2, 60000)).toBeNull();
    expect((await checkRateLimit(source({ "x-real-ip": "192.0.2.20", "x-forwarded-for": "192.0.2.99" }), "action-proxy", 2, 60000))?.status).toBe(503);
  });
  it("does not synthesize runtime identity from server-action headers", async () => {
    vi.stubEnv("ENTRY_CLIENT_IP_TRUST_MODE", "runtime");
    vi.stubEnv("ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE", "node");
    expect((await checkRateLimit(source(), "action-runtime", 2, 60000))?.status).toBe(503);
  });
});
