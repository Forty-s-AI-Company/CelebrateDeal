"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { RegistrationFormBuilderField } from "@/lib/registration-form-builder";
import {
  parseRegistrationFormDraft,
  registrationFormDraftMatches,
  registrationFormDraftStorageKey,
  serializeRegistrationFormDraft,
  type RegistrationFormDraft,
  type RegistrationFormDraftValues,
} from "@/lib/registration-form-draft";

const DRAFT_STORAGE_EVENT = "celebratedeal:registration-form-draft-change";

function subscribeToDraftStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(DRAFT_STORAGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(DRAFT_STORAGE_EVENT, onStoreChange);
  };
}

function notifyDraftStorageChanged() {
  window.dispatchEvent(new Event(DRAFT_STORAGE_EVENT));
}

function removeStoredDraft(storageKey: string) {
  window.localStorage.removeItem(storageKey);
  notifyDraftStorageChanged();
}

export function useRegistrationFormDraft({
  draftScope,
  initialUpdatedAt,
  initialValues,
  initialFields,
  values,
  fields,
  pending,
  onRestore,
}: {
  draftScope: string;
  initialUpdatedAt: string | null;
  initialValues: RegistrationFormDraftValues;
  initialFields: RegistrationFormBuilderField[];
  values: RegistrationFormDraftValues;
  fields: RegistrationFormBuilderField[];
  pending: boolean;
  onRestore: (draft: RegistrationFormDraft) => void;
}) {
  const [decision, setDecision] = useState<"pending" | "accepted">("pending");
  const [message, setMessage] = useState("");
  const storageKey = useMemo(
    () => registrationFormDraftStorageKey(draftScope, initialValues.id),
    [draftScope, initialValues.id],
  );
  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }, [storageKey]);
  const rawDraft = useSyncExternalStore(subscribeToDraftStorage, getSnapshot, () => null);
  const parsedDraft = useMemo(() => rawDraft
    ? parseRegistrationFormDraft(rawDraft, { formId: initialValues.id, baseUpdatedAt: initialUpdatedAt })
    : null, [initialUpdatedAt, initialValues.id, rawDraft]);
  const hasUnsavedChanges = !registrationFormDraftMatches(
    { values, fields },
    { values: initialValues, fields: initialFields },
  );
  const storedCurrentDraft = parsedDraft?.status === "ready"
    && registrationFormDraftMatches(
      { values: parsedDraft.draft.values, fields: parsedDraft.draft.fields },
      { values, fields },
    );
  const blocksAutosave = decision === "pending" && Boolean(parsedDraft);

  useEffect(() => {
    if (pending || blocksAutosave || !hasUnsavedChanges || storedCurrentDraft) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, serializeRegistrationFormDraft({
          baseUpdatedAt: initialUpdatedAt,
          values,
          fields,
        }));
        notifyDraftStorageChanged();
      } catch {
        setMessage("瀏覽器無法保存草稿；請使用下方按鈕手動儲存。");
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [blocksAutosave, fields, hasUnsavedChanges, initialUpdatedAt, pending, storageKey, storedCurrentDraft, values]);

  function restoreDraft() {
    if (parsedDraft?.status !== "ready") return;
    onRestore(parsedDraft.draft);
    setDecision("accepted");
    setMessage("已恢復尚未儲存的草稿；請確認內容後再儲存表單。");
  }

  function discardDraft() {
    try {
      removeStoredDraft(storageKey);
      setMessage(parsedDraft?.status === "stale"
        ? "已捨棄較舊的瀏覽器草稿，保留伺服器上的最新內容。"
        : "已捨棄瀏覽器草稿，保留伺服器上的表單內容。");
    } catch {
      setMessage("瀏覽器目前無法移除草稿；仍可正常手動儲存表單。");
    }
    setDecision("accepted");
  }

  function clearForSubmission() {
    try {
      removeStoredDraft(storageKey);
    } catch {
      // A failed server action keeps the current in-memory values available.
    }
  }

  const candidate = decision === "pending" && parsedDraft?.status === "ready"
    ? parsedDraft.draft
    : null;
  const unsafeDraft = decision === "pending" && parsedDraft && parsedDraft.status !== "ready"
    ? parsedDraft.status
    : null;
  const saveStatus = message.startsWith("瀏覽器無法")
    ? "error"
    : hasUnsavedChanges && storedCurrentDraft
      ? "saved"
      : hasUnsavedChanges
        ? "saving"
        : "idle";

  return { candidate, unsafeDraft, message, saveStatus, restoreDraft, discardDraft, clearForSubmission };
}
