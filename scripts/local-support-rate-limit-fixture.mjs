import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const LOCAL_SUPPORT_RATE_LIMIT_HOST = "127.0.0.1";
export const LOCAL_SUPPORT_RATE_LIMIT_PORT = 31025;
export const LOCAL_SUPPORT_RATE_LIMIT_TOKEN = "celebratedeal-local-synthetic-rate-limit-token";
const MAX_BODY_BYTES = 4_096;
const KEY_PREFIX = "celebratedeal:rl:";
export const LOCAL_SUPPORT_RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`.trim();

function rejected(response) {
  response.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ error: "REQUEST_REJECTED" }));
}

function parseRequestBody(body) {
  if (body.length === 0 || body.length > MAX_BODY_BYTES) return null;
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 6) return null;
  const [command, script, keyCount, key, limit, windowMs] = value;
  if (
    command !== "EVAL"
    || typeof script !== "string" || script.trim() !== LOCAL_SUPPORT_RATE_LIMIT_SCRIPT
    || keyCount !== 1
    || typeof key !== "string" || !key.startsWith(KEY_PREFIX) || key.length > 512
    || typeof limit !== "string" || !/^\d{1,6}$/u.test(limit)
    || typeof windowMs !== "string" || !/^\d{1,9}$/u.test(windowMs)
  ) return null;
  const parsedLimit = Number(limit);
  const parsedWindowMs = Number(windowMs);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1_000) return null;
  if (!Number.isSafeInteger(parsedWindowMs) || parsedWindowMs < 1 || parsedWindowMs > 86_400_000) return null;
  return { key, limit: parsedLimit, windowMs: parsedWindowMs };
}

export function createLocalSupportRateLimitHandler({ now = () => Date.now() } = {}) {
  const buckets = new Map();
  return (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(204, { "cache-control": "no-store" });
      return response.end();
    }
    if (request.method !== "POST" || request.url !== "/") return rejected(response);
    if (request.headers.authorization !== `Bearer ${LOCAL_SUPPORT_RATE_LIMIT_TOKEN}`) return rejected(response);
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on("end", () => {
      const parsed = size <= MAX_BODY_BYTES ? parseRequestBody(Buffer.concat(chunks).toString("utf8")) : null;
      if (!parsed) return rejected(response);
      const currentTime = now();
      const existing = buckets.get(parsed.key);
      const bucket = existing && existing.expiresAt > currentTime
        ? existing
        : { count: 0, expiresAt: currentTime + parsed.windowMs };
      bucket.count += 1;
      buckets.set(parsed.key, bucket);
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ result: [bucket.count, Math.max(0, bucket.expiresAt - currentTime)] }));
    });
    request.on("error", () => {
      if (!response.writableEnded && !response.headersSent) rejected(response);
    });
  };
}

export function createLocalSupportRateLimitServer(options = {}) {
  return createServer(createLocalSupportRateLimitHandler(options));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createLocalSupportRateLimitServer();
  server.listen(LOCAL_SUPPORT_RATE_LIMIT_PORT, LOCAL_SUPPORT_RATE_LIMIT_HOST);
  const close = () => server.close(() => process.exit(0));
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}
