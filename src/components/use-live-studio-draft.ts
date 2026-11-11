"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  type LiveStudioDraftEnvelope,
  type LiveStudioDraftPayload,
} from "@/lib/live-studio-draft";
import {
  LiveStudioDraftClientError,
  saveLiveStudioDraft,
  serializeLiveStudioDraft,
} from "@/lib/live-studio-draft-client";

export type LiveStudioDraftSaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

export type LiveStudioDraftSaveState = {
  status: LiveStudioDraftSaveStatus;
  draftId: string;
  revision: number | null;
  updatedAt: string;
  errorCode: string;
  /** 草稿存檔時伺服器回報：目前填的直播網址已被其他直播使用。 */
  slugTaken: boolean;
  /** 草稿存檔時伺服器無法檢查直播網址是否重複（送出時會再檢查）。 */
  slugCheckFailed: boolean;
};

export type LiveStudioDraftClaim = {
  draftId: string;
  revision: number;
};

const beforeUnloadStatuses: ReadonlySet<LiveStudioDraftSaveStatus> = new Set([
  "dirty",
  "saving",
  "error",
  "conflict",
]);

export function shouldBlockLiveStudioDraftBeforeUnload(status: LiveStudioDraftSaveStatus) {
  return beforeUnloadStatuses.has(status);
}

export function handleLiveStudioDraftBeforeUnload(
  event: BeforeUnloadEvent,
  status: LiveStudioDraftSaveStatus,
) {
  if (!shouldBlockLiveStudioDraftBeforeUnload(status)) return;
  event.preventDefault();
  event.returnValue = "";
}

type SaveDraft = (input: {
  draftId: string;
  liveId: string;
  revision: number | null;
  payload: LiveStudioDraftPayload;
  overwrite?: boolean;
  keepalive?: boolean;
}) => Promise<LiveStudioDraftEnvelope & { slugTaken?: boolean; slugCheckFailed?: boolean }>;

/**
 * Serializes draft writes so an older request can never finish after a newer
 * request and silently replace its revision. Pending edits are coalesced while
 * the current request completes; requests are intentionally never aborted.
 */
export class LiveStudioDraftSaveQueue {
  private pendingPayload: LiveStudioDraftPayload | null = null;
  private activeSave: Promise<boolean> | null = null;
  private conflictLocked = false;
  private overwriteNext = false;
  private keepaliveNext = false;
  private draftId: string;
  private revision: number | null;
  private updatedAt: string;
  private slugTaken = false;
  private slugCheckFailed = false;
  private latestLocalPayload: LiveStudioDraftPayload | null;
  private lastSavedPayload: LiveStudioDraftPayload | null;

  constructor(private readonly options: {
    liveId: string;
    initialDraft?: LiveStudioDraftEnvelope;
    save: SaveDraft;
    onTransition: (state: LiveStudioDraftSaveState) => void;
  }) {
    this.draftId = options.initialDraft?.id ?? "";
    this.revision = options.initialDraft?.revision ?? null;
    this.updatedAt = options.initialDraft?.updatedAt ?? "";
    this.latestLocalPayload = options.initialDraft?.payload ?? null;
    // A row still stored in an older shape (e.g. an eight-step v2 draft) is not
    // what the publish claim will compare against: never treat it as saved.
    this.lastSavedPayload = options.initialDraft && !options.initialDraft.storedPayloadOutdated
      ? options.initialDraft.payload
      : null;
  }

  markDirty(payload?: LiveStudioDraftPayload) {
    if (this.conflictLocked) return;
    if (payload !== undefined) this.latestLocalPayload = payload;
    this.transition("dirty");
  }

  setTransitionHandler(onTransition: (state: LiveStudioDraftSaveState) => void) {
    this.options.onTransition = onTransition;
  }

  /** `keepalive` lets the next request outlive a page that is being hidden or unloaded. */
  enqueue(payload: LiveStudioDraftPayload, options: { keepalive?: boolean } = {}) {
    if (this.conflictLocked) return;
    this.latestLocalPayload = payload;
    this.pendingPayload = payload;
    if (options.keepalive) this.keepaliveNext = true;
    void this.ensureDrain();
  }

  flush(payload: LiveStudioDraftPayload) {
    if (this.conflictLocked) return Promise.resolve(false);
    this.latestLocalPayload = payload;
    this.pendingPayload = payload;
    return this.ensureDrain();
  }

  /**
   * B07-20: after a conflict the user explicitly keeps their own version. The
   * next save skips the revision comparison once; nothing is overwritten
   * unless this is called.
   */
  keepMine(payload: LiveStudioDraftPayload) {
    if (!this.conflictLocked) return Promise.resolve(false);
    this.conflictLocked = false;
    this.overwriteNext = true;
    this.latestLocalPayload = payload;
    this.pendingPayload = payload;
    return this.ensureDrain();
  }

  matches(payload: LiveStudioDraftPayload) {
    return this.latestLocalPayload !== null
      && this.lastSavedPayload !== null
      && JSON.stringify(this.latestLocalPayload) === JSON.stringify(payload)
      && JSON.stringify(this.lastSavedPayload) === JSON.stringify(payload);
  }

  currentClaim(): LiveStudioDraftClaim | null {
    if (!this.draftId || this.revision === null) return null;
    return { draftId: this.draftId, revision: this.revision };
  }

  private ensureDrain() {
    if (!this.activeSave) {
      const operation = this.drain();
      this.activeSave = operation.finally(() => {
        this.activeSave = null;
      });
    }
    return this.activeSave;
  }

  private async drain() {
    while (this.pendingPayload) {
      const payload = this.pendingPayload;
      this.pendingPayload = null;
      this.transition("saving");
      const overwrite = this.overwriteNext;
      this.overwriteNext = false;
      const keepalive = this.keepaliveNext;
      this.keepaliveNext = false;
      try {
        const saved = await this.options.save({
          draftId: this.draftId,
          liveId: this.options.liveId,
          revision: this.revision,
          payload,
          ...(overwrite ? { overwrite: true } : {}),
          ...(keepalive ? { keepalive: true } : {}),
        });
        this.draftId = saved.id;
        this.revision = saved.revision;
        this.updatedAt = saved.updatedAt;
        this.slugTaken = saved.slugTaken === true;
        this.slugCheckFailed = saved.slugCheckFailed === true;
        this.lastSavedPayload = saved.payload;
        this.transition(
          this.latestLocalPayload !== null
            && JSON.stringify(this.latestLocalPayload) === JSON.stringify(saved.payload)
            ? "saved"
            : "dirty",
        );
      } catch (error) {
        this.pendingPayload = null;
        const errorCode = error instanceof LiveStudioDraftClientError ? error.code : "draft_save_failed";
        if (errorCode === "draft_conflict") {
          this.conflictLocked = true;
          this.transition("conflict", errorCode);
        } else {
          this.transition("error", errorCode);
        }
        return false;
      }
    }
    return true;
  }

  private transition(status: LiveStudioDraftSaveStatus, errorCode = "") {
    this.options.onTransition({
      status,
      draftId: this.draftId,
      revision: this.revision,
      updatedAt: this.updatedAt,
      errorCode,
      slugTaken: this.slugTaken,
      slugCheckFailed: this.slugCheckFailed,
    });
  }
}

function initialSaveState(initialDraft?: LiveStudioDraftEnvelope): LiveStudioDraftSaveState {
  return {
    status: initialDraft ? "saved" : "idle",
    draftId: initialDraft?.id ?? "",
    revision: initialDraft?.revision ?? null,
    updatedAt: initialDraft?.updatedAt ?? "",
    errorCode: "",
    slugTaken: false,
    slugCheckFailed: false,
  };
}

function replaceCreateDraftQuery(draftId: string) {
  if (!draftId || typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("draft") === draftId) return;
  url.searchParams.set("draft", draftId);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function draftStatusMessage(state: LiveStudioDraftSaveState) {
  switch (state.status) {
    case "dirty": return "尚有變更，稍後會自動儲存。";
    case "saving": return "正在安全儲存草稿…";
    case "saved": return state.updatedAt ? "草稿已儲存，可安全離開後再繼續。" : "草稿已儲存。";
    case "conflict": return "其他人已更新這份草稿。系統沒有覆蓋它；請選擇「載入最新」放棄這裡的修改，或「以我的覆蓋」保留你目前的內容。";
    case "error": return "草稿尚未儲存，請檢查連線後按「立即儲存」。";
    default: return "開始輸入後會自動建立可復原草稿。";
  }
}

export function useLiveStudioDraft({
  activeStep,
  csrfToken,
  formRef,
  initialDraft,
  liveId = "",
  saveOnMount = false,
}: {
  activeStep: number;
  csrfToken: string;
  formRef: RefObject<HTMLFormElement | null>;
  initialDraft?: LiveStudioDraftEnvelope;
  liveId?: string;
  saveOnMount?: boolean;
}) {
  const [state, setState] = useState<LiveStudioDraftSaveState>(() => initialSaveState(initialDraft));
  const statusRef = useRef(state.status);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The payload the debounce timer will save, so leaving the page can save it right away. */
  const pendingPayloadRef = useRef<LiveStudioDraftPayload | null>(null);
  const mountSaveStartedRef = useRef(false);

  const setDraftState = useCallback((nextState: LiveStudioDraftSaveState) => {
    statusRef.current = nextState.status;
    setState(nextState);
  }, []);

  const setInvalidDraftState = useCallback(() => {
    statusRef.current = "error";
    setState((current) => ({ ...current, status: "error", errorCode: "invalid_draft" }));
  }, []);

  const [queue] = useState(() => new LiveStudioDraftSaveQueue({
    liveId,
    initialDraft,
    save: (input) => saveLiveStudioDraft({ ...input, csrfToken }),
    onTransition: () => undefined,
  }));

  useEffect(() => {
    queue.setTransitionHandler((nextState) => {
      setDraftState(nextState);
      if (!liveId && nextState.status === "saved") replaceCreateDraftQuery(nextState.draftId);
    });
    // A save flushed while leaving finishes after this studio is gone: it must
    // not touch the next page's URL or this unmounted state.
    return () => queue.setTransitionHandler(() => undefined);
  }, [liveId, queue, setDraftState]);

  const payloadForStep = useCallback((step: number) => {
    if (!formRef.current) return null;
    try {
      return serializeLiveStudioDraft(formRef.current, step);
    } catch {
      setInvalidDraftState();
      return null;
    }
  }, [formRef, setInvalidDraftState]);

  const scheduleSave = useCallback((step = activeStep) => {
    const payload = payloadForStep(step);
    if (!payload) return;
    queue.markDirty(payload);
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingPayloadRef.current = payload;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pendingPayloadRef.current = null;
      queue.enqueue(payload);
    }, 700);
  }, [activeStep, payloadForStep, queue]);

  /**
   * Starts the debounced save now instead of dropping it: the studio is being
   * left (a 「新增…」 link, back navigation) or the page is being hidden. It
   * goes through the same queue, so revision checks and conflicts still apply.
   */
  const flushPendingSave = useCallback((keepalive = false) => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    const payload = pendingPayloadRef.current;
    pendingPayloadRef.current = null;
    if (payload) queue.enqueue(payload, { keepalive });
  }, [queue]);

  const saveNow = useCallback(async (step = activeStep) => {
    const payload = payloadForStep(step);
    if (!payload) return null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingPayloadRef.current = null;
    }
    const saved = await queue.flush(payload);
    return saved ? queue.currentClaim() : null;
  }, [activeStep, payloadForStep, queue]);

  const getCurrentClaim = useCallback(() => queue.currentClaim(), [queue]);

  const keepMine = useCallback(async () => {
    const payload = payloadForStep(activeStep);
    if (!payload) return;
    await queue.keepMine(payload);
  }, [activeStep, payloadForStep, queue]);

  const reloadLatest = useCallback(() => {
    if (typeof window !== "undefined") window.location.reload();
  }, []);

  const isCurrentFormSaved = useCallback((step = activeStep) => {
    const payload = payloadForStep(step);
    return Boolean(payload && queue.matches(payload));
  }, [activeStep, payloadForStep, queue]);

  useEffect(() => () => flushPendingSave(), [flushPendingSave]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      handleLiveStudioDraftBeforeUnload(event, statusRef.current);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    const handlePageHide = () => flushPendingSave(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPendingSave(true);
    };
    window.addEventListener("pagehide", handlePageHide);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushPendingSave]);

  useEffect(() => {
    if (!saveOnMount || mountSaveStartedRef.current) return;
    mountSaveStartedRef.current = true;
    const timer = setTimeout(() => scheduleSave(activeStep), 0);
    return () => clearTimeout(timer);
  }, [activeStep, saveOnMount, scheduleSave]);

  return {
    ...state,
    canSubmit: Boolean(state.draftId && state.revision && state.status === "saved"),
    message: draftStatusMessage(state),
    getCurrentClaim,
    keepMine,
    reloadLatest,
    isCurrentFormSaved,
    saveNow,
    scheduleSave,
  };
}
