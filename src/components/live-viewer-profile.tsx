"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { UserRound } from "lucide-react";
import { INTERACTION_AVATAR_SEEDS, interactionRoleAvatarUrl, isCanonicalInteractionRolePresetUrl } from "@/lib/interaction-role";
import type { LiveRuntimeState } from "@/lib/live-runtime-state";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";

export const LIVE_VIEWER_PROFILE_ENDPOINT = "/api/live-viewer-profile";
export const LIVE_VIEWER_NICKNAME_MAX_LENGTH = 20;
export const LIVE_VIEWER_AVATAR_OPTIONS: ReadonlyArray<{ seed: string; url: string }> = Object.freeze(
  [...INTERACTION_AVATAR_SEEDS.male, ...INTERACTION_AVATAR_SEEDS.female].map((seed) => ({ seed, url: interactionRoleAvatarUrl(seed) })),
);
const CLIENT_HEADERS = {
  "Content-Type": "application/json",
  "X-CelebrateDeal-Client": "web",
};

export type LiveViewerProfile = {
  nickname: string;
  avatarSeed: string;
  avatarUrl: string;
};

export type LiveViewerProfileStatus = "idle" | "loading" | "ready" | "error";

export type LiveViewerProfileSaveResult = { ok: true } | { ok: false; message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLiveViewerProfile(value: unknown): LiveViewerProfile | null {
  if (!isObject(value)) return null;
  const { nickname, avatarSeed, avatarUrl } = value;
  if (typeof nickname !== "string" || !nickname.trim() || Array.from(nickname).length > LIVE_VIEWER_NICKNAME_MAX_LENGTH) return null;
  if (typeof avatarSeed !== "string" || typeof avatarUrl !== "string") return null;
  if (!isCanonicalInteractionRolePresetUrl(avatarUrl) || interactionRoleAvatarUrl(avatarSeed) !== avatarUrl) return null;
  return { nickname, avatarSeed, avatarUrl };
}

/**
 * Whether the viewer must set a nickname before the video appears: only while
 * the viewer's own session plays live (replay is never forced) and the room
 * has chat. A failed profile read never locks a viewer out of watching.
 */
export function liveViewerProfileGateRequired(input: {
  enabled: boolean;
  runtimeState: LiveRuntimeState;
  status: LiveViewerProfileStatus;
  hasProfile: boolean;
}) {
  if (!input.enabled || input.runtimeState !== "playing" || input.status === "error") return false;
  return !input.hasProfile;
}

/** Posting asks for a nickname whenever the room uses them and the read worked. */
export function liveViewerProfileRequiredForChat(input: { enabled: boolean; status: LiveViewerProfileStatus }) {
  return input.enabled && input.status !== "error";
}

type ProfileState = {
  scope: string;
  status: LiveViewerProfileStatus;
  profile: LiveViewerProfile | null;
  suggestedNickname: string | null;
};

export function useLiveViewerProfile({ vendorId, liveId, enabled }: { vendorId: string; liveId: string; enabled: boolean }) {
  const scope = `${vendorId}:${liveId}`;
  const [state, setState] = useState<ProfileState>(() => ({ scope, status: "idle", profile: null, suggestedNickname: null }));
  const current: ProfileState = state.scope === scope ? state : { scope, status: "idle", profile: null, suggestedNickname: null };

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!disposed) setState((previous) => previous.scope === scope && previous.status === "ready" ? previous : { scope, status: "loading", profile: null, suggestedNickname: null });
    });
    const query = new URLSearchParams({ vendorId, liveId });
    void fetch(`${LIVE_VIEWER_PROFILE_ENDPOINT}?${query.toString()}`, { headers: CLIENT_HEADERS, signal: controller.signal })
      .then(async (response) => {
        if (disposed) return;
        if (!response.ok) {
          setState((previous) => previous.scope === scope && previous.status === "ready" ? previous : { scope, status: "error", profile: null, suggestedNickname: null });
          return;
        }
        const payload: unknown = await response.json();
        if (disposed) return;
        const profile = isObject(payload) ? parseLiveViewerProfile(payload.profile) : null;
        const suggestion = isObject(payload) && typeof payload.suggestedNickname === "string" ? payload.suggestedNickname : null;
        setState({ scope, status: "ready", profile, suggestedNickname: suggestion });
      })
      .catch(() => {
        if (!disposed) setState((previous) => previous.scope === scope && previous.status === "ready" ? previous : { scope, status: "error", profile: null, suggestedNickname: null });
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [enabled, liveId, scope, vendorId]);

  // useMemo (not useCallback) keeps this hook to the hooks LivePlayback already uses.
  const save = useMemo(() => async (nickname: string, avatarSeed: string): Promise<LiveViewerProfileSaveResult> => {
    try {
      const response = await fetch(LIVE_VIEWER_PROFILE_ENDPOINT, {
        method: "PUT",
        headers: CLIENT_HEADERS,
        body: JSON.stringify({ vendorId, liveId, nickname, avatarSeed }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isObject(payload) && typeof payload.message === "string" ? payload.message : null;
        return { ok: false, message: message ?? (response.status === 429 ? "操作太頻繁，請稍後再試" : "暫時無法儲存，請稍後再試") };
      }
      const profile = isObject(payload) ? parseLiveViewerProfile(payload.profile) : null;
      if (!profile) return { ok: false, message: "暫時無法儲存，請稍後再試" };
      setState({ scope, status: "ready", profile, suggestedNickname: null });
      return { ok: true };
    } catch {
      return { ok: false, message: "暫時無法儲存，請稍後再試" };
    }
  }, [liveId, scope, vendorId]);

  return { status: current.status, profile: current.profile, suggestedNickname: current.suggestedNickname, save };
}

type AdmissionStatus = "checking" | "admitted" | "blocked";

type ProfileDialogProps = {
  key: string;
  mode: "gate" | "edit";
  loading: boolean;
  hasProfile: boolean;
  initialNickname: string;
  initialAvatarSeed: string | null;
  onSave: (nickname: string, avatarSeed: string) => Promise<LiveViewerProfileSaveResult>;
  onClose?: () => void;
};

/**
 * Everything the live player needs from the nickname step: whether it is on,
 * the admission status the player itself should use (the gate holds playback
 * back like an admission still in progress), the chat props and the dialog.
 */
export function useLiveViewerProfileGate(input: {
  vendorId: string;
  liveId: string;
  runtimeState: LiveRuntimeState;
  admissionRequired: boolean;
  chatEnabled: boolean;
  admissionStatus: AdmissionStatus;
}) {
  const playable = input.runtimeState === "playing" || input.runtimeState === "replay";
  const enabled = playable && input.admissionRequired && input.chatEnabled && input.admissionStatus === "admitted";
  const viewerProfile = useLiveViewerProfile({ vendorId: input.vendorId, liveId: input.liveId, enabled });
  const [editorOpen, setEditorOpen] = useState(false);
  const gateOpen = liveViewerProfileGateRequired({
    enabled,
    runtimeState: input.runtimeState,
    status: viewerProfile.status,
    hasProfile: Boolean(viewerProfile.profile),
  });
  const playbackAdmissionStatus: AdmissionStatus = gateOpen ? "checking" : input.admissionStatus;
  const chat = enabled
    ? {
        required: liveViewerProfileRequiredForChat({ enabled, status: viewerProfile.status }),
        profile: viewerProfile.profile,
        onEdit: () => setEditorOpen(true),
      }
    : undefined;
  const dialog: ProfileDialogProps | null = enabled && (gateOpen || editorOpen)
    ? {
        // A new mount per mode and once the read ends, so the form starts from current values.
        key: `${gateOpen ? "gate" : "edit"}:${viewerProfile.status}`,
        mode: gateOpen ? "gate" : "edit",
        loading: viewerProfile.status === "idle" || viewerProfile.status === "loading",
        hasProfile: Boolean(viewerProfile.profile),
        initialNickname: viewerProfile.profile?.nickname ?? viewerProfile.suggestedNickname ?? "",
        initialAvatarSeed: viewerProfile.profile?.avatarSeed ?? null,
        onSave: viewerProfile.save,
        onClose: gateOpen ? undefined : () => setEditorOpen(false),
      }
    : null;
  return { enabled, gateOpen, playbackAdmissionStatus, chat, dialog };
}

export function LiveViewerProfileLayer({ dialog }: { dialog: ProfileDialogProps | null }) {
  if (!dialog) return null;
  const { key, ...props } = dialog;
  return <LiveViewerProfileDialog key={key} {...props} />;
}

/** Round chat avatar; a missing or non-https image shows the default icon. */
export function ChatAvatar({ url, size = 28 }: { url: string | null | undefined; size?: number }) {
  const safeUrl = typeof url === "string" && url.startsWith("https://") ? url : null;
  if (safeUrl) {
    return (
      <Image src={safeUrl} alt="" width={size} height={size} unoptimized
        className="shrink-0 rounded-full bg-white/10 object-cover" style={{ width: size, height: size }} />
    );
  }
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full bg-white/15 text-white/70" style={{ width: size, height: size }}>
      <UserRound size={Math.round(size * 0.6)} />
    </span>
  );
}

function dialogTitle(mode: "gate" | "edit", hasProfile: boolean) {
  if (mode === "gate") return "設定你在直播間的名稱";
  return hasProfile ? "修改暱稱與頭像" : "設定暱稱與頭像";
}

export function LiveViewerProfileDialog({
  mode,
  loading = false,
  hasProfile = false,
  initialNickname,
  initialAvatarSeed,
  onSave,
  onClose,
}: {
  /** "gate" blocks the room until saved; "edit" can be closed. */
  mode: "gate" | "edit";
  loading?: boolean;
  /** Whether the viewer already has a nickname in this live (rename vs first setup). */
  hasProfile?: boolean;
  initialNickname: string;
  initialAvatarSeed: string | null;
  onSave: (nickname: string, avatarSeed: string) => Promise<LiveViewerProfileSaveResult>;
  onClose?: () => void;
}) {
  const [nickname, setNickname] = useState(initialNickname);
  const [avatarSeed, setAvatarSeed] = useState(
    initialAvatarSeed && LIVE_VIEWER_AVATAR_OPTIONS.some((option) => option.seed === initialAvatarSeed)
      ? initialAvatarSeed
      : LIVE_VIEWER_AVATAR_OPTIONS[0]!.seed,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closable = mode === "edit" && Boolean(onClose);
  useDialogBehavior(true, closable ? onClose : undefined);
  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading]);

  const length = Array.from(nickname.trim()).length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const trimmed = nickname.trim();
    if (!trimmed) return setError("請輸入暱稱");
    if (Array.from(trimmed).length > LIVE_VIEWER_NICKNAME_MAX_LENGTH) return setError(`暱稱最多 ${LIVE_VIEWER_NICKNAME_MAX_LENGTH} 個字`);
    setSaving(true);
    setError(null);
    const result = await onSave(trimmed, avatarSeed);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      inputRef.current?.focus();
      return;
    }
    if (mode === "edit") onClose?.();
  }

  return (
    <div data-testid="live-viewer-profile-dialog" className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-slate-950/90 p-4" role="dialog" aria-modal="true"
      aria-labelledby="live-viewer-profile-title" aria-describedby="live-viewer-profile-description"
      onClick={(event) => { if (closable && event.target === event.currentTarget && !saving) onClose?.(); }}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-slate-950 shadow-2xl">
        <h2 id="live-viewer-profile-title" className="text-lg font-black">{dialogTitle(mode, hasProfile)}</h2>
        <p id="live-viewer-profile-description" className="mt-1 text-sm leading-6 text-slate-600">
          {hasProfile ? "修改後，你在這場直播的留言都會顯示新的暱稱與頭像。" : "其他觀眾會在聊天室看到你的暱稱與頭像。"}
        </p>
        {loading ? (
          <p role="status" className="mt-5 rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600">正在準備直播間…</p>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-4" noValidate>
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="live-viewer-nickname" className="text-sm font-bold">暱稱</label>
                <span className={`text-xs ${length > LIVE_VIEWER_NICKNAME_MAX_LENGTH ? "text-red-700" : "text-slate-500"}`}>{length}/{LIVE_VIEWER_NICKNAME_MAX_LENGTH}</span>
              </div>
              <input
                ref={inputRef}
                id="live-viewer-nickname"
                value={nickname}
                onChange={(event) => { setNickname(event.target.value); setError(null); }}
                maxLength={80}
                autoComplete="nickname"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "live-viewer-profile-error" : undefined}
                className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus-visible:border-orange-600 focus-visible:ring-2 focus-visible:ring-orange-200"
              />
            </div>
            <fieldset>
              <legend className="text-sm font-bold">選擇頭像</legend>
              <div className="mt-2 grid grid-cols-5 gap-2">
                {LIVE_VIEWER_AVATAR_OPTIONS.map((option, index) => {
                  const selected = option.seed === avatarSeed;
                  return (
                    <label
                      key={option.seed}
                      className={`grid aspect-square min-h-11 cursor-pointer place-items-center rounded-full border-2 p-0.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-orange-600 ${selected ? "border-orange-600 bg-orange-50" : "border-transparent hover:border-slate-300"}`}
                    >
                      <input
                        type="radio"
                        name="live-viewer-avatar"
                        value={option.seed}
                        checked={selected}
                        onChange={() => setAvatarSeed(option.seed)}
                        aria-label={`頭像 ${index + 1}`}
                        className="sr-only"
                      />
                      <Image src={option.url} alt="" width={44} height={44} unoptimized className="h-full w-full rounded-full" />
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {error ? <p id="live-viewer-profile-error" role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-800">{error}</p> : null}
            <div className={closable ? "grid grid-cols-2 gap-3" : "grid"}>
              {closable ? (
                <button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black disabled:opacity-60">取消</button>
              ) : null}
              <button type="submit" disabled={saving} aria-busy={saving} className="min-h-11 rounded-xl bg-orange-700 px-4 text-sm font-black text-white hover:bg-orange-800 disabled:opacity-60">
                {saving ? "儲存中…" : mode === "gate" ? "進入直播間" : "儲存"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
