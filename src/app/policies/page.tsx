import type { Metadata } from "next";
import Link from "next/link";
import { PublicPolicyShell, PolicyDraftNotice, PublicResourceLinks } from "@/components/public-policy";

export const metadata: Metadata = {
  title: "政策與協助中心 | CelebrateDeal",
  description: "CelebrateDeal 的政策、客服與商家 onboarding 草稿入口。",
};

export default function PoliciesPage() {
  return (
    <PublicPolicyShell>
      <section aria-labelledby="policies-title" className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="text-sm font-semibold text-primary">公開資訊入口</p>
          <h1 id="policies-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">政策與協助中心</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
            在付款、退款、資料請求或商家 onboarding 前，先查看目前可追溯的產品邊界與待核准項目。
          </p>
        </div>
        <PolicyDraftNotice status="DRAFT — HUMAN OWNER ACCEPTANCE REQUIRED" owner="privacy／legal、finance、support、merchant 與 release owner" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[
            ["/policies/terms", "使用條款（草稿）", "帳號、服務、內容與方案的待核准邊界。"],
            ["/policies/privacy", "隱私通知（草稿）", "資料用途、保存、請求與第三方服務的待核准入口。"],
            ["/policies/refunds", "退款政策（草稿）", "退款狀態、客服交接與禁止重試的產品說明。"],
            ["/support", "客服與付款協助", "P0／P1／P2 目標回應與付款事件升級草稿。"],
            ["/merchant-onboarding", "商家 onboarding", "八階段商家交接與 owner evidence 的可見摘要。"],
          ].map(([href, title, description]) => (
            <Link key={href} href={href} className="rounded-lg border border-border bg-white p-5 shadow-sm transition-colors hover:border-primary hover:bg-blue-50">
              <h2 className="font-semibold text-slate-950">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
              <span className="mt-4 inline-block text-sm font-semibold text-primary">查看頁面 →</span>
            </Link>
          ))}
        </div>
        <section className="mt-8 rounded-lg border border-border bg-white p-6 shadow-sm" aria-labelledby="next-step-title">
          <h2 id="next-step-title" className="text-lg font-semibold text-slate-950">目前唯一安全下一步</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            請由對應真人 owner 逐頁核對內容、適用環境、生效日期、客服入口與 rollback／停止條件，再留下去識別的 acceptance receipt。AI 不代替法律、財務、客服或 release 簽核。
          </p>
          <div className="mt-4"><PublicResourceLinks /></div>
        </section>
      </section>
    </PublicPolicyShell>
  );
}
