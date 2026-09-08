"use client";

import { useState } from "react";

export function CustomerCopyButton({ summary }: { summary: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="min-h-11 rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={async () => { await navigator.clipboard.writeText(summary); setCopied(true); }}>{copied ? "已複製" : "複製學員摘要"}</button>;
}
