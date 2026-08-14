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
    this.lastSavedPayload = options.initialDraft?.payload ?? null;
  }

  markDirty() {
    if (this.conflictLocked) return;
    this.transition("dirty");
  }

  enqueue(payload: LiveStudioDraftPayload) {
    if (this.conflictLocked) return;
    this.pendingPayload = payload;
    void this.ensureDrain();
  }

  flush(payload: LiveStudioDraftPayload) {
    if (this.conflictLocked) return Promise.resolve(false);
    this.pendingPayload = payload;
    return this.ensureDrain();
  }

  matches(payload: LiveStudioDraftPayload) {
    return this.lastSavedPayload !== null
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
        this.transition("saved");
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountSaveStartedRef = useRef(false);
  const queueRef = useRef<LiveStudioDraftSaveQueue | null>(null);

  if (queueRef.current == null) {
    queueRef.current = new LiveStudioDraftSaveQueue({
      liveId,
      initialDraft,
      save: (input) => saveLiveStudioDraft({ ...input, csrfToken }),
      onTransition: (nextState) => {
        setState(nextState);
        if (!liveId && nextState.status === "saved") replaceCreateDraftQuery(nextState.draftId);
      },
    });
  }

  const payloadForStep = useCallback((step: number) => {
    if (!formRef.current) return null;
    try {
      return serializeLiveStudioDraft(formRef.current, step);
    } catch {
      setState((current) => ({ ...current, status: "error", errorCode: "invalid_draft" }));
      return null;
    }
  }, [formRef]);

  const scheduleSave = useCallback((step = activeStep) => {
    const payload = payloadForStep(step);
    if (!payload || !queueRef.current) return;
    queueRef.current.markDirty();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      queueRef.current?.enqueue(payload);
    }, 700);
  }, [activeStep, payloadForStep]);

  const saveNow = useCallback(async (step = activeStep) => {
    const payload = payloadForStep(step);
    if (!payload || !queueRef.current) return null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const saved = await queueRef.current.flush(payload);
    return saved ? queueRef.current.currentClaim() : null;
  }, [activeStep, payloadForStep]);

  const getCurrentClaim = useCallback(() => queueRef.current?.currentClaim() ?? null, []);

  const isCurrentFormSaved = useCallback((step = activeStep) => {
    const payload = payloadForStep(step);
    return Boolean(payload && queueRef.current?.matches(payload));
  }, [activeStep, payloadForStep]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
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
