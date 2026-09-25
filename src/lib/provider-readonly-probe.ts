import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

type ProbeResult = "ok" | "not_configured" | "invalid_configuration" | "unauthorized"
  | "forbidden" | "not_found" | "provider_error" | "network_error" | "invalid_response";

type ProbeEnv = {
  CLOUDFLARE_R2_ACCOUNT_ID?: string;
  CLOUDFLARE_R2_ACCESS_KEY_ID?: string;
  CLOUDFLARE_R2_SECRET_ACCESS_KEY?: string;
  CLOUDFLARE_R2_BUCKET?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_STREAM_TOKEN?: string;
};

const TIMEOUT_MS = 5_000;
const ACCOUNT_ID = /^[a-f0-9]{32}$/i;
const BUCKET = /^[a-z0-9][a-z0-9.-]{0,61}[a-z0-9]$|^[a-z0-9]$/;

function classifyStatus(status: number | undefined): ProbeResult {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return status ? "provider_error" : "network_error";
}

/** A single R2 S3 HeadBucket; no object listing or writes. Never propagate SDK errors. */
export async function probeR2HeadBucket(
  env: ProbeEnv = process.env as unknown as ProbeEnv,
  send?: (accountId: string, accessKeyId: string, secretAccessKey: string, bucket: string) => Promise<void>,
): Promise<ProbeResult> {
  const accountId = env.CLOUDFLARE_R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.CLOUDFLARE_R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return "not_configured";
  if (!ACCOUNT_ID.test(accountId) || !BUCKET.test(bucket)) return "invalid_configuration";

  try {
    if (send) {
      await send(accountId, accessKeyId, secretAccessKey, bucket);
    } else {
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
        maxAttempts: 1,
        requestHandler: { connectionTimeout: 2_000, requestTimeout: TIMEOUT_MS },
      });
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
      } finally {
        client.destroy();
      }
    }
    return "ok";
  } catch (error) {
    // AWS errors can contain headers and resource names; retain only the status enum.
    const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
    return classifyStatus(status);
  }
}

/** A single Cloudflare Stream video-list GET, limited to one result; no mutation. */
export async function probeStreamList(
  env: ProbeEnv = process.env as unknown as ProbeEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_STREAM_TOKEN?.trim();
  if (!accountId || !token) return "not_configured";
  if (!ACCOUNT_ID.test(accountId)) return "invalid_configuration";

  try {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream?limit=1`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return classifyStatus(response.status);
    }
    // The API result is deliberately discarded; only a bounded success shape is inspected.
    const reader = response.body?.getReader();
    if (!reader) return "invalid_response";
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16_384) return "invalid_response";
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    return typeof payload === "object" && payload !== null
      && "success" in payload && payload.success === true
      && "result" in payload && Array.isArray(payload.result)
      ? "ok" : "invalid_response";
  } catch {
    return "network_error";
  }
}

export async function probeProviderReadOnly() {
  const [r2, stream] = await Promise.all([probeR2HeadBucket(), probeStreamList()]);
  return { r2, stream };
}
