import { getRequestClientIp, normalizeClientIp, type ClientIpTrustConfig } from "./request-client-ip";

export type EntryIpTrustConfig = ClientIpTrustConfig | {
  trustMode: "vercel-native";
  deploymentSource: "vercel";
};

/** Entry trust is explicit; a storage/WAF provider never selects a proxy. */
export function entryIpTrustConfig(env: NodeJS.ProcessEnv = process.env): EntryIpTrustConfig {
  const trustMode = env.ENTRY_CLIENT_IP_TRUST_MODE;
  const deploymentSource = env.ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE;
  if (trustMode === "vercel-native") {
    // Explicit Preview-only rollout. Runtime metadata is server-side, never headers.
    const expectedProject = env.ENTRY_CLIENT_IP_EXPECTED_PROJECT_ID;
    const verified = deploymentSource === "vercel"
      && env.ENTRY_CLIENT_IP_TOPOLOGY === "direct-vercel"
      && env.VERCEL === "1" && env.VERCEL_ENV === "preview"
      && Boolean(expectedProject) && expectedProject === env.VERCEL_PROJECT_ID
      && env.RATE_LIMIT_PROVIDER === "upstash_redis";
    return verified ? { trustMode, deploymentSource: "vercel" }
      : { trustMode: "none", deploymentSource: "none" };
  }
  if (trustMode === "runtime" && deploymentSource === "node") {
    return { trustMode, deploymentSource };
  }
  if ((trustMode === "cloudflare" && deploymentSource === "cloudflare")
    || (trustMode === "trusted-proxy" && deploymentSource === "vercel")) {
    return { trustMode, deploymentSource, ingressSecret: env.ENTRY_CLIENT_IP_INGRESS_SECRET };
  }
  return { trustMode: "none", deploymentSource: "none" };
}

/** Native IPv6 sources share a /64 bucket; mapped IPv4 shares its IPv4 bucket. */
export function nativeBucketIdentity(value: string | null) {
  const ip = normalizeClientIp(value);
  if (!ip || !ip.includes(":")) return ip;
  const [head, tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left
    : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  const words = groups.map(group => Number.parseInt(group, 16));
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    return [words[6]! >> 8, words[6]! & 255, words[7]! >> 8, words[7]! & 255].join(".");
  }
  return `${words.slice(0, 4).map(word => word.toString(16)).join(":")}::`;
}

/** 回傳真實正規化 IP；業務授權與封鎖名單不得拿 IPv6 /64 bucket 代替地址。 */
export function getEntryClientIp(request: Request, config: EntryIpTrustConfig = entryIpTrustConfig()) {
  if (config.trustMode === "vercel-native") {
    // 每次重新核對部署 metadata；傳入 config 不能繞過 Preview 限制。
    return entryIpTrustConfig().trustMode === "vercel-native"
      ? normalizeClientIp(request.headers.get("x-vercel-forwarded-for")) : null;
  }
  return getRequestClientIp(request, config);
}
