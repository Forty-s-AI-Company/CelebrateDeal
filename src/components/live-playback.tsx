"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Image from "next/image";
import { ArrowLeft, Maximize2, Megaphone, MessageCircle, Minimize2, Package, Pause, Play, Send, ShoppingBag, Sparkles, Volume2, VolumeX } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { LeadForm } from "@/components/lead-form";
import { LiveChatPanel } from "@/components/live-chat-panel";
import { trackClientAnalytics } from "@/lib/client-analytics";
import { formatCurrency } from "@/lib/format";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { postStreamUsageHeartbeat, type StreamUsageHeartbeat } from "@/lib/stream-usage-client";
import { getOrCreateVisitorId } from "@/lib/visitor-id";
import type { ScheduledRuntimeMessage } from "@/lib/live-chat-contract";

const clientHeaders = {
  "Content-Type": "application/json",
  "X-CelebrateDeal-Client": "web",
};

export const DIRECT_ENTRY_ATTRIBUTION_ENDPOINT = "/api/affiliate-attribution/direct-entry";

const playbackPanels = [
  { key: "chat", label: "聊天", Icon: MessageCircle },
  { key: "products", label: "商品", Icon: Package },
  { key: "form", label: "報名", Icon: Send },
] as const;

export function isHlsPlaybackUrl(url: string | null) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.pathname.endsWith("/manifest/video.m3u8");
  } catch {
    return false;
  }
}

/** Keeps partner-page lineage in the shared playback click endpoint URL. */
export function affiliateClickEndpoint(sourcePageSlug: string | null) {
  const params = new URLSearchParams();
  if (sourcePageSlug) params.set("sourcePage", sourcePageSlug);
  const query = params.toString();
  return query ? `/api/affiliate-clicks?${query}` : "/api/affiliate-clicks";
}

export function shouldResetAffiliateAttribution(search: string) {
  const params = new URLSearchParams(search);
  return !params.get("ref")?.trim() && !params.get("sourcePage")?.trim();
}

/** Removes the bearer share token from the browser URL before external navigation or Referer generation. */
export function stripLiveShareFromUrl(value: string) {
  try {
    const url = new URL(value, "https://app.example.test");
    url.searchParams.delete("share");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

function useLiveQueryParam(name: string) {
  return useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get(name);
  }, [name]);
}

type LivePageData = {
  id: string;
  title: string;
  slug: string;
  status: string;
  description: string | null;
  accentCopy: string | null;
  heroImageUrl: string | null;
  /** Only used by direct component fixtures; public pages resolve this after admission. */
  videoUrl?: string | null;
  vendorId: string;
  admissionRequired?: boolean;
  /** Real viewer chat stays opt-in so isolated fixtures never start polling. */
  chatEnabled?: boolean;
  brand: {
    name: string;
    logoUrl: string | null;
    primaryColor: string;
    ctaColor: string;
  };
  form: null | {
    id: string;
    headline: string;
    description: string | null;
    fields: Array<{ key: string; label: string; type?: string; required?: boolean }>;
    submitLabel: string;
    successMessage: string;
  };
  formConfigurationUnavailable?: boolean;
  interactionEvents: Array<{
    id: string;
    eventType: string;
    triggerSec: number;
    title: string;
    message: string | null;
    productId: string | null;
    ctaLabel: string | null;
    ctaUrl: string | null;
    role: null | {
      name: string;
      avatarUrl: string | null;
      label: string;
    };
  }>;
  scheduledMessages?: ScheduledRuntimeMessage[];
  products: Array<{
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    compareAtCents: number | null;
    currency: string;
    imageUrl: string | null;
    checkoutUrl: string | null;
    offerLabel: string | null;
  }>;
};

type CheckoutResponse = {
  checkoutUrl?: string | null;
  formAction?: string;
  formMethod?: "POST";
  formPayload?: Record<string, string>;
};

type LiveAdmissionStatus = "checking" | "admitted" | "blocked";

function secondsLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainSeconds).padStart(2, "0")}`;
}

export function useLiveAdmission({
  vendorId,
  liveId,
  admissionRequired,
  refreshKey,
}: {
  vendorId: string;
  liveId: string;
  admissionRequired: boolean;
  refreshKey: number;
}): LiveAdmissionStatus {
  const [admissionStatus, setAdmissionStatus] = useState<LiveAdmissionStatus>(admissionRequired ? "checking" : "admitted");

  useEffect(() => {
    if (!admissionRequired) return;

    let disposed = false;
    let requestInFlight = false;
    let activeController: AbortController | null = null;
    const requestAdmission = async (showChecking: boolean) => {
      if (requestInFlight) return;
      requestInFlight = true;
      if (showChecking) setAdmissionStatus("checking");
      const controller = new AbortController();
      activeController = controller;
      try {
        const response = await fetch("/api/live-admission", {
          method: "POST",
          headers: clientHeaders,
          body: JSON.stringify({ vendorId, liveId }),
          signal: controller.signal,
        });
        if (!disposed) setAdmissionStatus(response.ok ? "admitted" : "blocked");
      } catch {
        if (!disposed) setAdmissionStatus("blocked");
      } finally {
        if (activeController === controller) activeController = null;
        requestInFlight = false;
      }
    };

    void requestAdmission(true);
    const interval = window.setInterval(() => void requestAdmission(false), 30_000);
    return () => {
      disposed = true;
      activeController?.abort();
      window.clearInterval(interval);
    };
  }, [admissionRequired, liveId, refreshKey, vendorId]);

  useEffect(() => {
    if (!admissionRequired) return;
    return () => {
      void fetch("/api/live-admission", {
        method: "DELETE",
        headers: clientHeaders,
        body: JSON.stringify({ vendorId, liveId }),
        keepalive: true,
      }).catch(() => undefined);
    };
  }, [admissionRequired, liveId, vendorId]);

  return admissionStatus;
}

async function fetchLivePlaybackSource(vendorId: string, liveId: string) {
  const query = new URLSearchParams({ vendorId, liveId });
  const response = await fetch(`/api/live-playback-source?${query.toString()}`, { headers: clientHeaders });
  if (!response.ok) return null;

  const payload = await response.json() as { playbackUrl?: unknown };
  return typeof payload.playbackUrl === "string" ? parseSafeExternalHttpUrl(payload.playbackUrl) : null;
}

export function useLivePlaybackSource(live: LivePageData, admissionStatus: LiveAdmissionStatus) {
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(() => live.videoUrl ?? null);

  useEffect(() => {
    // Public pages resolve the source only after the server-side admission
    // cookie is established. The optional prop remains for local fixtures.
    if (!live.admissionRequired || live.videoUrl || admissionStatus !== "admitted") return;

    let disposed = false;
    void fetchLivePlaybackSource(live.vendorId, live.id)
      .then((safeUrl) => {
        if (!disposed) setPlaybackUrl(safeUrl);
      })
      .catch(() => {
        if (!disposed) setPlaybackUrl(null);
      });

    return () => {
      disposed = true;
    };
  }, [admissionStatus, live.admissionRequired, live.id, live.vendorId, live.videoUrl]);

  return admissionStatus === "admitted" ? playbackUrl : null;
}

function LiveBrandHeader({ live }: { live: LivePageData }) {
  return (
    <header className="relative z-10 flex items-center justify-between gap-3 p-4">
      <div className="flex min-w-0 items-center gap-3 rounded-full bg-black/35 px-3 py-2 backdrop-blur-md">
        {live.brand.logoUrl ? <Image src={live.brand.logoUrl} alt="" width={34} height={34} unoptimized className="h-8 w-8 rounded-full object-cover" /> : null}
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-white/75">{live.brand.name}</p>
          <h1 className="truncate text-sm font-bold">{live.title}</h1>
        </div>
      </div>
      <div className="rounded-full bg-red-700 px-3 py-1 text-xs font-black tracking-wide shadow-lg shadow-red-950/40">
        {getLiveStatusLabel(live.status)}
      </div>
    </header>
  );
}

function LiveAdmissionOverlay({ status }: { status: LiveAdmissionStatus }) {
  if (status === "admitted") return null;
  return (
    <div role="status" className="absolute inset-0 z-50 grid place-items-center bg-slate-950/85 p-6 text-center">
      <div className="max-w-xs rounded-2xl border border-white/15 bg-black/45 p-5 backdrop-blur-md">
        <p className="text-base font-black">{status === "checking" ? "正在確認直播容量…" : "直播目前暫停服務"}</p>
        <p className="mt-2 text-sm text-white/75">請稍後再試；目前不會建立播放、報名或購買來源。</p>
      </div>
    </div>
  );
}

function StreamQuotaAlert() {
  return (
    <div
      id="stream-quota-alert"
      role="alert"
      aria-live="assertive"
      className="pointer-events-none absolute left-4 right-4 top-20 z-40 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-slate-950 shadow-2xl"
    >
      <p className="font-black">直播播放額度已用完</p>
      <p className="mt-1 text-sm leading-6 text-slate-700">播放已暫停。請聯絡主辦人調整直播額度，完成後再重新整理頁面。</p>
    </div>
  );
}

export const STREAM_USAGE_RETRY_DELAYS_MS = [500, 1_000, 2_000] as const;

export function getStreamUsageRetryDelayMs(eventId: string, attemptIndex: number) {
  const baseDelay = STREAM_USAGE_RETRY_DELAYS_MS[attemptIndex];
  if (baseDelay === undefined) return null;

  // Event IDs are random per viewer, so this deterministic 0-25% jitter spreads
  // retries without changing the idempotency key across attempts.
  let hash = 2_166_136_261;
  for (const character of `${eventId}:${attemptIndex}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  const jitterWindow = Math.floor(baseDelay * 0.25);
  return baseDelay + ((hash >>> 0) % (jitterWindow + 1));
}

export function getLiveStatusLabel(status: string) {
  if (status === "live") return "直播中";
  if (status === "scheduled") return "即將直播";
  if (status === "ended") return "精彩回放";
  return "直播";
}

function useStreamUsageTracker({
  vendorId,
  liveId,
  sourcePageSlug,
  liveShareCode,
  onQuotaExhausted,
}: {
  vendorId: string;
  liveId: string;
  sourcePageSlug: string | null;
  liveShareCode: string | null;
  onQuotaExhausted: () => void;
}) {
  const lastPlaybackPositionRef = useRef<number | null>(null);
  const usageAccumulatorRef = useRef(0);
  const usageFlushInFlightRef = useRef(false);
  const quotaExhaustedRef = useRef(false);
  const pendingHeartbeatRef = useRef<StreamUsageHeartbeat | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const retrySuspendedRef = useRef(false);
  const disposedRef = useRef(false);
  const heartbeatAbortControllerRef = useRef<AbortController | null>(null);

  function clearRetryTimer() {
    if (retryTimerRef.current === null) return;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }

  function scheduleRetry() {
    if (disposedRef.current || quotaExhaustedRef.current || retryTimerRef.current !== null) return;
    const eventId = pendingHeartbeatRef.current?.eventId;
    const delay = eventId ? getStreamUsageRetryDelayMs(eventId, retryAttemptRef.current) : null;
    if (delay === null) {
      retrySuspendedRef.current = true;
      return;
    }
    retryAttemptRef.current += 1;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void flushStreamUsage(true);
    }, delay);
  }

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      clearRetryTimer();
      heartbeatAbortControllerRef.current?.abort(new Error("Stream usage tracker disposed"));
      heartbeatAbortControllerRef.current = null;
    };
  }, []);

  async function flushStreamUsage(force = false) {
    if (
      disposedRef.current
      || quotaExhaustedRef.current
      || usageFlushInFlightRef.current
      || retryTimerRef.current !== null
      || retrySuspendedRef.current
    ) return;

    let pendingHeartbeat = pendingHeartbeatRef.current;
    if (!pendingHeartbeat) {
      const accumulatedSeconds = Math.floor(usageAccumulatorRef.current);
      if (accumulatedSeconds <= 0 || (!force && accumulatedSeconds < 60)) return;
      const watchSeconds = Math.min(60, accumulatedSeconds);
      usageAccumulatorRef.current -= watchSeconds;
      pendingHeartbeat = {
        vendorId,
        liveId,
        ...(sourcePageSlug ? { sourcePageSlug } : {}),
        ...(liveShareCode ? { liveShareCode } : {}),
        eventId: crypto.randomUUID(),
        watchSeconds,
      };
      pendingHeartbeatRef.current = pendingHeartbeat;
    }

    usageFlushInFlightRef.current = true;
    const requestController = new AbortController();
    heartbeatAbortControllerRef.current = requestController;
    const outcome = await postStreamUsageHeartbeat(pendingHeartbeat, fetch, { signal: requestController.signal });
    if (heartbeatAbortControllerRef.current === requestController) {
      heartbeatAbortControllerRef.current = null;
    }
    usageFlushInFlightRef.current = false;
    if (disposedRef.current) return;

    if (outcome === "quota_exhausted") {
      clearRetryTimer();
      quotaExhaustedRef.current = true;
      usageAccumulatorRef.current = 0;
      pendingHeartbeatRef.current = null;
      lastPlaybackPositionRef.current = null;
      onQuotaExhausted();
      return;
    }

    if (outcome === "retryable_failure") {
      scheduleRetry();
      return;
    }

    pendingHeartbeatRef.current = null;
    retryAttemptRef.current = 0;
    retrySuspendedRef.current = false;
    if (usageAccumulatorRef.current >= 60) {
      void flushStreamUsage();
    }
  }

  function trackStreamUsage(currentTime: number) {
    if (quotaExhaustedRef.current) return;
    const previousTime = lastPlaybackPositionRef.current;
    lastPlaybackPositionRef.current = currentTime;
    if (previousTime == null) return;

    const elapsedSeconds = currentTime - previousTime;
    // A seek, HLS discontinuity, or tab resume must not inflate billable usage.
    if (elapsedSeconds <= 0 || elapsedSeconds > 5) return;
    usageAccumulatorRef.current += elapsedSeconds;
    void flushStreamUsage();
  }

  return {
    start: (currentTime: number) => {
      if (quotaExhaustedRef.current) return;
      if (retrySuspendedRef.current) {
        retrySuspendedRef.current = false;
        retryAttemptRef.current = 0;
        void flushStreamUsage(true);
      }
      lastPlaybackPositionRef.current = currentTime;
    },
    stop: () => {
      lastPlaybackPositionRef.current = null;
      if (quotaExhaustedRef.current) return;
      if (retrySuspendedRef.current) {
        retrySuspendedRef.current = false;
        retryAttemptRef.current = 0;
      }
      void flushStreamUsage(true);
    },
    track: trackStreamUsage,
  };
}

export function PlaybackNavigation({
  panel,
  onPanelChange,
}: {
  panel: "chat" | "products" | "form";
  onPanelChange: (panel: "chat" | "products" | "form") => void;
}) {
  return (
    <nav aria-label="直播功能" className="absolute bottom-0 left-0 right-0 z-20 border-t border-white/10 bg-black/55 px-3 py-3 backdrop-blur-xl">
      <div className="grid grid-cols-3 gap-2">
        {playbackPanels.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onPanelChange(key)}
            aria-controls={key !== "chat" && panel === key ? "live-playback-panel" : undefined}
            aria-current={panel === key ? "page" : undefined}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-black transition ${
              panel === key ? "bg-white text-slate-950 shadow-lg" : "bg-white/10 text-white"
            }`}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function submitCheckout(checkout: CheckoutResponse) {
  if (checkout.formAction && checkout.formMethod && checkout.formPayload) {
    const formAction = parseSafeExternalHttpUrl(checkout.formAction);
    if (!formAction) return false;

    const form = document.createElement("form");
    form.method = checkout.formMethod;
    form.action = formAction;
    form.style.display = "none";

    for (const [name, value] of Object.entries(checkout.formPayload)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
    return true;
  }

  const checkoutUrl = parseSafeExternalHttpUrl(checkout.checkoutUrl);
  if (checkoutUrl) {
    window.location.href = checkoutUrl;
    return true;
  }

  return false;
}

export function openExternalUrl(value: string | null | undefined) {
  const externalUrl = parseSafeExternalHttpUrl(value);
  if (!externalUrl) return false;
  window.open(externalUrl, "_blank", "noopener,noreferrer");
  return true;
}

export function checkoutPagePath(vendorId: string, productId: string) {
  const normalizedVendorId = vendorId.trim();
  const normalizedProductId = productId.trim();
  if (!normalizedVendorId || !normalizedProductId) return null;
  return `/checkout/${encodeURIComponent(normalizedVendorId)}/${encodeURIComponent(normalizedProductId)}`;
}

export function isInternalCheckoutPath(pathname: string | null) {
  return Boolean(pathname && /^\/checkout\/[^/]+\/[^/]+\/?$/u.test(pathname));
}

export const CHECKOUT_NAVIGATION_LOCK_TIMEOUT_MS = 10_000;

export async function requestCheckout({
  vendorId,
  productId,
  checkoutUrl,
  navigateInternal,
}: {
  vendorId: string;
  productId: string;
  checkoutUrl?: string | null;
  navigateInternal?: (path: string) => void;
}) {
  const externalCheckoutUrl = checkoutUrl ? parseSafeExternalHttpUrl(checkoutUrl) : null;
  if (checkoutUrl && !externalCheckoutUrl) return false;
  if (externalCheckoutUrl) {
    if (typeof window === "undefined") return false;
    window.location.href = externalCheckoutUrl;
    return true;
  }
  const path = checkoutPagePath(vendorId, productId);
  if (!path) return false;
  if (navigateInternal) {
    navigateInternal(path);
    return true;
  }
  if (typeof window === "undefined") return false;
  window.location.href = path;
  return true;
}

function DirectEntryAttributionReset() {
  useEffect(() => {
    if (typeof window === "undefined" || !shouldResetAffiliateAttribution(window.location.search)) return;
    void fetch(DIRECT_ENTRY_ATTRIBUTION_ENDPOINT, {
      method: "POST",
      headers: clientHeaders,
    }).catch(() => undefined);
  }, []);

  return null;
}

function LiveShareUrlCleanup({ liveShareCode }: { liveShareCode: string | null }) {
  useEffect(() => {
    if (!liveShareCode || typeof window === "undefined") return;
    window.history.replaceState(window.history.state, "", stripLiveShareFromUrl(window.location.href));
  }, [liveShareCode]);

  return null;
}

function prioritizeProduct<T extends { id: string }>(products: T[], spotlightProduct: T | undefined) {
  return spotlightProduct
    ? [...products].sort((a, b) => (a.id === spotlightProduct.id ? -1 : b.id === spotlightProduct.id ? 1 : 0))
    : products;
}

type LiveInteractionEvent = LivePageData["interactionEvents"][number];
type LiveProduct = LivePageData["products"][number];

export function ScriptedInteractionOverlay({
  latestCtaEvent,
  latestProductEvent,
  spotlightProduct,
  hasScriptedEvents,
  isSubmittingCheckout,
  trackCta,
  trackProduct,
}: {
  latestCtaEvent: LiveInteractionEvent | undefined;
  latestProductEvent: LiveInteractionEvent | undefined;
  spotlightProduct: LiveProduct | undefined;
  hasScriptedEvents: boolean;
  isSubmittingCheckout: boolean;
  trackCta: () => Promise<void>;
  trackProduct: (productId: string) => Promise<void>;
}) {
  return (
    <>
      {latestCtaEvent ? (
        <button
          type="button"
          onClick={trackCta}
          aria-label={`商家預設腳本導購：${latestCtaEvent.ctaLabel}`}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-700 px-4 py-3 text-sm font-black text-white shadow-2xl shadow-orange-950/40 hover:bg-orange-800"
        >
          <Megaphone size={17} aria-hidden="true" />
          <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] tracking-wide">商家腳本</span>
          <span>{latestCtaEvent.ctaLabel}</span>
        </button>
      ) : null}

      {spotlightProduct ? (
        <div className="mb-3 animate-[fadeInUp_260ms_ease-out] rounded-2xl border border-white/20 bg-white/95 p-3 text-slate-950 shadow-2xl">
          <div className="flex gap-3">
            {spotlightProduct.imageUrl ? <Image src={spotlightProduct.imageUrl} alt={spotlightProduct.name} width={92} height={92} unoptimized className="h-20 w-20 rounded-xl object-cover" /> : null}
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-black text-slate-950">
                  {latestProductEvent ? "腳本推薦" : "主打商品"}
                </span>
                {latestProductEvent ? <span className="text-xs text-slate-600">{secondsLabel(latestProductEvent.triggerSec)}</span> : null}
              </div>
              <h2 className="line-clamp-1 font-bold">{spotlightProduct.name}</h2>
              <p className="mt-1 text-sm font-black text-orange-700">{formatCurrency(spotlightProduct.priceCents, spotlightProduct.currency)}</p>
              <button
                type="button"
                onClick={() => trackProduct(spotlightProduct.id)}
                disabled={isSubmittingCheckout}
                aria-busy={isSubmittingCheckout}
                className="mt-2 min-h-11 w-full rounded-lg bg-orange-700 text-sm font-black text-white shadow-lg shadow-orange-200 hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmittingCheckout ? "結帳送出中…" : "立即搶購"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="mb-2 rounded-xl border border-white/15 bg-black/45 px-3 py-2 text-[11px] leading-4 text-white/85 backdrop-blur-md">
        {hasScriptedEvents
          ? "官方互動為商家預先設定的腳本，不代表即時真人留言、真實購買或觀看人數。"
          : "目前沒有商家預設互動腳本，頁面不會模擬真人留言或購買行為。"}
      </p>
    </>
  );
}

export function persistentPlayerShellClass(isCheckoutOverlay: boolean, isExpanded: boolean) {
  if (!isCheckoutOverlay) return "absolute inset-0";
  return isExpanded
    ? "fixed inset-3 z-[70] overflow-hidden rounded-2xl border border-white/20 bg-black shadow-2xl"
    : "fixed bottom-4 right-4 z-[70] h-48 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/20 bg-black shadow-2xl";
}

export function PersistentMiniPlayerControls({
  title,
  videoRef,
  isPaused,
  isMuted,
  isExpanded,
  onBack,
  onMutedChange,
  onToggleExpanded,
}: {
  title: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  isPaused: boolean;
  isMuted: boolean;
  isExpanded: boolean;
  onBack: () => void;
  onMutedChange: (muted: boolean) => void;
  onToggleExpanded: () => void;
}) {
  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };
  const toggleMuted = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    onMutedChange(video.muted);
  };

  return (
    <div className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-2 rounded-xl bg-black/75 p-2 text-white backdrop-blur-md">
      <button type="button" onClick={onBack} aria-label="返回直播" className="grid min-h-11 min-w-11 place-items-center rounded-lg bg-white/15 hover:bg-white/25">
        <ArrowLeft size={18} aria-hidden="true" />
      </button>
      <button type="button" onClick={togglePlayback} aria-label={isPaused ? "播放直播" : "暫停直播"} className="grid min-h-11 min-w-11 place-items-center rounded-lg bg-white/15 hover:bg-white/25">
        {isPaused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
      </button>
      <button type="button" onClick={toggleMuted} aria-label={isMuted ? "開啟直播聲音" : "將直播靜音"} className="grid min-h-11 min-w-11 place-items-center rounded-lg bg-white/15 hover:bg-white/25">
        {isMuted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
      </button>
      <p className="min-w-0 flex-1 truncate px-1 text-xs font-bold">{title}</p>
      <button type="button" onClick={onToggleExpanded} aria-label={isExpanded ? "縮小直播小窗" : "展開直播小窗"} className="grid min-h-11 min-w-11 place-items-center rounded-lg bg-white/15 hover:bg-white/25">
        {isExpanded ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}

function useMiniPlayerState() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  return { isExpanded, setIsExpanded, isPaused, setIsPaused, isMuted, setIsMuted };
}

function useLiveAttributionParams() {
  return {
    referralCode: useLiveQueryParam("ref"),
    sourcePageSlug: useLiveQueryParam("sourcePage"),
    liveShareCode: useLiveQueryParam("share"),
  };
}

function useCheckoutNavigationLock(isCheckoutOverlay: boolean) {
  const [isLocked, setIsLocked] = useState(false);
  const lockRef = useRef(false);
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const release = () => {
    lockRef.current = false;
    setIsLocked(false);
    if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
    unlockTimerRef.current = null;
  };

  useEffect(() => {
    if (!isCheckoutOverlay || !lockRef.current) return;
    lockRef.current = false;
    setIsLocked(false);
    if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
    unlockTimerRef.current = null;
  }, [isCheckoutOverlay]);
  useEffect(() => () => {
    if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
  }, []);

  return {
    isLocked,
    begin: () => {
      if (lockRef.current) return false;
      lockRef.current = true;
      setIsLocked(true);
      return true;
    },
    release,
    retainUntilTimeout: (onTimeout: () => void) => {
      unlockTimerRef.current = setTimeout(() => {
        release();
        onTimeout();
      }, CHECKOUT_NAVIGATION_LOCK_TIMEOUT_MS);
    },
  };
}

export function LivePlayback({ live }: { live: LivePageData }) {
  const router = useRouter(); const pathname = usePathname();
  const isCheckoutOverlay = isInternalCheckoutPath(pathname);
  const [panel, setPanel] = useState<"chat" | "products" | "form">("chat");
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [reportedProgress, setReportedProgress] = useState<Set<number>>(() => new Set());
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [streamQuotaExhausted, setStreamQuotaExhausted] = useState(false);
  const [admissionRefreshKey, setAdmissionRefreshKey] = useState(0);
  const { isExpanded: isMiniPlayerExpanded, setIsExpanded: setIsMiniPlayerExpanded, isPaused: isPlaybackPaused, setIsPaused: setIsPlaybackPaused, isMuted: isPlaybackMuted, setIsMuted: setIsPlaybackMuted } = useMiniPlayerState();
  const checkoutNavigation = useCheckoutNavigationLock(isCheckoutOverlay);
  const refreshAdmission = useMemo(() => () => setAdmissionRefreshKey((current) => current + 1), []);
  // Public pages opt into admission-required SSR; direct component fixtures can
  // keep the admitted default while testing the rest of the playback contract.
  const admissionStatus = useLiveAdmission({
    vendorId: live.vendorId,
    liveId: live.id,
    admissionRequired: live.admissionRequired === true,
    refreshKey: admissionRefreshKey,
  });
  const visiblePlaybackUrl = useLivePlaybackSource(live, admissionStatus);
  const playableSource = streamQuotaExhausted ? null : visiblePlaybackUrl;
  const videoRef = useRef<HTMLVideoElement>(null);
  const visitorId = useMemo(
    () => (typeof window === "undefined"
      ? "server"
      : getOrCreateVisitorId(live.vendorId, () => crypto.randomUUID(), () => window.localStorage)),
    [live.vendorId],
  );
  const { referralCode, sourcePageSlug, liveShareCode } = useLiveAttributionParams();
  const streamUsage = useStreamUsageTracker({
    vendorId: live.vendorId,
    liveId: live.id,
    sourcePageSlug,
    liveShareCode,
    onQuotaExhausted: () => {
      const video = videoRef.current;
      video?.pause();
      video?.removeAttribute("src");
      video?.load();
      setStreamQuotaExhausted(true);
    },
  });
  const triggeredEvents = live.interactionEvents.filter((event) => event.triggerSec <= currentSeconds);
  const scheduledMessages = (live.scheduledMessages ?? []).filter((message) => message.triggerSec <= currentSeconds);
  const latestProductEvent = [...triggeredEvents].reverse().find((event) => (
    event.eventType === "product_spotlight"
    && Boolean(event.productId && live.products.some((product) => product.id === event.productId))
  ));
  const latestCtaEvent = [...triggeredEvents].reverse().find((event) => event.eventType === "cta_switch" && event.ctaLabel);
  const spotlightProduct = live.products.find((product) => product.id === latestProductEvent?.productId) ?? live.products[0];
  const sortedProducts = prioritizeProduct(live.products, spotlightProduct);
  useEffect(() => {
    if (admissionStatus !== "admitted") return;
    void trackClientAnalytics({
      liveId: live.id,
      vendorId: live.vendorId,
      eventType: "page_view",
      payload: { slug: live.slug },
    });
  }, [admissionStatus, live.id, live.slug, live.vendorId]);
  useEffect(() => {
    if ((!referralCode && !sourcePageSlug && !liveShareCode) || typeof window === "undefined") return;
    void fetch(affiliateClickEndpoint(sourcePageSlug), {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({
        liveId: live.id,
        vendorId: live.vendorId,
        visitorId,
        ...(referralCode ? { referralCode } : {}),
        ...(liveShareCode ? { shareCode: liveShareCode } : {}),
        landingPath: `${window.location.pathname}${window.location.search}`,
      }),
    });
  }, [live.id, live.vendorId, liveShareCode, referralCode, sourcePageSlug, visitorId]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isHlsPlaybackUrl(playableSource) || !playableSource) return;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playableSource;
      return;
    }
    let disposed = false;
    let hls: { destroy: () => void } | null = null;
    void import("hls.js")
      .then(({ default: Hls }) => {
        if (disposed || !Hls.isSupported()) return;
        const player = new Hls();
        hls = player;
        player.loadSource(playableSource);
        player.attachMedia(video);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      hls?.destroy();
    };
  }, [playableSource]);

  function trackProgress(seconds: number) {
    const checkpoints = [30, 60, 120, 300, 600] as const;
    const checkpoint = checkpoints.find((value) => seconds >= value && !reportedProgress.has(value));
    if (!checkpoint) return;
    const nextReported = new Set(reportedProgress);
    nextReported.add(checkpoint);
    setReportedProgress(nextReported);
    void trackClientAnalytics({
      liveId: live.id,
      vendorId: live.vendorId,
      eventType: "play_progress",
      payload: { seconds: checkpoint, ref: referralCode },
    });
  }

  async function trackProduct(productId: string) {
    if (admissionStatus !== "admitted") {
      setCheckoutError("直播目前無法提供購買，請稍後再試。");
      return;
    }
    if (!checkoutNavigation.begin()) return;
    setCheckoutError(null);
    void trackClientAnalytics({
      liveId: live.id,
      vendorId: live.vendorId,
      eventType: "product_click",
      payload: { productId, ref: referralCode },
    });

    let keepNavigationLocked = false;
    try {
      const product = live.products.find((item) => item.id === productId);
      const checkoutStarted = await requestCheckout({ vendorId: live.vendorId, productId, checkoutUrl: product?.checkoutUrl, navigateInternal: (path) => router.push(path) });
      if (!checkoutStarted) {
        setCheckoutError("目前無法完成結帳，請稍後再試。");
      } else if (!product?.checkoutUrl) {
        keepNavigationLocked = true;
        checkoutNavigation.retainUntilTimeout(() => {
          setCheckoutError("結帳頁載入逾時，請再試一次。");
        });
      }
    } finally {
      if (!keepNavigationLocked) checkoutNavigation.release();
    }
  }

  async function trackCta() {
    if (!latestCtaEvent?.ctaLabel) return;
    if (admissionStatus !== "admitted") {
      setCheckoutError("直播目前無法提供導購，請稍後再試。");
      return;
    }
    setCheckoutError(null);
    void trackClientAnalytics({
      liveId: live.id,
      vendorId: live.vendorId,
      eventType: "cta_click",
      payload: { label: latestCtaEvent.ctaLabel, ref: referralCode },
    });
    if (!openExternalUrl(latestCtaEvent.ctaUrl)) {
      setCheckoutError("目前無法開啟這個連結，請稍後再試。");
    }
  }

  return (
    <main className="min-h-screen bg-slate-950" data-checkout-overlay-active={isCheckoutOverlay ? "true" : "false"}>
      <DirectEntryAttributionReset />
      <LiveShareUrlCleanup liveShareCode={liveShareCode} />
      <section className="relative mx-auto min-h-screen max-w-[430px] overflow-hidden bg-slate-950 text-white shadow-2xl">
        <div data-testid="persistent-live-player" className={persistentPlayerShellClass(isCheckoutOverlay, isMiniPlayerExpanded)}>
          {!streamQuotaExhausted && (visiblePlaybackUrl || live.videoUrl) ? (
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              src={playableSource ?? undefined}
              controls={admissionStatus === "admitted" && !streamQuotaExhausted}
              aria-describedby={streamQuotaExhausted ? "stream-quota-alert" : undefined}
              playsInline
              poster={live.heroImageUrl ?? undefined}
              onTimeUpdate={(event) => {
                if (streamQuotaExhausted) return;
                streamUsage.track(event.currentTarget.currentTime);
                const seconds = Math.floor(event.currentTarget.currentTime);
                setCurrentSeconds(seconds);
                trackProgress(seconds);
              }}
              onPlay={(event) => {
                if (streamQuotaExhausted) {
                  event.currentTarget.pause();
                  return;
                }
                setIsPlaybackPaused(false);
                streamUsage.start(event.currentTarget.currentTime);
                void trackClientAnalytics({
                  liveId: live.id,
                  vendorId: live.vendorId,
                  eventType: "video_play",
                  payload: { slug: live.slug, ref: referralCode },
                });
              }}
              onPause={() => { setIsPlaybackPaused(true); streamUsage.stop(); }}
              onEnded={() => { setIsPlaybackPaused(true); streamUsage.stop(); }}
              onVolumeChange={(event) => setIsPlaybackMuted(event.currentTarget.muted)}
            />
          ) : (
            <div className="h-full bg-cover bg-center" style={{ backgroundImage: live.heroImageUrl ? `url(${live.heroImageUrl})` : undefined }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-black/85" />
          {isCheckoutOverlay ? (
            <PersistentMiniPlayerControls title={live.title} videoRef={videoRef} isPaused={isPlaybackPaused} isMuted={isPlaybackMuted}
              isExpanded={isMiniPlayerExpanded} onBack={() => router.back()} onMutedChange={setIsPlaybackMuted}
              onToggleExpanded={() => setIsMiniPlayerExpanded((current) => !current)} />
          ) : null}
        </div>

        <LiveBrandHeader live={live} />
        {streamQuotaExhausted ? <StreamQuotaAlert /> : null}

        <div className="relative z-10 flex min-h-[calc(100vh-72px)] flex-col justify-end p-4 pb-24">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold backdrop-blur-md">{secondsLabel(currentSeconds)}</span>
            {live.accentCopy ? <span className="rounded-full bg-orange-700/95 px-3 py-1 text-xs font-bold shadow-lg shadow-orange-950/30">{live.accentCopy}</span> : null}
          {referralCode ? <span className="rounded-full bg-blue-500/90 px-3 py-1 text-xs font-bold">來源 {referralCode}</span> : null}
          </div>

          <ScriptedInteractionOverlay
            latestCtaEvent={latestCtaEvent}
            latestProductEvent={latestProductEvent}
            spotlightProduct={spotlightProduct}
            hasScriptedEvents={live.interactionEvents.length > 0 || (live.scheduledMessages?.length ?? 0) > 0}
            isSubmittingCheckout={checkoutNavigation.isLocked}
            trackCta={trackCta}
            trackProduct={trackProduct}
          />
          <div className="max-h-[46vh] min-h-0 overflow-hidden rounded-2xl border border-white/10 bg-black/30 backdrop-blur-md">
            <LiveChatPanel
              enabled={live.chatEnabled === true}
              admissionStatus={admissionStatus}
              vendorId={live.vendorId}
              liveId={live.id}
              scheduledMessages={scheduledMessages}
              onAdmissionInvalid={refreshAdmission}
            />
          </div>
        </div>

        <PlaybackNavigation panel={panel} onPanelChange={setPanel} />

        {checkoutError ? (
          <p role="alert" className="absolute bottom-24 left-3 right-3 z-40 rounded-xl bg-red-700 px-4 py-3 text-sm font-bold text-white shadow-xl">
            {checkoutError}
          </p>
        ) : null}

        {panel !== "chat" ? (
          <aside id="live-playback-panel" aria-label={panel === "products" ? "直播商品" : "直播報名"} className="absolute bottom-20 left-3 right-3 z-30 max-h-[58vh] overflow-auto rounded-2xl border border-white/15 bg-white p-4 text-slate-950 shadow-2xl">
            {panel === "products" ? (
              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-black">直播商品</h2>
                  <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-black text-slate-950">{live.products.length} 件</span>
                </div>
                {sortedProducts.map((product) => (
                  <article key={product.id} className={`rounded-xl border p-3 ${product.id === spotlightProduct?.id ? "border-orange-300 bg-orange-50" : "border-slate-200"}`}>
                    <div className="flex gap-3">
                      {product.imageUrl ? <Image src={product.imageUrl} alt={product.name} width={84} height={84} unoptimized className="h-20 w-20 rounded-lg object-cover" /> : null}
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-1 font-bold">{product.name}</h3>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{product.description}</p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="font-black text-orange-700">{formatCurrency(product.priceCents, product.currency)}</p>
                          <button
                            type="button"
                            onClick={() => trackProduct(product.id)}
                            disabled={checkoutNavigation.isLocked}
                            aria-busy={checkoutNavigation.isLocked}
                            className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-orange-700 px-3 text-xs font-black text-white hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <ShoppingBag size={14} aria-hidden="true" />
                            {checkoutNavigation.isLocked ? "送出中…" : "購買"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            {panel === "form" ? (
              live.form ? (
                <div>
                  <div className="mb-4 flex items-start gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
                      <Sparkles size={18} />
                    </span>
                    <div>
                      <h2 className="font-black">{live.form.headline}</h2>
                      {live.form.description ? <p className="mt-1 text-sm text-slate-500">{live.form.description}</p> : null}
                    </div>
                  </div>
                  <LeadForm formId={live.form.id} liveId={live.id} fields={live.form.fields} submitLabel={live.form.submitLabel} successMessage={live.form.successMessage} />
                </div>
              ) : live.formConfigurationUnavailable ? (
                <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">報名表欄位需要商家重新確認，目前暫停接收資料。</p>
              ) : (
                <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">這場直播尚未綁定報名表。</p>
              )
            ) : null}
          </aside>
        ) : null}
        <LiveAdmissionOverlay status={admissionStatus} />
      </section>
    </main>
  );
}
