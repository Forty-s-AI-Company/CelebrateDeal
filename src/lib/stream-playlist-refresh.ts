import { isStreamDeliveryHost, withCurrentStreamToken, type RenewalTimers } from "@/lib/signed-playback-renewal";

/**
 * F-093: Cloudflare Stream signs what a playlist references by itself. A media playlist fetched
 * with token A (`/<token A>/manifest/<rendition>.m3u8`) lists uid-form URIs
 * (`/<uid>/video/<n>/seg_<n>.mp4?p=…&s=…`, the same for `init.mp4`) whose `p`／`s` signature
 * Cloudflare derived from token A, so they are refused (401 "signature expired") from token A's
 * `exp` on, whatever token a later request would carry in its path.
 *
 * hls.js loads a VOD media playlist once and keeps its fragment URLs for the whole session; a
 * renewed token in `xhrSetup` reaches only token-form URLs. This module fetches the media
 * playlists hls.js holds again with the renewed token and indexes the freshly signed URIs, so
 * `xhrSetup` can send every later segment request to the URI Cloudflare signed for the new token.
 * `createVodPlaylistResigner` does that; `hls-playback-attachment.ts` wires it into hls.js.
 */

/** A refresh request that has not answered by then is abandoned (segments wait for at most this). */
export const STREAM_PLAYLIST_REFRESH_TIMEOUT_MS = 10_000;
/**
 * Delays of the retries of a refresh that failed without the new token being refused (network
 * error, timeout, 5xx). A refused token (401／403) is not retried here: the player's stall
 * recovery renews it once segments start failing.
 */
export const STREAM_PLAYLIST_REFRESH_RETRY_DELAYS_MS: readonly number[] = [15_000, 30_000];

/** Fetches one playlist for the refresh (injectable for tests). */
export type PlaylistFetcher = (url: string, signal: AbortSignal) => Promise<{ status: number; text: () => Promise<string> }>;

// Like hls.js's own XHR: no cookies; never a cached copy signed for an older token.
export const defaultFetchPlaylist: PlaylistFetcher = (url, signal) => fetch(url, { signal, credentials: "omit", cache: "no-store" });

const JWT_PATH_SEGMENT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function parseStreamUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && isStreamDeliveryHost(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** A Stream delivery URL whose first path segment is a playback token. */
export function isTokenFormStreamUrl(value: string) {
  const url = parseStreamUrl(value);
  return Boolean(url && JWT_PATH_SEGMENT.test(url.pathname.split("/")[1] ?? ""));
}

/**
 * Index key of a Stream URL that Cloudflare signed itself (not token-form): its path. Host and
 * query are left out, so the same resource signed for another token maps to the same key.
 * Null for token-form URLs (`withCurrentStreamToken` renews those) and non-Stream URLs.
 */
export function providerSignedUrlKey(value: string) {
  const url = parseStreamUrl(value);
  if (!url || JWT_PATH_SEGMENT.test(url.pathname.split("/")[1] ?? "")) return null;
  return url.pathname;
}

/**
 * Absolute URIs a playlist references: every non-tag line (segments, variant playlists) and
 * every `URI="…"` attribute (EXT-X-MAP init segments, EXT-X-MEDIA renditions, keys, parts),
 * resolved against the URL the playlist was fetched from.
 */
export function playlistUris(text: string, playlistUrl: string) {
  const uris: string[] = [];
  const add = (reference: string) => {
    try {
      uris.push(new URL(reference, playlistUrl).href);
    } catch {
      // An unresolvable reference is left to hls.js.
    }
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith("#")) {
      add(line);
      continue;
    }
    for (const match of line.matchAll(/URI="([^"]+)"/g)) add(match[1]!);
  }
  return uris;
}

export type VodPlaylistResigner = {
  /**
   * Re-signs for the current playback URL: fetches the VOD media playlists `heldPlaylists()`
   * returns again with its token and indexes the URIs Cloudflare signed for it. Joins a refresh
   * already running for that URL; null when there is nothing to do (already done for this URL,
   * or no VOD playlist held: the player loads those later with the new token).
   */
  refresh: () => Promise<void> | null;
  /** The running refresh, if any (a segment request waits for it). */
  pending: () => Promise<void> | null;
  /** The URL a player request is sent to: the newest token, or the URI re-signed for it. */
  requestUrlFor: (requestUrl: string) => string;
  /** A new playback URL arrived: refresh with fresh retries. */
  renewed: () => void;
  /** The player loads everything again with the current URL: drop what was re-signed so far. */
  reset: () => void;
  dispose: () => void;
};

/**
 * Keeps the provider-signed URIs of the VOD playlists a player holds signed for the newest token
 * (see the module comment). `heldPlaylists` returns the URLs of the loaded VOD media playlists,
 * or null while there is no player to refresh for.
 */
export function createVodPlaylistResigner({
  initialUrl,
  currentUrl,
  heldPlaylists,
  fetchPlaylist,
  timers,
}: {
  initialUrl: string;
  currentUrl: () => string;
  heldPlaylists: () => readonly string[] | null;
  fetchPlaylist: PlaylistFetcher;
  timers: RenewalTimers;
}): VodPlaylistResigner {
  let disposed = false;
  // Provider-signed URIs (segments, init) re-signed for the newest token, by providerSignedUrlKey.
  const resigned = new Map<string, string>();
  // The playback URL whose token signed the URIs the player loads (the initial playlists use it).
  let refreshedFor = initialUrl;
  let running: { url: string; promise: Promise<void> } | null = null;
  let generation = 0;
  let retries = 0;
  let retryTimer: unknown = null;
  const controllers = new Set<AbortController>();

  const clearRetry = () => {
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    retryTimer = null;
  };

  /** One playlist: its text, "refused" (401／403: the token is not accepted) or "failed". */
  const load = async (target: string): Promise<string | "refused" | "failed"> => {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = timers.setTimeout(() => controller.abort(), STREAM_PLAYLIST_REFRESH_TIMEOUT_MS);
    try {
      const response = await fetchPlaylist(target, controller.signal);
      if (response.status === 401 || response.status === 403) return "refused";
      if (response.status < 200 || response.status >= 300) return "failed";
      return await response.text();
    } catch {
      return "failed";
    } finally {
      timers.clearTimeout(timer);
      controllers.delete(controller);
    }
  };

  const index = (text: string, playlistUrl: string, into: Map<string, string>) => {
    for (const uri of playlistUris(text, playlistUrl)) {
      const key = providerSignedUrlKey(uri);
      if (key) into.set(key, uri);
    }
  };

  /** Fetches and indexes into `fresh`; resolves to the overall outcome. Never rejects. */
  const resign = async (target: string, held: readonly string[], fresh: Map<string, string>) => {
    let outcome: "ok" | "refused" | "failed" = "ok";
    const fail = (reason: "refused" | "failed") => {
      if (reason === "refused" || outcome === "ok") outcome = reason;
    };
    // A uid-form media playlist URL was signed by Cloudflare too: its newly signed URL comes from
    // the entry manifest. Token-form ones (what Stream serves) only need the new token.
    let manifestUris: Map<string, string> | null = null;
    if (held.some((playlistUrl) => !isTokenFormStreamUrl(playlistUrl))) {
      const manifest = await load(target);
      if (manifest === "refused" || manifest === "failed") fail(manifest);
      else {
        manifestUris = new Map();
        index(manifest, target, manifestUris);
        for (const [key, uri] of manifestUris) fresh.set(key, uri);
      }
    }
    await Promise.all(held.map(async (playlistUrl) => {
      const key = providerSignedUrlKey(playlistUrl);
      const source = key === null ? withCurrentStreamToken(playlistUrl, target) : manifestUris?.get(key) ?? null;
      if (!source) {
        fail("failed");
        return;
      }
      const text = await load(source);
      if (text === "refused" || text === "failed") fail(text);
      else index(text, source, fresh);
    }));
    return outcome;
  };

  const refresh = (): Promise<void> | null => {
    const target = currentUrl();
    if (disposed) return null;
    if (running?.url === target) return running.promise;
    if (refreshedFor === target) return null;
    const held = heldPlaylists();
    if (held === null) return null;
    if (held.length === 0) {
      refreshedFor = target;
      return null;
    }
    clearRetry();
    const own = ++generation;
    const promise = (async () => {
      const fresh = new Map<string, string>();
      const outcome = await resign(target, held, fresh);
      if (disposed || own !== generation) return;
      for (const [key, uri] of fresh) resigned.set(key, uri);
      if (outcome === "ok") {
        refreshedFor = target;
        return;
      }
      // A refused token is not retried here; a network failure is, a bounded number of times,
      // while the old signatures still work.
      if (outcome === "failed" && retries < STREAM_PLAYLIST_REFRESH_RETRY_DELAYS_MS.length) {
        const delay = STREAM_PLAYLIST_REFRESH_RETRY_DELAYS_MS[retries]!;
        retries += 1;
        retryTimer = timers.setTimeout(() => {
          retryTimer = null;
          void refresh();
        }, delay);
      }
    })().finally(() => {
      if (running?.promise === promise) running = null;
    });
    running = { url: target, promise };
    return promise;
  };

  return {
    refresh,
    pending: () => running?.promise ?? null,
    requestUrlFor: (requestUrl) => {
      const key = providerSignedUrlKey(requestUrl);
      if (key === null) return withCurrentStreamToken(requestUrl, currentUrl());
      return resigned.get(key) ?? requestUrl;
    },
    renewed: () => {
      retries = 0;
      void refresh();
    },
    reset: () => {
      resigned.clear();
      generation += 1;
      running = null;
      refreshedFor = currentUrl();
      clearRetry();
    },
    dispose: () => {
      disposed = true;
      clearRetry();
      running = null;
      for (const controller of controllers) controller.abort();
    },
  };
}
