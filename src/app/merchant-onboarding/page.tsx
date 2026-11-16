import type { Metadata, Route } from "next";
import Link from "next/link";
import { PolicyScopeNotice, PublicPolicyShell } from "@/components/public-policy";
import { merchantOnboardingOutline } from "@/lib/merchant-onboarding";

export const metadata: Metadata = {
  title: "商家使用指南 | CelebrateDeal",
  description: "開始在 CelebrateDeal 銷售前要完成的步驟：商店與客服資料、平台服務付款驗證、商品、報名流程與第一場可販售直播。",
};

/** Account and support setup that is not part of the 上線任務 list but every merchant needs. */
const resources = [
  {
    title: "帳號安全與團隊",
    description: "到「安全性」啟用多因子驗證（MFA）並保存復原方式；在「團隊管理」邀請夥伴，只給予需要的權限。",
    links: [
      { href: "/settings/security", label: "安全性設定" },
      { href: "/settings/team", label: "團隊管理" },
    ],
  },
  {
    title: "平台方案與追蹤",
    description: "平台方案目前不會自動扣款，每月帳單依方案產生。Pixel、GTM 等追蹤是選配，不影響上線進度。",
    links: [
      { href: "/billing/plans", label: "方案" },
      { href: "/settings/tracking", label: "追蹤設定" },
    ],
  },
  {
    title: "客服與退款",
    description: "買家的訂單問題集中在「客服案件」處理，退款需求依退款政策審核並交給金流處理。",
    links: [
      { href: "/support-cases", label: "客服案件" },
      { href: "/policies/refunds", label: "退款政策" },
      { href: "/support", label: "客服與付款協助" },
    ],
  },
] satisfies readonly { title: string; description: string; links: readonly { href: Route; label: string }[] }[];

export default function MerchantOnboardingPage() {
  // The same steps as the signed-in 上線導引 (`/onboarding`), without anyone's status.
  const steps = merchantOnboardingOutline();
  return (
    <PublicPolicyShell>
      <section aria-labelledby="onboarding-title" className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="text-sm font-semibold text-primary">商家入門</p>
          <h1 id="onboarding-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">商家使用指南</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">開始銷售前要完成的 {steps.length} 個步驟，和後台「上線導引」完全相同。</p>
          <p className="mt-3 max-w-2xl rounded-lg border border-border bg-card px-4 py-3 text-sm leading-6 text-slate-700">
            已登入的商家請到後台<Link href={"/onboarding" as Route} className="font-semibold text-primary underline">「上線導引」</Link>查看自己的進度；它會依你實際完成的設定即時更新。本頁只說明步驟，不顯示任何人的進度。
          </p>
        </div>
        <PolicyScopeNotice />
        <section className="mt-8 rounded-lg border border-border bg-card p-6 shadow-sm" aria-labelledby="steps-title">
          <h2 id="steps-title" className="text-lg font-semibold text-slate-950">開始銷售的 {steps.length} 個步驟</h2>
          <ol className="mt-4 grid gap-3">
            {steps.map((step, index) => (
              <li key={step.key} className="flex gap-4 rounded-md border border-border p-4">
                <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-700">{index + 1}</span>
                <div>
                  <h3 className="font-semibold text-slate-950">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{step.description}</p>
                  {step.deferred ? <p className="mt-1 text-sm text-slate-600">這一步需要外部驗證，可以先完成其他步驟。</p> : null}
                  <Link href={step.href as Route} className="mt-2 inline-flex min-h-10 items-center text-sm font-semibold text-primary hover:underline">{step.actionLabel}</Link>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="mt-6 rounded-lg border border-border bg-card p-6 shadow-sm" aria-labelledby="resources-title">
          <h2 id="resources-title" className="text-lg font-semibold text-slate-950">其他設定與協助</h2>
          <ul className="mt-4 grid gap-3">
            {resources.map((resource) => (
              <li key={resource.title} className="rounded-md border border-border p-4">
                <h3 className="font-semibold text-slate-950">{resource.title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{resource.description}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {resource.links.map((link) => (
                    <Link key={link.href} href={link.href} className="inline-flex min-h-10 items-center font-semibold text-primary hover:underline">{link.label}</Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="mt-6 rounded-lg border border-border bg-card p-6 shadow-sm" aria-labelledby="help-title">
          <h2 id="help-title" className="text-lg font-semibold text-slate-950">需要協助？</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">以上頁面需要登入商家帳號才能開啟。設定過程遇到問題，可以查看客服與付款協助，或先閱讀各項政策。</p>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <Link href="/support" className="font-semibold text-primary hover:underline">客服與付款協助</Link>
            <Link href="/policies" className="font-semibold text-primary hover:underline">政策與協助中心</Link>
          </div>
        </section>
      </section>
    </PublicPolicyShell>
  );
}
