import type { Metadata } from "next";
import Link from "next/link";
import { PublicPolicyShell } from "@/components/public-policy";

export const metadata: Metadata = {
  title: "客服與付款協助 | CelebrateDeal",
  description: "查詢 CelebrateDeal 訂單、履約進度與既有客服案件。",
};

export default function SupportPage() {
  return (
    <PublicPolicyShell>
      <section aria-labelledby="support-title" className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="text-sm font-semibold text-primary">付款與營運協助</p>
          <h1 id="support-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">客服與付款協助</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">查看訂單與履約進度，或查詢已有客服案件的最新回覆。</p>
        </div>
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">如需聯絡客服，請使用本頁下方的客服信箱。服務時段尚未公告，一般客服目前無法承諾固定回應時間；條款另有期限者，依各該條款辦理。平台方案目前不會自動扣款，要結束方案請寄信至客服信箱。</div>
        <section className="mt-8 rounded-lg border border-border bg-white p-6 shadow-sm" aria-labelledby="sla-title">
          <h2 id="sla-title" className="text-lg font-semibold text-slate-950">如何取得協助</h2>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-slate-600">
            <li>先至「訂單與履約進度」查看目前狀態。</li>
            <li>如已有客服案件，至「客服案件」查看最新回覆。</li>
            <li>若付款結果不明，請先核對訂單紀錄，避免重複付款或重複提出相同申請。</li>
          </ol>
        </section>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <section className="rounded-lg border border-border bg-white p-6 shadow-sm" aria-labelledby="safe-intake-title">
            <h2 id="safe-intake-title" className="text-lg font-semibold text-slate-950">提出問題前請留意</h2>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
              <li>說明問題時，可提供訂單編號、發生時間與目前顯示的狀態。</li>
              <li>請勿提供完整卡號、卡片安全碼、帳號密碼、登入憑證或一次性驗證碼。</li>
              <li>如需截圖，請先遮蔽個人資料與付款敏感資訊。</li>
            </ul>
          </section>
          <section className="rounded-lg border border-border bg-white p-6 shadow-sm" aria-labelledby="helpful-links-title">
            <h2 id="helpful-links-title" className="text-lg font-semibold text-slate-950">相關資訊</h2>
            <div className="mt-3 grid gap-2 text-sm">
              <Link href="/support/orders" className="font-semibold text-primary hover:underline">查看我的訂單與履約進度 →</Link>
              <Link href="/support/requests" className="font-semibold text-primary hover:underline">查詢我的訂單客服案件 →</Link>
              <Link href="/policies/refunds" className="font-semibold text-primary hover:underline">查看退款政策 →</Link>
              <Link href="/merchant-onboarding" className="font-semibold text-primary hover:underline">查看商家使用指南 →</Link>
              <Link href="/login" className="font-semibold text-primary hover:underline">返回登入 →</Link>
            </div>
          </section>
        </div>
      </section>
    </PublicPolicyShell>
  );
}
