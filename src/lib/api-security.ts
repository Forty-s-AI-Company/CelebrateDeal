import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const CLIENT_REQUEST_HEADER = "x-celebratedeal-client";
export const CLIENT_REQUEST_HEADER_VALUE = "web";
export const MAX_JSON_BODY_BYTES = 64 * 1024;

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2) return null;

  const [scheme, token] = parts;
  return scheme.toLowerCase() === "bearer" && token ? token : null;
}

export function isAuthorizedBearer(request: Request, secret: string | undefined) {
  if (!secret) return false;
  const token = bearerToken(request);
  return Boolean(token && safeEqual(token, secret));
}

export function requireJobSecret(request: Request) {
  return isAuthorizedBearer(request, process.env.JOB_SECRET);
}

export function requireSharedSecretHeader(request: Request, headerName: string, secret: string | undefined) {
  if (!secret) return false;
  const incoming = request.headers.get(headerName);
  return Boolean(incoming && safeEqual(incoming, secret));
}

export function unauthorizedJson(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

function originFrom(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function requestOrigin(request: Request) {
  return originFrom(request.headers.get("origin")) ?? originFrom(request.headers.get("referer"));
}

function allowedRequestOrigins(request: Request) {
  const origins = new Set<string>();
  const requestUrl = new URL(request.url);
  origins.add(requestUrl.origin);

  const configured = originFrom(process.env.NEXT_PUBLIC_APP_URL ?? null);
  if (configured) origins.add(configured);

  return origins;
}

export function requireSameOriginRequest(request: Request, options: { requireClientHeader?: boolean } = {}) {
  const incomingOrigin = requestOrigin(request);
  if (options.requireClientHeader && request.headers.get(CLIENT_REQUEST_HEADER) !== CLIENT_REQUEST_HEADER_VALUE) {
    return NextResponse.json({ error: "Missing trusted client header" }, { status: 403 });
  }

  if (options.requireClientHeader && !incomingOrigin) {
    return NextResponse.json({ error: "Missing request origin" }, { status: 403 });
  }

  if (incomingOrigin && !allowedRequestOrigins(request).has(incomingOrigin)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  return null;
}

/**
 * 以固定記憶體上限讀取 JSON。任何空白、畸形或超過上限的內容都正規化為
 * 空物件，再由各 route 的 Zod schema 回傳一致的 400。
 */
async function readBoundedBody(request: Request, maxBytes: number) {
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    return null;
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readJsonBody(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const bytes = await readBoundedBody(request, maxBytes);
  if (!bytes) return {};
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

/**
 * 讀取需要保留原始內容的 webhook／安全回報，並沿用相同的固定記憶體上限。
 * `null` 代表內容超量或串流讀取失敗，呼叫端應直接拒絕，不能繼續驗證簽章。
 */
export async function readTextBody(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<string | null> {
  const bytes = await readBoundedBody(request, maxBytes);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

export async function readFormDataBody(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
) {
  const bytes = await readBoundedBody(request, maxBytes);
  if (!bytes) return null;
  try {
    return await new Response(bytes, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    return null;
  }
}
