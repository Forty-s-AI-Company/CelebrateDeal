import { afterEach, expect, it, vi } from "vitest";
import { entryIpTrustConfig, getEntryClientIp, nativeBucketIdentity } from "./entry-client-ip";
import { getLiveChatClientIp, rateLimitRequestWithIdentity } from "./live-chat-request-security";

afterEach(() => vi.unstubAllEnvs());
function nativePreview() {
  for (const [key, value] of Object.entries({ ENTRY_CLIENT_IP_TRUST_MODE: "vercel-native", ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE: "vercel", ENTRY_CLIENT_IP_TOPOLOGY: "direct-vercel", ENTRY_CLIENT_IP_EXPECTED_PROJECT_ID: "synthetic-project", VERCEL_PROJECT_ID: "synthetic-project", VERCEL: "1", VERCEL_ENV: "preview", RATE_LIMIT_PROVIDER: "upstash_redis" })) vi.stubEnv(key, value);
}
it("shares exact native identity for entry/chat while limiting by IPv6 /64", () => {
  nativePreview();
  const request = new Request("https://preview.example.test", { headers: { "x-vercel-forwarded-for": "2001:db8:1:2::123", "cf-connecting-ip": "198.51.100.99", "x-real-ip": "203.0.113.99", "x-forwarded-for": "203.0.113.98" } });
  expect(getEntryClientIp(request)).toBe("2001:db8:1:2::123");
  expect(getLiveChatClientIp(request)).toBe("2001:db8:1:2::123");
  expect(rateLimitRequestWithIdentity(request, getLiveChatClientIp(request)).headers.get("cf-connecting-ip")).toBe("2001:db8:1:2::");
  expect(nativeBucketIdentity("::ffff:192.0.2.8")).toBe("192.0.2.8");
});
it.each(["production", "development"])("never enables native mode in %s via supplied config", environment => {
  nativePreview(); vi.stubEnv("VERCEL_ENV", environment);
  const request = new Request("https://preview.example.test", { headers: { "x-vercel-forwarded-for": "192.0.2.2" } });
  expect(getEntryClientIp(request, { trustMode: "vercel-native", deploymentSource: "vercel" })).toBeNull();
  expect(getLiveChatClientIp(request)).toBeNull();
});
it.each(["", "192.0.2.1, 192.0.2.2", "not-ip"])("rejects malformed native identity %s without alternate-header fallback", value => {
  nativePreview();
  const request = new Request("https://preview.example.test", { headers: { "x-vercel-forwarded-for": value, "cf-connecting-ip": "192.0.2.7" } });
  expect(getLiveChatClientIp(request)).toBeNull();
});
it("explicit invalid ENTRY configuration never falls back to runtime identity", () => {
  vi.stubEnv("ENTRY_CLIENT_IP_TRUST_MODE", "invalid");
  const request = new Request("http://localhost"); Object.defineProperty(request, "ip", { value: "192.0.2.8" });
  expect(getLiveChatClientIp(request)).toBeNull();
  expect(entryIpTrustConfig().trustMode).toBe("none");
});
it("shares ENTRY proof even if the legacy chat secret differs", () => {
  vi.stubEnv("ENTRY_CLIENT_IP_TRUST_MODE", "cloudflare");vi.stubEnv("ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE", "cloudflare");
  const proof = "synthetic-entry-proof-for-unit-tests-only";
  vi.stubEnv("ENTRY_CLIENT_IP_INGRESS_SECRET", proof);vi.stubEnv("LIVE_CHAT_INGRESS_SECRET", "different-synthetic-legacy-proof-only");
  const request = new Request("https://preview.example.test", { headers: { "cf-connecting-ip": "192.0.2.5", "x-celebratedeal-live-chat-ingress": proof } });
  expect(getEntryClientIp(request)).toBe("192.0.2.5");expect(getLiveChatClientIp(request)).toBe("192.0.2.5");
});
