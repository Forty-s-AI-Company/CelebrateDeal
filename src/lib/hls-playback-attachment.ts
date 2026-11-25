import {
  consumeSourceSwapPlay,
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
  details?: string;
  fatal?: boolean;
  response?: { code?: number };
  networkDetails?: unknown;
};

export type HlsConstructor = {
  isSupported: () => boolean;
  Events: { ERROR: string; FRAG_LOADED?: string; MANIFEST_PARSED?: string };
  ErrorTypes: { NETWORK_ERROR: string };
  ErrorDetails?: { MANIFEST_LOAD_ERROR?: string; MANIFEST_LOAD_TIMEOUT?: string };
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
const MANIFEST_LOAD_ERROR = "manifestLoadError";
const MANIFEST_LOAD_TIMEOUT = "manifestLoadTimeOut";

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
 * A token renewed during a stall is reused without renewing again for at most half its
 * lifetime, capped at this (preview and promo tokens last up to 4 hours).
 */
export const HLS_STALL_TOKEN_REUSE_MAX_MS = 120_000;
/** Failed attempts on the same renewed token after which the next attempt renews anyway. */
export const HLS_STALL_TOKEN_REUSE_MAX_FAILURES = 3;

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
  authError: boolean;
  manifestError: boolean;
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
 * stall). After a 401／403 an attempt first renews (limited by the renewal's
 * own minimum interval) unless this stall already got a token that is still
 * fresh (renewed less than min(half its lifetime, 2 min) ago and failed fewer
 * than 3 attempts); an expired one is never used. It then calls `startLoad` at the current
 * position, or `loadSource` when the manifest itself never loaded (`startLoad`
 * does nothing before hls.js has levels). A paused player in a hidden tab waits
 * for the tab to show; a viewer play, the tab showing again or a renewed token
 * retries at once. A loaded fragment ends the stall. Playback is only resumed
 * when the viewer's last own play／pause was a play.
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
  // Until then an attempt may reuse the applied token instead of renewing (see HLS_STALL_TOKEN_REUSE_MAX_MS).
  let appliedTokenReuseUntil = Number.NEGATIVE_INFINITY;
  // The applied token's own expiry; after it the token is useless even without a renewal.
  let appliedTokenExpiresAt = Number.POSITIVE_INFINITY;
  // Recovery attempts that loaded with the applied token (each further attempt means it failed).
  let attemptsOnAppliedToken = 0;
  let fetchedLifetimeMs: number | null = null;
  let manifestParsed = false;
  let manifestLoadErrors: ReadonlySet<string> = new Set([MANIFEST_LOAD_ERROR, MANIFEST_LOAD_TIMEOUT]);
  // The viewer's last own play／pause. MSE stalls keep `paused` false, so the element state
  // alone cannot tell a stall from a pause whose event is still queued.
  let viewerWantsPlay = !video.paused;
  let selfPlayPending = false;
  let selfPlayTicket = 0;
  let selfPauseExpected = false;
  let selfPauseTimer: unknown = null;

  const trackedFetchSource = async () => {
    const next = await fetchSource();
    fetchedLifetimeMs = typeof next?.expiresInSeconds === "number" && next.expiresInSeconds > 0
      ? next.expiresInSeconds * 1_000
      : null;
    return next;
  };

  const renewal: SignedPlaybackRenewal | null = expiresInSeconds && expiresInSeconds > 0
    ? createSignedPlaybackRenewal({
      expiresInSeconds,
      fetchSource: trackedFetchSource,
      timers,
      now,
      applySource: (nextUrl) => {
        if (!isHlsManifestUrl(nextUrl)) return;
        const changed = nextUrl !== currentUrl;
        currentUrl = nextUrl;
        lastSourceAppliedAt = now();
        appliedTokenReuseUntil = fetchedLifetimeMs === null
          ? lastSourceAppliedAt
          : lastSourceAppliedAt + Math.min(fetchedLifetimeMs / 2, HLS_STALL_TOKEN_REUSE_MAX_MS);
        appliedTokenExpiresAt = fetchedLifetimeMs === null ? Number.POSITIVE_INFINITY : lastSourceAppliedAt + fetchedLifetimeMs;
        attemptsOnAppliedToken = 0;
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

  function resumeIfViewerWantsPlay() {
    if (!viewerWantsPlay || !video.paused) return;
    const ticket = ++selfPlayTicket;
    selfPlayPending = true;
    markSourceSwapPlay(video);
    void video.play()?.catch(() => {
      // Only the latest resume whose play event has not fired yet owns the mark: an older
      // play() rejected (AbortError) by a later reload must not clear the newer one's mark.
      if (ticket !== selfPlayTicket || !selfPlayPending) return;
      selfPlayPending = false;
      consumeSourceSwapPlay(video);
    });
  }

  function clearSelfPauseExpectation() {
    selfPauseExpected = false;
    if (selfPauseTimer !== null) timers.clearTimeout(selfPauseTimer);
    selfPauseTimer = null;
  }

  function reloadManifest(target: HlsPlayer) {
    const wasPaused = video.paused;
    target.loadSource(currentUrl);
    // A reload that re-creates the MediaSource pauses the element (HTML load algorithm); some
    // engines also queue a pause event for it, which is not the viewer's. Only when the element
    // really flipped to paused here, and only until the next task: a real pause afterwards counts.
    if (!wasPaused && video.paused) {
      clearSelfPauseExpectation();
      selfPauseExpected = true;
      selfPauseTimer = timers.setTimeout(() => {
        selfPauseTimer = null;
        selfPauseExpected = false;
      }, 0);
    }
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
    backoffLevel += 1;
    // A token renewed during this stall and not yet expired (after the replay deadline the
    // renewals fail and the last token lapses: stop loading with it).
    const stallTokenValid = () => lastSourceAppliedAt >= current.startedAt && now() < appliedTokenExpiresAt;
    // Reuse it without renewing while it is fresh and has not failed repeatedly (a bad fresh
    // token, e.g. during a key rotation, is replaced after a few attempts).
    const reuseStallToken = stallTokenValid() && now() < appliedTokenReuseUntil
      && attemptsOnAppliedToken < HLS_STALL_TOKEN_REUSE_MAX_FAILURES;
    let usable = true;
    try {
      if (renew && current.authError && renewal && !reuseStallToken) {
        const renewed = await renewal.renewNow();
        // A refused or rate-limited renewal still leaves a usable token when a valid one arrived
        // during this stall; otherwise restarting would only meet the same 401／403.
        usable = renewed !== null || stallTokenValid();
      }
    } catch {
      usable = stallTokenValid();
    } finally {
      current.attempting = false;
      // Measured from the end, so a slow renewal does not shorten the gap before a viewer retry.
      lastAttemptAt = now();
    }
    if (disposed || stall !== current || !player) return;
    if (!usable) {
      scheduleAttempt();
      return;
    }
    attemptsOnAppliedToken += 1;
    if (!manifestParsed || current.manifestError) {
      // Before hls.js has levels startLoad() only flags a later start; the manifest must be
      // requested again (nothing has played yet, so the position is 0 anyway).
      reloadManifest(player);
    } else {
      // No loadSource() here: it re-attaches the media and resets the position to 0.
      player.startLoad(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    }
    resumeIfViewerWantsPlay();
  }

  const onHlsError = (data: HlsErrorData, networkErrorType: string) => {
    if (data.type !== networkErrorType) return;
    const status = errorStatus(data);
    const authError = status === 401 || status === 403;
    // hls.js retries other non-fatal network errors itself.
    if (!authError && data.fatal !== true) return;
    const manifestError = typeof data.details === "string" && manifestLoadErrors.has(data.details);
    if (!stall) {
      const at = now();
      if (at - lastStallEndedAt >= HLS_STALL_BACKOFF_RESET_MS) backoffLevel = 0;
      stall = {
        startedAt: at,
        authError,
        manifestError,
        autoAttempts: 0,
        timer: null,
        attempting: false,
        waitingForVisibility: false,
      };
      if (backoffLevel === 0) {
        void attemptRecovery(true);
        return;
      }
    } else {
      if (authError) stall.authError = true;
      if (manifestError) stall.manifestError = true;
    }
    // The previous attempt failed (errors during an attempt or with a retry pending are absorbed).
    scheduleAttempt();
  };

  const onManifestParsed = () => {
    manifestParsed = true;
    if (stall) stall.manifestError = false;
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
      // Too soon: keep the backoff running.
      if (current.waitingForVisibility) scheduleAttempt();
      return;
    }
    clearStallTimer();
    void attemptRecovery(true);
  };

  const onPlay = () => {
    if (selfPlayPending) {
      // Our own resume after an attempt: neither a viewer intent nor a reason to retry.
      selfPlayPending = false;
      return;
    }
    viewerWantsPlay = true;
    retryOnViewerAction();
  };
  const onPause = () => {
    if (selfPauseExpected) {
      clearSelfPauseExpectation();
      return;
    }
    // A viewer pause during a stall must not be undone by a later attempt.
    viewerWantsPlay = false;
  };
  const onVisibilityChange = () => {
    // Also after the automatic attempts are used up: showing the tab retries a live stall.
    if (!visibility?.hidden && stall) retryOnViewerAction();
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
        manifestLoadErrors = new Set([
          Hls.ErrorDetails?.MANIFEST_LOAD_ERROR ?? MANIFEST_LOAD_ERROR,
          Hls.ErrorDetails?.MANIFEST_LOAD_TIMEOUT ?? MANIFEST_LOAD_TIMEOUT,
        ]);
        // Without the event the manifest state is unknown; rely on the error details alone.
        manifestParsed = !Hls.Events.MANIFEST_PARSED;
        hls.on(Hls.Events.ERROR, (_event, data) => onHlsError(data, Hls.ErrorTypes.NETWORK_ERROR));
        if (Hls.Events.MANIFEST_PARSED) hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
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
    clearSelfPauseExpectation();
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
