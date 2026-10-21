import type { Metadata } from "next";
import { HistoryBackButton } from "@/components/history-back-button";

export const metadata: Metadata = { title: "報名資料未能送出", robots: { index: false, follow: false } };

/** Fixed fallback when a native registration POST cannot be traced back to a trusted source page. */
export default function RegistrationErrorPage() {
  return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-bold">報名資料未能送出</h1><p role="alert" className="mt-4">無法安全確認原報名頁，這次未儲存填寫內容。請回到原活動頁重新填寫。</p><div className="mt-6"><HistoryBackButton fallbackHref={null}>回上一頁</HistoryBackButton></div></main>;
}
