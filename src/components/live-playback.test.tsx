import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  cursor: 0,
  refCursor: 0,
  effectCursor: 0,
  effectsEnabled: false,
  values: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<{ dependencies?: readonly unknown[]; cleanup?: () => void }>,
  pendingEffects: [] as Array<{
    index: number;
    effect: () => void | (() => void);
    dependencies?: readonly unknown[];
  }>,
}));
const navigation = vi.hoisted(() => ({
  pathname: "/live/test-fixture-live",
  push: vi.fn(),
  back: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push, back: navigation.back, refresh: navigation.refresh }),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();

  return {
    ...react,
    useEffect: (effect: () => void | (() => void), dependencies?: readonly unknown[]) => {
      if (!hookState.effectsEnabled) return;
      const index = hookState.effectCursor++;
      const previous = hookState.effects[index];
      const unchanged = previous
        && dependencies !== undefined
        && previous.dependencies !== undefined
        && dependencies.length === previous.dependencies.length
        && dependencies.every((dependency, dependencyIndex) => Object.is(dependency, previous.dependencies?.[dependencyIndex]));
      if (!unchanged) hookState.pendingEffects.push({ index, effect, dependencies });
    },
    useMemo: <Value,>(factory: () => Value) => factory(),
    useRef: <Value,>(initialValue: Value) => {
      const index = hookState.refCursor++;
      if (!hookState.refs[index]) hookState.refs[index] = { current: initialValue };
      return hookState.refs[index] as { current: Value };
    },
    useState: <Value,>(initialValue: Value | (() => Value)) => {
      const index = hookState.cursor++;
      if (hookState.values.length === index) {
        hookState.values.push(typeof initialValue === "function" ? (initialValue as () => Value)() : initialValue);
      }

      const setValue = (nextValue: Value | ((currentValue: Value) => Value)) => {
        const currentValue = hookState.values[index] as Value;
        hookState.values[index] = typeof nextValue === "function"
          ? (nextValue as (currentValue: Value) => Value)(currentValue)
          : nextValue;
      };

      return [hookState.values[index] as Value, setValue] as const;
    },
  };
});

vi.mock("@/lib/client-analytics", () => ({ trackClientAnalytics: vi.fn() }));
vi.mock("@/lib/stream-usage-client", () => ({ postStreamUsageHeartbeat: vi.fn() }));
vi.mock("@/lib/visitor-id", () => ({ getOrCreateVisitorId: () => "test-fixture-visitor-id" }));

import { postStreamUsageHeartbeat } from "@/lib/stream-usage-client";
import { trackClientAnalytics } from "@/lib/client-analytics";
import type { ScheduledRuntimeMessage } from "@/lib/live-chat-contract";
import { LiveChatPanel } from "./live-chat-panel";
import { affiliateClickEndpoint, CHECKOUT_NAVIGATION_LOCK_TIMEOUT_MS, checkoutPagePath, getLiveStatusLabel, getStreamUsageRetryDelayMs, getWaitingCountdownSeconds, isHlsPlaybackUrl, isInternalCheckoutPath, LivePlayback, normalizePlaybackStartSeconds, openExternalUrl, PersistentMiniPlayerControls, PlaybackNavigation, requestCheckout, ScriptedInteractionOverlay, shouldResetAffiliateAttribution, STREAM_USAGE_RETRY_DELAYS_MS, stripLiveShareFromUrl, submitCheckout, useLiveAdmission, useLivePlaybackSource } from "./live-playback";

type ElementNode = {
  type: unknown;
  props: Record<string, unknown>;
};

function isElementNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && "props" in value && "type" in value;
}

function findElements(value: unknown, predicate: (element: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(value)) return value.flatMap((child) => findElements(child, predicate));
  if (!isElementNode(value)) return [];

  const renderedChildren = value.type === ScriptedInteractionOverlay
    ? ScriptedInteractionOverlay(value.props as Parameters<typeof ScriptedInteractionOverlay>[0])
    : value.type === PersistentMiniPlayerControls
      ? PersistentMiniPlayerControls(value.props as Parameters<typeof PersistentMiniPlayerControls>[0])
      : typeof value.type === "function" && ["LiveWaitingRoom", "LiveUnavailableNotice", "LivePlaybackExperience", "LivePlaybackPanel", "ProductSpotlightCard", "ExternalNavigationConfirmDialog"].includes(value.type.name)
        ? (value.type as (props: Record<string, unknown>) => unknown)(value.props)
    : value.props.children;

  return [
    ...(predicate(value) ? [value] : []),
    ...findElements(renderedChildren, predicate),
  ];
}

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (!isElementNode(value)) return "";
  return value.type === ScriptedInteractionOverlay
    ? textContent(ScriptedInteractionOverlay(value.props as Parameters<typeof ScriptedInteractionOverlay>[0]))
    : value.type === PersistentMiniPlayerControls
      ? textContent(PersistentMiniPlayerControls(value.props as Parameters<typeof PersistentMiniPlayerControls>[0]))
      : typeof value.type === "function" && ["LiveWaitingRoom", "LiveUnavailableNotice", "LivePlaybackExperience", "LivePlaybackPanel", "ProductSpotlightCard", "ExternalNavigationConfirmDialog"].includes(value.type.name)
        ? textContent((value.type as (props: Record<string, unknown>) => unknown)(value.props))
      : textContent(value.props.children);
}

const live: Parameters<typeof LivePlayback>[0]["live"] = {
  id: "test-fixture-live-1",
  title: "測試直播",
  slug: "test-fixture-live",
  status: "live",
  description: null,
  accentCopy: null,
  heroImageUrl: null,
  videoUrl: null,
  vendorId: "test-fixture-vendor-1",
  brand: { name: "測試品牌", logoUrl: null, primaryColor: "#000000", ctaColor: "#f97316" },
  form: null,
  interactionEvents: [],
  scheduledMessages: [],
  chatEnabled: false,
  products: [
    { id: "test-fixture-product-1", name: "測試商品一", description: null, priceCents: 1000, compareAtCents: null, currency: "TWD", imageUrl: null, checkoutUrl: null, offerLabel: null },
    { id: "test-fixture-product-2", name: "測試商品二", description: null, priceCents: 2000, compareAtCents: null, currency: "TWD", imageUrl: null, checkoutUrl: null, offerLabel: null },
  ],
};

function productSpotlightEvent(id: string, triggerSec: number, productId: string) {
  return {
    id,
    eventType: "product_spotlight",
    triggerSec,
    title: "商品聚焦",
    message: null,
    productId,
    ctaLabel: null,
    ctaUrl: null,
    role: null,
  };
}

function renderLive(overrides: Partial<Parameters<typeof LivePlayback>[0]["live"]> = {}) {
  hookState.cursor = 0;
  hookState.refCursor = 0;
  hookState.effectCursor = 0;
  return LivePlayback({ live: { ...live, ...overrides } });
}

function AdmissionPlaybackHarness({ refreshKey }: { refreshKey: number }) {
  const admissionStatus = useLiveAdmission({
    vendorId: live.vendorId,
    liveId: live.id,
    admissionRequired: true,
    refreshKey,
  });
  const playbackSource = useLivePlaybackSource({ ...live, admissionRequired: true }, admissionStatus, refreshKey);
  return { admissionStatus, playbackSource };
}

function renderAdmissionPlayback(refreshKey = 0) {
  hookState.cursor = 0;
  hookState.refCursor = 0;
  hookState.effectCursor = 0;
  return AdmissionPlaybackHarness({ refreshKey });
}

function PlaybackSourceHarness({
  overrides,
  admissionStatus,
  refreshKey,
}: {
  overrides: Partial<Parameters<typeof LivePlayback>[0]["live"]>;
  admissionStatus: "checking" | "admitted" | "blocked";
  refreshKey: number;
}) {
  return useLivePlaybackSource({ ...live, admissionRequired: true, ...overrides }, admissionStatus, refreshKey);
}

function renderPlaybackSource(
  overrides: Partial<Parameters<typeof LivePlayback>[0]["live"]> = {},
  admissionStatus: "checking" | "admitted" | "blocked" = "admitted",
  refreshKey = 0,
) {
  hookState.cursor = 0;
  hookState.refCursor = 0;
  hookState.effectCursor = 0;
  return PlaybackSourceHarness({ overrides, admissionStatus, refreshKey });
}

async function flushHookEffects() {
  const pendingEffects = hookState.pendingEffects.splice(0);
  for (const pending of pendingEffects) {
    hookState.effects[pending.index]?.cleanup?.();
    const cleanup = pending.effect();
    hookState.effects[pending.index] = {
      dependencies: pending.dependencies,
      cleanup: typeof cleanup === "function" ? cleanup : undefined,
    };
  }
  await Promise.resolve();
  await Promise.resolve();
}

function cleanupHookEffects() {
  for (const effect of hookState.effects) effect.cleanup?.();
  hookState.effects = [];
  hookState.pendingEffects = [];
  hookState.effectsEnabled = false;
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function checkoutButtons(tree: unknown) {
  return findElements(tree, (element) => (
    element.type === "button" && ["立即搶購", "結帳送出中…", "購買", "送出中…"].includes(textContent(element.props.children))
  ));
}

function checkoutErrors(tree: unknown) {
  return findElements(tree, (element) => element.props.role === "alert");
}

describe("LivePlayback checkout", () => {
  it("removes the bearer Live share from the browser URL while preserving safe navigation state", () => {
    expect(stripLiveShareFromUrl("https://app.example.test/live/webinar?share=tls1.fixture&ref=ignored#form"))
      .toBe("/live/webinar?ref=ignored#form");
  });
  it("builds a source-page-aware affiliate click endpoint", () => {
    expect(affiliateClickEndpoint("partner b")).toBe("/api/affiliate-clicks?sourcePage=partner+b");
    expect(affiliateClickEndpoint(null)).toBe("/api/affiliate-clicks");
  });

  it.each([
    ["", true],
    ["?utm_source=direct", true],
    ["?ref=EDEN10", false],
    ["?sourcePage=partner-page", false],
    ["?ref=&sourcePage=", true],
  ])("classifies %s as direct-entry attribution=%s", (search, expected) => {
    expect(shouldResetAffiliateAttribution(search)).toBe(expected);
  });

  afterEach(() => {
    cleanupHookEffects();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    hookState.cursor = 0;
    hookState.refCursor = 0;
    hookState.effectCursor = 0;
    hookState.effectsEnabled = false;
    hookState.values = [];
    hookState.refs = [];
    hookState.effects = [];
    hookState.pendingEffects = [];
    navigation.pathname = "/live/test-fixture-live";
    vi.clearAllMocks();
  });

  it("submits every PayUni form-post field without redirecting to the product checkout URL", () => {
    const inputs: Array<{ type: string; name: string; value: string }> = [];
    const form = {
      method: "",
      action: "",
      style: { display: "" },
      appendChild: vi.fn((input: { type: string; name: string; value: string }) => inputs.push(input)),
      submit: vi.fn(),
    };
    const appendToBody = vi.fn();

    vi.stubGlobal("document", {
      createElement: vi.fn((tagName: string) => tagName === "form" ? form : { type: "", name: "", value: "" }),
      body: { appendChild: appendToBody },
    });
    vi.stubGlobal("window", { location: { href: "https://shop.example.test/product-checkout" } });

    const submitted = submitCheckout({
      formAction: "https://sandbox-api.payuni.com.tw/api/upp",
      formMethod: "POST",
      formPayload: {
        MerID: "merchant-123",
        Version: "2.0",
        EncryptInfo: "encrypted-payload",
        HashInfo: "signed-payload",
      },
      checkoutUrl: "https://checkout.example.test/should-not-redirect",
    });

    expect(submitted).toBe(true);
    expect(form.method).toBe("POST");
    expect(form.action).toBe("https://sandbox-api.payuni.com.tw/api/upp");
    expect(form.style.display).toBe("none");
    expect(inputs).toEqual([
      { type: "hidden", name: "MerID", value: "merchant-123" },
      { type: "hidden", name: "Version", value: "2.0" },
      { type: "hidden", name: "EncryptInfo", value: "encrypted-payload" },
      { type: "hidden", name: "HashInfo", value: "signed-payload" },
    ]);
    expect(appendToBody).toHaveBeenCalledWith(form);
    expect(form.submit).toHaveBeenCalledOnce();
    expect(window.location.href).toBe("https://shop.example.test/product-checkout");
  });

  it("detects Cloudflare Stream HLS playback URLs for browser player fallback", () => {
    expect(isHlsPlaybackUrl("https://videodelivery.net/video-1/manifest/video.m3u8")).toBe(true);
    expect(isHlsPlaybackUrl("https://customer-example.cloudflarestream.com/video-1/manifest/video.m3u8")).toBe(true);
    expect(isHlsPlaybackUrl("http://videodelivery.net/video-1/manifest/video.m3u8")).toBe(false);
    expect(isHlsPlaybackUrl("https://videodelivery.net/video-1/watch")).toBe(false);
    expect(isHlsPlaybackUrl("not-a-url")).toBe(false);
  });

  it("does not expose a playable source before server admission", () => {
    const tree = renderLive({ admissionRequired: true, videoUrl: "https://video.example.test/recording.mp4" });
    const video = findElements(tree, (element) => element.type === "video")[0];

    expect(video?.props.src).toBeUndefined();
    expect(video?.props.controls).toBe(false);
    expect(video?.props.src).toBeUndefined();
  });

  it("keeps an authorized same-scope source while replay admission is checking", async () => {
    hookState.effectsEnabled = true;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ playbackUrl: "https://video.example.test/authorized.mp4", playbackStartSeconds: 21 }),
    })));

    expect(renderPlaybackSource({ runtimeState: "playing", status: "live" })).toBeNull();
    await flushHookEffects();
    expect(renderPlaybackSource({ runtimeState: "playing", status: "live" })).toEqual({
      playbackUrl: "https://video.example.test/authorized.mp4",
      playbackStartSeconds: 21,
    });

    expect(renderPlaybackSource({ runtimeState: "replay", status: "ended" }, "checking", 1)).toEqual({
      playbackUrl: "https://video.example.test/authorized.mp4",
      playbackStartSeconds: 21,
    });
    await flushHookEffects();
    expect(renderPlaybackSource({ runtimeState: "replay", status: "ended" }, "checking", 1)).toEqual({
      playbackUrl: "https://video.example.test/authorized.mp4",
      playbackStartSeconds: 21,
    });
  });

  it.each([
    ["blocked admission", { runtimeState: "playing", status: "live" }, "blocked"],
    ["waiting runtime", { runtimeState: "waiting", status: "scheduled" }, "admitted"],
    ["unavailable runtime", { runtimeState: "unavailable", status: "ended" }, "admitted"],
    ["changed live scope", { id: "test-fixture-live-2", runtimeState: "playing", status: "live" }, "checking"],
    ["changed vendor scope", { vendorId: "test-fixture-vendor-2", runtimeState: "playing", status: "live" }, "checking"],
  ] as const)("clears an authorized source for %s", async (_label, overrides, admissionStatus) => {
    hookState.effectsEnabled = true;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ playbackUrl: "https://video.example.test/authorized.mp4", playbackStartSeconds: 9 }),
    })));

    renderPlaybackSource({ runtimeState: "playing", status: "live" });
    await flushHookEffects();
    expect(renderPlaybackSource({ runtimeState: "playing", status: "live" })).not.toBeNull();

    expect(renderPlaybackSource(overrides, admissionStatus)).toBeNull();
    await flushHookEffects();
    expect(renderPlaybackSource({ runtimeState: "playing", status: "live" }, "checking", 1)).toBeNull();
  });

  it("clears a cached source when replay revalidation fails", async () => {
    hookState.effectsEnabled = true;
    let sourceRequests = 0;
    vi.stubGlobal("fetch", vi.fn(() => {
      sourceRequests += 1;
      return sourceRequests === 1
        ? Promise.resolve({
          ok: true,
          json: async () => ({ playbackUrl: "https://video.example.test/authorized.mp4", playbackStartSeconds: 15 }),
        })
        : Promise.resolve({ ok: false });
    }));

    renderPlaybackSource({ runtimeState: "playing", status: "live" });
    await flushHookEffects();
    expect(renderPlaybackSource({ runtimeState: "playing", status: "live" })).not.toBeNull();

    expect(renderPlaybackSource({ runtimeState: "replay", status: "ended" }, "admitted", 1)).not.toBeNull();
    await flushHookEffects();
    expect(renderPlaybackSource({ runtimeState: "replay", status: "ended" }, "admitted", 1)).toBeNull();
  });

  it("keeps an admitted playback source during one non-overlapping background renewal and removes it when rejected", async () => {
    vi.useFakeTimers();
    hookState.effectsEnabled = true;
    vi.stubGlobal("window", { setInterval, clearInterval });
    const initialAdmission = deferred<{ ok: boolean }>();
    const renewal = deferred<{ ok: boolean }>();
    const admissionResponses = [initialAdmission.promise, renewal.promise];
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") return Promise.resolve({ ok: true });
      if (url.startsWith("/api/live-playback-source?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ playbackUrl: "https://video.example.test/admitted.mp4" }),
        });
      }
      return admissionResponses.shift() ?? Promise.reject(new Error("unexpected admission request"));
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(renderAdmissionPlayback()).toEqual({ admissionStatus: "checking", playbackSource: null });
    await flushHookEffects();
    initialAdmission.resolve({ ok: true });
    await initialAdmission.promise;
    await Promise.resolve();

    expect(renderAdmissionPlayback()).toEqual({ admissionStatus: "admitted", playbackSource: null });
    await flushHookEffects();
    await Promise.resolve();
    const admitted = renderAdmissionPlayback();
    expect(admitted).toEqual({
      admissionStatus: "admitted",
      playbackSource: {
        playbackUrl: "https://video.example.test/admitted.mp4",
        playbackStartSeconds: 0,
      },
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(renderAdmissionPlayback()).toEqual(admitted);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);

    renewal.resolve({ ok: false });
    await renewal.promise;
    await Promise.resolve();
    expect(renderAdmissionPlayback()).toEqual({ admissionStatus: "blocked", playbackSource: null });
    await flushHookEffects();
  });

  it("removes the admitted playback source when background renewal throws", async () => {
    vi.useFakeTimers();
    hookState.effectsEnabled = true;
    vi.stubGlobal("window", { setInterval, clearInterval });
    const renewal = deferred<{ ok: boolean }>();
    let admissionRequests = 0;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") return Promise.resolve({ ok: true });
      if (url.startsWith("/api/live-playback-source?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ playbackUrl: "https://video.example.test/admitted.mp4" }),
        });
      }
      admissionRequests += 1;
      return admissionRequests === 1 ? Promise.resolve({ ok: true }) : renewal.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAdmissionPlayback();
    await flushHookEffects();
    await Promise.resolve();
    renderAdmissionPlayback();
    await flushHookEffects();
    await Promise.resolve();
    expect(renderAdmissionPlayback().playbackSource).toEqual({
      playbackUrl: "https://video.example.test/admitted.mp4",
      playbackStartSeconds: 0,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(renderAdmissionPlayback().admissionStatus).toBe("admitted");
    renewal.reject(new Error("synthetic renewal failure"));
    await expect(renewal.promise).rejects.toThrow("synthetic renewal failure");
    await Promise.resolve();
    expect(renderAdmissionPlayback()).toEqual({ admissionStatus: "blocked", playbackSource: null });
    await flushHookEffects();
  });

  it("cleans the renewal timer and ignores a stale admission response after lifecycle disposal", async () => {
    vi.useFakeTimers();
    hookState.effectsEnabled = true;
    vi.stubGlobal("window", { setInterval, clearInterval });
    const initialAdmission = deferred<{ ok: boolean }>();
    vi.stubGlobal("fetch", vi.fn((_input: string | URL | Request, init?: RequestInit) => (
      init?.method === "DELETE" ? Promise.resolve({ ok: true }) : initialAdmission.promise
    )));

    expect(renderAdmissionPlayback()).toEqual({ admissionStatus: "checking", playbackSource: null });
    await flushHookEffects();
    expect(vi.getTimerCount()).toBe(1);

    cleanupHookEffects();
    expect(vi.getTimerCount()).toBe(0);
    initialAdmission.resolve({ ok: true });
    await initialAdmission.promise;
    await Promise.resolve();

    expect(renderAdmissionPlayback()).toEqual({ admissionStatus: "checking", playbackSource: null });
  });

  it("renders a waiting brand room without admission, source, or media requests and refreshes once at zero", async () => {
    vi.useFakeTimers();
    hookState.effectsEnabled = true;
    const serverNow = new Date(Date.now()).toISOString();
    const scheduledAt = new Date(Date.now() + 2_000).toISOString();
    const fetchMock = vi.fn();
    vi.stubGlobal("window", {
      location: { search: "" },
      localStorage: {},
      setInterval,
      clearInterval,
    });
    vi.stubGlobal("fetch", fetchMock);

    const tree = renderLive({
      status: "scheduled",
      runtimeState: "waiting",
      scheduledAt,
      serverNow,
      admissionRequired: true,
      videoUrl: "https://video.example.test/should-not-load.mp4",
    });

    expect(textContent(tree)).toContain("品牌等候室");
    expect(textContent(tree)).toContain("距離開播");
    expect(findElements(tree, (element) => element.type === "video" || element.type === "audio" || element.type === "iframe")).toHaveLength(0);
    await flushHookEffects();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigation.refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_500);
    expect(navigation.refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("renders unavailable as a lifecycle state without admission, source, or media requests", async () => {
    hookState.effectsEnabled = true;
    const fetchMock = vi.fn();
    vi.stubGlobal("window", {
      location: { search: "" },
      localStorage: {},
      setInterval,
      clearInterval,
    });
    vi.stubGlobal("fetch", fetchMock);

    const tree = renderLive({
      status: "ended",
      runtimeState: "unavailable",
      admissionRequired: true,
      videoUrl: "https://video.example.test/should-not-load.mp4",
    });

    expect(textContent(tree)).toContain("此活動目前無法觀看");
    expect(textContent(tree)).not.toContain("直播容量目前暫停服務");
    expect(findElements(tree, (element) => element.type === "video" || element.type === "audio" || element.type === "iframe")).toHaveLength(0);
    await flushHookEffects();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates playback offsets, defaults a missing API offset to zero, and exposes the source object", async () => {
    expect(normalizePlaybackStartSeconds(12.5)).toBe(12.5);
    expect(normalizePlaybackStartSeconds(Number.NaN)).toBe(0);
    expect(normalizePlaybackStartSeconds(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizePlaybackStartSeconds(-1)).toBe(0);
    expect(normalizePlaybackStartSeconds("12")).toBe(0);
    expect(getWaitingCountdownSeconds("invalid", new Date().toISOString())).toBeNull();

    hookState.effectsEnabled = true;
    vi.stubGlobal("window", { setInterval, clearInterval, location: { search: "" }, localStorage: {} });
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") return Promise.resolve({ ok: true });
      if (String(input).startsWith("/api/live-playback-source?")) {
        return Promise.resolve({ ok: true, json: async () => ({ playbackUrl: "https://video.example.test/admitted.mp4" }) });
      }
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAdmissionPlayback();
    await flushHookEffects();
    renderAdmissionPlayback();
    await flushHookEffects();

    expect(renderAdmissionPlayback().playbackSource).toEqual({
      playbackUrl: "https://video.example.test/admitted.mp4",
      playbackStartSeconds: 0,
    });
  });

  it("seeks a playing source once per source and offset identity", async () => {
    hookState.effectsEnabled = true;
    vi.stubGlobal("window", { setInterval, clearInterval, location: { search: "" }, localStorage: {} });
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") return Promise.resolve({ ok: true });
      if (String(input).startsWith("/api/live-playback-source?")) {
        return Promise.resolve({ ok: true, json: async () => ({ playbackUrl: "https://video.example.test/offset.mp4", playbackStartSeconds: 12.5 }) });
      }
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderLive({ runtimeState: "playing", status: "live", admissionRequired: true });
    await flushHookEffects();
    renderLive({ runtimeState: "playing", status: "live", admissionRequired: true });
    await flushHookEffects();
    const tree = renderLive({ runtimeState: "playing", status: "live", admissionRequired: true });
    const video = findElements(tree, (element) => element.type === "video")[0];
    if (!video) throw new Error("Expected video element");
    const currentTarget = { currentTime: 99 };
    const onLoadedMetadata = video.props.onLoadedMetadata as (event: { currentTarget: HTMLVideoElement }) => void;
    onLoadedMetadata({ currentTarget: currentTarget as unknown as HTMLVideoElement });
    expect(currentTarget.currentTime).toBe(12.5);
    currentTarget.currentTime = 44;
    onLoadedMetadata({ currentTarget: currentTarget as unknown as HTMLVideoElement });
    expect(currentTarget.currentTime).toBe(44);
  });

  it("waits for new metadata before seeking when the HLS playback URL changes", async () => {
    hookState.effectsEnabled = true;
    vi.stubGlobal("window", { setInterval, clearInterval, location: { search: "" }, localStorage: {} });
    let sourceRequestCount = 0;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") return Promise.resolve({ ok: true });
      if (String(input).startsWith("/api/live-playback-source?")) {
        sourceRequestCount += 1;
        return Promise.resolve({
          ok: true,
          json: async () => sourceRequestCount === 1
            ? { playbackUrl: "https://video.example.test/hls-a/manifest/video.m3u8", playbackStartSeconds: 12 }
            : { playbackUrl: "https://video.example.test/hls-b/manifest/video.m3u8", playbackStartSeconds: 34 },
        });
      }
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderLive({ runtimeState: "playing", status: "live", admissionRequired: true });
    await flushHookEffects();
    renderLive({ runtimeState: "playing", status: "live", admissionRequired: true });
    await flushHookEffects();
    let tree = renderLive({ runtimeState: "playing", status: "live", admissionRequired: true });
    const firstVideo = findElements(tree, (element) => element.type === "video")[0];
    if (!firstVideo) throw new Error("Expected first HLS video element");
    const currentTarget = {
      currentTime: 99,
      readyState: 1,
      src: "",
      canPlayType: vi.fn(() => "probably"),
    };
    const videoRef = firstVideo.props.ref as { current: HTMLVideoElement | null };
    videoRef.current = currentTarget as unknown as HTMLVideoElement;
    const firstLoadedMetadata = firstVideo.props.onLoadedMetadata as (event: { currentTarget: HTMLVideoElement }) => void;
    firstLoadedMetadata({ currentTarget: currentTarget as unknown as HTMLVideoElement });
    expect(currentTarget.currentTime).toBe(12);

    currentTarget.currentTime = 77;
    (firstVideo.props.onEnded as () => void)();
    tree = renderLive({ runtimeState: "playing", status: "live", admissionRequired: true });
    await flushHookEffects();
    tree = renderLive({ runtimeState: "playing", status: "live", admissionRequired: true });
    await flushHookEffects();
    tree = renderLive({ runtimeState: "playing", status: "live", admissionRequired: true });
    await flushHookEffects();

    const secondVideo = findElements(tree, (element) => element.type === "video")[0];
    if (!secondVideo) throw new Error("Expected replacement HLS video element");
    expect(secondVideo.props.src).toBe("https://video.example.test/hls-b/manifest/video.m3u8");
    expect(currentTarget.currentTime).toBe(77);

    const secondLoadedMetadata = secondVideo.props.onLoadedMetadata as (event: { currentTarget: HTMLVideoElement }) => void;
    secondLoadedMetadata({ currentTarget: currentTarget as unknown as HTMLVideoElement });
    expect(currentTarget.currentTime).toBe(34);
    currentTarget.currentTime = 55;
    secondLoadedMetadata({ currentTarget: currentTarget as unknown as HTMLVideoElement });
    expect(currentTarget.currentTime).toBe(55);
  });

  it("refreshes route and admission once on ended, then applies replay zero for the same URL", async () => {
    hookState.effectsEnabled = true;
    vi.stubGlobal("window", { setInterval, clearInterval, location: { search: "" }, localStorage: {} });
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") return Promise.resolve({ ok: true });
      if (String(input).startsWith("/api/live-playback-source?")) {
        return Promise.resolve({ ok: true, json: async () => ({ playbackUrl: "https://video.example.test/same.mp4", playbackStartSeconds: 0 }) });
      }
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderLive({ runtimeState: "playing", status: "live", admissionRequired: true });
    await flushHookEffects();
    renderLive({ runtimeState: "playing", status: "live", admissionRequired: true });
    await flushHookEffects();
    let tree = renderLive({ runtimeState: "playing", status: "live", admissionRequired: true });
    const video = findElements(tree, (element) => element.type === "video")[0];
    if (!video) throw new Error("Expected playing video element");
    const currentTarget = { currentTime: 99, readyState: 1 };
    const videoRef = video.props.ref as { current: HTMLVideoElement | null };
    videoRef.current = currentTarget as unknown as HTMLVideoElement;
    const onLoadedMetadata = video.props.onLoadedMetadata as (event: { currentTarget: HTMLVideoElement }) => void;
    onLoadedMetadata({ currentTarget: currentTarget as unknown as HTMLVideoElement });
    expect(currentTarget.currentTime).toBe(0);
    currentTarget.currentTime = 37;

    (video.props.onEnded as () => void)();
    (video.props.onEnded as () => void)();
    expect(navigation.refresh).toHaveBeenCalledOnce();

    tree = renderLive({ runtimeState: "replay", status: "ended", admissionRequired: true });
    await flushHookEffects();
    tree = renderLive({ runtimeState: "replay", status: "ended", admissionRequired: true });
    await flushHookEffects();
    tree = renderLive({ runtimeState: "replay", status: "ended", admissionRequired: true });
    await flushHookEffects();

    expect(currentTarget.currentTime).toBe(0);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    expect(findElements(tree, (element) => element.type === "video")).toHaveLength(1);
  });

  it("flushes validated playback seconds with the shared page lineage", async () => {
    vi.stubGlobal("window", {
      location: { search: "?sourcePage=partner-page" },
      localStorage: {},
    });
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("00000000-0000-4000-8000-000000000001") });
    vi.mocked(postStreamUsageHeartbeat).mockResolvedValue("recorded");

    const tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4" });
    const video = findElements(tree, (element) => element.type === "video")[0];
    if (!video) throw new Error("Expected video element");

    (video.props.onPlay as (event: { currentTarget: { currentTime: number } }) => void)({ currentTarget: { currentTime: 0 } });
    for (let currentTime = 1; currentTime <= 60; currentTime += 1) {
      (video.props.onTimeUpdate as (event: { currentTarget: { currentTime: number } }) => void)({
        currentTarget: { currentTime },
      });
    }

    expect(postStreamUsageHeartbeat).toHaveBeenCalledWith(
      {
        vendorId: live.vendorId,
        liveId: live.id,
        sourcePageSlug: "partner-page",
        eventId: "00000000-0000-4000-8000-000000000001",
        watchSeconds: 60,
      },
      fetch,
      { signal: expect.any(AbortSignal) },
    );
  });

  it("stops controls and exposes an accessible recovery message when Stream quota is exhausted", async () => {
    vi.stubGlobal("window", {
      location: { search: "" },
      localStorage: {},
    });
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("00000000-0000-4000-8000-000000000002") });
    vi.mocked(postStreamUsageHeartbeat).mockResolvedValue("quota_exhausted");

    let tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4" });
    let video = findElements(tree, (element) => element.type === "video")[0];
    if (!video) throw new Error("Expected video element");

    const pause = vi.fn();
    (video.props.onPlay as (event: { currentTarget: { currentTime: number; pause: () => void } }) => void)({
      currentTarget: { currentTime: 0, pause },
    });
    for (let currentTime = 1; currentTime <= 60; currentTime += 1) {
      (video.props.onTimeUpdate as (event: { currentTarget: { currentTime: number; pause: () => void } }) => void)({
        currentTarget: { currentTime, pause },
      });
    }
    await vi.waitFor(() => expect(postStreamUsageHeartbeat).toHaveBeenCalledOnce());
    await Promise.resolve();

    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4" });
    video = findElements(tree, (element) => element.type === "video")[0];
    const quotaAlertComponent = findElements(tree, (element) => (
      typeof element.type === "function" && element.type.name === "StreamQuotaAlert"
    ))[0];
    if (!quotaAlertComponent || typeof quotaAlertComponent.type !== "function") {
      throw new Error("Expected Stream quota alert component");
    }
    const alerts = findElements(quotaAlertComponent.type({}), (element) => element.props.role === "alert");

    expect(video).toBeUndefined();
    expect(alerts.map((alert) => textContent(alert))).toContain(
      "直播播放額度已用完播放已暫停。請聯絡主辦人調整直播額度，完成後再重新整理頁面。",
    );

  });

  it("retries one ambiguous usage batch with the same event identity and does not show the quota alert", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      location: { search: "" },
      localStorage: {},
    });
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("00000000-0000-4000-8000-000000000003") });
    vi.mocked(postStreamUsageHeartbeat)
      .mockResolvedValueOnce("retryable_failure")
      .mockResolvedValueOnce("retryable_failure")
      .mockResolvedValueOnce("recorded");

    let tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4" });
    const video = findElements(tree, (element) => element.type === "video")[0];
    if (!video) throw new Error("Expected video element");

    (video.props.onPlay as (event: { currentTarget: { currentTime: number } }) => void)({ currentTarget: { currentTime: 0 } });
    for (let currentTime = 1; currentTime <= 60; currentTime += 1) {
      (video.props.onTimeUpdate as (event: { currentTarget: { currentTime: number } }) => void)({
        currentTarget: { currentTime },
      });
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(postStreamUsageHeartbeat).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(getStreamUsageRetryDelayMs("00000000-0000-4000-8000-000000000003", 0) ?? 0);
    expect(postStreamUsageHeartbeat).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(getStreamUsageRetryDelayMs("00000000-0000-4000-8000-000000000003", 1) ?? 0);
    expect(postStreamUsageHeartbeat).toHaveBeenCalledTimes(3);

    const payloads = vi.mocked(postStreamUsageHeartbeat).mock.calls.map(([payload]) => payload);
    expect(payloads).toEqual([
      expect.objectContaining({ eventId: "00000000-0000-4000-8000-000000000003", watchSeconds: 60 }),
      expect.objectContaining({ eventId: "00000000-0000-4000-8000-000000000003", watchSeconds: 60 }),
      expect.objectContaining({ eventId: "00000000-0000-4000-8000-000000000003", watchSeconds: 60 }),
    ]);
    expect(crypto.randomUUID).toHaveBeenCalledOnce();

    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4" });
    expect(findElements(tree, (element) => element.props.role === "alert")).toHaveLength(0);
    expect(findElements(tree, (element) => element.type === "video")[0]?.props.controls).toBe(true);
  });

  it("bounds automatic retries and does not turn progress events into a request storm", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      location: { search: "" },
      localStorage: {},
    });
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("00000000-0000-4000-8000-000000000004") });
    vi.mocked(postStreamUsageHeartbeat).mockResolvedValue("retryable_failure");

    const tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4" });
    const video = findElements(tree, (element) => element.type === "video")[0];
    if (!video) throw new Error("Expected video element");
    (video.props.onPlay as (event: { currentTarget: { currentTime: number } }) => void)({ currentTarget: { currentTime: 0 } });
    for (let currentTime = 1; currentTime <= 60; currentTime += 1) {
      (video.props.onTimeUpdate as (event: { currentTarget: { currentTime: number } }) => void)({ currentTarget: { currentTime } });
    }

    await vi.runAllTimersAsync();
    expect(postStreamUsageHeartbeat).toHaveBeenCalledTimes(1 + STREAM_USAGE_RETRY_DELAYS_MS.length);
    for (let currentTime = 61; currentTime <= 120; currentTime += 1) {
      (video.props.onTimeUpdate as (event: { currentTarget: { currentTime: number } }) => void)({ currentTarget: { currentTime } });
    }
    await vi.advanceTimersByTimeAsync(10_000);
    expect(postStreamUsageHeartbeat).toHaveBeenCalledTimes(1 + STREAM_USAGE_RETRY_DELAYS_MS.length);
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("cancels the retry schedule when a later attempt confirms quota exhaustion", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      location: { search: "" },
      localStorage: {},
    });
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("00000000-0000-4000-8000-000000000005") });
    vi.mocked(postStreamUsageHeartbeat)
      .mockResolvedValueOnce("retryable_failure")
      .mockResolvedValueOnce("quota_exhausted");

    let tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4" });
    const video = findElements(tree, (element) => element.type === "video")[0];
    if (!video) throw new Error("Expected video element");
    (video.props.onPlay as (event: { currentTarget: { currentTime: number } }) => void)({ currentTarget: { currentTime: 0 } });
    for (let currentTime = 1; currentTime <= 60; currentTime += 1) {
      (video.props.onTimeUpdate as (event: { currentTarget: { currentTime: number } }) => void)({ currentTarget: { currentTime } });
    }

    await vi.advanceTimersByTimeAsync(getStreamUsageRetryDelayMs("00000000-0000-4000-8000-000000000005", 0) ?? 0);
    expect(postStreamUsageHeartbeat).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(postStreamUsageHeartbeat).toHaveBeenCalledTimes(2);
    expect(crypto.randomUUID).toHaveBeenCalledOnce();

    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4" });
    expect(findElements(tree, (element) => (
      typeof element.type === "function" && element.type.name === "StreamQuotaAlert"
    ))).toHaveLength(1);
    expect(findElements(tree, (element) => element.type === "video")).toHaveLength(0);
  });

  it("adds stable event-derived jitter while keeping every retry within its bounded window", () => {
    const firstViewer = STREAM_USAGE_RETRY_DELAYS_MS.map((_delay, attempt) => (
      getStreamUsageRetryDelayMs("00000000-0000-4000-8000-000000000006", attempt)
    ));
    const secondViewer = STREAM_USAGE_RETRY_DELAYS_MS.map((_delay, attempt) => (
      getStreamUsageRetryDelayMs("00000000-0000-4000-8000-000000000007", attempt)
    ));

    expect(firstViewer).toEqual(STREAM_USAGE_RETRY_DELAYS_MS.map((base, attempt) => (
      getStreamUsageRetryDelayMs("00000000-0000-4000-8000-000000000006", attempt)
    )));
    firstViewer.forEach((delay, attempt) => {
      const base = STREAM_USAGE_RETRY_DELAYS_MS[attempt];
      expect(delay).not.toBeNull();
      expect(delay).toBeGreaterThanOrEqual(base);
      expect(delay).toBeLessThanOrEqual(base + Math.floor(base * 0.25));
    });
    expect(firstViewer).not.toEqual(secondViewer);
    expect(getStreamUsageRetryDelayMs("00000000-0000-4000-8000-000000000006", 3)).toBeNull();
  });

  it.each([
    ["scheduled", "即將直播"],
    ["live", "直播中"],
    ["ended", "精彩回放"],
    ["unknown", "直播"],
  ])("maps %s to the truthful %s public status", (status, label) => {
    expect(getLiveStatusLabel(status)).toBe(label);
  });

  it("only points aria-controls at the panel that currently exists", () => {
    const navigation = PlaybackNavigation({ panel: "chat", onPanelChange: vi.fn() });
    const inactiveButtons = findElements(navigation, (element) => element.type === "button");
    expect(inactiveButtons.every((button) => button.props["aria-controls"] === undefined)).toBe(true);

    const productsNavigation = PlaybackNavigation({ panel: "products", onPanelChange: vi.fn() });
    const productButton = findElements(productsNavigation, (element) => (
      element.type === "button" && textContent(element.props.children) === "商品"
    ))[0];

    expect(productButton?.props["aria-controls"]).toBe("live-playback-panel");
  });

  it("shows a non-submittable recovery state for an invalid registration schema", () => {
    let tree = renderLive({ form: null, formConfigurationUnavailable: true });
    const navigation = findElements(tree, (element) => element.type === PlaybackNavigation)[0];
    expect(navigation).toBeDefined();
    (navigation!.props.onPanelChange as (panel: "form") => void)("form");

    tree = renderLive({ form: null, formConfigurationUnavailable: true });
    const alerts = findElements(tree, (element) => element.props.role === "alert");

    expect(alerts.map((alert) => textContent(alert))).toContain("報名表欄位需要商家重新確認，目前暫停接收資料。");
  });

  it.each(["javascript:alert(1)", "data:text/html,unsafe", "//attacker.example.test/path"])(
    "does not submit an unsafe provider form action %s",
    (formAction) => {
      const createElement = vi.fn();
      vi.stubGlobal("document", { createElement });

      expect(submitCheckout({
        formAction,
        formMethod: "POST",
        formPayload: { MerID: "merchant-123" },
      })).toBe(false);
      expect(createElement).not.toHaveBeenCalled();
    },
  );

  it("blocks unsafe CTA navigation even when legacy data already contains it", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    expect(openExternalUrl("javascript:alert(document.cookie)")).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(openExternalUrl("https://shop.example.test/offer")).toBe(true);
    expect(open).toHaveBeenCalledWith(
      "https://shop.example.test/offer",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("shows a safe visible error when a timed CTA has no valid destination", async () => {
    vi.stubGlobal("window", {
      location: { search: "" },
      open: vi.fn(),
      localStorage: {},
    });
    const interactionEvents = [{
      id: "test-fixture-cta",
      eventType: "cta_switch",
      triggerSec: 0,
      title: "了解活動",
      message: null,
      productId: null,
      ctaLabel: "立即了解",
      ctaUrl: "javascript:alert(document.cookie)",
      role: null,
    }];

    let tree = renderLive({ interactionEvents });
    const ctaButton = findElements(
      tree,
      (element) => element.type === "button" && element.props["aria-label"] === "商家預設腳本導購：立即了解",
    )[0];
    if (!ctaButton) throw new Error("Expected timed CTA button");
    await (ctaButton.props.onClick as () => Promise<void>)();

    tree = renderLive({ interactionEvents });
    expect(checkoutErrors(tree)).toHaveLength(1);
    expect(textContent(checkoutErrors(tree)[0]?.props.children)).toBe("目前無法開啟這個連結，請稍後再試。");
    expect(findElements(tree, (element) => element.props.role === "dialog")).toHaveLength(0);
    expect(trackClientAnalytics).not.toHaveBeenCalled();
  });

  it("pauses for external product intent, keeps cancel side-effect free, and confirms only once", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      location: { href: "https://app.example.test/live/demo", search: "" },
      localStorage: {},
    });
    const products = live.products.map((product) => product.id === "test-fixture-product-1"
      ? { ...product, checkoutUrl: "https://merchant.example.test/buy" }
      : product);
    const interactionEvents = [productSpotlightEvent("external-product", 0, "test-fixture-product-1")];
    let tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", products, interactionEvents });
    const video = findElements(tree, (element) => element.type === "video")[0];
    const pause = vi.fn();
    if (!video) throw new Error("Expected video element");
    (video.props.ref as { current: unknown }).current = { pause };
    const buy = checkoutButtons(tree).find((button) => textContent(button.props.children) === "立即搶購");
    if (!buy) throw new Error("Expected spotlight checkout button");

    await (buy.props.onClick as () => Promise<void>)();
    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", products, interactionEvents });
    const dialog = findElements(tree, (element) => element.props.role === "dialog")[0];
    expect(pause).toHaveBeenCalledOnce();
    expect(dialog?.props["aria-modal"]).toBe("true");
    expect(textContent(dialog)).toContain("離開後直播聲音會中斷");
    expect(trackClientAnalytics).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(window.location.href).toBe("https://app.example.test/live/demo");

    const cancel = findElements(dialog, (element) => element.type === "button" && textContent(element.props.children) === "留在直播")[0];
    (cancel?.props.onClick as () => void)();
    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", products, interactionEvents });
    expect(findElements(tree, (element) => element.props.role === "dialog")).toHaveLength(0);
    expect(trackClientAnalytics).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.href).toBe("https://app.example.test/live/demo");

    await (checkoutButtons(tree).find((button) => textContent(button.props.children) === "立即搶購")?.props.onClick as () => Promise<void>)();
    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", products, interactionEvents });
    const confirmDialog = findElements(tree, (element) => typeof element.type === "function" && element.type.name === "ExternalNavigationConfirmDialog")[0];
    if (!confirmDialog) throw new Error("Expected external navigation dialog component");
    const confirm = confirmDialog.props.onConfirm as () => Promise<void>;
    const firstConfirm = confirm();
    const duplicateConfirm = confirm();
    const confirmingTree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", products, interactionEvents });
    const confirmingButton = findElements(confirmingTree, (element) => element.type === "button" && textContent(element.props.children) === "正在前往…")[0];
    expect(confirmingButton?.props.disabled).toBe(true);
    expect(confirmingButton?.props["aria-busy"]).toBe(true);
    await Promise.all([firstConfirm, duplicateConfirm]);

    expect(vi.mocked(trackClientAnalytics).mock.calls.filter(([event]) => event.eventType === "product_click")).toHaveLength(1);
    expect(window.location.href).toBe("https://merchant.example.test/buy");
    expect(navigation.push).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pauses for external CTA intent and keeps cancel and duplicate confirm one-shot", async () => {
    const open = vi.fn();
    const pendingAnalytics = deferred<boolean>();
    vi.mocked(trackClientAnalytics).mockReturnValueOnce(pendingAnalytics.promise);
    vi.stubGlobal("window", { location: { search: "" }, localStorage: {}, open });
    const interactionEvents = [{
      id: "external-cta",
      eventType: "cta_switch",
      triggerSec: 0,
      title: "外部活動",
      message: null,
      productId: null,
      ctaLabel: "查看外部活動",
      ctaUrl: "https://merchant.example.test/campaign",
      role: null,
    }];
    let tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", interactionEvents });
    const video = findElements(tree, (element) => element.type === "video")[0];
    const pause = vi.fn();
    if (!video) throw new Error("Expected video element");
    (video.props.ref as { current: unknown }).current = { pause };
    const cta = findElements(tree, (element) => element.props["aria-label"] === "商家預設腳本導購：查看外部活動")[0];
    await (cta?.props.onClick as () => Promise<void>)();

    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", interactionEvents });
    expect(pause).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(trackClientAnalytics).not.toHaveBeenCalled();
    const cancel = findElements(tree, (element) => element.type === "button" && textContent(element.props.children) === "留在直播")[0];
    (cancel?.props.onClick as () => void)();
    expect(open).not.toHaveBeenCalled();
    expect(trackClientAnalytics).not.toHaveBeenCalled();

    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", interactionEvents });
    await (findElements(tree, (element) => element.props["aria-label"] === "商家預設腳本導購：查看外部活動")[0]?.props.onClick as () => Promise<void>)();
    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", interactionEvents });
    const confirmDialog = findElements(tree, (element) => typeof element.type === "function" && element.type.name === "ExternalNavigationConfirmDialog")[0];
    const confirm = confirmDialog?.props.onConfirm as () => Promise<void>;
    const firstConfirm = confirm();
    const duplicateConfirm = confirm();
    expect(open).toHaveBeenCalledExactlyOnceWith("https://merchant.example.test/campaign", "_blank", "noopener,noreferrer");
    expect(vi.mocked(trackClientAnalytics).mock.results[0]?.value).toBe(pendingAnalytics.promise);
    await Promise.all([firstConfirm, duplicateConfirm]);

    expect(vi.mocked(trackClientAnalytics).mock.calls.filter(([event]) => event.eventType === "cta_click")).toHaveLength(1);
    expect(open).toHaveBeenCalledExactlyOnceWith("https://merchant.example.test/campaign", "_blank", "noopener,noreferrer");
  });

  it("keeps internal products immediate without a dialog or playback pause", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { location: { search: "" }, localStorage: {} });
    let tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4" });
    const video = findElements(tree, (element) => element.type === "video")[0];
    const pause = vi.fn();
    if (!video) throw new Error("Expected video element");
    (video.props.ref as { current: unknown }).current = { pause };
    const navigationComponent = findElements(tree, (element) => element.type === PlaybackNavigation)[0];
    (navigationComponent?.props.onPanelChange as (panel: "products") => void)("products");
    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4" });
    const buy = checkoutButtons(tree)[0];
    await (buy.props.onClick as () => Promise<void>)();

    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/checkout/test-fixture-vendor-1/test-fixture-product-1");
    expect(findElements(renderLive({ videoUrl: "https://video.example.test/recording.mp4" }), (element) => element.props.role === "dialog")).toHaveLength(0);
    expect(pause).not.toHaveBeenCalled();
    expect(vi.mocked(trackClientAnalytics).mock.calls.filter(([event]) => event.eventType === "product_click")).toHaveLength(1);
  });

  it("fails closed before intent for an invalid external product URL", async () => {
    vi.stubGlobal("window", { location: { href: "https://app.example.test/live/demo", search: "" }, localStorage: {} });
    const products = [{ ...live.products[0], checkoutUrl: "javascript:alert(document.cookie)" }, live.products[1]];
    const interactionEvents = [productSpotlightEvent("unsafe-product", 0, "test-fixture-product-1")];
    const tree = renderLive({ products, interactionEvents });
    await (checkoutButtons(tree)[0].props.onClick as () => Promise<void>)();
    const updated = renderLive({ products, interactionEvents });

    expect(findElements(updated, (element) => element.props.role === "dialog")).toHaveLength(0);
    expect(checkoutErrors(updated)).toHaveLength(1);
    expect(trackClientAnalytics).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(window.location.href).toBe("https://app.example.test/live/demo");
  });

  it("labels merchant-configured interaction roles, product spotlights, and CTAs truthfully", () => {
    const interactionEvents = [
      {
        id: "test-fixture-product",
        eventType: "product_spotlight",
        triggerSec: 0,
        title: "商品聚焦",
        message: null,
        productId: "test-fixture-product-2",
        ctaLabel: null,
        ctaUrl: null,
        role: null,
      },
      {
        id: "test-fixture-cta",
        eventType: "cta_switch",
        triggerSec: 0,
        title: "看活動",
        message: null,
        productId: null,
        ctaLabel: "查看活動",
        ctaUrl: "https://shop.example.test/deal",
        role: null,
      },
    ];

    const tree = renderLive({
      interactionEvents,
      scheduledMessages: [{
        id: "test-fixture-chat",
        source: "scheduled",
        triggerSec: 0,
        body: "歡迎來到直播",
        actor: { name: "直播小編", avatarUrl: null, label: "官方角色", presentationRole: "official" },
      }],
    });
    const pageCopy = textContent(tree);
    const chatPanel = findElements(tree, (element) => element.type === LiveChatPanel)[0];

    expect(pageCopy).toContain("官方互動為商家預先設定的腳本");
    expect(pageCopy).toContain("不代表即時真人留言、真實購買或觀看人數");
    expect(pageCopy).toContain("腳本推薦");
    expect(pageCopy).toContain("商家腳本");
    expect(chatPanel?.props.scheduledMessages).toEqual([expect.objectContaining({ id: "test-fixture-chat", source: "scheduled" })]);
    expect(chatPanel?.props.enabled).toBe(false);
  });

  it("does not render a product card before a valid spotlight event and shows it at the trigger second", () => {
    const interactionEvents = [productSpotlightEvent("spotlight-later", 10, "test-fixture-product-2")];
    let tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", interactionEvents });

    expect(findElements(tree, (element) => element.props["data-spotlight-state"] !== undefined)).toHaveLength(0);
    expect(textContent(tree)).not.toContain("測試商品二");

    const video = findElements(tree, (element) => element.type === "video")[0];
    if (!video) throw new Error("Expected video element");
    (video.props.onTimeUpdate as (event: { currentTarget: { currentTime: number } }) => void)({ currentTarget: { currentTime: 10 } });
    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", interactionEvents });

    expect(findElements(tree, (element) => element.props["data-spotlight-state"] === "expanded")).toHaveLength(1);
    expect(textContent(tree)).toContain("測試商品二");
  });

  it("supports minimizing, closing, and reopening the event-driven card from the independent product panel", () => {
    const interactionEvents = [productSpotlightEvent("spotlight-now", 0, "test-fixture-product-2")];
    let tree = renderLive({ interactionEvents });
    const minimize = findElements(tree, (element) => element.type === "button" && element.props["aria-label"] === "縮小推薦商品浮卡")[0];
    if (!minimize) throw new Error("Expected spotlight minimize button");

    (minimize.props.onClick as () => void)();
    tree = renderLive({ interactionEvents });
    const minimized = findElements(tree, (element) => element.props["data-spotlight-state"] === "minimized")[0];
    expect(minimized?.props["aria-label"]).toBe("展開推薦商品：測試商品二");
    expect(minimized?.props["aria-expanded"]).toBe("false");

    (minimized?.props.onClick as () => void)();
    tree = renderLive({ interactionEvents });
    expect(findElements(tree, (element) => element.props["data-spotlight-state"] === "expanded")).toHaveLength(1);
    const close = findElements(tree, (element) => element.type === "button" && element.props["aria-label"] === "關閉推薦商品浮卡")[0];
    if (!close) throw new Error("Expected spotlight close button");
    (close.props.onClick as () => void)();

    tree = renderLive({ interactionEvents });
    expect(findElements(tree, (element) => element.props["data-spotlight-state"] !== undefined)).toHaveLength(0);
    const navigation = findElements(tree, (element) => element.type === PlaybackNavigation)[0];
    if (!navigation) throw new Error("Expected playback navigation");
    (navigation.props.onPanelChange as (panel: "products") => void)("products");
    tree = renderLive({ interactionEvents });
    expect(findElements(tree, (element) => element.props["aria-label"] === "直播商品")).toHaveLength(1);
    const reopen = findElements(tree, (element) => element.type === "button" && element.props["aria-label"] === "重新開啟推薦商品浮卡：測試商品二")[0];
    if (!reopen) throw new Error("Expected spotlight reopen button");
    (reopen.props.onClick as () => void)();

    tree = renderLive({ interactionEvents });
    expect(findElements(tree, (element) => element.props["data-spotlight-state"] === "expanded")).toHaveLength(1);
  });

  it.each(["minimized", "dismissed"] as const)("keeps the %s card state while a newer event changes the product", (state) => {
    const interactionEvents = [
      productSpotlightEvent("spotlight-first", 0, "test-fixture-product-1"),
      productSpotlightEvent("spotlight-second", 10, "test-fixture-product-2"),
    ];
    let tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", interactionEvents });
    const stateButtonLabel = state === "minimized" ? "縮小推薦商品浮卡" : "關閉推薦商品浮卡";
    const stateButton = findElements(tree, (element) => element.type === "button" && element.props["aria-label"] === stateButtonLabel)[0];
    if (!stateButton) throw new Error(`Expected spotlight ${state} button`);
    (stateButton.props.onClick as () => void)();

    const video = findElements(tree, (element) => element.type === "video")[0];
    if (!video) throw new Error("Expected video element");
    (video.props.onTimeUpdate as (event: { currentTarget: { currentTime: number } }) => void)({ currentTarget: { currentTime: 10 } });
    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", interactionEvents });

    if (state === "minimized") {
      const minimized = findElements(tree, (element) => element.props["data-spotlight-state"] === "minimized")[0];
      expect(minimized?.props["aria-label"]).toBe("展開推薦商品：測試商品二");
    } else {
      expect(findElements(tree, (element) => element.props["data-spotlight-state"] !== undefined)).toHaveLength(0);
      const navigation = findElements(tree, (element) => element.type === PlaybackNavigation)[0];
      if (!navigation) throw new Error("Expected playback navigation");
      (navigation.props.onPanelChange as (panel: "products") => void)("products");
      tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", interactionEvents });
      expect(findElements(tree, (element) => element.props["aria-label"] === "重新開啟推薦商品浮卡：測試商品二")).toHaveLength(1);
    }
  });

  it("renders scheduled official and audience messages only at or after their trigger second", () => {
    const scheduledMessages: ScheduledRuntimeMessage[] = [
      {
        id: "scheduled-official",
        source: "scheduled",
        triggerSec: 10,
        body: "官方提醒",
        actor: { name: "直播小編", avatarUrl: null, label: "官方角色", presentationRole: "official" },
      },
      {
        id: "scheduled-audience",
        source: "scheduled",
        triggerSec: 10,
        body: "觀眾提醒",
        actor: { name: "小明", avatarUrl: null, label: "一般觀眾", presentationRole: "audience" },
      },
    ];

    let tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", scheduledMessages });
    expect(findElements(tree, (element) => element.type === LiveChatPanel)[0]?.props.scheduledMessages).toEqual([]);

    const video = findElements(tree, (element) => element.type === "video")[0];
    if (!video) throw new Error("Expected video element");
    const onTimeUpdate = video.props.onTimeUpdate as (event: { currentTarget: { currentTime: number } }) => void;
    onTimeUpdate({ currentTarget: { currentTime: 9.99 } });
    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", scheduledMessages });
    expect(findElements(tree, (element) => element.type === LiveChatPanel)[0]?.props.scheduledMessages).toEqual([]);

    onTimeUpdate({ currentTarget: { currentTime: 10 } });
    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", scheduledMessages });
    expect(findElements(tree, (element) => element.type === LiveChatPanel)[0]?.props.scheduledMessages).toEqual(scheduledMessages);

    onTimeUpdate({ currentTarget: { currentTime: 9.25 } });
    tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4", scheduledMessages });
    expect(findElements(tree, (element) => element.type === LiveChatPanel)[0]?.props.scheduledMessages).toEqual([]);
  });

  it("does not label a different live product as a scripted recommendation when the spotlight target is stale", () => {
    const interactionEvents = [{
      id: "test-fixture-stale-product",
      eventType: "product_spotlight",
      triggerSec: 0,
      title: "失效商品聚焦",
      message: null,
      productId: "product-not-in-live",
      ctaLabel: null,
      ctaUrl: null,
      role: null,
    }];

    const pageCopy = textContent(renderLive({ interactionEvents }));

    expect(pageCopy).not.toContain("測試商品一");
    expect(pageCopy).not.toContain("腳本推薦");
    expect(findElements(renderLive({ interactionEvents }), (element) => element.props["data-spotlight-state"] !== undefined)).toHaveLength(0);
  });

  it("does not imply that a script will appear when the live has no interaction events", () => {
    const pageCopy = textContent(renderLive({ interactionEvents: [] }));

    expect(pageCopy).toContain("目前沒有商家預設互動腳本");
    expect(pageCopy).not.toContain("播放到指定秒數後，商家預先設定的互動腳本會出現在這裡");
    expect(findElements(renderLive({ interactionEvents: [] }), (element) => element.type === LiveChatPanel)[0]?.props.scheduledMessages).toEqual([]);
  });

  it("builds an encoded same-origin checkout route and rejects missing identities", () => {
    expect(checkoutPagePath("vendor 123", "product/123")).toBe("/checkout/vendor%20123/product%2F123");
    expect(checkoutPagePath("", "product-123")).toBeNull();
    expect(checkoutPagePath("vendor-123", "   ")).toBeNull();
    expect(isInternalCheckoutPath("/checkout/vendor-123/product-123")).toBe(true);
    expect(isInternalCheckoutPath("/checkout/vendor-123")).toBe(false);
  });

  it("uses client navigation for internal checkout and preserves hard navigation for external checkout", async () => {
    const navigateInternal = vi.fn();
    vi.stubGlobal("window", { location: { href: "https://app.example.test/live/demo" } });

    await expect(requestCheckout({ vendorId: "vendor-123", productId: "product-123", navigateInternal })).resolves.toBe(true);
    expect(navigateInternal).toHaveBeenCalledWith("/checkout/vendor-123/product-123");
    expect(window.location.href).toBe("https://app.example.test/live/demo");

    navigateInternal.mockClear();
    await expect(requestCheckout({
      vendorId: "vendor-123",
      productId: "product-123",
      checkoutUrl: "https://merchant.example.test/buy",
      navigateInternal,
    })).resolves.toBe(true);
    expect(navigateInternal).not.toHaveBeenCalled();
    expect(window.location.href).toBe("https://merchant.example.test/buy");
  });

  it("keeps the video branch mounted while presenting checkout miniplayer controls", () => {
    navigation.pathname = "/checkout/test-fixture-vendor-1/test-fixture-product-1";
    const tree = renderLive({ videoUrl: "https://video.example.test/recording.mp4" });
    const video = findElements(tree, (element) => element.type === "video");
    const shell = findElements(tree, (element) => element.props["data-testid"] === "persistent-live-player")[0];
    expect(video).toHaveLength(1);
    expect(String(shell?.props.className)).toContain("fixed");
    expect(textContent(tree)).toContain("測試直播");
    expect(findElements(tree, (element) => element.props["aria-label"] === "返回直播")).toHaveLength(1);
    expect(findElements(tree, (element) => element.props["aria-label"] === "播放直播")).toHaveLength(1);
    expect(findElements(tree, (element) => element.props["aria-label"] === "將直播靜音")).toHaveLength(1);
    expect(findElements(tree, (element) => element.props["aria-label"] === "展開直播小窗")).toHaveLength(1);
  });

  it("routes purchase intent to the local buyer-details page without calling the payment API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { href: "https://app.example.test/live/demo" } });

    await expect(requestCheckout({
      vendorId: "vendor-123",
      productId: "product-123",
    })).resolves.toBe(true);

    expect(window.location.href).toBe("/checkout/vendor-123/product-123");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes an external-checkout product to its validated merchant URL", async () => {
    vi.stubGlobal("window", { location: { href: "https://app.example.test/live/demo" } });
    await expect(requestCheckout({ vendorId: "vendor-123", productId: "product-123", checkoutUrl: "https://merchant.example.test/buy" })).resolves.toBe(true);
    expect(window.location.href).toBe("https://merchant.example.test/buy");
  });

  it("does not navigate or call payment when a checkout identity is incomplete", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { href: "https://app.example.test/live/demo" } });

    await expect(requestCheckout({ vendorId: "vendor-123", productId: "" })).resolves.toBe(false);

    expect(window.location.href).toBe("https://app.example.test/live/demo");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps every purchase button locked until slow local navigation settles or times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      location: {
        search: "",
        pathname: "/live/demo",
        href: "https://app.example.test/live/demo",
      },
      localStorage: {},
    });
    const interactionEvents = [productSpotlightEvent("checkout-spotlight", 0, "test-fixture-product-1")];
    const renderCheckoutLive = () => renderLive({ interactionEvents });

    let tree = renderCheckoutLive();
    const playbackNavigation = findElements(tree, (element) => element.type === PlaybackNavigation)[0];
    if (!playbackNavigation) throw new Error("Expected playback navigation");
    (playbackNavigation.props.onPanelChange as (panel: "products") => void)("products");
    tree = renderCheckoutLive();

    const initialButtons = checkoutButtons(tree);
    expect(initialButtons).toHaveLength(3);
    const firstCheckout = initialButtons[0].props.onClick as () => Promise<void>;
    const secondCheckout = initialButtons[1].props.onClick as () => Promise<void>;
    const pendingNavigation = firstCheckout();

    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/checkout/test-fixture-vendor-1/test-fixture-product-1");
    expect(checkoutButtons(renderCheckoutLive()).every((button) => button.props.disabled === true)).toBe(true);

    await secondCheckout();
    expect(navigation.push).toHaveBeenCalledTimes(1);
    await pendingNavigation;

    expect(checkoutButtons(renderCheckoutLive()).every((button) => button.props.disabled === true)).toBe(true);
    expect(checkoutErrors(renderCheckoutLive())).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(CHECKOUT_NAVIGATION_LOCK_TIMEOUT_MS);
    expect(checkoutButtons(renderCheckoutLive()).every((button) => button.props.disabled === false)).toBe(true);
    expect(textContent(checkoutErrors(renderCheckoutLive()))).toContain("結帳頁載入逾時");
  });
});
