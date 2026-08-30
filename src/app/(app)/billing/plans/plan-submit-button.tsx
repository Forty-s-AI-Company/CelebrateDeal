"use client";

import { FormSubmitButton } from "@/components/form-submit-button";

export function PlanSubmitButton({ label }: { label: string }) {
  const isPlanChange = label === "變更方案";

  return (
    <FormSubmitButton
      pendingChildren={isPlanChange ? "建立變更付款中…" : "建立付款中…"}
      pendingMessage={isPlanChange
        ? "正在建立方案變更付款，請勿重複送出。"
        : "正在建立方案付款，請勿重複送出。"}
      className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
    >
      {label}
    </FormSubmitButton>
  );
}
