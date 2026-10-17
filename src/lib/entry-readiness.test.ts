import { afterEach, expect, it, vi } from "vitest";
import { entryReadiness } from "./entry-readiness";
import { GET } from "@/app/api/health/entry/route";
const native: NodeJS.ProcessEnv = { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview", VERCEL_PROJECT_ID: "synthetic", ENTRY_CLIENT_IP_EXPECTED_PROJECT_ID: "synthetic", ENTRY_CLIENT_IP_TRUST_MODE: "vercel-native", ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE: "vercel", ENTRY_CLIENT_IP_TOPOLOGY: "direct-vercel", RATE_LIMIT_PROVIDER: "upstash_redis", UPSTASH_REDIS_REST_URL: "https://redis.example.test", UPSTASH_REDIS_REST_TOKEN: "synthetic-only" };
afterEach(() => vi.unstubAllEnvs());
it("reports configured native Preview, never Production", () => {
  expect(entryReadiness(native)).toEqual({ ready: true, reason: "preview_native_configured" });
  expect(entryReadiness({ ...native, VERCEL_ENV: "production" })).toEqual({ ready: false, reason: "production_topology_unverified" });
});
it.each(["ENTRY_CLIENT_IP_TRUST_MODE", "ENTRY_CLIENT_IP_EXPECTED_PROJECT_ID", "ENTRY_CLIENT_IP_TOPOLOGY", "UPSTASH_REDIS_REST_TOKEN"])("fails readiness without %s", key => {
  expect(entryReadiness({ ...native, [key]: undefined }).ready).toBe(false);
});
it("accepts explicit local runtime/proof profiles but rejects remote memory and WAF assumptions", () => {
  expect(entryReadiness({ NODE_ENV: "test", ENTRY_CLIENT_IP_TRUST_MODE: "runtime", ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE: "node" }).ready).toBe(true);
  const proof = { NODE_ENV: "test" as const, ENTRY_CLIENT_IP_TRUST_MODE: "cloudflare", ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE: "cloudflare", ENTRY_CLIENT_IP_INGRESS_SECRET: "synthetic-ingress-proof-more-than-thirty-two", RATE_LIMIT_PROVIDER: "memory" };
  expect(entryReadiness(proof).ready).toBe(true);
  expect(entryReadiness({ ...proof, NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview" }).ready).toBe(false);
  expect(entryReadiness({ ...proof, RATE_LIMIT_PROVIDER: "cloudflare_waf" }).ready).toBe(false);
  expect(entryReadiness({ ...proof, ENTRY_CLIENT_IP_INGRESS_SECRET: "short" }).ready).toBe(false);
  expect(entryReadiness({ ...native, ENTRY_CLIENT_IP_TRUST_MODE: "cloudflare", ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE: "cloudflare", ENTRY_CLIENT_IP_INGRESS_SECRET: proof.ENTRY_CLIENT_IP_INGRESS_SECRET }).ready).toBe(true);
});
it("health response exposes only fixed categories and requires a topology probe", async () => {
  for (const [key,value] of Object.entries(native)) vi.stubEnv(key,value);
  let response = GET();expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: true, entry: "preview_native_configured", topologyProbeRequired: true });
  vi.stubEnv("ENTRY_CLIENT_IP_TRUST_MODE", "invalid");response=GET();expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, entry: "entry_configuration_missing_or_invalid", topologyProbeRequired: true });
});
