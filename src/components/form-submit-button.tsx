"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type FormSubmitButtonProps = {
  children: ReactNode;
  pendingChildren: ReactNode;
  pendingMessage: string;
  className?: string;
};

/**
 * 讓所有 Server Action 表單在送出期間提供一致、可存取的回饋，並避免重複送出。
 */
export function FormSubmitButton({ children, pendingChildren, pendingMessage, className }: FormSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <div className="grid gap-1.5">
      <button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {pending ? pendingChildren : children}
      </button>
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-slate-500">
        {pending ? pendingMessage : ""}
      </p>
    </div>
  );
}
