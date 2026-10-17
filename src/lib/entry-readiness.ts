import { entryIpTrustConfig } from "./entry-client-ip";
import { hasStrongIngressSecret } from "./request-client-ip";

/** 僅回報固定設定狀態；不輸出 secret、URL、專案 ID，也不宣稱網路拓撲已通過探測。 */
export function entryReadiness(env: NodeJS.ProcessEnv = process.env) {
  const config = entryIpTrustConfig(env);
  if (env.VERCEL_ENV === "production") return { ready: false, reason: "production_topology_unverified" } as const;
  if (config.trustMode === "none") return { ready: false, reason: "entry_configuration_missing_or_invalid" } as const;
  if (env.RATE_LIMIT_PROVIDER === "upstash_redis" && !(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN)) {
    return { ready: false, reason: "shared_rate_limit_not_configured" } as const;
  }
  if (config.trustMode === "vercel-native") return { ready: true, reason: "preview_native_configured" } as const;
  const local = env.NODE_ENV !== "production" && !env.VERCEL;
  if (!local && env.VERCEL_ENV !== "preview") return { ready: false, reason: "deployment_topology_unverified" } as const;
  if (config.trustMode === "runtime") return local
    ? { ready: true, reason: "local_runtime_configured" } as const
    : { ready: false, reason: "runtime_address_unavailable_on_deployment" } as const;
  if (!hasStrongIngressSecret(config.ingressSecret)) return { ready: false, reason: "ingress_proof_not_configured" } as const;
  // 遠端 app 限流必須使用共享儲存；沒有 WAF 規則證據時不得宣稱 WAF 已覆蓋路由。
  if (env.RATE_LIMIT_PROVIDER !== "upstash_redis" && !(local && env.RATE_LIMIT_PROVIDER === "memory")) {
    return { ready: false, reason: "shared_rate_limit_provider_required" } as const;
  }
  return { ready: true, reason: "proof_ingress_configured" } as const;
}
