"use client";

import { type FormEvent, useRef, useState } from "react";

type ExternalPaymentFormProps = {
  action: string;
  payload: Record<string, string>;
  target?: "_blank" | "_self";
  className?: string;
  buttonClassName?: string;
};

/**
 * 保留 provider 的原生 form-post contract，同時在瀏覽器離站期間避免重複送出。
 */
export function ExternalPaymentForm({
  action,
  payload,
  target = "_self",
  className = "mt-4",
  buttonClassName = "bg-slate-950 hover:bg-slate-800",
}: ExternalPaymentFormProps) {
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
    <form
      action={action}
      method="post"
      target={target}
      rel={target === "_blank" ? "noopener noreferrer" : undefined}
      className={className}
      aria-busy={pending}
      onSubmit={handleSubmit}
    >
      {Object.entries(payload).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        aria-busy={pending}
        className={`inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${buttonClassName}`}
      >
        {pending ? "正在前往付款頁…" : "前往安全付款頁"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? "正在安全傳送付款資料，請勿重複送出。" : ""}
      </span>
    </form>
  );
}
