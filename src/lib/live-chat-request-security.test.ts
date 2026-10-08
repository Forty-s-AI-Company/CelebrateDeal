import { expect, it } from "vitest";
import { liveChatIpTrustConfig } from "./live-chat-request-security";
import { getRequestClientIp } from "./request-client-ip";

const proof = "owned-loopback-synthetic-ingress-proof";
const local = { NODE_ENV: "production", RATE_LIMIT_PROVIDER: "memory", E2E_TEST_MODE: "true",
  E2E_BASE_URL: "http://127.0.0.1:31023", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31023",
  E2E_LIVE_CHAT_TRUSTED_INGRESS: "true", LIVE_CHAT_INGRESS_SECRET: proof } as NodeJS.ProcessEnv;
it.each([
  { ...local, E2E_LIVE_CHAT_TRUSTED_INGRESS: undefined },
  { ...local, E2E_TEST_MODE: undefined },
  { ...local, NEXT_PUBLIC_APP_URL: "https://app.example.test", E2E_BASE_URL: "https://app.example.test" },
  { ...local, E2E_BASE_URL: "http://127.0.0.1:31024" },
])("does not turn a flag, memory provider or public production URL into a trust root", env => {
  expect(liveChatIpTrustConfig(env)).toEqual({ trustMode: "none", deploymentSource: "none" });
});
it("requires valid ingress proof even in the explicit local memory runtime", () => {
  const config = liveChatIpTrustConfig(local);
  const request = new Request("http://127.0.0.1:31023/api/live-chat/private", { headers: {
    "cf-connecting-ip": "127.0.0.1", "x-forwarded-for": "203.0.113.9" } });
  expect(getRequestClientIp(request, config)).toBeNull();
  request.headers.set("x-celebratedeal-live-chat-ingress", "wrong-synthetic-proof");
  expect(getRequestClientIp(request, config)).toBeNull();
  request.headers.set("x-celebratedeal-live-chat-ingress", proof);
  expect(getRequestClientIp(request, config)).toBe("127.0.0.1");
  request.headers.set("cf-connecting-ip", "127.0.0.1,203.0.113.9");
  expect(getRequestClientIp(request, config)).toBeNull();
});
it("preserves development runtime IP and existing production Cloudflare configuration", () => {
  expect(liveChatIpTrustConfig({ ...local, NODE_ENV: "development" })).toEqual({ trustMode: "runtime", deploymentSource: "node" });
  expect(liveChatIpTrustConfig({ NODE_ENV: "production", RATE_LIMIT_PROVIDER: "cloudflare_waf", LIVE_CHAT_INGRESS_SECRET: proof })).toEqual({ trustMode: "cloudflare", deploymentSource: "cloudflare", ingressSecret: proof });
});
