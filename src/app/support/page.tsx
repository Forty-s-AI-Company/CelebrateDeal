import type { Metadata } from "next";
import Link from "next/link";
import { PolicyDraftNotice, PublicPolicyShell } from "@/components/public-policy";

export const metadata: Metadata = {
  title: "客服與付款協助 | CelebrateDeal",
  description: "CelebrateDeal 客服 SLA 與付款、退款事件升級草稿。",
};

const responseTargets = [
  ["P0", "可能重複扣款、退款錯帳、權限繞過或付款服務全面不可用", "目標 15 分鐘內首次回應", "平台管理員／Release owner"],
  ["P1", "單筆金額或狀態不一致、webhook exhausted、退款長時間未完成", "目標 1 小時內首次回應", "財務／平台管理員"],
  ["P2", "一般退款進度詢問或已拒絕的重複操作", "目標 1 個工作日內首次回應", "客服人員，必要時升級"],
] as const;

export default function SupportPage() {
  return (
    <PublicPolicyShell>
      <section aria-labelledby="support-title" className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="text-sm font-semibold text-primary">付款與營運協助</p>
          <h1 id="support-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">客服與事件升級</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">先確認事件分級、禁止操作與安全交接，再由對應 owner 決定下一步。</p>
        </div>
        <PolicyDraftNotice status="DRAFT — SUPPORT／FINANCE OWNER ACCEPTANCE REQUIRED" owner="support owner、finance owner、platform owner、release owner" />
        <section className="mt-8 rounded-lg border border-border bg-white p-6 shadow-sm" aria-labelledby="sla-title">
          <h2 id="sla-title" className="text-lg font-semibold text-slate-950">目標回應矩陣（待 owner 核准）</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <caption className="sr-only">客服事件分級、目標回應與升級對象</caption>
              <thead className="border-y border-border bg-slate-50 text-slate-600"><tr><th scope="col" className="px-3 py-3">等級</th><th scope="col" className="px-3 py-3">觸發條件</th><th scope="col" className="px-3 py-3">目標</th><th scope="col" className="px-3 py-3">升級</th></tr></thead>
              <tbody>{responseTargets.map(([level, trigger, target, owner]) => <tr key={level} className="border-b border-border align-top"><th scope="row" className="px-3 py-3 font-semibold text-slate-950">{level}</th><td className="px-3 py-3 text-slate-600">{trigger}</td><td className="px-3 py-3 text-slate-600">{target}</td><td className="px-3 py-3 text-slate-600">{owner}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <section className="rounded-lg border border-border bg-white p-6 shadow-sm" aria-labelledby="safe-intake-title">
            <h2 id="safe-intake-title" className="text-lg font-semibold text-slate-950">安全受理</h2>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
              <li>只保存環境、狀態分類與短雜湊參照。</li>
              <li>不要求完整卡號、CVV、密碼、Token、Cookie 或原始 provider payload。</li>
              <li>付款／退款狀態不明時停止自動重試並升級。</li>
            </ul>
          </section>
          <section className="rounded-lg border border-border bg-white p-6 shadow-sm" aria-labelledby="helpful-links-title">
            <h2 id="helpful-links-title" className="text-lg font-semibold text-slate-950">相關資訊</h2>
            <div className="mt-3 grid gap-2 text-sm">
              <Link href="/support/orders" className="font-semibold text-primary hover:underline">查看我的訂單與履約進度 →</Link>
              <Link href="/support/requests" className="font-semibold text-primary hover:underline">查詢我的訂單客服案件 →</Link>
              <Link href="/policies/refunds" className="font-semibold text-primary hover:underline">查看退款政策草稿 →</Link>
              <Link href="/merchant-onboarding" className="font-semibold text-primary hover:underline">查看商家 onboarding →</Link>
              <Link href="/login" className="font-semibold text-primary hover:underline">返回登入 →</Link>
            </div>
          </section>
        </div>
      </section>
    </PublicPolicyShell>
  );
}
