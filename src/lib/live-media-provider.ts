import { createHash } from "node:crypto";

/** Signaling must stay on a private listener; browsers only receive SDP. */
export function mediaOrigin(value = process.env.CELEBRATEDEAL_MEDIA_ORIGIN) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}

export function mediaPath(vendorId: string, liveId: string) {
  return `/cd_${createHash("sha256").update(JSON.stringify([vendorId, liveId])).digest("hex")}`;
}

export function mediaResourcePath(location: string | null, endpoint: string) {
  if (!location) throw new Error("MEDIA_INVALID_RESPONSE");
  const base = new URL(endpoint);
  const url = new URL(location, base);
  if (url.origin !== base.origin || url.search || url.hash || !url.pathname.startsWith(`${base.pathname}/`)
    || !/^[0-9a-f-]{36}$/.test(url.pathname.slice(base.pathname.length + 1))) throw new Error("MEDIA_INVALID_RESPONSE");
  return url.pathname;
}

export async function startMediaSession(origin: string, path: string, direction: "publish" | "read", sdp: string) {
  const endpoint = `${origin}${path}/${direction === "publish" ? "whip" : "whep"}`;
  const response = await fetch(endpoint, { method: "POST", redirect: "error", headers: { "Content-Type": "application/sdp" }, body: sdp, signal: AbortSignal.timeout(15_000) });
  if (response.status !== 201) throw new Error("MEDIA_UNAVAILABLE");
  const resourcePath = mediaResourcePath(response.headers.get("location"), endpoint);
  const answer = await response.text();
  if (answer.length > 64_000 || !answer.startsWith("v=0")) {
    await stopMediaSession(origin, resourcePath).catch(() => undefined);
    throw new Error("MEDIA_INVALID_RESPONSE");
  }
  return { answer, resourcePath };
}

export async function stopMediaSession(origin: string, resourcePath: string) {
  // Defense in depth: persisted provider state is never an arbitrary fetch URL.
  if (!/^\/cd_[a-f0-9]{64}\/(whip|whep)\/[a-f0-9-]{36}$/.test(resourcePath)) throw new Error("MEDIA_INVALID_RESOURCE");
  const response = await fetch(`${origin}${resourcePath}`, { method: "DELETE", redirect: "error", signal: AbortSignal.timeout(5_000) });
  if (!response.ok && response.status !== 404) throw new Error("MEDIA_STOP_FAILED");
}
