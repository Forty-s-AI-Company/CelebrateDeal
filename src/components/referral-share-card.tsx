"use client";

import { useMemo, useState } from "react";
import { generateReferralCard, type ReferralCardInput } from "@/lib/referral-card";

export function ReferralShareCard({ input, themeColor = "#6366f1" }: { input: ReferralCardInput; themeColor?: string }) {
  const [copied, setCopied] = useState(false);
  const cardUrl = useMemo(() => {
    try {
      return new URL(input.referralUrl, window.location.origin).toString();
    } catch {
      return input.referralUrl;
    }
  }, [input.referralUrl]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(cardUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function downloadCard() {
    const card = await generateReferralCard({ ...input, referralUrl: cardUrl });
    const blob = new Blob([card.svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = card.downloadName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="grid gap-3 rounded-2xl border border-indigo-200 bg-slate-950 p-5 text-white shadow-lg" aria-labelledby="referral-share-card-title">
      <h2 id="referral-share-card-title" className="text-lg font-black">把這場分享會送給朋友</h2>
      <p className="text-sm leading-6 text-slate-300">一鍵複製專屬推薦連結，或下載分享海報到 LINE、IG 限時動態。</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={copyLink} className="h-11 rounded-lg px-4 text-sm font-bold text-white transition hover:brightness-110" style={{ backgroundColor: themeColor }}>
          {copied ? "已複製推薦連結" : "一鍵複製推薦連結"}
        </button>
        <button type="button" onClick={downloadCard} className="h-11 rounded-lg border border-slate-600 px-4 text-sm font-bold text-slate-100 transition hover:bg-slate-800">
          下載分享海報
        </button>
      </div>
    </section>
  );
}
