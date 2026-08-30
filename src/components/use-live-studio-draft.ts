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
}) => Promise<LiveStudioDraftEnvelope>;

/**
 * Serializes draft writes so an older request can never finish after a newer
 * request and silently replace its revision. Pending edits are coalesced while
 * the current request completes; requests are intentionally never aborted.
 */
export class LiveStudioDraftSaveQueue {
  private pendingPayload: LiveStudioDraftPayload | null = null;
  private activeSave: Promise<boolean> | null = null;
  private conflictLocked = false;
  private draftId: string;
  private revision: number | null;
  private updatedAt: string;
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
    this.lastSavedPayload = options.initialDraft?.payload ?? null;
  }

  markDirty(payload?: LiveStudioDraftPayload) {
    if (this.conflictLocked) return;
    if (payload !== undefined) this.latestLocalPayload = payload;
    this.transition("dirty");
  }

  setTransitionHandler(onTransition: (state: LiveStudioDraftSaveState) => void) {
    this.options.onTransition = onTransition;
  }

  enqueue(payload: LiveStudioDraftPayload) {
    if (this.conflictLocked) return;
    this.latestLocalPayload = payload;
    this.pendingPayload = payload;
    void this.ensureDrain();
  }

  flush(payload: LiveStudioDraftPayload) {
    if (this.conflictLocked) return Promise.resolve(false);
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
      try {
        const saved = await this.options.save({
          draftId: this.draftId,
          liveId: this.options.liveId,
          revision: this.revision,
          payload,
        });
        this.draftId = saved.id;
        this.revision = saved.revision;
        this.updatedAt = saved.updatedAt;
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
    case "conflict": return "另一個分頁已有較新的版本。為避免覆蓋，請重新整理後再繼續。";
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
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      queue.enqueue(payload);
    }, 700);
  }, [activeStep, payloadForStep, queue]);

  const saveNow = useCallback(async (step = activeStep) => {
    const payload = payloadForStep(step);
    if (!payload) return null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const saved = await queue.flush(payload);
    return saved ? queue.currentClaim() : null;
  }, [activeStep, payloadForStep, queue]);

  const getCurrentClaim = useCallback(() => queue.currentClaim(), [queue]);

  const isCurrentFormSaved = useCallback((step = activeStep) => {
    const payload = payloadForStep(step);
    return Boolean(payload && queue.matches(payload));
  }, [activeStep, payloadForStep, queue]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      handleLiveStudioDraftBeforeUnload(event, statusRef.current);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

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
    isCurrentFormSaved,
    saveNow,
    scheduleSave,
  };
}
