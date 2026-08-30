import type { Metadata } from "next";
import Link from "next/link";
import { PolicyDraftNotice, PublicPolicyShell } from "@/components/public-policy";

export const metadata: Metadata = {
  title: "商家 onboarding | CelebrateDeal",
  description: "CelebrateDeal 商家 onboarding 八階段與 owner handoff 草稿。",
};

const stages = [
  ["1", "商家／owner 身分與唯一責任", "OWNER ACCEPTANCE REQUIRED"],
  ["2", "密碼、session、MFA、recovery 與最小權限", "LOCAL EVIDENCE + MANUAL REQUIRED"],
  ["3", "成員邀請、角色與 active owner", "LOCAL EVIDENCE + MANUAL REQUIRED"],
  ["4", "品牌與 tracking", "LOCAL EVIDENCE + MANUAL REQUIRED"],
  ["5", "商品、直播、表單、互動角色與腳本", "LOCAL EVIDENCE + MANUAL REQUIRED"],
  ["6", "方案與 PayUni 邊界", "LOCAL EVIDENCE + EXTERNAL REQUIRED"],
  ["7", "支援與退款 SOP handoff", "LOCAL EVIDENCE + OWNER ACCEPTANCE REQUIRED"],
  ["8", "DNS、條款、隱私、退款政策與正式 owner acceptance", "EXTERNAL + MANUAL REQUIRED"],
] as const;

export default function MerchantOnboardingPage() {
  return (
    <PublicPolicyShell>
      <section aria-labelledby="onboarding-title" className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="text-sm font-semibold text-primary">商家交接入口</p>
          <h1 id="onboarding-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">商家 onboarding</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">以八階段 checklist 讓商家、平台、客服、財務與 release owner 看見同一份 readiness 邊界。</p>
        </div>
        <PolicyDraftNotice status="DRAFT — MERCHANT／SUPPORT／FINANCE／LEGAL／RELEASE ACCEPTANCE REQUIRED" owner="商家 owner、平台 owner、support、finance、privacy／legal、release owner" />
        <section className="mt-8 rounded-lg border border-border bg-white p-6 shadow-sm" aria-labelledby="stages-title">
          <h2 id="stages-title" className="text-lg font-semibold text-slate-950">八階段 readiness</h2>
          <ol className="mt-4 grid gap-3">
            {stages.map(([number, title, status]) => (
              <li key={number} className="flex gap-4 rounded-md border border-border p-4">
                <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-50 text-sm font-bold text-primary">{number}</span>
                <div><h3 className="font-semibold text-slate-950">{title}</h3><p className="mt-1 text-xs font-semibold tracking-wide text-amber-700">{status}</p></div>
              </li>
            ))}
          </ol>
        </section>
        <section className="mt-6 rounded-lg border border-border bg-white p-6 shadow-sm" aria-labelledby="handoff-title">
          <h2 id="handoff-title" className="text-lg font-semibold text-slate-950">交接時應留下的 evidence</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">環境分類、短雜湊參照、已驗證項目、未知／BLOCKED 項目、下一位 owner、唯一安全下一步、授權需求與停止／回滾條件。不得填入姓名、完整 email、密碼、Cookie、Token 或付款資料。</p>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <Link href="/support" className="font-semibold text-primary hover:underline">客服與事件升級 →</Link>
            <Link href="/policies" className="font-semibold text-primary hover:underline">政策與協助中心 →</Link>
          </div>
        </section>
      </section>
    </PublicPolicyShell>
  );
}
