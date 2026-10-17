import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ limiter: vi.fn().mockResolvedValue(null) }));
vi.mock("./rate-limit", () => ({
  checkRateLimit: calls.limiter,
  getRateLimitProviderId: () => process.env.RATE_LIMIT_PROVIDER ?? "memory",
}));
import { checkRateLimit, entryIpTrustConfig } from "./trusted-entry-rate-limit";

const environment = {
  ENTRY_CLIENT_IP_TRUST_MODE: "vercel-native",
  ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE: "vercel",
  ENTRY_CLIENT_IP_TOPOLOGY: "direct-vercel",
  ENTRY_CLIENT_IP_EXPECTED_PROJECT_ID: "synthetic-project",
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_PROJECT_ID: "synthetic-project",
  RATE_LIMIT_PROVIDER: "upstash_redis",
};
function request(ip: string | null, extra: Record<string, string> = {}) {
  const headers = new Headers(extra);
  if (ip !== null) headers.set("x-vercel-forwarded-for", ip);
  return new Request("https://synthetic.invalid/entry", { method: "POST", headers, body: "unchanged" });
}
beforeEach(() => {
  calls.limiter.mockClear();
  for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

it.each(Object.keys(environment))("rejects missing runtime configuration %s before any limiter call", async key => {
  vi.stubEnv(key, undefined);
  const response = await checkRateLimit(request("192.0.2.1"), "entry", 2, 60000);
  expect(response?.status).toBe(503);
  expect(calls.limiter).not.toHaveBeenCalled();
});
it.each([
  ["VERCEL", "0"], ["VERCEL_ENV", "production"], ["VERCEL_ENV", "development"],
  ["VERCEL_PROJECT_ID", "wrong-project"], ["ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE", "node"],
  ["ENTRY_CLIENT_IP_TOPOLOGY", "cloudflare"], ["RATE_LIMIT_PROVIDER", "memory"],
  ["RATE_LIMIT_PROVIDER", "cloudflare_waf"],
])("rejects mismatched %s=%s without fallback", async (key, value) => {
  vi.stubEnv(key, value);
  const response = await checkRateLimit(request("192.0.2.1", {"cf-connecting-ip":"192.0.2.2", "x-real-ip":"192.0.2.2"}), "entry", 2, 60000);
  expect(response?.status).toBe(503); expect(calls.limiter).not.toHaveBeenCalled();
});
it.each([null, "", "garbage", "192.0.2.1:80", "192.0.2.1,192.0.2.2", "fe80::1%eth0", "a".repeat(129)])("rejects invalid native IP %s before provider access", async ip => {
  const response = await checkRateLimit(request(ip, {"x-real-ip":"192.0.2.9", "cf-connecting-ip":"192.0.2.9", "x-forwarded-for":"192.0.2.9"}), "entry", 2, 60000);
  expect(response?.status).toBe(503); expect(calls.limiter).not.toHaveBeenCalled();
});
it.each([
  ["192.0.2.1", "192.0.2.1"], [" 192.0.2.1 ", "192.0.2.1"],
  ["::ffff:192.0.2.1", "192.0.2.1"], ["::ffff:c000:201", "192.0.2.1"],
  ["2001:db8:abcd:1234:1:2:3:4", "2001:db8:abcd:1234::"],
  ["2001:db8:abcd:1234::ffff", "2001:db8:abcd:1234::"],
  ["2001:db8::1", "2001:db8:0:0::"], ["::1", "0:0:0:0::"],
  ["2001:0DB8:ABCD:1234:0:0:0:1", "2001:db8:abcd:1234::"],
  ["::FFFF:C000:0201", "192.0.2.1"],
  ["::192.0.2.1", "0:0:0:0::"],
  ["64:ff9b::192.0.2.1", "64:ff9b:0:0::"],
  ["1::2:3:4:5:1.2.3.4", "1:0:2:3::"],
  ["1:0:2:3:4:5:102:304", "1:0:2:3::"],
])("normalizes %s into stable bucket %s", async (ip, expected) => {
  const original = request(ip, {"cf-connecting-ip":"192.0.2.99", "x-real-ip":"192.0.2.99", "x-forwarded-for":"192.0.2.99"});
  expect(await checkRateLimit(original, "entry", 2, 60000)).toBeNull();
  const [metadata, key, limit, window] = calls.limiter.mock.calls[0]!;
  expect(metadata.headers.get("cf-connecting-ip")).toBe(expected);
  expect(metadata.headers.has("x-real-ip")).toBe(false);
  expect(metadata.headers.has("x-forwarded-for")).toBe(false);
  expect([key, limit, window]).toEqual(["entry-vercel-native:entry", 2, 60000]);
  expect(await original.text()).toBe("unchanged");
});
it("reads runtime configuration per request and ignores request claims about runtime", async () => {
  expect(await checkRateLimit(request("192.0.2.1"), "entry", 2, 60000)).toBeNull();
  vi.stubEnv("VERCEL_ENV", "production");
  expect((await checkRateLimit(request("192.0.2.1", {"VERCEL_ENV":"preview", "VERCEL":"1"}), "entry", 2, 60000))?.status).toBe(503);
  expect(calls.limiter).toHaveBeenCalledTimes(1);
});
it("rejects a provider switch even with a previously resolved native config", async () => {
  const config = entryIpTrustConfig(); vi.stubEnv("RATE_LIMIT_PROVIDER", "cloudflare_waf");
  expect((await checkRateLimit(request("192.0.2.1"), "entry", 2, 60000, config))?.status).toBe(503);
  expect(calls.limiter).not.toHaveBeenCalled();
});
it("keeps provider failures unchanged", async () => {
  calls.limiter.mockResolvedValueOnce(new Response(null, {status:503}));
  expect((await checkRateLimit(request("192.0.2.1"), "entry", 2, 60000))?.status).toBe(503);
});

it.each([["VERCEL_ENV", "production"], ["VERCEL_PROJECT_ID", "other"], ["ENTRY_CLIENT_IP_TOPOLOGY", ""]])("revalidates all gates for caller-supplied native config after %s changes", async (key, value) => {
  vi.stubEnv(key, value);
  const response = await checkRateLimit(request("192.0.2.1"), "entry", 2, 60000, {trustMode:"vercel-native", deploymentSource:"vercel"});
  expect(response?.status).toBe(503); expect(calls.limiter).not.toHaveBeenCalled();
});
