/**
 * F-093：簽章播放網址的客戶端續期（瀏覽器可用，不含任何金鑰）。
 *
 * `/api/live-playback-source` 在簽章啟用時回傳 `expiresInSeconds`。播放器在
 * token 到期前重新呼叫同一個端點（伺服器會再做一次入場檢查）取得新網址：
 * - hls.js：以 `xhrSetup` 把之後每個 manifest／segment 請求的 token 換成最新的，播放不中斷。
 * - Safari 原生 HLS：換 `src` 後補回播放位置。
 */

/** 到期前多久開始續期。 */
export const SIGNED_PLAYBACK_RENEWAL_LEAD_MS = 2 * 60_000;
/** 續期最短間隔，避免短效 token（例如回放即將截止）造成密集請求。 */
export const SIGNED_PLAYBACK_MIN_RENEWAL_DELAY_MS = 5_000;
/** 續期失敗後的重試間隔；只在原 token 仍有效時重試。 */
export const SIGNED_PLAYBACK_RETRY_DELAY_MS = 30_000;

export function signedPlaybackRenewalDelayMs(expiresInSeconds: number) {
  const lifetimeMs = Math.max(0, expiresInSeconds) * 1_000;
  const delay = lifetimeMs > SIGNED_PLAYBACK_RENEWAL_LEAD_MS * 2
    ? lifetimeMs - SIGNED_PLAYBACK_RENEWAL_LEAD_MS
    : lifetimeMs / 2;
  return Math.max(SIGNED_PLAYBACK_MIN_RENEWAL_DELAY_MS, Math.floor(delay));
}

export type RenewablePlaybackSource = {
  playbackUrl: string;
  expiresInSeconds?: number;
};

type Timers = {
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

/**
 * 依 `expiresInSeconds` 排程續期；回傳取消函式。續期回應沒有
 * `expiresInSeconds`（伺服器已停用簽章）時套用新網址後停止排程；
 * 回應失敗時只在原 token 到期前重試，到期後交給入場輪詢處理。
 */
export function scheduleSignedPlaybackRenewal({
  expiresInSeconds,
  fetchSource,
  applySource,
  timers = {
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  now = () => Date.now(),
}: {
  expiresInSeconds: number;
  fetchSource: () => Promise<RenewablePlaybackSource | null>;
  applySource: (playbackUrl: string) => void;
  timers?: Timers;
  now?: () => number;
}) {
  let disposed = false;
  let handle: unknown = null;
  let deadline = now() + expiresInSeconds * 1_000;

  const schedule = (delay: number) => {
    handle = timers.setTimeout(() => {
      handle = null;
      void renew();
    }, delay);
  };

  const renew = async () => {
    let next: RenewablePlaybackSource | null = null;
    try {
      next = await fetchSource();
    } catch {
      next = null;
    }
    if (disposed) return;
    if (next?.playbackUrl) {
      applySource(next.playbackUrl);
      if (typeof next.expiresInSeconds !== "number" || !(next.expiresInSeconds > 0)) return;
      deadline = now() + next.expiresInSeconds * 1_000;
      schedule(signedPlaybackRenewalDelayMs(next.expiresInSeconds));
      return;
    }
    if (now() + SIGNED_PLAYBACK_RETRY_DELAY_MS < deadline) schedule(SIGNED_PLAYBACK_RETRY_DELAY_MS);
  };

  if (expiresInSeconds > 0) schedule(signedPlaybackRenewalDelayMs(expiresInSeconds));
  return () => {
    disposed = true;
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
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
    if (!wasPaused) void video.play()?.catch(() => undefined);
  };
  video.addEventListener("loadedmetadata", restore);
  video.src = nextUrl;
}
