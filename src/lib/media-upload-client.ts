import { Upload } from "tus-js-client";
import {
  CLOUDFLARE_TUS_CHUNK_BYTES,
  MAX_BASIC_VIDEO_UPLOAD_BYTES,
  MAX_CLOUDFLARE_VIDEO_BYTES,
} from "@/lib/media-upload-limits";

export const IMAGE_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
export const VIDEO_BASIC_UPLOAD_MAX_BYTES = MAX_BASIC_VIDEO_UPLOAD_BYTES;
export const VIDEO_UPLOAD_MAX_BYTES = MAX_CLOUDFLARE_VIDEO_BYTES;

const IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const VIDEO_MIME_TYPES = new Set([
  "video/3gpp",
  "video/mp2t",
  "video/mp4",
  "video/mpeg",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
]);

// Cloudflare Stream 目前可能回傳兩個官方上傳網域；兩者都必須保留
// HTTPS 與 exact-host 驗證，避免把一次性上傳 URL 開放給 lookalike domain。
const CLOUDFLARE_UPLOAD_HOSTS = new Set([
  "upload.videodelivery.net",
  "upload.cloudflarestream.com",
]);

export type MediaUploadKind = "image" | "video";

export class MediaUploadClientError extends Error {
  constructor(public readonly code: string) {
    super(`Media upload failed (${code}).`);
    this.name = "MediaUploadClientError";
  }
}

export function validateMediaFile(kind: MediaUploadKind, file: Pick<File, "size" | "type">) {
  if (file.size <= 0) return "empty_file";
  const allowedTypes = kind === "image" ? IMAGE_MIME_TYPES : VIDEO_MIME_TYPES;
  if (!allowedTypes.has(file.type.toLowerCase())) return `unsupported_${kind}_type`;
  const maxBytes = kind === "image" ? IMAGE_UPLOAD_MAX_BYTES : VIDEO_UPLOAD_MAX_BYTES;
  return file.size > maxBytes ? `${kind}_too_large` : null;
}

function diagnosticCode(value: unknown) {
  if (!value || typeof value !== "object") return "request_failed";
  const record = value as Record<string, unknown>;
  const nestedError = record.error && typeof record.error === "object"
    ? (record.error as Record<string, unknown>).code
    : null;
  const candidate = typeof record.diagnostic === "string"
    ? record.diagnostic
    : typeof record.error === "string"
      ? record.error
      : typeof nestedError === "string"
        ? nestedError
        : "request_failed";
  return /^[a-z0-9_]{1,64}$/i.test(candidate) ? candidate.toLowerCase() : "request_failed";
}

export async function requestMediaJson({
  path,
  csrfToken,
  payload,
  signal,
}: {
  path: string;
  csrfToken: string;
  payload: Record<string, unknown>;
  signal?: AbortSignal;
}) {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-celebratedeal-client": "web",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new MediaUploadClientError("cancelled");
    }
    throw new MediaUploadClientError("network_error");
  }

  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new MediaUploadClientError(diagnosticCode(body));
  if (!body || typeof body !== "object") throw new MediaUploadClientError("invalid_response");
  return body as Record<string, unknown>;
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeCloudflareVideoUploadUrl(value: unknown) {
  const safe = safeHttpsUrl(value);
  if (!safe) return null;
  const hostname = new URL(safe).hostname.toLowerCase();
  return CLOUDFLARE_UPLOAD_HOSTS.has(hostname) ? safe : null;
}

export function parseImageProvision(value: Record<string, unknown>) {
  const assetId = typeof value.assetId === "string" ? value.assetId : "";
  const uploadUrl = safeHttpsUrl(value.uploadUrl);
  const publicUrl = safeHttpsUrl(value.publicUrl);
  const headers = value.headers && typeof value.headers === "object"
    ? value.headers as Record<string, unknown>
    : {};
  const contentType = typeof headers["content-type"] === "string" ? headers["content-type"] : null;
  if (!assetId || !uploadUrl || !publicUrl || value.method !== "PUT" || !contentType) {
    throw new MediaUploadClientError("invalid_response");
  }
  return { assetId, uploadUrl, publicUrl, headers: { "content-type": contentType } };
}

export function parseVideoProvision(value: Record<string, unknown>) {
  const videoId = typeof value.videoId === "string" ? value.videoId : "";
  const uploadUrl = safeCloudflareVideoUploadUrl(value.uploadUrl);
  if (!videoId || !uploadUrl || value.method !== "POST") {
    throw new MediaUploadClientError("invalid_response");
  }
  return { videoId, uploadUrl };
}

export function parseResumableVideoProvision(value: Record<string, unknown>) {
  const videoId = typeof value.videoId === "string" ? value.videoId : "";
  const uploadUrl = safeCloudflareVideoUploadUrl(value.uploadUrl);
  const uploadTicket = typeof value.uploadTicket === "string" ? value.uploadTicket : "";
  if (!videoId || !uploadUrl || uploadTicket.length < 20 || value.method !== "TUS") {
    throw new MediaUploadClientError("invalid_response");
  }
  return { videoId, uploadUrl, uploadTicket };
}

export function parseResumableVideoComplete(value: Record<string, unknown>) {
  const videoId = typeof value.videoId === "string" ? value.videoId : "";
  if (!videoId || value.status !== "processing") {
    throw new MediaUploadClientError("invalid_response");
  }
  return { videoId };
}

export async function uploadResumableFileWithProgress({
  url,
  file,
  videoId,
  signal,
  onProgress,
}: {
  url: string;
  file: File;
  videoId: string;
  signal?: AbortSignal;
  onProgress: (percentage: number) => void;
}) {
  const uploadUrl = safeCloudflareVideoUploadUrl(url);
  if (!uploadUrl) throw new MediaUploadClientError("invalid_response");

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (result: "resolve" | "reject", code?: string) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (result === "resolve") resolve();
      else reject(new MediaUploadClientError(code ?? "provider_rejected"));
    };
    const upload = new Upload(file, {
      uploadUrl,
      uploadSize: file.size,
      chunkSize: CLOUDFLARE_TUS_CHUNK_BYTES,
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        name: file.name,
        filetype: file.type,
        celebratedealVideoId: videoId,
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        if (bytesTotal <= 0) return;
        onProgress(Math.min(100, Math.round((bytesUploaded / bytesTotal) * 100)));
      },
      onSuccess: () => finish("resolve"),
      onError: (error) => {
        const withResponse = error as Error & { originalResponse?: unknown };
        finish("reject", withResponse.originalResponse ? "provider_rejected" : "network_error");
      },
    });
    const abort = () => {
      void upload.abort().finally(() => finish("reject", "cancelled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    upload.start();
  });
}

export async function uploadFileWithProgress({
  url,
  method,
  file,
  headers = {},
  signal,
  onProgress,
}: {
  url: string;
  method: "POST" | "PUT";
  file: File;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onProgress: (percentage: number) => void;
}) {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (result: "resolve" | "reject", code?: string) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (result === "resolve") resolve();
      else reject(new MediaUploadClientError(code ?? "provider_rejected"));
    };
    const abort = () => {
      xhr.abort();
      finish("reject", "cancelled");
    };

    xhr.open(method, url);
    xhr.timeout = 10 * 60 * 1000;
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) finish("resolve");
      else finish("reject", "provider_rejected");
    });
    xhr.addEventListener("error", () => finish("reject", "network_error"));
    xhr.addEventListener("timeout", () => finish("reject", "timeout"));
    xhr.addEventListener("abort", () => finish("reject", "cancelled"));
    signal?.addEventListener("abort", abort, { once: true });

    if (signal?.aborted) {
      abort();
      return;
    }
    if (method === "POST") {
      const formData = new FormData();
      formData.append("file", file);
      xhr.send(formData);
    } else {
      xhr.send(file);
    }
  });
}
