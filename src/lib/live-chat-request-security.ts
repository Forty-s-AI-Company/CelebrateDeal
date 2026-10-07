import type { ClientIpTrustConfig } from "./request-client-ip";
import { isExplicitLocalE2eRuntime } from "./app-url";

export function liveChatIpTrustConfig(env: NodeJS.ProcessEnv = process.env): ClientIpTrustConfig {
  // Local development must use the runtime-provided address only. A local
  // RATE_LIMIT_PROVIDER value never becomes a proxy trust root.
  if (env.NODE_ENV !== "production") {
    return { trustMode: "runtime", deploymentSource: "node" };
  }

  // An owned loopback ingress may exercise the same proof contract while the
  // limiter remains memory-backed. A flag or forwarded header alone never
  // authorizes it, and public production URLs cannot enter this QA branch.
  const ownedLocalIngress = env.E2E_LIVE_CHAT_TRUSTED_INGRESS === "true"
    && env.RATE_LIMIT_PROVIDER === "memory" && isExplicitLocalE2eRuntime(env);
  if (env.RATE_LIMIT_PROVIDER === "cloudflare_waf" || ownedLocalIngress) {
    return {
      trustMode: "cloudflare",
      deploymentSource: "cloudflare",
      ingressSecret: env.LIVE_CHAT_INGRESS_SECRET,
    };
  }
  if (env.RATE_LIMIT_PROVIDER === "upstash_redis") {
    return {
      trustMode: "trusted-proxy",
      deploymentSource: "vercel",
      ingressSecret: env.LIVE_CHAT_INGRESS_SECRET,
    };
  }
  return { trustMode: "none", deploymentSource: "none" };
}

export function rateLimitRequestWithIdentity(request: Request, clientIp: string | null) {
  const headers = new Headers(request.headers);

  // checkRateLimit currently derives its final bucket suffix from these
  // legacy headers. Replace them with the already-normalized identity chosen
  // by this route so forged alternate headers cannot create another bucket.
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  headers.set("cf-connecting-ip", clientIp ?? "unknown");
  // Construct the limiter-only request from a clone so reading this request's
  // body later in POST does not compete with the stream owned by the route.
  return new Request(request.body ? request.clone() : request, { headers });
}
