"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { trapDialogFocus } from "@/components/landing-pages/unsaved-changes-dialog";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";

export type ConfirmOptions = {
  /** The question, shown as the dialog title (same text the native confirm used). */
  message: string;
  /** Optional supporting sentence below the title. */
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for irreversible or disruptive actions. */
  destructive?: boolean;
};

type ConfirmDialogProps = ConfirmOptions & {
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * An in-page replacement for `window.confirm()`.
 *
 * Native confirm dialogs block the renderer, so browser automation and
 * DevTools hang until someone answers them. This is a regular modal
 * (`role="alertdialog"`): Escape, the backdrop and 取消 cancel it, Tab stays
 * inside, and focus starts on the safe choice (取消) and returns to the
 * trigger on close. Mount it only while it is open.
 */
export function ConfirmDialog({
  message: fullMessage,
  description: explicitDescription,
  confirmLabel = "確認",
  cancelLabel = "取消",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Multi-line native messages keep working: the first line is the question,
  // the rest becomes the supporting text with its line breaks preserved.
  const [message = "", ...detailLines] = fullMessage.split("\n");
  const description = explicitDescription ?? (detailLines.join("\n").trim() || undefined);
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  // Declared before the focus effect: the hook records the trigger first.
  useDialogBehavior(true, onCancel);
  useEffect(() => { cancelRef.current?.focus(); }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      data-confirm-backdrop="true"
      className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/60 p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onKeyDown={(event) => { if (panelRef.current) trapDialogFocus(panelRef.current, event); }}
        className="w-full max-w-md rounded-2xl bg-white p-6 text-left shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-bold text-slate-950">{message}</h2>
        {description ? <p id={descriptionId} className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{description}</p> : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="min-h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-confirm-action="true"
            onClick={onConfirm}
            className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md px-4 text-sm font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${destructive ? "bg-red-700 hover:bg-red-800" : "bg-cta hover:bg-cta-dark"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Imperative form of the confirmation for handlers that decide at click time
 * whether to ask (for example only when a form is dirty). Render `dialog`
 * once in the component; call `confirm(options, action, trigger?)` where
 * `window.confirm()` used to be. `action` runs only if the user confirms;
 * focus returns to `trigger` when the dialog closes.
 */
export function useConfirmDialog() {
  const [pendingRequest, setPendingRequest] = useState<{ options: ConfirmOptions; action: () => void; trigger: HTMLElement | null } | null>(null);
  const confirm = useCallback((options: ConfirmOptions, action: () => void, trigger: HTMLElement | null = null) => {
    setPendingRequest({ options, action, trigger });
  }, []);
  // Not every browser focuses a button on click (Safari), so hand focus back explicitly.
  const close = (request: { trigger: HTMLElement | null }) => {
    setPendingRequest(null);
    if (request.trigger?.isConnected) request.trigger.focus();
  };
  const dialog = pendingRequest ? (
    <ConfirmDialog
      {...pendingRequest.options}
      onCancel={() => close(pendingRequest)}
      onConfirm={() => {
        close(pendingRequest);
        pendingRequest.action();
      }}
    />
  ) : null;
  return { confirm, dialog };
}

type ConfirmActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & ConfirmOptions & {
  children: ReactNode;
  /** When false the button acts immediately, like a plain button (default true). */
  confirmRequired?: boolean;
  /** Runs after the user confirms. Not used for `type="submit"` buttons. */
  onConfirm?: () => void;
  /** Runs on every click before the confirmation opens; may call preventDefault() to skip it. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
};

/**
 * A button that asks inside the page before acting.
 *
 * `type="button"` (default) runs `onConfirm` once confirmed. `type="submit"`
 * submits the closest form via `requestSubmit(button)` once confirmed, so the
 * button's name, value and formAction travel with the form exactly as a
 * direct click would. Cancelling does nothing.
 */
export function ConfirmActionButton({
  children,
  message,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  confirmRequired = true,
  onConfirm,
  onClick,
  type = "button",
  ...buttonProps
}: ConfirmActionButtonProps) {
  const { confirm, dialog } = useConfirmDialog();
  return (
    <>
      <button
        {...buttonProps}
        type={type}
        aria-haspopup="dialog"
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          if (!confirmRequired) {
            if (type !== "submit") onConfirm?.();
            return;
          }
          const button = event.currentTarget;
          const form = button.form;
          const options = { message, description, confirmLabel, cancelLabel, destructive };
          if (type === "submit") {
            if (!form) return;
            event.preventDefault();
            // Invalid required fields keep the browser's own validation flow.
            if (!button.formNoValidate && !form.checkValidity()) {
              form.reportValidity();
              return;
            }
            confirm(options, () => form.requestSubmit(button), button);
            return;
          }
          confirm(options, () => onConfirm?.(), button);
        }}
      >
        {children}
      </button>
      {dialog}
    </>
  );
}
