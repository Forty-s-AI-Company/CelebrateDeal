import { z } from "zod";
import { getStreamPlaybackSecurity, type StreamPlaybackSecurity } from "@/lib/cloudflare-stream-signing";

const CloudflareVideoDetails = z.object({
  uid: z.string(),
  status: z.object({ state: z.string().optional() }).optional(),
  thumbnail: z.string().optional(),
  duration: z.number().optional(),
  readyToStream: z.boolean().optional(),
  playback: z.object({
    hls: z.string().optional(),
    dash: z.string().optional(),
  }).optional(),
});

const CLOUDFLARE_UPLOAD_HOSTS = new Set([
  "upload.videodelivery.net",
  "upload.cloudflarestream.com",
]);

const CloudflareUploadUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && CLOUDFLARE_UPLOAD_HOSTS.has(url.hostname.toLowerCase());
});

const CloudflareDirectUpload = z.object({
  uid: z.string().min(1),
  uploadURL: CloudflareUploadUrl,
});

const CloudflareResumableUpload = z.object({
  uid: z.string().trim().min(1).max(128),
  uploadURL: CloudflareUploadUrl,
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
  // F-093：簽章啟用時新影片一律 requireSignedURLs＋allowedOrigins；未啟用時請求內容不變。
  const security = getStreamPlaybackSecurity();
  const result = await cloudflareRequest("/stream/direct_upload", {
    method: "POST",
    body: JSON.stringify({ maxDurationSeconds, ...security }),
  });
  const parsed = CloudflareDirectUpload.safeParse(result);
  if (!parsed.success) {
    throw new CloudflareStreamError("invalid_response", 200);
  }
  return parsed.data;
}

function encodeTusMetadata(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

/** tus 的 Cloudflare 擴充 metadata：`requiresignedurls` 不帶值，`allowedorigins` 為逗號分隔清單。 */
function tusSecurityMetadata(security: StreamPlaybackSecurity | null) {
  if (!security) return [];
  return [
    "requiresignedurls",
    ...(security.allowedOrigins.length > 0
      ? [`allowedorigins ${encodeTusMetadata(security.allowedOrigins.join(","))}`]
      : []),
  ];
}

export async function createResumableCreatorUpload(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  maxDurationSeconds: number;
}) {
  const { accountId, token } = cloudflareEnv();
  const security = getStreamPlaybackSecurity();
  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream?direct_user=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(input.sizeBytes),
          "Upload-Metadata": [
            `name ${encodeTusMetadata(input.fileName)}`,
            `filetype ${encodeTusMetadata(input.mimeType)}`,
            `maxDurationSeconds ${encodeTusMetadata(String(input.maxDurationSeconds))}`,
            ...tusSecurityMetadata(security),
          ].join(","),
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new CloudflareStreamError("network");
  }

  if (!response.ok) {
    throw new CloudflareStreamError("provider_rejected", response.status);
  }

  const parsed = CloudflareResumableUpload.safeParse({
    uid: response.headers.get("stream-media-id"),
    uploadURL: response.headers.get("location"),
  });
  if (!parsed.success) {
    throw new CloudflareStreamError("invalid_response", response.status);
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
  const security = getStreamPlaybackSecurity();
  const result = await cloudflareRequest("/stream/live_inputs", {
    method: "POST",
    body: JSON.stringify({
      meta: { name },
      recording: { mode: "automatic", ...security },
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

const CloudflareVideoPlaybackSettings = z.object({
  uid: z.string().min(1),
  requireSignedURLs: z.boolean().optional(),
  allowedOrigins: z.array(z.string()).optional(),
});

const CloudflareLiveInputRecordingSettings = z.object({
  uid: z.string().min(1),
  recording: z.object({
    requireSignedURLs: z.boolean().optional(),
    allowedOrigins: z.array(z.string()).optional(),
  }).optional(),
});

/** 既有影片開啟簽章：`POST /stream/{uid}`，body 帶 `uid`。 */
export async function updateStreamVideoPlaybackSecurity(uid: string, security: StreamPlaybackSecurity) {
  const result = await cloudflareRequest(`/stream/${encodeURIComponent(uid)}`, {
    method: "POST",
    body: JSON.stringify({ uid, ...security }),
  });
  const parsed = CloudflareVideoPlaybackSettings.safeParse(result);
  if (!parsed.success) {
    throw new CloudflareStreamError("invalid_response", 200);
  }
  return parsed.data;
}

/** 既有 live input 的錄影開啟簽章：`PUT /stream/live_inputs/{uid}`，保留自動錄影。 */
export async function updateLiveInputRecordingSecurity(uid: string, security: StreamPlaybackSecurity) {
  const result = await cloudflareRequest(`/stream/live_inputs/${encodeURIComponent(uid)}`, {
    method: "PUT",
    body: JSON.stringify({ recording: { mode: "automatic", ...security } }),
  });
  const parsed = CloudflareLiveInputRecordingSettings.safeParse(result);
  if (!parsed.success) {
    throw new CloudflareStreamError("invalid_response", 200);
  }
  return parsed.data;
}
