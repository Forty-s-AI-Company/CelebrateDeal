import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  cursor: 0,
  refCursor: 0,
  values: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();

  return {
    ...react,
    useEffect: () => undefined,
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
import type { ScheduledRuntimeMessage } from "@/lib/live-chat-contract";
import { LiveChatPanel } from "./live-chat-panel";
import { affiliateClickEndpoint, checkoutPagePath, getLiveStatusLabel, getStreamUsageRetryDelayMs, isHlsPlaybackUrl, LivePlayback, openExternalUrl, PlaybackNavigation, requestCheckout, ScriptedInteractionOverlay, shouldResetAffiliateAttribution, STREAM_USAGE_RETRY_DELAYS_MS, stripLiveShareFromUrl, submitCheckout } from "./live-playback";

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

function renderLive(overrides: Partial<Parameters<typeof LivePlayback>[0]["live"]> = {}) {
  hookState.cursor = 0;
  hookState.refCursor = 0;
  return LivePlayback({ live: { ...live, ...overrides } });
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    hookState.cursor = 0;
    hookState.refCursor = 0;
    hookState.values = [];
    hookState.refs = [];
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

    expect(pageCopy).toContain("主打商品");
    expect(pageCopy).toContain("測試商品一");
    expect(pageCopy).not.toContain("腳本推薦");
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

  it("disables every purchase button during local navigation and prevents a second navigation", async () => {
    let assignedHref = "https://app.example.test/live/demo";
    let assignmentCount = 0;
    vi.stubGlobal("window", {
      location: {
        search: "",
        pathname: "/live/demo",
        get href() { return assignedHref; },
        set href(value: string) { assignedHref = value; assignmentCount += 1; },
      },
      localStorage: {},
    });

    let tree = renderLive();
    const navigation = findElements(tree, (element) => element.type === PlaybackNavigation)[0];
    if (!navigation) throw new Error("Expected playback navigation");
    (navigation.props.onPanelChange as (panel: "products") => void)("products");
    tree = renderLive();

    const initialButtons = checkoutButtons(tree);
    expect(initialButtons).toHaveLength(3);
    const firstCheckout = initialButtons[0].props.onClick as () => Promise<void>;
    const secondCheckout = initialButtons[1].props.onClick as () => Promise<void>;
    const pendingNavigation = firstCheckout();

    expect(assignedHref).toBe("/checkout/test-fixture-vendor-1/test-fixture-product-1");
    expect(assignmentCount).toBe(1);
    expect(checkoutButtons(renderLive()).every((button) => button.props.disabled === true)).toBe(true);

    await secondCheckout();
    expect(assignmentCount).toBe(1);
    await pendingNavigation;

    expect(checkoutButtons(renderLive()).every((button) => button.props.disabled === false)).toBe(true);
    expect(checkoutErrors(renderLive())).toHaveLength(0);
  });
});
