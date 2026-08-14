"use client";

import { type FormEvent, type ReactNode, useRef, useState } from "react";

/** 保留原生 POST 與 no-JS 行為，並在頁面導航前同步阻擋重複送出。 */
export function NativePostForm({
  action,
  children,
  idleLabel,
  pendingLabel,
  pendingMessage,
  className,
  buttonClassName,
}: {
  action: string;
  children: ReactNode;
  idleLabel: string;
  pendingLabel: string;
  pendingMessage: string;
  className?: string;
  buttonClassName?: string;
}) {
  const [pending, setPending] = useState(false);
  const submittedRef = useRef(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (submittedRef.current) {
      event.preventDefault();
      return;
    }
    submittedRef.current = true;
    setPending(true);
  }

  return (
    <form action={action} method="post" className={className} aria-busy={pending} onSubmit={handleSubmit}>
      {children}
      <button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        aria-busy={pending}
        className={`${buttonClassName ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {pending ? (
          <span className="inline-flex items-center justify-center gap-2">
            <span aria-hidden="true" data-loading-indicator="true" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" />
            {pendingLabel}
          </span>
        ) : idleLabel}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{pending ? pendingMessage : ""}</span>
    </form>
  );
}
