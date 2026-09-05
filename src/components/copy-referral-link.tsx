"use client";

import { useState } from "react";

export function CopyReferralLink({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        aria-label="專屬推薦連結"
        readOnly
        value={value}
        className="h-11 min-w-0 flex-1 rounded-md border border-border bg-slate-50 px-3 font-mono text-sm text-slate-700"
      />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2_000);
        }}
        className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark"
      >
        {copied ? "已複製" : "一鍵複製"}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{copied ? "推薦連結已複製" : ""}</span>
    </div>
  );
}

