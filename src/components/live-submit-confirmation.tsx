"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { FormSubmitButton } from "@/components/form-submit-button";
import { trapDialogFocus } from "@/components/landing-pages/unsaved-changes-dialog";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";

type LiveConfirmedSubmitButtonProps = {
  children: ReactNode;
  name: string;
  value: string;
  disabled: boolean;
  confirmMessage: string;
  confirmLabel: string;
  pendingChildren: ReactNode;
  pendingMessage: string;
  className: string;
};

/**
 * A publish/status submitter that asks for confirmation inside the page.
 *
 * `window.confirm()` is a blocking native modal: while it is open the renderer
 * runs no script and DevTools/automation calls hang until someone answers it,
 * which browser QA reported as a frozen Live Studio. This keeps the page
 * scriptable and submits through a real submit button so `status` and the
 * draft claim travel with the form exactly as before.
 */
export function LiveConfirmedSubmitButton({
  children,
  name,
  value,
  disabled,
  confirmMessage,
  confirmLabel,
  pendingChildren,
  pendingMessage,
  className,
}: LiveConfirmedSubmitButtonProps) {
  const [open, setOpen] = useState(false);
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="button"
        disabled={disabled || pending}
        aria-disabled={disabled || pending}
        aria-haspopup="dialog"
        onClick={(event) => {
          const form = event.currentTarget.form;
          // Invalid fields keep the existing flow: the form's invalid handler
          // jumps to the step that needs attention instead of asking to publish.
          if (form && !form.checkValidity()) {
            form.reportValidity();
            return;
          }
          setOpen(true);
        }}
        className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {children}
      </button>
      {open ? (
        <LiveSubmitConfirmDialog
          title={confirmMessage}
          confirmLabel={confirmLabel}
          name={name}
          value={value}
          pendingChildren={pendingChildren}
          pendingMessage={pendingMessage}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function LiveSubmitConfirmDialog({
  title,
  confirmLabel,
  name,
  value,
  pendingChildren,
  pendingMessage,
  onCancel,
}: {
  title: string;
  confirmLabel: string;
  name: string;
  value: string;
  pendingChildren: ReactNode;
  pendingMessage: string;
  onCancel: () => void;
}) {
  const { pending } = useFormStatus();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialogBehavior(true, () => { if (!pending) onCancel(); });
  // The trigger was enabled only for a saved, publish-ready draft. While this
  // modal is open the form cannot be edited; the submit itself may briefly
  // flip the draft to "saving", so the confirm button is not tied to that
  // state. The server still re-checks the draft claim and readiness.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]:not([disabled])')?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/60 p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onCancel(); }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={(event) => { if (panelRef.current) trapDialogFocus(panelRef.current, event); }}
        className="w-full max-w-md rounded-2xl bg-white p-6 text-left shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-bold text-slate-950">{title}</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600">
          送出前會先安全儲存最新草稿；送出期間請勿關閉頁面。
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <FormSubmitButton
            name={name}
            value={value}
            pendingChildren={pendingChildren}
            pendingMessage={pendingMessage}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-cta px-4 text-sm font-semibold text-white transition hover:bg-cta-dark"
          >
            {confirmLabel}
          </FormSubmitButton>
        </div>
      </div>
    </div>
  );
}
