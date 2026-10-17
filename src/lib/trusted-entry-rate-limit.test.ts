import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkRateLimit, entryIpTrustConfig } from "./trusted-entry-rate-limit";
import { resetInMemoryRateLimitForTests } from "./rate-limit";
import type { ClientIpTrustConfig } from "./request-client-ip";

const proof = "synthetic-entry-ingress-proof-only-0000000000";
const cloudflare: ClientIpTrustConfig = { trustMode: "cloudflare", deploymentSource: "cloudflare", ingressSecret: proof };
it.each(["cloudflare", "trusted-proxy"] as const)("fails closed for every missing or malformed %s credential configuration", async mode => {
  for (const credential of [undefined, "", "short", " padded-proof-000000000000000000000000 "]) {
    const config = entryIpTrustConfig({
      NODE_ENV: "test",
      ENTRY_CLIENT_IP_TRUST_MODE: mode,
      ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE: mode === "cloudflare" ? "cloudflare" : "vercel",
      ENTRY_CLIENT_IP_INGRESS_SECRET: credential,
    } as NodeJS.ProcessEnv);
    for (const supplied of [undefined, "", credential]) {
      const headers = new Headers({ "cf-connecting-ip": "198.51.100.1", "x-real-ip": "198.51.100.1" });
      if (supplied !== undefined) headers.set("x-celebratedeal-live-chat-ingress", supplied);
      expect((await checkRateLimit(new Request("http://localhost/entry", { headers }), "entry", 1, 60000, config))?.status).toBe(503);
    }
  }
});
it("validates the entire trusted-proxy forwarding chain", async () => {
  const config: ClientIpTrustConfig = { trustMode: "trusted-proxy", deploymentSource: "vercel", ingressSecret: proof };
  const headers = { "x-real-ip": "198.51.100.1", "x-forwarded-for": "198.51.100.1,203.0.113.2", "x-celebratedeal-live-chat-ingress": proof };
  expect(await checkRateLimit(new Request("http://localhost/entry", { headers }), "entry", 1, 60000, config)).toBeNull();
  for (const chain of ["203.0.113.9,198.51.100.1", "198.51.100.1,not-an-ip"]) {
    expect((await checkRateLimit(new Request("http://localhost/entry", { headers: { ...headers, "x-forwarded-for": chain } }), "entry", 1, 60000, config))?.status).toBe(503);
  }
});
beforeEach(() => { vi.stubEnv("RATE_LIMIT_PROVIDER", "memory"); resetInMemoryRateLimitForTests(); });
afterEach(() => { vi.unstubAllEnvs(); resetInMemoryRateLimitForTests(); });

it.each([{}, { RATE_LIMIT_PROVIDER: "cloudflare_waf" }, { ENTRY_CLIENT_IP_TRUST_MODE: "runtime", ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE: "vercel" }])("does not infer trust from provider or mismatched configuration", env => {
  expect(entryIpTrustConfig(env as NodeJS.ProcessEnv)).toEqual({ trustMode: "none", deploymentSource: "none" });
});
it.each([undefined, "wrong-proof"])("rejects missing or forged proof before calling even an edge-only provider", async value => {
  vi.stubEnv("RATE_LIMIT_PROVIDER", "cloudflare_waf");
  const headers = new Headers({ "cf-connecting-ip": "198.51.100.1" });
  if (value) headers.set("x-celebratedeal-live-chat-ingress", value);
  const response = await checkRateLimit(new Request("http://localhost/entry", { headers }), "entry", 1, 60000, cloudflare);
  expect(response?.status).toBe(503);
});
it("counts the runtime socket identity despite rotating forged headers and preserves the body", async () => {
  const config: ClientIpTrustConfig = { trustMode: "runtime", deploymentSource: "node" };
  for (let index = 0; index < 3; index++) {
    const request = new Request("http://localhost/entry", { method: "POST", body: "original-body", headers: { "cf-connecting-ip": `198.51.100.${index + 1}`, "x-forwarded-for": `203.0.113.${index + 1}` } });
    Object.defineProperty(request, "ip", { value: "127.0.0.1" });
    expect((await checkRateLimit(request, "entry", 2, 60000, config))?.status ?? null).toBe(index === 2 ? 429 : null);
    expect(await request.text()).toBe("original-body");
  }
});
it("requires a runtime address and does not fall back to headers", async () => {
  const request = new Request("http://localhost/entry", { headers: { "cf-connecting-ip": "127.0.0.1" } });
  expect((await checkRateLimit(request, "entry", 1, 60000, { trustMode: "runtime", deploymentSource: "node" }))?.status).toBe(503);
});
it("uses verified proxy identity and rejects malformed proxy addresses", async () => {
  const headers = { "cf-connecting-ip": "198.51.100.1", "x-celebratedeal-live-chat-ingress": proof };
  expect(await checkRateLimit(new Request("http://localhost/entry", { headers }), "entry", 1, 60000, cloudflare)).toBeNull();
  expect((await checkRateLimit(new Request("http://localhost/entry", { headers: { ...headers, "x-forwarded-for": "203.0.113.9" } }), "entry", 1, 60000, cloudflare))?.status).toBe(429);
  expect((await checkRateLimit(new Request("http://localhost/entry", { headers: { ...headers, "cf-connecting-ip": "198.51.100.1,203.0.113.9" } }), "other", 1, 60000, cloudflare))?.status).toBe(503);
});
