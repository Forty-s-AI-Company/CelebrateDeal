import type { ViewerRuntimeMessage } from "@/lib/live-chat-contract";

/**
 * One shared poll per viewer page for chat and interaction state (F-091 (2)).
 *
 * Components subscribe to a per-live channel. The channel owns the single
 * timer, the `since` cursor and the abort controller, and fans each payload
 * out to every subscriber. Visibility gating stays with the caller: a hidden
 * tab unsubscribes (see `useLiveUpdates`), and subscribing again fetches
 * immediately.
 */

export const LIVE_UPDATES_ENDPOINT = "/api/live-updates";
export const LIVE_UPDATES_MIN_INTERVAL_MS = 2_000;
export const LIVE_UPDATES_MAX_INTERVAL_MS = 10_000;
export const LIVE_UPDATES_ERROR_INTERVAL_MS = 3_000;
/** Every Nth poll ignores the cursor so a late-committed row cannot stay missing. */
export const LIVE_UPDATES_RESYNC_EVERY = 20;
const CHAT_BODY_MAX_LENGTH = 1_000;
const CLIENT_HEADERS = { "X-CelebrateDeal-Client": "web" };

export type LiveUpdatesViewer = {
  canPost: boolean;
  displayName: string | null;
  reason: "verification_required" | "blocked" | null;
};

export type LiveUpdatesPayload = {
  cursor: string | null;
  nextPollMs: number;
  chat?: { messages: ViewerRuntimeMessage[]; reset: boolean; viewer: LiveUpdatesViewer };
  interactions?: { runs: unknown[]; spotlight: unknown | null };
};

export type LiveUpdatesInclude = { chat: boolean; interactions: boolean };
export type LiveUpdatesStatus = "ok" | "error" | "unauthorized";

export type LiveUpdatesSubscriber = {
  include: LiveUpdatesInclude;
  onUpdate: (payload: LiveUpdatesPayload) => void;
  onStatus?: (status: LiveUpdatesStatus) => void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseViewerRuntimeMessage(value: unknown): ViewerRuntimeMessage | null {
  if (!isObject(value) || value.source !== "viewer") return null;
  if (typeof value.id !== "string" || !value.id || value.id.length > 128) return null;
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) return null;
  if (typeof value.body !== "string" || !value.body.trim() || Array.from(value.body).length > CHAT_BODY_MAX_LENGTH) return null;
  if (!isObject(value.actor) || typeof value.actor.name !== "string" || !value.actor.name.trim()) return null;
  return {
    id: value.id,
    source: "viewer",
    createdAt: value.createdAt,
    body: value.body,
    actor: { name: value.actor.name },
  };
}

export function parseLiveUpdatesViewer(value: unknown): LiveUpdatesViewer | null {
  if (!isObject(value) || typeof value.canPost !== "boolean") return null;
  const { displayName, reason } = value;
  if (displayName !== null && typeof displayName !== "string") return null;
  if (reason !== null && reason !== "verification_required" && reason !== "blocked") return null;
  return { canPost: value.canPost, displayName, reason };
}

export function parseLiveUpdatesPayload(value: unknown): LiveUpdatesPayload | null {
  if (!isObject(value)) return null;
  const cursor = value.cursor;
  if (cursor !== null && typeof cursor !== "string") return null;
  if (typeof value.nextPollMs !== "number" || !Number.isFinite(value.nextPollMs)) return null;
  const payload: LiveUpdatesPayload = { cursor, nextPollMs: value.nextPollMs };

  if (value.chat !== undefined) {
    const chat = value.chat;
    if (!isObject(chat) || !Array.isArray(chat.messages) || typeof chat.reset !== "boolean") return null;
    const messages = chat.messages.map(parseViewerRuntimeMessage).filter((message): message is ViewerRuntimeMessage => message !== null);
    if (messages.length !== chat.messages.length) return null;
    const viewer = parseLiveUpdatesViewer(chat.viewer);
    if (!viewer) return null;
    payload.chat = { messages, reset: chat.reset, viewer };
  }
  if (value.interactions !== undefined) {
    const interactions = value.interactions;
    if (!isObject(interactions) || !Array.isArray(interactions.runs)) return null;
    payload.interactions = { runs: interactions.runs, spotlight: interactions.spotlight ?? null };
  }
  return payload;
}

export function clampPollInterval(ms: number) {
  return Math.min(LIVE_UPDATES_MAX_INTERVAL_MS, Math.max(LIVE_UPDATES_MIN_INTERVAL_MS, Math.round(ms)));
}

/** Failed polls retry at 3 s, then 6 s, up to the 10 s ceiling. */
export function errorPollInterval(consecutiveErrors: number) {
  const exponent = Math.max(0, Math.min(consecutiveErrors - 1, 2));
  return Math.min(LIVE_UPDATES_MAX_INTERVAL_MS, LIVE_UPDATES_ERROR_INTERVAL_MS * 2 ** exponent);
}

export function liveUpdatesUrl(input: { vendorId: string; liveId: string; since: string | null; include: LiveUpdatesInclude }) {
  const query = new URLSearchParams({ vendorId: input.vendorId, liveId: input.liveId });
  const parts = [input.include.chat ? "chat" : null, input.include.interactions ? "interactions" : null].filter(Boolean);
  query.set("include", parts.join(","));
  if (input.include.chat && input.since) query.set("since", input.since);
  return `${LIVE_UPDATES_ENDPOINT}?${query.toString()}`;
}

type ChannelOptions = {
  fetchImpl?: typeof fetch;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  onEmpty?: () => void;
};

export class LiveUpdatesChannel {
  private readonly subscribers = new Set<LiveUpdatesSubscriber>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private cursor: string | null = null;
  private pollCount = 0;
  private consecutiveErrors = 0;
  private running = false;

  constructor(
    private readonly scope: { vendorId: string; liveId: string },
    private readonly options: ChannelOptions = {},
  ) {}

  get subscriberCount() {
    return this.subscribers.size;
  }

  subscribe(subscriber: LiveUpdatesSubscriber) {
    const hadChat = this.wantsChat();
    this.subscribers.add(subscriber);
    // A new chat consumer starts with an empty list, so it needs a snapshot.
    if (!hadChat && subscriber.include.chat) this.cursor = null;
    this.restart();
    return () => {
      if (!this.subscribers.delete(subscriber)) return;
      if (this.subscribers.size === 0) {
        this.stop();
        this.cursor = null;
        this.options.onEmpty?.();
      }
    };
  }

  private wantsChat() {
    for (const subscriber of this.subscribers) if (subscriber.include.chat) return true;
    return false;
  }

  private include(): LiveUpdatesInclude {
    let chat = false;
    let interactions = false;
    for (const subscriber of this.subscribers) {
      chat ||= subscriber.include.chat;
      interactions ||= subscriber.include.interactions;
    }
    return { chat, interactions };
  }

  private restart() {
    this.cancelInFlight();
    this.running = true;
    this.schedule(0);
  }

  private stop() {
    this.running = false;
    this.cancelInFlight();
  }

  private cancelInFlight() {
    if (this.timer !== null) (this.options.clearTimer ?? clearTimeout)(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  private schedule(ms: number) {
    if (!this.running) return;
    if (this.timer !== null) (this.options.clearTimer ?? clearTimeout)(this.timer);
    this.timer = (this.options.setTimer ?? setTimeout)(() => {
      this.timer = null;
      void this.poll();
    }, ms);
  }

  private notify(status: LiveUpdatesStatus) {
    for (const subscriber of [...this.subscribers]) subscriber.onStatus?.(status);
  }

  private async poll() {
    if (!this.running || this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    const include = this.include();
    this.pollCount += 1;
    const resync = this.pollCount % LIVE_UPDATES_RESYNC_EVERY === 0;
    const since = resync ? null : this.cursor;
    let nextDelay: number = LIVE_UPDATES_ERROR_INTERVAL_MS;
    try {
      const response = await (this.options.fetchImpl ?? fetch)(liveUpdatesUrl({ ...this.scope, since, include }), {
        headers: CLIENT_HEADERS,
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        // Admission is gone; stay quiet until a consumer resubscribes.
        this.consecutiveErrors = 0;
        this.running = false;
        this.notify("unauthorized");
        return;
      }
      const payload = response.ok ? parseLiveUpdatesPayload(await response.json()) : null;
      if (controller.signal.aborted) return;
      if (!payload) {
        // An unusable cursor (e.g. rotated key) restarts from a snapshot.
        if (response.status === 400) this.cursor = null;
        this.consecutiveErrors += 1;
        nextDelay = errorPollInterval(this.consecutiveErrors);
        this.notify("error");
        return;
      }
      this.consecutiveErrors = 0;
      if (include.chat && payload.cursor) this.cursor = payload.cursor;
      nextDelay = clampPollInterval(payload.nextPollMs);
      for (const subscriber of [...this.subscribers]) {
        subscriber.onUpdate(payload);
        subscriber.onStatus?.("ok");
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      this.consecutiveErrors += 1;
      nextDelay = errorPollInterval(this.consecutiveErrors);
      this.notify("error");
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        this.schedule(nextDelay);
      }
    }
  }
}

const channels = new Map<string, LiveUpdatesChannel>();

export function subscribeLiveUpdates(scope: { vendorId: string; liveId: string }, subscriber: LiveUpdatesSubscriber) {
  const key = `${scope.vendorId}:${scope.liveId}`;
  let channel = channels.get(key);
  if (!channel) {
    const created = new LiveUpdatesChannel(scope, { onEmpty: () => { if (channels.get(key) === created) channels.delete(key); } });
    channels.set(key, created);
    channel = created;
  }
  return channel.subscribe(subscriber);
}
