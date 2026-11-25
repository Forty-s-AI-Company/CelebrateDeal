import {
  createSignedPlaybackRenewal,
  markSourceSwapPlay,
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
  fatal?: boolean;
  response?: { code?: number };
  networkDetails?: unknown;
};

export type HlsConstructor = {
  isSupported: () => boolean;
  Events: { ERROR: string; FRAG_LOADED?: string };
  ErrorTypes: { NETWORK_ERROR: string };
  new (config?: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void }): HlsPlayer;
};

/** The part of `document` the stall recovery reads (injectable for tests). */
export type PlaybackVisibility = {
  readonly hidden: boolean;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
};

const NATIVE_HLS_TYPE = "application/vnd.apple.mpegurl";
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

/** First automatic retry after a failed hls.js recovery attempt; doubles per attempt. */
export const HLS_STALL_RETRY_BASE_MS = 2_000;
/** Cap of the automatic hls.js recovery interval. */
export const HLS_STALL_RETRY_MAX_MS = 30_000;
/** Each delay is shortened by up to this fraction so stalled viewers do not retry in lockstep. */
export const HLS_STALL_RETRY_JITTER = 0.25;
/** Automatic attempts per stall; after that only a viewer play, the tab showing or a renewed token retries. */
export const HLS_STALL_MAX_AUTO_ATTEMPTS = 20;
/** The retry backoff starts from zero again only after loading stayed healthy this long. */
export const HLS_STALL_BACKOFF_RESET_MS = 60_000;
/** A retry from a viewer play or the tab showing waits at least this long after the previous attempt. */
export const HLS_STALL_MANUAL_MIN_GAP_MS = 1_000;

/**
 * Delay before recovery attempt number `level` of a stall: 0 for the first one, then
 * 2 s doubling up to 30 s, each shortened by a random 0–25 %.
 */
export function hlsStallRetryDelayMs(level: number, random: () => number = Math.random) {
  if (level <= 0) return 0;
  const base = Math.min(HLS_STALL_RETRY_MAX_MS, HLS_STALL_RETRY_BASE_MS * 2 ** Math.min(level - 1, 10));
  const jitter = Math.min(1, Math.max(0, random()));
  return Math.round(base * (1 - HLS_STALL_RETRY_JITTER * jitter));
}

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

function defaultVisibility(): PlaybackVisibility | null {
  return typeof document === "undefined" ? null : document;
}

const defaultTimers: RenewalTimers = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type HlsStall = {
  startedAt: number;
  wasPlaying: boolean;
  authError: boolean;
  autoAttempts: number;
  timer: unknown;
  attempting: boolean;
  waitingForVisibility: boolean;
};

/**
 * Attaches an HLS manifest to a video element and returns its cleanup.
 *
 * hls.js is preferred whenever `Hls.isSupported()`; native HLS is only the
 * fallback. With `expiresInSeconds` (an F-093 signed Stream URL) the source is
 * renewed through `fetchSource` (the admission-checked playback-source
 * endpoint) before the token lapses, and immediately when playback hits an
 * expired-token response (hls.js NETWORK_ERROR 401／403, or a native media
 * network／source error), after which loading resumes at the current position.
 *
 * hls.js does not retry 4xx responses and stops loading on a fatal network
 * error, so a rejection that outlasts one renewal (every Stream request
 * refused for a while) would otherwise stall until the next scheduled
 * renewal. While stalled, recovery is retried with a jittered backoff
 * (at once, then 2, 4, 8, 16 and every 30 s, at most 20 automatic attempts per
 * stall). After a 401／403 each attempt renews first (still limited by the
 * renewal's own minimum interval) and then calls `startLoad` at the current
 * position. A paused player in a hidden tab waits for the tab to show; a viewer
 * play, the tab showing again or a renewed token retries at once. A loaded
 * fragment ends the stall.
 */
export function attachHlsPlayback({
  video,
  url,
  expiresInSeconds,
  fetchSource,
  loadHls = importHls,
  timers = defaultTimers,
  now = () => Date.now(),
  random = Math.random,
  visibility = defaultVisibility(),
}: {
  video: HTMLVideoElement;
  url: string;
  expiresInSeconds?: number;
  fetchSource: () => Promise<RenewablePlaybackSource | null>;
  loadHls?: () => Promise<HlsConstructor>;
  timers?: RenewalTimers;
  now?: () => number;
  random?: () => number;
  visibility?: PlaybackVisibility | null;
}) {
  let disposed = false;
  let currentUrl = url;
  let native = false;
  let player: HlsPlayer | null = null;
  let nativeReloadPending = false;
  let cancelNativeSwap: (() => void) | null = null;

  // hls.js stall recovery: `stall` is set while a network error has stopped loading.
  let stall: HlsStall | null = null;
  // Carried across stalls until loading stays healthy for HLS_STALL_BACKOFF_RESET_MS,
  // so a failure that keeps coming back right after a success cannot loop without delay.
  let backoffLevel = 0;
  let lastStallEndedAt = Number.NEGATIVE_INFINITY;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let lastSourceAppliedAt = Number.NEGATIVE_INFINITY;

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
        lastSourceAppliedAt = now();
        if (native) {
          // Native HLS needs a new src; after a media error it reloads even for the same URL.
          if (changed || nativeReloadPending) {
            cancelNativeSwap?.();
            cancelNativeSwap = swapNativePlaybackSource(video, nextUrl);
          }
          nativeReloadPending = false;
          return;
        }
        // hls.js picks the new token up in xhrSetup on every later request, so a
        // stalled player only restarts loading. A renewal outside a recovery
        // attempt (scheduled, or the retry of a failed one) retries at once.
        if (stall && !stall.attempting) {
          clearStallTimer();
          void attemptRecovery(false);
        }
      },
    })
    : null;

  function clearStallTimer() {
    if (stall && stall.timer !== null) {
      timers.clearTimeout(stall.timer);
      stall.timer = null;
    }
  }

  function scheduleAttempt() {
    const current = stall;
    if (!current || disposed || current.attempting || current.timer !== null) return;
    if (current.autoAttempts >= HLS_STALL_MAX_AUTO_ATTEMPTS) return;
    current.timer = timers.setTimeout(() => {
      current.timer = null;
      current.autoAttempts += 1;
      void attemptRecovery(true);
    }, hlsStallRetryDelayMs(backoffLevel, random));
  }

  async function attemptRecovery(renew: boolean) {
    const current = stall;
    if (!current || disposed || !player || current.attempting) return;
    if (visibility?.hidden && video.paused) {
      // A paused player in a background tab needs nothing loaded; retry when the tab shows.
      current.waitingForVisibility = true;
      return;
    }
    current.waitingForVisibility = false;
    current.attempting = true;
    lastAttemptAt = now();
    backoffLevel += 1;
    let usable = true;
    if (renew && current.authError && renewal) {
      const renewed = await renewal.renewNow();
      // A refused or rate-limited renewal still leaves a usable token when one arrived
      // during this stall; otherwise restarting would only meet the same 401／403.
      usable = renewed !== null || lastSourceAppliedAt >= current.startedAt;
    }
    current.attempting = false;
    if (disposed || stall !== current || !player) return;
    if (!usable) {
      scheduleAttempt();
      return;
    }
    // No loadSource(): in hls.js it re-attaches the media and resets the position to 0.
    player.startLoad(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    if (current.wasPlaying && video.paused) {
      markSourceSwapPlay(video);
      void video.play()?.catch(() => undefined);
    }
  }

  const onHlsError = (data: HlsErrorData, networkErrorType: string) => {
    if (data.type !== networkErrorType) return;
    const status = errorStatus(data);
    const authError = status === 401 || status === 403;
    // hls.js retries other non-fatal network errors itself.
    if (!authError && data.fatal !== true) return;
    if (!stall) {
      const at = now();
      if (at - lastStallEndedAt >= HLS_STALL_BACKOFF_RESET_MS) backoffLevel = 0;
      stall = {
        startedAt: at,
        wasPlaying: !video.paused,
        authError,
        autoAttempts: 0,
        timer: null,
        attempting: false,
        waitingForVisibility: false,
      };
      if (backoffLevel === 0) {
        void attemptRecovery(true);
        return;
      }
    } else if (authError) {
      stall.authError = true;
    }
    // The previous attempt failed (errors during an attempt or with a retry pending are absorbed).
    scheduleAttempt();
  };

  const onFragLoaded = () => {
    if (!stall) return;
    clearStallTimer();
    stall = null;
    lastStallEndedAt = now();
  };

  const retryOnViewerAction = () => {
    const current = stall;
    if (!current || current.attempting || disposed) return;
    if (now() - lastAttemptAt < HLS_STALL_MANUAL_MIN_GAP_MS) {
      // Too soon (this is also our own play() right after an attempt): keep the backoff.
      if (current.waitingForVisibility) scheduleAttempt();
      return;
    }
    clearStallTimer();
    void attemptRecovery(true);
  };

  const onPlay = () => {
    if (!stall) return;
    stall.wasPlaying = true;
    retryOnViewerAction();
  };
  const onPause = () => {
    // A viewer pause during a stall must not be undone by a later attempt.
    if (stall) stall.wasPlaying = false;
  };
  const onVisibilityChange = () => {
    if (!visibility?.hidden && stall?.waitingForVisibility) retryOnViewerAction();
  };

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

  let stallListenersAttached = false;

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
        hls.on(Hls.Events.ERROR, (_event, data) => onHlsError(data, Hls.ErrorTypes.NETWORK_ERROR));
        if (Hls.Events.FRAG_LOADED) hls.on(Hls.Events.FRAG_LOADED, onFragLoaded);
        video.addEventListener("play", onPlay);
        video.addEventListener("pause", onPause);
        visibility?.addEventListener("visibilitychange", onVisibilityChange);
        stallListenersAttached = true;
      }
      hls.loadSource(url);
      hls.attachMedia(video);
    })
    .catch(() => startNative());

  return () => {
    disposed = true;
    renewal?.stop();
    clearStallTimer();
    stall = null;
    cancelNativeSwap?.();
    player?.destroy();
    player = null;
    if (native && renewal) video.removeEventListener("error", onNativeError);
    if (stallListenersAttached) {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      visibility?.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}
