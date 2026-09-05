"use client";

import { useState } from "react";

type BindingRequest =
  | { mode: "registration"; redirectPath: string }
  | { mode: "promoter"; redirectPath: string }
  | { mode: "buyer"; grantId: string; redirectPath: string };

async function startLine(request: BindingRequest | { mode: "login"; affiliateCode: string; redirectPath: string }) {
  const response = await fetch("/api/auth/line/start", {
    method: "POST",
    headers: { "content-type": "application/json", "x-celebratedeal-client": "web" },
    body: JSON.stringify(request),
  });
  const result: unknown = await response.json();
  if (!response.ok || !result || typeof result !== "object" || !("authorizationUrl" in result) || typeof result.authorizationUrl !== "string") {
    throw new Error("line_unavailable");
  }
  window.location.assign(result.authorizationUrl);
}

export function LineLoginButton({ request, children = "綁定 LINE 接收通知" }: { request: BindingRequest; children?: string }) {
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  return (
    <div>
      <button
        type="button"
        disabled={state === "pending"}
        onClick={() => {
          setState("pending");
          void startLine(request).catch(() => setState("error"));
        }}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#06C755] px-4 text-sm font-bold text-white hover:bg-[#05b64d] disabled:opacity-60"
      >
        {state === "pending" ? "前往 LINE…" : children}
      </button>
      {state === "error" ? <p role="alert" className="mt-2 text-sm text-red-700">LINE 目前無法使用，請稍後再試。</p> : null}
    </div>
  );
}

export function LineQuickLoginForm() {
  const [affiliateCode, setAffiliateCode] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <p className="text-sm font-semibold text-slate-900">已綁定 LINE？</p>
      <label className="mt-3 grid gap-1.5 text-sm font-medium text-slate-700">
        推廣碼
        <input value={affiliateCode} onChange={(event) => setAffiliateCode(event.target.value)} maxLength={80} className="h-11 rounded-md border border-border px-3 font-mono uppercase" />
      </label>
      <button
        type="button"
        disabled={state === "pending" || !affiliateCode.trim()}
        onClick={() => {
          setState("pending");
          void startLine({ mode: "login", affiliateCode: affiliateCode.trim(), redirectPath: "/affiliate-portal" }).catch(() => setState("error"));
        }}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[#06C755] px-4 font-bold text-white hover:bg-[#05b64d] disabled:opacity-60"
      >
        {state === "pending" ? "前往 LINE…" : "使用 LINE 快速登入"}
      </button>
      {state === "error" ? <p role="alert" className="mt-2 text-sm text-red-700">找不到可用的 LINE 綁定，請確認推廣碼。</p> : null}
    </div>
  );
}
