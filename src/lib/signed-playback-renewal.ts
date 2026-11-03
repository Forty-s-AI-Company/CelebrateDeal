/**
 * F-093：簽章播放網址的客戶端續期（瀏覽器可用，不含任何金鑰）。
 *
 * `/api/live-playback-source` 在簽章啟用時回傳 `expiresInSeconds`。播放器在
 * token 到期前重新呼叫同一個端點（伺服器會再做一次入場檢查）取得新網址：
 * - hls.js：以 `xhrSetup` 把之後每個 manifest／segment 請求的 token 換成最新的，播放不中斷。
 * - Safari 原生 HLS（僅在 hls.js 不支援時）：換 `src` 後補回播放位置。
 * 續期失敗時只要播放器還掛著就持續退避重試；播放中遇到 401／403 時立即續期。
 */

/** 到期前多久開始續期。 */
export const SIGNED_PLAYBACK_RENEWAL_LEAD_MS = 2 * 60_000;
/** 續期最短間隔，避免短效 token（例如回放即將截止）造成密集請求。 */
export const SIGNED_PLAYBACK_MIN_RENEWAL_DELAY_MS = 5_000;
/** 續期失敗後的第一次重試間隔，之後倍增。 */
export const SIGNED_PLAYBACK_RETRY_BASE_MS = 15_000;
/** 續期失敗重試間隔上限。 */
export const SIGNED_PLAYBACK_RETRY_MAX_MS = 5 * 60_000;
/** 播放錯誤觸發的立即續期，兩次之間至少間隔。 */
export const SIGNED_PLAYBACK_MIN_RECOVERY_INTERVAL_MS = 5_000;

export function signedPlaybackRenewalDelayMs(expiresInSeconds: number) {
  const lifetimeMs = Math.max(0, expiresInSeconds) * 1_000;
  const delay = lifetimeMs > SIGNED_PLAYBACK_RENEWAL_LEAD_MS * 2
    ? lifetimeMs - SIGNED_PLAYBACK_RENEWAL_LEAD_MS
    : lifetimeMs / 2;
  return Math.max(SIGNED_PLAYBACK_MIN_RENEWAL_DELAY_MS, Math.floor(delay));
}

export function signedPlaybackRetryDelayMs(failures: number) {
  return Math.min(SIGNED_PLAYBACK_RETRY_MAX_MS, SIGNED_PLAYBACK_RETRY_BASE_MS * 2 ** Math.max(0, Math.min(failures, 10)));
}

export type RenewablePlaybackSource = {
  playbackUrl: string;
  expiresInSeconds?: number;
};

export type RenewalTimers = {
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const defaultTimers: RenewalTimers = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type SignedPlaybackRenewal = {
  /**
   * 立即續期（播放遇到 401／403 時）。進行中的續期會共用；距上一次立即續期不到
   * `SIGNED_PLAYBACK_MIN_RECOVERY_INTERVAL_MS` 時回傳 null。成功時回傳新網址。
   */
  renewNow: () => Promise<string | null>;
  stop: () => void;
};

/**
 * 依 `expiresInSeconds` 排程續期。成功時呼叫 `applySource` 並依新效期排下一次；
 * 回應沒有 `expiresInSeconds`（伺服器已停用簽章）時套用新網址後停止排程；
 * 失敗時以 15 秒起倍增、上限 5 分鐘持續重試，直到 `stop()`。
 */
export function createSignedPlaybackRenewal({
  expiresInSeconds,
  fetchSource,
  applySource,
  timers = defaultTimers,
  now = () => Date.now(),
}: {
  expiresInSeconds: number;
  fetchSource: () => Promise<RenewablePlaybackSource | null>;
  applySource: (playbackUrl: string) => void;
  timers?: RenewalTimers;
  now?: () => number;
}): SignedPlaybackRenewal {
  let disposed = false;
  let handle: unknown = null;
  let failures = 0;
  let inFlight: Promise<string | null> | null = null;
  let lastRecoveryAt = Number.NEGATIVE_INFINITY;

  const clear = () => {
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
  };

  const schedule = (delay: number) => {
    clear();
    if (disposed) return;
    handle = timers.setTimeout(() => {
      handle = null;
      void run();
    }, delay);
  };

  const run = (): Promise<string | null> => {
    if (inFlight) return inFlight;
    clear();
    inFlight = (async () => {
      let next: RenewablePlaybackSource | null = null;
      try {
        next = await fetchSource();
      } catch {
        next = null;
      }
      if (disposed) return null;
      if (next?.playbackUrl) {
        failures = 0;
        applySource(next.playbackUrl);
        if (typeof next.expiresInSeconds === "number" && next.expiresInSeconds > 0) {
          schedule(signedPlaybackRenewalDelayMs(next.expiresInSeconds));
        }
        return next.playbackUrl;
      }
      schedule(signedPlaybackRetryDelayMs(failures));
      failures += 1;
      return null;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  if (expiresInSeconds > 0) schedule(signedPlaybackRenewalDelayMs(expiresInSeconds));

  return {
    renewNow: () => {
      if (disposed) return Promise.resolve(null);
      if (inFlight) return inFlight;
      if (now() - lastRecoveryAt < SIGNED_PLAYBACK_MIN_RECOVERY_INTERVAL_MS) return Promise.resolve(null);
      lastRecoveryAt = now();
      return run();
    },
    stop: () => {
      disposed = true;
      clear();
    },
  };
}

const JWT_PATH_SEGMENT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function isStreamDeliveryHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "videodelivery.net" || /^customer-[a-z0-9]+\.cloudflarestream\.com$/.test(host);
}

/**
 * 把 Cloudflare Stream 請求網址第一段的舊 token 換成 `currentPlaybackUrl` 的 token。
 * 非 Stream 網址或第一段不是 token 時原樣回傳。
 */
export function withCurrentStreamToken(requestUrl: string, currentPlaybackUrl: string) {
  let request: URL;
  let current: URL;
  try {
    request = new URL(requestUrl);
    current = new URL(currentPlaybackUrl);
  } catch {
    return requestUrl;
  }
  if (!isStreamDeliveryHost(request.hostname) || !isStreamDeliveryHost(current.hostname)) return requestUrl;
  const requestSegments = request.pathname.split("/");
  const currentToken = current.pathname.split("/")[1];
  if (!requestSegments[1] || !currentToken) return requestUrl;
  if (!JWT_PATH_SEGMENT.test(requestSegments[1]) || !JWT_PATH_SEGMENT.test(currentToken)) return requestUrl;
  if (requestSegments[1] === currentToken && request.host === current.host) return requestUrl;
  requestSegments[1] = currentToken;
  request.pathname = requestSegments.join("/");
  request.host = current.host;
  return request.toString();
}

const sourceSwapPlays = new WeakSet<object>();

/**
 * 換網址造成的 `play` 事件不是觀眾按下播放；`onPlay` 用這個判斷是否略過
 * `video_play` 分析事件。呼叫一次後清除標記。
 */
export function consumeSourceSwapPlay(video: object) {
  return sourceSwapPlays.delete(video);
}

/** Safari 原生 HLS：換網址後回到原播放位置，並維持播放／暫停狀態。 */
export function swapNativePlaybackSource(video: HTMLVideoElement, nextUrl: string) {
  const resumeAt = video.currentTime;
  const wasPaused = video.paused;
  const restore = () => {
    video.removeEventListener("loadedmetadata", restore);
    if (resumeAt > 0 && Number.isFinite(resumeAt)) {
      try {
        video.currentTime = resumeAt;
      } catch {
        // 直播視窗已移出原位置時，交給播放器的直播位置邏輯。
      }
    }
    if (wasPaused) return;
    sourceSwapPlays.add(video);
    void video.play()?.catch(() => {
      sourceSwapPlays.delete(video);
    });
  };
  video.addEventListener("loadedmetadata", restore);
  video.src = nextUrl;
}
