import { NextResponse } from "next/server";

export type RateLimitProviderId = "memory" | "cloudflare_waf" | "upstash_redis";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const UPSTASH_RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`;

type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

function clientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown"
  );
}

function cleanup(now: number) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function getRateLimitProviderId(): RateLimitProviderId {
  const value = process.env.RATE_LIMIT_PROVIDER;
  if (value === "cloudflare_waf" || value === "upstash_redis") return value;
  return "memory";
}

export function getRateLimitProviderStatus() {
  const provider = getRateLimitProviderId();
  const upstashConfigured = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  return {
    provider,
    durable: provider !== "memory",
    externalRequired: provider !== "memory",
    configured: provider === "upstash_redis" ? upstashConfigured : provider !== "cloudflare_waf",
  };
}

function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))),
      },
    },
  );
}

function serviceUnavailable() {
  return NextResponse.json(
    { error: "Rate limit provider unavailable" },
    {
      status: 503,
      headers: {
        "Retry-After": "30",
      },
    },
  );
}

async function memoryDecision(request: Request, key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
  const now = Date.now();
  cleanup(now);

  const bucketKey = `${key}:${clientIp(request)}`;
  const current = buckets.get(bucketKey);
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };

  bucket.count += 1;
  buckets.set(bucketKey, bucket);

  if (bucket.count <= limit) {
    return { allowed: true };
  }

  return {
    allowed: false,
    retryAfterSeconds: (bucket.resetAt - now) / 1000,
  };
}

async function upstashDecision(request: Request, key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!restUrl || !token) {
    throw new Error("Upstash Redis REST env is not configured.");
  }

  const bucketKey = `celebratedeal:rl:${key}:${clientIp(request)}`;
  const response = await fetch(restUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["EVAL", UPSTASH_RATE_LIMIT_SCRIPT, 1, bucketKey, String(limit), String(windowMs)]),
    cache: "no-store",
  });
  const json = await response.json() as { result?: unknown; error?: string };
  if (!response.ok || json.error) {
    throw new Error(json.error ?? `Upstash Redis returned HTTP ${response.status}`);
  }

  const [countRaw, ttlRaw] = Array.isArray(json.result) ? json.result : [0, windowMs];
  const count = Number(countRaw);
  const ttlMs = Number(ttlRaw);
  if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
    throw new Error("Upstash Redis returned an unexpected rate limit payload.");
  }

  return {
    allowed: count <= limit,
    retryAfterSeconds: Math.max(1, ttlMs / 1000),
  };
}

export async function checkRateLimit(request: Request, key: string, limit: number, windowMs: number) {
  const provider = getRateLimitProviderId();

  if (provider === "cloudflare_waf") {
    // Cloudflare WAF is enforced before the request reaches Next.js.
    return null;
  }

  let decision: RateLimitDecision;
  try {
    decision = provider === "upstash_redis"
      ? await upstashDecision(request, key, limit, windowMs)
      : await memoryDecision(request, key, limit, windowMs);
  } catch {
    return serviceUnavailable();
  }

  if (decision.allowed) {
    return null;
  }

  return tooManyRequests(decision.retryAfterSeconds ?? Math.ceil(windowMs / 1000));
}

export function resetInMemoryRateLimitForTests() {
  buckets.clear();
}
