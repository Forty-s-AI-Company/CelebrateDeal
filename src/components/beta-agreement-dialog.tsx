"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";
import { trapDialogFocus } from "@/components/landing-pages/unsaved-changes-dialog";

/** Pixels of slack when deciding the reader has reached the end (sub-pixel scroll positions, zoom). */
const END_TOLERANCE_PX = 8;

type AcceptProps = {
  mode: "accept";
  /** Server Action; it re-checks owner role, vendor and version on its own. */
  action: (formData: FormData) => void | Promise<void>;
  csrfField: ReactNode;
  vendorId: string;
  agreementVersion: string;
  next: string | null;
};

type WaitingProps = { mode: "waiting" };

export type BetaAgreementDialogProps = (AcceptProps | WaitingProps) & {
  title: string;
  /** Short line under the title (who must accept and why the back office is held). */
  intro: ReactNode;
  /** The agreement text (server-rendered BetaAgreementText). */
  children: ReactNode;
  /** A server error from the last submission, already in plain Chinese. */
  error?: string | null;
  /** Secondary controls such as 登出 (rendered inside the dialog so Tab can reach them). */
  footer?: ReactNode;
};

/**
 * Blocking modal for the 封測合作協議 gate. It cannot be dismissed (no close
 * button, Escape does nothing): the back office is behind it until the owner
 * accepts. Tab stays inside the dialog; focus starts on the scrollable
 * agreement so the keyboard can scroll it.
 *
 * Reading aid only: the checkbox unlocks once the agreement has been
 * scrolled to the end (or immediately when it fits without scrolling), and
 * the submit button unlocks once the box is ticked. The Server Action never
 * relies on either.
 */
export function BetaAgreementDialog(props: BetaAgreementDialogProps) {
  const { title, intro, children, error, footer } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const introId = useId();
  const hintId = useId();
  const errorId = useId();
  const [readToEnd, setReadToEnd] = useState(false);
  const [checked, setChecked] = useState(false);

  const measure = useCallback(() => {
    const region = scrollRef.current;
    if (!region) return;
    if (region.scrollTop + region.clientHeight >= region.scrollHeight - END_TOLERANCE_PX) setReadToEnd(true);
  }, []);

  useEffect(() => {
    scrollRef.current?.focus();
    measure();
    // A rotated phone or a resized window can make the whole text fit.
    if (typeof ResizeObserver === "undefined" || !scrollRef.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className="fixed inset-0 z-[200] flex items-stretch justify-center bg-slate-950/60 sm:items-center sm:p-4" data-beta-agreement-gate={props.mode}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={introId}
        onKeyDown={(event) => {
          // Blocking: Escape never closes this dialog.
          if (event.key === "Escape") { event.preventDefault(); return; }
          if (panelRef.current) trapDialogFocus(panelRef.current, event);
        }}
        className="flex max-h-[100dvh] w-full max-w-3xl flex-col bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
      >
        <header className="border-b border-border px-4 pb-4 pt-5 sm:px-6">
          <h1 id={titleId} className="text-xl font-bold text-slate-950">{title}</h1>
          <div id={introId} className="mt-2 text-sm leading-6 text-slate-700">{intro}</div>
          {error ? <p id={errorId} role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{error}</p> : null}
        </header>
        <div
          ref={scrollRef}
          tabIndex={0}
          role="region"
          aria-label="協議全文"
          onScroll={measure}
          data-beta-agreement-scroll
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300 sm:px-6"
        >
          {children}
        </div>
        <footer className="border-t border-border px-4 pb-5 pt-4 sm:px-6">
          {props.mode === "accept" ? (
            <div className="grid gap-3">
            <form action={props.action} className="grid gap-3">
              {props.csrfField}
              <input type="hidden" name="vendorId" value={props.vendorId} />
              <input type="hidden" name="agreementVersion" value={props.agreementVersion} />
              {props.next ? <input type="hidden" name="next" value={props.next} /> : null}
              <label className={`flex items-start gap-3 text-sm leading-6 ${readToEnd ? "text-slate-900" : "text-slate-500"}`}>
                <input
                  type="checkbox"
                  name="acceptBetaAgreement"
                  disabled={!readToEnd}
                  checked={checked}
                  onChange={(event) => setChecked(event.currentTarget.checked)}
                  aria-describedby={readToEnd ? undefined : hintId}
                  className="mt-1 h-5 w-5 shrink-0 accent-[var(--primary)]"
                />
                <span>我已閱讀並同意《CelebrateDeal 封測合作協議》（版本 {props.agreementVersion}），並代表上方乙方商家簽署。</span>
              </label>
              {readToEnd ? null : <p id={hintId} className="text-xs text-slate-600">請先把協議捲動到最後，才能勾選同意。</p>}
              <div className="flex justify-end">
                <FormSubmitButton
                  disabled={!checked}
                  pendingChildren="送出中…"
                  pendingMessage="正在記錄你的同意，請勿重複送出。"
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                >
                  同意並進入後台
                </FormSubmitButton>
              </div>
            </form>
            {/* Outside the accept form: a nested <form> (登出) is invalid HTML. */}
            {footer ? <div className="flex flex-wrap items-center gap-3">{footer}</div> : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-3">{footer}</div>
          )}
        </footer>
      </div>
    </div>
  );
}
