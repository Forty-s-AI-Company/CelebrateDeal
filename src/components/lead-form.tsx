"use client";

import { useState } from "react";

type FieldSpec = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
};

export function LeadForm({
  formId,
  liveId,
  fields,
  submitLabel,
  successMessage,
  redirectTo,
}: {
  formId: string;
  liveId?: string | null;
  fields: FieldSpec[];
  submitLabel: string;
  successMessage: string;
  redirectTo?: string;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    const form = event.currentTarget;

    const formData = new FormData(form);
    const payload = Object.fromEntries(
      [...formData.entries()].filter(([key]) => !["formId", "liveId", "referralCode", "redirectTo"].includes(key)),
    );
    const referralCode = new URLSearchParams(window.location.search).get("ref");
    try {
      const response = await fetch("/api/form-submissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CelebrateDeal-Client": "web",
        },
        body: JSON.stringify({ formId, liveId, payload, referralCode }),
      });

      setStatus(response.ok ? "success" : "error");
      if (response.ok) {
        form.reset();
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return <p className="rounded-lg bg-emerald-50 p-4 text-sm font-medium text-emerald-700">{successMessage}</p>;
  }

  return (
    <form method="post" action="/api/form-submissions" onSubmit={onSubmit} className="grid gap-3">
      <input type="hidden" name="formId" value={formId} />
      {liveId ? <input type="hidden" name="liveId" value={liveId} /> : null}
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}
      {fields.map((field) => (
        <label key={field.key} className="grid gap-1.5 text-sm font-medium text-slate-700">
          {field.label}
          <input
            name={field.key}
            type={field.type ?? "text"}
            required={field.required}
            className="h-11 rounded-md border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
      ))}
      {status === "error" ? <p className="text-sm text-red-600">送出失敗，請稍後再試。</p> : null}
      <button disabled={status === "loading"} className="h-11 rounded-md bg-orange-500 text-sm font-bold text-white transition hover:bg-orange-600 disabled:opacity-60">
        {status === "loading" ? "送出中..." : submitLabel}
      </button>
    </form>
  );
}
