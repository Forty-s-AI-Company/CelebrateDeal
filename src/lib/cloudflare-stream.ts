import { z } from "zod";

const CloudflareVideoDetails = z.object({
  uid: z.string(),
  thumbnail: z.string().optional(),
  duration: z.number().optional(),
  readyToStream: z.boolean().optional(),
  playback: z.object({
    hls: z.string().optional(),
    dash: z.string().optional(),
  }).optional(),
});

const CloudflareDirectUpload = z.object({
  uid: z.string().min(1),
  uploadURL: z.string().url(),
});

const CloudflareLiveInput = z.object({
  uid: z.string().min(1),
  rtmps: z.object({
    url: z.string().optional(),
    streamKey: z.string().optional(),
  }).optional(),
  webRTC: z.object({ url: z.string().optional() }).optional(),
});

export type CloudflareStreamErrorCode =
  | "configuration"
  | "network"
  | "provider_rejected"
  | "invalid_response";

export class CloudflareStreamError extends Error {
  constructor(
    public readonly code: CloudflareStreamErrorCode,
    public readonly providerStatus: number | null = null,
  ) {
    super(`Cloudflare Stream request failed (${code}).`);
    this.name = "CloudflareStreamError";
  }
}

function cloudflareEnv() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_STREAM_TOKEN;
  if (!accountId || !token) {
    throw new CloudflareStreamError("configuration");
  }
  return { accountId, token };
}

async function cloudflareRequest(path: string, init?: RequestInit): Promise<unknown> {
  const { accountId, token } = cloudflareEnv();
  let response: Response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CloudflareStreamError("network");
  }

  const json = await response.json().catch(() => null) as {
    success?: unknown;
    result?: unknown;
  } | null;
  if (!response.ok || !json || json.success === false) {
    throw new CloudflareStreamError("provider_rejected", response.status);
  }
  if (!("result" in json)) {
    throw new CloudflareStreamError("invalid_response", response.status);
  }
  return json.result;
}

export async function createDirectCreatorUpload(maxDurationSeconds = 60 * 60) {
  const result = await cloudflareRequest("/stream/direct_upload", {
    method: "POST",
    body: JSON.stringify({ maxDurationSeconds }),
  });
  const parsed = CloudflareDirectUpload.safeParse(result);
  if (!parsed.success) {
    throw new CloudflareStreamError("invalid_response", 200);
  }
  return parsed.data;
}

export async function getStreamVideoStatus(uid: string) {
  const result = await cloudflareRequest(`/stream/${encodeURIComponent(uid)}`);
  const parsed = CloudflareVideoDetails.safeParse(result);
  if (!parsed.success) {
    throw new CloudflareStreamError("invalid_response", 200);
  }
  return parsed.data;
}

export async function createLiveInput(name: string) {
  const result = await cloudflareRequest("/stream/live_inputs", {
    method: "POST",
    body: JSON.stringify({
      meta: { name },
      recording: { mode: "automatic" },
    }),
  });
  const parsed = CloudflareLiveInput.safeParse(result);
  if (!parsed.success) {
    throw new CloudflareStreamError("invalid_response", 200);
  }
  return parsed.data;
}

export async function getLiveInput(uid: string) {
  const result = await cloudflareRequest(`/stream/live_inputs/${encodeURIComponent(uid)}`);
  const parsed = CloudflareLiveInput.safeParse(result);
  if (!parsed.success) {
    throw new CloudflareStreamError("invalid_response", 200);
  }
  return parsed.data;
}
