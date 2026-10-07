import type { ClientIpTrustConfig } from "./request-client-ip";

export function liveChatIpTrustConfig(env: NodeJS.ProcessEnv = process.env): ClientIpTrustConfig {
  // Local development must use the runtime-provided address only. A local
  // RATE_LIMIT_PROVIDER value never becomes a proxy trust root.
  if (env.NODE_ENV !== "production") {
    return { trustMode: "runtime", deploymentSource: "node" };
  }

  if (env.RATE_LIMIT_PROVIDER === "cloudflare_waf") {
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

