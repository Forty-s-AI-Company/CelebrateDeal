import type { Metadata, Route } from "next";
import Link from "next/link";
import { PublicPolicyShell, PublicResourceLinks } from "@/components/public-policy";
import { policyCenterPublication } from "@/lib/public-policy-content";

export const metadata: Metadata = {
  title: "政策與協助中心 | CelebrateDeal",
  description: "查看 CelebrateDeal 政策發布狀態、訂單協助與商家使用指南。",
};

export default function PoliciesPage() {
  const policyLinks = [
    { href: "/policies/terms", title: "使用條款", description: "查看服務、帳號、付款與通知規則。" },
    { href: "/policies/privacy", title: "隱私通知", description: "查看資料用途、共享範圍、保存原則與權利。" },
    { href: "/policies/refunds", title: "退款政策", description: "查看退款申請、解除契約與付款支援規則。" },
    { href: "/support", title: "客服與付款協助", description: "查看訂單、履約進度與已有的客服案件。" },
    { href: "/merchant-onboarding", title: "商家使用指南", description: "查看商家設定與使用流程。" },
  ] satisfies readonly { href: Route; title: string; description: string }[];

  return (
    <PublicPolicyShell>
      <section aria-labelledby="policies-title" className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="text-sm font-semibold text-primary">公開資訊入口</p>
          <h1 id="policies-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">政策與協助中心</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
            查看目前生效的政策，或前往訂單、客服與商家使用指南。
          </p>
        </div>
        <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <p className="font-bold">預定政策版本 {policyCenterPublication.version}</p>
          <p className="mt-1 leading-6">預定生效日為 {policyCenterPublication.effectiveDateLabel}。各政策頁會顯示完整內容與聯絡方式；若公開日期異動，生效日會同步更新，避免倒填生效。</p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {policyLinks.map(({ href, title, description }) => (
            <Link key={href} href={href} className="rounded-lg border border-border bg-white p-5 shadow-sm transition-colors hover:border-primary hover:bg-blue-50">
              <h2 className="font-semibold text-slate-950">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
              <span className="mt-4 inline-block text-sm font-semibold text-primary">查看頁面 →</span>
            </Link>
          ))}
        </div>
        <section className="mt-8 rounded-lg border border-border bg-white p-6 shadow-sm" aria-labelledby="next-step-title">
          <h2 id="next-step-title" className="text-lg font-semibold text-slate-950">常用資訊</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            如需查看既有訂單、退款進度或客服案件，請前往客服與付款協助。
          </p>
          <div className="mt-4"><PublicResourceLinks /></div>
        </section>
      </section>
    </PublicPolicyShell>
  );
}
