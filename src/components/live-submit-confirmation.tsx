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
  /** The studio is saving the latest draft before this submit continues. */
  savingBeforeSubmit?: boolean;
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
 *
 * The confirmation is single-use: it closes once its submission settles, so a
 * same-page redirect (for example the edit page after 開始直播) can never leave
 * it open over the next status action.
 */
export function LiveConfirmedSubmitButton({
  children,
  name,
  value,
  disabled,
  savingBeforeSubmit = false,
  confirmMessage,
  confirmLabel,
  pendingChildren,
  pendingMessage,
  className,
}: LiveConfirmedSubmitButtonProps) {
  const [open, setOpen] = useState(false);
  const { pending } = useFormStatus();
  const [wasPending, setWasPending] = useState(pending);
  if (wasPending !== pending) {
    setWasPending(pending);
    if (wasPending && !pending && open) setOpen(false);
  }
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
          savingBeforeSubmit={savingBeforeSubmit}
          pendingChildren={pendingChildren}
          pendingMessage={pendingMessage}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * While a studio submit is pending, mark the form busy and inert so nothing
 * typed in that window is silently replaced by the server's re-render.
 * Render inside the form: `useFormStatus` only reports its parent form.
 */
export function LiveFormPendingLock({ formRef }: { formRef: { current: HTMLFormElement | null } }) {
  const { pending } = useFormStatus();
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    form.inert = pending;
    form.setAttribute("aria-busy", String(pending));
  }, [formRef, pending]);
  return null;
}

function LiveSubmitConfirmDialog({
  title,
  confirmLabel,
  name,
  value,
  savingBeforeSubmit,
  pendingChildren,
  pendingMessage,
  onCancel,
}: {
  title: string;
  confirmLabel: string;
  name: string;
  value: string;
  savingBeforeSubmit: boolean;
  pendingChildren: ReactNode;
  pendingMessage: string;
  onCancel: () => void;
}) {
  const { pending } = useFormStatus();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialogBehavior(true, () => { if (!pending) onCancel(); });
  // These actions publish, end or unpublish a live: start on the safe choice.
  useEffect(() => { cancelRef.current?.focus(); }, []);
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
            ref={cancelRef}
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          {/*
            While the studio saves the draft before submitting, this button
            stays enabled in the DOM (a disabled submitter would drop `status`
            from the follow-up submit) but ignores further clicks; the studio's
            submit guard also refuses re-entrant submits.
          */}
          <FormSubmitButton
            name={name}
            value={value}
            onClick={(event) => { if (savingBeforeSubmit) event.preventDefault(); }}
            pendingChildren={pendingChildren}
            pendingMessage={pendingMessage}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-cta px-4 text-sm font-semibold text-white transition hover:bg-cta-dark"
          >
            {savingBeforeSubmit ? pendingChildren : confirmLabel}
          </FormSubmitButton>
        </div>
      </div>
    </div>
  );
}
