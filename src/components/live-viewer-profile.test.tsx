import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { interactionRoleAvatarUrl } from "@/lib/interaction-role";
import type { LiveRuntimeState } from "@/lib/live-runtime-state";
import type { ScheduledRuntimeMessage, ViewerRuntimeMessage } from "@/lib/live-chat-contract";
import { parseViewerRuntimeMessage } from "@/lib/live-updates-client";
import { isNicknameMissing, LiveChatPanel } from "./live-chat-panel";
import {
  abortAfter,
  ChatAvatar,
  fetchLiveViewerProfile,
  LIVE_VIEWER_AVATAR_OPTIONS,
  LIVE_VIEWER_PROFILE_READ_TIMEOUT_MS,
  liveViewerProfileGateRequired,
  liveViewerProfileRequiredForChat,
  LiveViewerProfileDialog,
  LiveViewerProfileLayer,
  liveViewerProfileSaveOutcome,
  parseLiveViewerProfile,
  useLiveViewerProfileGate,
} from "./live-viewer-profile";

type GateInput = Parameters<typeof useLiveViewerProfileGate>[0];
const gateInput: GateInput = {
  vendorId: "vendor-1",
  liveId: "live-1",
  runtimeState: "playing",
  admissionRequired: true,
  chatEnabled: true,
  admissionStatus: "admitted",
};

/** Renders the hook once (effects do not run on the server) and returns its result. */
function renderGate(overrides: Partial<GateInput> = {}) {
  let result: ReturnType<typeof useLiveViewerProfileGate> | null = null;
  function Harness() {
    result = useLiveViewerProfileGate({ ...gateInput, ...overrides });
    return <LiveViewerProfileLayer dialog={result.dialog} />;
  }
  const html = renderToStaticMarkup(<Harness />);
  return { result: result as unknown as ReturnType<typeof useLiveViewerProfileGate>, html };
}

describe("nickname gate", () => {
  it("holds a live room back until the viewer has a nickname", () => {
    const { result, html } = renderGate();
    expect(result.enabled).toBe(true);
    expect(result.gateOpen).toBe(true);
    // The player waits as if admission were still running: no source, no autoplay.
    expect(result.playbackAdmissionStatus).toBe("checking");
    expect(html).toContain("設定你在直播間的名稱");
    expect(html).toContain("正在準備直播間");
  });

  it("does not force replay viewers; they are asked when posting", () => {
    const { result, html } = renderGate({ runtimeState: "replay" });
    expect(result.gateOpen).toBe(false);
    expect(result.playbackAdmissionStatus).toBe("admitted");
    expect(result.chat).toMatchObject({ required: true, profile: null });
    expect(html).toBe("");
  });

  it("stays off without chat, before admission and outside playable states", () => {
    for (const overrides of [
      { chatEnabled: false },
      { admissionRequired: false },
      { admissionStatus: "checking" as const },
      { admissionStatus: "blocked" as const },
      { runtimeState: "waiting" as LiveRuntimeState },
      { runtimeState: "unavailable" as LiveRuntimeState },
    ]) {
      const { result } = renderGate(overrides);
      expect(result.enabled).toBe(false);
      expect(result.gateOpen).toBe(false);
      expect(result.chat).toBeUndefined();
      expect(result.playbackAdmissionStatus).toBe(overrides.admissionStatus ?? "admitted");
    }
  });

  it("decides the gate from the profile read", () => {
    const base = { enabled: true, runtimeState: "playing" as const, hasProfile: false };
    expect(liveViewerProfileGateRequired({ ...base, status: "idle" })).toBe(true);
    expect(liveViewerProfileGateRequired({ ...base, status: "loading" })).toBe(true);
    expect(liveViewerProfileGateRequired({ ...base, status: "ready" })).toBe(true);
    expect(liveViewerProfileGateRequired({ ...base, status: "ready", hasProfile: true })).toBe(false);
    // A failed read never locks a viewer out of watching.
    expect(liveViewerProfileGateRequired({ ...base, status: "error" })).toBe(false);
    expect(liveViewerProfileGateRequired({ ...base, status: "ready", runtimeState: "replay" })).toBe(false);
    expect(liveViewerProfileRequiredForChat({ enabled: true, status: "ready" })).toBe(true);
    expect(liveViewerProfileRequiredForChat({ enabled: true, status: "error" })).toBe(false);
    expect(liveViewerProfileRequiredForChat({ enabled: false, status: "ready" })).toBe(false);
  });
});

describe("profile read", () => {
  /** A fetch that only ends when its signal aborts, like a hung request. */
  const hangingFetch = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
  })) as unknown as typeof fetch;

  it("gives up after the timeout and reports an error, which never blocks watching", async () => {
    const started = Date.now();
    const result = await fetchLiveViewerProfile({ vendorId: "vendor-1", liveId: "live-1", timeoutMs: 30, fetchImpl: hangingFetch });
    expect(result).toEqual({ status: "error" });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(liveViewerProfileGateRequired({ enabled: true, runtimeState: "playing", status: result.status, hasProfile: false })).toBe(false);
    expect(LIVE_VIEWER_PROFILE_READ_TIMEOUT_MS).toBe(6_000);
  });

  it("parses a profile and suggestion, and treats a failed response as an error", async () => {
    const url = interactionRoleAvatarUrl("host-blue");
    const calls: Array<[string, RequestInit | undefined]> = [];
    const okFetch = (async (input: string, init?: RequestInit) => {
      calls.push([input, init]);
      return new Response(JSON.stringify({ profile: { nickname: "小明", avatarSeed: "host-blue", avatarUrl: url }, suggestedNickname: null }));
    }) as unknown as typeof fetch;
    await expect(fetchLiveViewerProfile({ vendorId: "vendor-1", liveId: "live-1", fetchImpl: okFetch }))
      .resolves.toEqual({ status: "ready", profile: { nickname: "小明", avatarSeed: "host-blue", avatarUrl: url }, suggestedNickname: null });
    expect(calls[0]?.[0]).toBe("/api/live-viewer-profile?vendorId=vendor-1&liveId=live-1");
    expect(calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);

    const failing = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    await expect(fetchLiveViewerProfile({ vendorId: "vendor-1", liveId: "live-1", fetchImpl: failing })).resolves.toEqual({ status: "error" });
  });

  it("works in browsers without AbortSignal.any or AbortSignal.timeout (Safari 16.4, Chrome 111)", async () => {
    const any = Object.getOwnPropertyDescriptor(AbortSignal, "any");
    const timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
    Object.defineProperty(AbortSignal, "any", { configurable: true, value: undefined });
    Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: undefined });
    try {
      expect(AbortSignal.any).toBeUndefined();
      expect(AbortSignal.timeout).toBeUndefined();
      // Timeout still fires and is reported as a failed read (fail open).
      await expect(fetchLiveViewerProfile({ vendorId: "vendor-1", liveId: "live-1", timeoutMs: 30, fetchImpl: hangingFetch }))
        .resolves.toEqual({ status: "error" });
      // The caller's abort is still forwarded.
      const controller = new AbortController();
      const pending = fetchLiveViewerProfile({ vendorId: "vendor-1", liveId: "live-1", signal: controller.signal, fetchImpl: hangingFetch });
      controller.abort();
      await expect(pending).resolves.toEqual({ status: "error" });
      // And a normal read still succeeds.
      const okFetch = (async () => new Response(JSON.stringify({ profile: null, suggestedNickname: "王大明", canSetNickname: true }))) as unknown as typeof fetch;
      await expect(fetchLiveViewerProfile({ vendorId: "vendor-1", liveId: "live-1", fetchImpl: okFetch }))
        .resolves.toEqual({ status: "ready", profile: null, suggestedNickname: "王大明" });
    } finally {
      if (any) Object.defineProperty(AbortSignal, "any", any);
      if (timeout) Object.defineProperty(AbortSignal, "timeout", timeout);
    }
  });

  it("turns a fetch that throws synchronously into an error, never a stuck read", async () => {
    const throwing = (() => { throw new TypeError("not supported"); }) as unknown as typeof fetch;
    await expect(fetchLiveViewerProfile({ vendorId: "vendor-1", liveId: "live-1", fetchImpl: throwing })).resolves.toEqual({ status: "error" });
  });

  it("clears its timer once the read ends", async () => {
    const controller = new AbortController();
    const { signal, dispose } = abortAfter(10_000, controller.signal);
    dispose();
    controller.abort();
    // Disposed: the caller's later abort is no longer forwarded.
    expect(signal.aborted).toBe(false);
  });

  it("reports a blacklisted viewer as unavailable: no gate, playback admitted, read-only chat", async () => {
    const blockedFetch = (async () => new Response(JSON.stringify({ profile: null, suggestedNickname: null, canSetNickname: false, reason: "unavailable" }))) as unknown as typeof fetch;
    const result = await fetchLiveViewerProfile({ vendorId: "vendor-1", liveId: "live-1", fetchImpl: blockedFetch });
    expect(result).toEqual({ status: "unavailable" });
    expect(liveViewerProfileGateRequired({ enabled: true, runtimeState: "playing", status: result.status, hasProfile: false })).toBe(false);
    expect(liveViewerProfileRequiredForChat({ enabled: true, status: result.status })).toBe(false);
  });

  it("closes the nickname step when a save is refused by the blacklist, and shows other refusals", () => {
    expect(liveViewerProfileSaveOutcome(403, { error: "blocked", message: "目前無法設定暱稱" })).toEqual({ kind: "unavailable" });
    expect(liveViewerProfileSaveOutcome(403, { error: "access_denied", message: "直播連線已失效，請重新進入直播間" }))
      .toEqual({ kind: "failed", message: "直播連線已失效，請重新進入直播間" });
    expect(liveViewerProfileSaveOutcome(409, { error: "nickname_taken", message: "這個名稱已經有人使用，請換一個" }))
      .toEqual({ kind: "failed", message: "這個名稱已經有人使用，請換一個" });
    expect(liveViewerProfileSaveOutcome(429, null)).toEqual({ kind: "failed", message: "操作太頻繁，請稍後再試" });
    const url = interactionRoleAvatarUrl("host-blue");
    expect(liveViewerProfileSaveOutcome(200, { profile: { nickname: "小明", avatarSeed: "host-blue", avatarUrl: url } }))
      .toEqual({ kind: "saved", profile: { nickname: "小明", avatarSeed: "host-blue", avatarUrl: url } });
    expect(liveViewerProfileSaveOutcome(200, { profile: { nickname: "小明", avatarSeed: "x", avatarUrl: "https://evil.example/a.png" } }))
      .toEqual({ kind: "failed", message: "暫時無法儲存，請稍後再試" });
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    const pending = fetchLiveViewerProfile({ vendorId: "vendor-1", liveId: "live-1", signal: controller.signal, fetchImpl: hangingFetch });
    controller.abort();
    await expect(pending).resolves.toEqual({ status: "error" });
  });
});

describe("nickname dialog", () => {
  const save = async () => ({ ok: true as const });

  it("offers exactly the 20 preset avatars and a single enter button at the gate", () => {
    const html = renderToStaticMarkup(
      <LiveViewerProfileDialog mode="gate" initialNickname="王大明" initialAvatarSeed={null} onSave={save} />,
    );
    expect(LIVE_VIEWER_AVATAR_OPTIONS).toHaveLength(20);
    expect(html.match(/type="radio"/gu)).toHaveLength(20);
    expect(html).toContain('value="王大明"');
    expect(html).toContain("進入直播間");
    expect(html).not.toContain("取消");
    expect(html).toContain('aria-modal="true"');
  });

  it("can be cancelled when editing from the chat", () => {
    const html = renderToStaticMarkup(
      <LiveViewerProfileDialog mode="edit" hasProfile initialNickname="阿明" initialAvatarSeed="chat-mint" onSave={save} onClose={() => undefined} />,
    );
    expect(html).toContain("修改暱稱與頭像");
    // A replay viewer setting a first nickname from the chat sees a setup title.
    expect(renderToStaticMarkup(
      <LiveViewerProfileDialog mode="edit" initialNickname="" initialAvatarSeed={null} onSave={save} onClose={() => undefined} />,
    )).toContain("設定暱稱與頭像");
    expect(html).toContain("取消");
    expect(html).toContain("儲存");
    expect(html).toMatch(/checked="" value="chat-mint"/u);
    expect(html.match(/checked=""/gu)).toHaveLength(1);
  });
});

describe("profile and avatar parsing", () => {
  it("accepts only preset avatars that match their seed", () => {
    const url = interactionRoleAvatarUrl("host-blue");
    expect(parseLiveViewerProfile({ nickname: "小明", avatarSeed: "host-blue", avatarUrl: url })).toEqual({ nickname: "小明", avatarSeed: "host-blue", avatarUrl: url });
    expect(parseLiveViewerProfile({ nickname: "小明", avatarSeed: "chat-mint", avatarUrl: url })).toBeNull();
    expect(parseLiveViewerProfile({ nickname: "小明", avatarSeed: "x", avatarUrl: "https://evil.example/a.png" })).toBeNull();
    expect(parseLiveViewerProfile({ nickname: "一".repeat(21), avatarSeed: "host-blue", avatarUrl: url })).toBeNull();
    expect(parseLiveViewerProfile(null)).toBeNull();
  });

  it("keeps a viewer's preset avatar and drops any other image", () => {
    const base = { id: "m1", source: "viewer", createdAt: "2026-11-26T10:00:00.000Z", body: "hi" };
    const preset = interactionRoleAvatarUrl("live-coral");
    expect(parseViewerRuntimeMessage({ ...base, actor: { name: "阿明", avatarUrl: preset } })?.actor).toEqual({ name: "阿明", avatarUrl: preset });
    expect(parseViewerRuntimeMessage({ ...base, actor: { name: "阿明", avatarUrl: "https://evil.example/x.png" } })?.actor).toEqual({ name: "阿明" });
    expect(parseViewerRuntimeMessage({ ...base, actor: { name: "阿明" } })?.actor).toEqual({ name: "阿明" });
  });

  it("draws the default icon without an https avatar", () => {
    expect(renderToStaticMarkup(<ChatAvatar url={null} />)).toContain("<svg");
    expect(renderToStaticMarkup(<ChatAvatar url="javascript:alert(1)" />)).not.toContain("javascript:");
    expect(renderToStaticMarkup(<ChatAvatar url={interactionRoleAvatarUrl("host-blue")} />)).toContain("api.dicebear.com");
  });
});

describe("chat panel with nicknames", () => {
  it("draws avatars for scripted roles and shows the viewer's own nickname by the composer", () => {
    const roleAvatar = interactionRoleAvatarUrl("helper-gold");
    const scheduled: ScheduledRuntimeMessage = {
      id: "s1", source: "scheduled", triggerSec: 1, body: "歡迎", actor: { name: "小助理", avatarUrl: roleAvatar, label: null, presentationRole: "audience" },
    };
    const noAvatar: ScheduledRuntimeMessage = { ...scheduled, id: "s2", actor: { ...scheduled.actor, name: "主持人", avatarUrl: null } };
    const ownAvatar = interactionRoleAvatarUrl("live-coral");
    const html = renderToStaticMarkup(
      <LiveChatPanel enabled admissionStatus="admitted" vendorId="vendor-1" liveId="live-1" scheduledMessages={[scheduled, noAvatar]}
        viewerProfile={{ required: true, profile: { nickname: "阿明", avatarUrl: ownAvatar }, onEdit: () => undefined }} />,
    );
    expect(html).toContain(roleAvatar.replaceAll("&", "&amp;"));
    expect(html).toContain("主持人");
    expect(html).toContain("<svg");
    expect(html).toContain("以「阿明」留言");
    expect(html).toContain("更改");
  });

  it("keeps the composer closed while a required nickname is missing", () => {
    expect(isNicknameMissing({ required: true, profile: null, onEdit: () => undefined })).toBe(true);
    expect(isNicknameMissing({ required: true, profile: { nickname: "a", avatarUrl: interactionRoleAvatarUrl("host-blue") }, onEdit: () => undefined })).toBe(false);
    expect(isNicknameMissing({ required: false, profile: null, onEdit: () => undefined })).toBe(false);
    expect(isNicknameMissing(undefined)).toBe(false);
    const viewerMessage: ViewerRuntimeMessage = { id: "v", source: "viewer", createdAt: "2026-11-26T10:00:00.000Z", body: "x", actor: { name: "x" } };
    expect(viewerMessage.actor.avatarUrl).toBeUndefined();
  });
});
