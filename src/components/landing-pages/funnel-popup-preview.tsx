"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { FunnelCommerceView } from "@/lib/funnel-commerce";

import {
  parsePageDocument,
  type FunnelPopup,
  type PageDocument,
} from "@/lib/funnel-page-document";
import {
  validatePopupTrigger,
  type PopupTriggerEligibility,
} from "@/lib/funnel-popup";

import {
  FunnelPageDocumentRenderer,
  type FunnelViewport,
} from "./funnel-page-document-renderer";

/**
 * The callback is intentionally based on the domain eligibility result.  This
 * lets the editor and the real preview surface show the same explicit
 * fail-closed state without pretending that exit intent has been verified.
 */
export type FunnelPopupPreviewProps = {
  commerce?: FunnelCommerceView;
  publicSurface?: boolean;
  document: PageDocument;
  popupId: string;
  viewport?: FunnelViewport;
  /** Editor preview opens immediately; the normal preview follows the delay. */
  previewEnabled?: boolean;
  className?: string;
  onTriggerStatus?: (status: PopupTriggerEligibility) => void;
};

export type SchedulePopupOpenOptions = {
  previewEnabled?: boolean;
  onOpen: () => void;
};

export type ScheduledPopupOpen = {
  status: PopupTriggerEligibility;
  cancel: () => void;
};

const shadowValue: Record<FunnelPopup["settings"]["shadow"], string> = {
  none: "none",
  soft: "0 10px 30px rgba(15, 23, 42, 0.14)",
  medium: "0 18px 45px rgba(15, 23, 42, 0.2)",
  strong: "0 24px 60px rgba(15, 23, 42, 0.28)",
};

function widthValue(value: unknown): CSSProperties["width"] {
  if (typeof value === "number" && Number.isFinite(value)) return `${value}%`;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function editorPreviewStatus(): PopupTriggerEligibility {
  return {
    trigger: "automatic_delay",
    status: "available",
    executable: true,
    canTrigger: true,
    reason: "編輯器預覽可立即顯示指定 Popup",
    delayMs: 0,
  };
}

/**
 * Schedules only the explicitly supported automatic trigger.  Keeping this
 * helper pure apart from the timer makes the timing contract easy to test and
 * means an unverified exit-intent trigger can never accidentally be scheduled.
 */
export function scheduleFunnelPopupOpen(
  popup: FunnelPopup,
  { previewEnabled = false, onOpen }: SchedulePopupOpenOptions,
): ScheduledPopupOpen {
  const status = previewEnabled ? editorPreviewStatus() : validatePopupTrigger(popup, "automatic_delay");
  if (!status.executable) return { status, cancel: () => undefined };

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (previewEnabled) {
    onOpen();
  } else {
    timer = setTimeout(onOpen, status.delayMs ?? 0);
  }
  return {
    status,
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

/** Returns the explicit exit-intent capability state without registering a listener. */
export function getFunnelPopupExitIntentStatus(popup: FunnelPopup): PopupTriggerEligibility {
  return validatePopupTrigger(popup, "exit_intent");
}

function popupStyle(popup: FunnelPopup): CSSProperties {
  const settings = popup.settings;
  const width = widthValue(popup.root[0]?.style.width);
  return {
    backgroundColor: settings.backgroundColor,
    width,
    maxWidth: "calc(100vw - 2rem)",
    padding: `${settings.padding}px`,
    border: `${settings.borderWidth}px ${settings.borderStyle} ${settings.borderColor}`,
    borderRadius: `${settings.cornerRadius}px`,
    boxShadow: shadowValue[settings.shadow],
  };
}

function popupDocument(document: PageDocument, popup: FunnelPopup): PageDocument {
  // The popup content is rendered through the same parsed node contract as the
  // page.  In particular, this never turns a stored raw_html prop into markup.
  return { ...document, root: popup.root, popups: [] };
}

function statusLabel(status: PopupTriggerEligibility): string {
  if (status.status === "unverified") return `Exit intent：unverified（${status.reason}）`;
  return status.status === "disabled" ? `Popup：${status.reason}` : status.reason;
}

/**
 * Safe overlay preview for one persisted Popup.  `previewEnabled` is an
 * explicit editor affordance; normal preview waits for the configured delay.
 * No mouseleave/exit-intent listener is registered until that capability is
 * actually verified, so the current unverified state cannot trigger content.
 */
export function FunnelPopupPreview({
  document,
  popupId,
  viewport = "desktop",
  previewEnabled = false,
  className = "",
  onTriggerStatus,
  commerce,
  publicSurface,
}: FunnelPopupPreviewProps) {
  const parsed = useMemo(() => parsePageDocument(document), [document]);
  const popup = parsed?.popups.find((candidate) => candidate.id === popupId) ?? null;
  if (!parsed || !popup) {
    return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">找不到可預覽的 Popup。</div>;
  }
  return (
    <FunnelPopupPreviewOverlay
      key={`${popup.id}:${previewEnabled ? "editor" : "preview"}`}
      document={parsed}
      commerce={commerce}
      publicSurface={publicSurface}
      popup={popup}
      viewport={viewport}
      previewEnabled={previewEnabled}
      className={className}
      onTriggerStatus={onTriggerStatus}
    />
  );
}

type FunnelPopupPreviewOverlayProps = {
  commerce?: FunnelCommerceView;
  publicSurface?: boolean;
  document: PageDocument;
  popup: FunnelPopup;
  viewport: FunnelViewport;
  previewEnabled: boolean;
  className: string;
  onTriggerStatus?: (status: PopupTriggerEligibility) => void;
};

function FunnelPopupPreviewOverlay({
  document,
  popup,
  viewport,
  previewEnabled,
  className,
  onTriggerStatus,
  commerce,
  publicSurface,
}: FunnelPopupPreviewOverlayProps) {
  const initialWaitingStatus = !previewEnabled ? validatePopupTrigger(popup, "automatic_delay") : null;
  const [isOpen, setIsOpen] = useState(previewEnabled);
  const [closed, setClosed] = useState(false);
  const [waitingStatus] = useState<PopupTriggerEligibility | null>(initialWaitingStatus);
  const closedRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const closePopup = useCallback(() => {
    closedRef.current = true;
    setIsOpen(false);
    setClosed(true);
    previousFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    const exitStatus = getFunnelPopupExitIntentStatus(popup);
    if (popup.settings.openOnExitIntent) onTriggerStatus?.(exitStatus);

    const scheduled = scheduleFunnelPopupOpen(popup, {
      previewEnabled,
      onOpen: () => {
        if (!closedRef.current) setIsOpen(true);
      },
    });
    if (!previewEnabled) {
      onTriggerStatus?.(scheduled.status);
    }
    return scheduled.cancel;
  }, [onTriggerStatus, popup, previewEnabled]);

  useEffect(() => {
    const openFromAction = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail && typeof detail === "object" && "popupId" in detail && detail.popupId === popup.id && !closedRef.current) setIsOpen(true);
    };
    window.addEventListener("celebratedeal:show-popup", openFromAction);
    return () => window.removeEventListener("celebratedeal:show-popup", openFromAction);
  }, [popup.id]);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closePopup(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && globalThis.document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && globalThis.document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    globalThis.document.addEventListener("keydown", keyboard);
    return () => globalThis.document.removeEventListener("keydown", keyboard);
  }, [closePopup, isOpen]);

  if (closed) return null;

  const exitStatus = popup.settings.openOnExitIntent ? getFunnelPopupExitIntentStatus(popup) : null;
  if (!isOpen) {
    return (
      <div
        data-funnel-popup-preview
        data-popup-id={popup.id}
        data-funnel-popup-state="waiting"
        data-funnel-popup-status={waitingStatus?.status ?? "waiting"}
        className={className}
        aria-live="polite"
      >
        {waitingStatus ? <span className="sr-only">{statusLabel(waitingStatus)}</span> : null}
        {exitStatus ? <p data-funnel-popup-exit-intent-status="unverified" className="text-xs text-amber-700">{statusLabel(exitStatus)}</p> : null}
      </div>
    );
  }

  const content = popupDocument(document, popup);
  return (
    <div
      data-funnel-popup-preview
      data-popup-id={popup.id}
      data-funnel-popup-state="open"
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 ${className}`.trim()}
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        data-funnel-popup-overlay
        data-popup-id={popup.id}
        role="dialog"
        aria-modal="true"
        aria-label={popup.name}
        style={popupStyle(popup)}
        className="relative max-h-[calc(100vh-2rem)] min-h-0 overflow-auto"
      >
        {popup.settings.showCloseButton ? (
          <button
            type="button"
            aria-label="關閉 Popup"
            data-funnel-popup-close
            className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-lg leading-none text-slate-700 shadow-sm"
            onClick={closePopup}
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
        <FunnelPageDocumentRenderer document={content} commerce={commerce} publicSurface={publicSurface} viewport={viewport} mode="preview" className="min-h-0" />
        {exitStatus ? <p data-funnel-popup-exit-intent-status="unverified" className="mt-3 text-xs text-amber-700">{statusLabel(exitStatus)}</p> : null}
      </div>
    </div>
  );
}
