"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="zh-Hant">
      <body className="min-h-screen bg-slate-100 px-6 py-12 text-slate-900">
        <main className="mx-auto max-w-xl rounded-2xl bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold text-blue-600">CelebrateDeal</p>
          <h1 className="mt-3 text-2xl font-bold">系統暫時無法顯示這個頁面</h1>
          <p className="mt-3 text-sm text-slate-600">錯誤已送出給維運團隊，請稍後重新整理或返回後台。</p>
        </main>
      </body>
    </html>
  );
}
