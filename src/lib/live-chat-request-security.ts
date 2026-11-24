import type { ClientIpTrustConfig } from "./request-client-ip";
import { isVercelDeployment } from "./vercel-runtime";
import { isExplicitLocalE2eRuntime } from "./app-url";

export function liveChatIpTrustConfig(env: NodeJS.ProcessEnv = process.env): ClientIpTrustConfig {
  // A4-03: on a Vercel deployment the edge sets x-real-ip and overwrites
  // x-forwarded-for, and nothing reaches the function around it, so live chat
  // uses the same rule as every other caller of getTrustedClientIp. The
  // ingress-proof modes below remain for non-Vercel runtimes only.
  if (isVercelDeployment(env)) {
    return { trustMode: "vercel-edge", deploymentSource: "vercel" };
  }

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
