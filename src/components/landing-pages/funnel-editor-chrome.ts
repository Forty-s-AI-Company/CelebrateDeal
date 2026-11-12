import type { ReactNode } from "react";
import type { FunnelViewport } from "./funnel-page-document-renderer";

/**
 * Persisted-revision state shown by the toolbar's save button (EDT-SAVE-001).
 * `error` means the last save of the current content failed; the button
 * becomes 儲存失敗（重試）.
 */
export type FunnelEditorSaveState = "dirty" | "saving" | "saved" | "error";

/** Editor-session moves another surface (the publish drawer) may ask for to lead the merchant to a fix. */
export type FunnelEditorNavigation = {
  /** Opens 頁面設定 in the left panel. */
  openPageSettings: () => void;
  /** Selects the first checkout element on the canvas (its settings offer the product picker); false when there is none. */
  selectCommerceElement: () => boolean;
};

/**
 * Everything the full-screen editor shell needs from its persistence owner
 * (the workspace). The editor session owns history, selection and viewport;
 * the workspace owns saving, leaving and page-level metadata.
 */
export type FunnelEditorChrome = {
  /** Page or step name shown in the toolbar when nothing is selected. */
  title: string;
  saveState: FunnelEditorSaveState;
  /** Blocks saving even with unsaved changes (invalid settings, missing name). */
  saveBlocked?: boolean;
  onSave: () => void;
  /** True when edits are saved automatically a few seconds after the last change. */
  autosave?: boolean;
  onExit: () => void;
  /** 發布／更新發布 in the toolbar; omitted for pages that publish elsewhere. */
  publish?: { label: string; disabled?: boolean; onPublish: () => void };
  /** Surfaces rendered inside the editor session (for example the publish drawer) that can move the selection. */
  renderOverlay?: (navigation: FunnelEditorNavigation) => ReactNode;
  /** Compact publication status chip with its own popover. */
  status?: ReactNode;
  /** Workspace-level settings (name, URL, form, live) rendered inside 頁面設定. */
  pageSettings?: ReactNode;
  /** Version history content; the toolbar shows 版本紀錄 only when provided. */
  versions?: ReactNode;
  /** In-place preview of the current editor content. */
  renderPreview?: (viewport: FunnelViewport) => ReactNode;
  /** Page-level notice shown between the toolbar and the canvas (for example a converted legacy page). */
  notice?: ReactNode;
  /** Opens 「存成範本」 for the stored page; the toolbar shows the button only when provided. */
  onSaveAsTemplate?: () => void;
};

export type EditorShortcut = "undo" | "redo" | "save" | "delete" | "deselect";

type ShortcutEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "defaultPrevented" | "isComposing"> & { target: EventTarget | null };

type ClosestTarget = { closest?: (selector: string) => unknown; isContentEditable?: boolean };

/** Text entry keeps its native keys: the editor never steals undo, delete or Escape there. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as ClosestTarget | null;
  if (!element || typeof element.closest !== "function") return false;
  if (element.isContentEditable) return true;
  return Boolean(element.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

function insideDialog(target: EventTarget | null) {
  const element = target as ClosestTarget | null;
  return Boolean(element && typeof element.closest === "function" && element.closest("[role='dialog'], [role='alertdialog'], [aria-modal='true']"));
}

/**
 * Maps a keydown to an editor command. Ctrl/Cmd+S is the only shortcut that
 * also works while typing (it has no text-editing meaning and avoids the
 * browser's "save page" dialog); every other shortcut is ignored in inputs,
 * textareas, selects, contenteditable regions and dialogs.
 */
export function editorShortcutFor(event: ShortcutEvent): EditorShortcut | null {
  if (event.defaultPrevented || event.isComposing || insideDialog(event.target)) return null;
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (modifier && !event.altKey && !event.shiftKey && key === "s") return "save";
  if (isTypingTarget(event.target)) return null;
  if (modifier && !event.altKey && key === "z") return event.shiftKey ? "redo" : "undo";
  if (modifier && !event.altKey && !event.shiftKey && key === "y") return "redo";
  if (modifier || event.altKey) return null;
  if (event.key === "Delete" || event.key === "Backspace") return "delete";
  if (event.key === "Escape") return "deselect";
  return null;
}
