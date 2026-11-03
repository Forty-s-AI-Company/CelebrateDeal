import {
  createSignedPlaybackRenewal,
  swapNativePlaybackSource,
  withCurrentStreamToken,
  type RenewablePlaybackSource,
  type RenewalTimers,
  type SignedPlaybackRenewal,
} from "@/lib/signed-playback-renewal";

/** The subset of hls.js the live player uses. */
export type HlsPlayer = {
  loadSource: (url: string) => void;
  attachMedia: (media: HTMLMediaElement) => void;
  startLoad: (startPosition?: number) => void;
  destroy: () => void;
  on: (event: string, listener: (event: string, data: HlsErrorData) => void) => void;
};

export type HlsErrorData = {
  type?: string;
  response?: { code?: number };
  networkDetails?: unknown;
};

export type HlsConstructor = {
  isSupported: () => boolean;
  Events: { ERROR: string };
  ErrorTypes: { NETWORK_ERROR: string };
  new (config?: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void }): HlsPlayer;
};

const NATIVE_HLS_TYPE = "application/vnd.apple.mpegurl";
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

function isHlsManifestUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.pathname.endsWith("/manifest/video.m3u8");
  } catch {
    return false;
  }
}

function errorStatus(data: HlsErrorData) {
  if (typeof data.response?.code === "number") return data.response.code;
  const details = data.networkDetails as { status?: unknown } | null | undefined;
  return typeof details?.status === "number" ? details.status : null;
}

async function importHls(): Promise<HlsConstructor> {
  const hlsModule = await import("hls.js");
  return hlsModule.default as unknown as HlsConstructor;
}

/**
 * Attaches an HLS manifest to a video element and returns its cleanup.
 *
 * hls.js is preferred whenever `Hls.isSupported()`; native HLS is only the
 * fallback. With `expiresInSeconds` (an F-093 signed Stream URL) the source is
 * renewed through `fetchSource` (the admission-checked playback-source
 * endpoint) before the token lapses, and immediately when playback hits an
 * expired-token response (hls.js NETWORK_ERROR 401／403, or a native media
 * network／source error), after which loading resumes at the current position.
 */
export function attachHlsPlayback({
  video,
  url,
  expiresInSeconds,
  fetchSource,
  loadHls = importHls,
  timers,
  now,
}: {
  video: HTMLVideoElement;
  url: string;
  expiresInSeconds?: number;
  fetchSource: () => Promise<RenewablePlaybackSource | null>;
  loadHls?: () => Promise<HlsConstructor>;
  timers?: RenewalTimers;
  now?: () => number;
}) {
  let disposed = false;
  let currentUrl = url;
  let native = false;
  let player: HlsPlayer | null = null;
  // Set when playback hit an expired token; the next renewed URL reloads the source.
  let hlsReloadAt: number | null = null;
  let nativeReloadPending = false;

  const renewal: SignedPlaybackRenewal | null = expiresInSeconds && expiresInSeconds > 0
    ? createSignedPlaybackRenewal({
      expiresInSeconds,
      fetchSource,
      timers,
      now,
      applySource: (nextUrl) => {
        if (!isHlsManifestUrl(nextUrl)) return;
        const changed = nextUrl !== currentUrl;
        currentUrl = nextUrl;
        if (native) {
          // Native HLS needs a new src; after a media error it reloads even for the same URL.
          if (changed || nativeReloadPending) swapNativePlaybackSource(video, nextUrl);
          nativeReloadPending = false;
          return;
        }
        // hls.js picks the new token up in xhrSetup; after an expired-token
        // error it stopped loading, so reload from the position it stopped at.
        if (hlsReloadAt !== null && player) {
          const resumeAt = hlsReloadAt;
          hlsReloadAt = null;
          player.loadSource(nextUrl);
          player.startLoad(resumeAt);
        }
      },
    })
    : null;

  const onNativeError = () => {
    const code = video.error?.code;
    if (code !== MEDIA_ERR_NETWORK && code !== MEDIA_ERR_SRC_NOT_SUPPORTED) return;
    nativeReloadPending = true;
    void renewal?.renewNow();
  };

  const startNative = () => {
    if (disposed || !video.canPlayType(NATIVE_HLS_TYPE)) return;
    native = true;
    if (renewal) video.addEventListener("error", onNativeError);
    video.src = url;
  };

  void loadHls()
    .then((Hls) => {
      if (disposed) return;
      if (!Hls.isSupported()) {
        startNative();
        return;
      }
      const hls = new Hls(renewal ? {
        xhrSetup: (xhr, requestUrl) => {
          const target = withCurrentStreamToken(requestUrl, currentUrl);
          if (target !== requestUrl) xhr.open("GET", target, true);
        },
      } : undefined);
      player = hls;
      if (renewal) {
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.type !== Hls.ErrorTypes.NETWORK_ERROR) return;
          const status = errorStatus(data);
          if (status !== 401 && status !== 403) return;
          hlsReloadAt ??= video.currentTime;
          void renewal.renewNow();
        });
      }
      hls.loadSource(url);
      hls.attachMedia(video);
    })
    .catch(() => startNative());

  return () => {
    disposed = true;
    renewal?.stop();
    player?.destroy();
    player = null;
    if (native && renewal) video.removeEventListener("error", onNativeError);
  };
}
