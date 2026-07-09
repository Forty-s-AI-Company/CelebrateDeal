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

function cloudflareEnv() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_STREAM_TOKEN;
  if (!accountId || !token) {
    throw new Error("Cloudflare Stream env is not configured.");
  }
  return { accountId, token };
}

async function cloudflareRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { accountId, token } = cloudflareEnv();
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const json = await response.json() as { success?: boolean; errors?: unknown; result?: T };
  if (!response.ok || json.success === false) {
    throw new Error(`Cloudflare Stream request failed: ${JSON.stringify(json.errors ?? response.statusText)}`);
  }
  return json.result as T;
}

export async function createDirectCreatorUpload(maxDurationSeconds = 60 * 60) {
  return cloudflareRequest<{ uid: string; uploadURL: string }>("/stream/direct_upload", {
    method: "POST",
    body: JSON.stringify({ maxDurationSeconds }),
  });
}

export async function getStreamVideoStatus(uid: string) {
  const result = await cloudflareRequest<unknown>(`/stream/${encodeURIComponent(uid)}`);
  const parsed = CloudflareVideoDetails.safeParse(result);
  if (!parsed.success) {
    throw new Error("Cloudflare Stream returned an unexpected video payload.");
  }
  return parsed.data;
}

export async function createLiveInput(name: string) {
  return cloudflareRequest<{
    uid: string;
    rtmps?: { url?: string; streamKey?: string };
    webRTC?: { url?: string };
  }>("/stream/live_inputs", {
    method: "POST",
    body: JSON.stringify({
      meta: { name },
      recording: { mode: "automatic" },
    }),
  });
}

export async function getLiveInput(uid: string) {
  return cloudflareRequest<unknown>(`/stream/live_inputs/${encodeURIComponent(uid)}`);
}
