import type { Metadata, Route } from "next";
import Link from "next/link";
import { PolicyScopeNotice, PublicPolicyShell } from "@/components/public-policy";

export const metadata: Metadata = {
  title: "商家使用指南 | CelebrateDeal",
  description: "從建立帳號、設定品牌與付款，到上架商品、舉辦直播與處理退款，了解商家使用 CelebrateDeal 的完整流程。",
};

const steps = [
  {
    title: "建立帳號並啟用多因子驗證",
    description: "註冊商家帳號後，請到「安全性」啟用多因子驗證（MFA），並妥善保存復原方式。商家擁有者可在同一頁管理登入密碼與已登入的裝置。",
    links: [{ href: "/settings/security", label: "前往安全性設定" }],
  },
  {
    title: "邀請成員並設定角色",
    description: "在「團隊管理」邀請夥伴加入，依工作內容指派角色，只給予需要的權限。",
    links: [{ href: "/settings/team", label: "前往團隊管理" }],
  },
  {
    title: "設定品牌與追蹤",
    description: "在「品牌設定」填寫商店名稱、寄件人、聯絡網址、Logo 與主色；在「追蹤設定」可設定 Pixel、GTM 與事件開關。",
    links: [
      { href: "/settings/brand", label: "品牌設定" },
      { href: "/settings/tracking", label: "追蹤設定" },
    ],
  },
  {
    title: "建立商品與直播活動",
    description: "先建立商品並確認價格、庫存與交付方式，再建立直播間，把影片、商品與報名表單串在一起。",
    links: [
      { href: "/products", label: "商品" },
      { href: "/lives", label: "直播間" },
    ],
  },
  {
    title: "選擇方案並設定 PayUni",
    description: "在「方案」選擇適合的平台方案；平台方案目前不會自動扣款，每月帳單依方案產生。另到「平台服務付款方式」完成 PayUni 付款方式設定。",
    links: [
      { href: "/billing/plans", label: "方案" },
      { href: "/billing/payment-methods", label: "平台服務付款方式" },
    ],
  },
  {
    title: "了解客服與退款流程",
    description: "買家的訂單問題會集中在「客服案件」處理，退款需求會依退款政策審核並交給金流處理。需要平台協助時，請使用客服與付款協助頁面的信箱。",
    links: [
      { href: "/support-cases", label: "客服案件" },
      { href: "/policies/refunds", label: "退款政策" },
      { href: "/support", label: "客服與付款協助" },
    ],
  },
] satisfies readonly { title: string; description: string; links: readonly { href: Route; label: string }[] }[];

export default function MerchantOnboardingPage() {
  return (
    <PublicPolicyShell>
      <section aria-labelledby="onboarding-title" className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="text-sm font-semibold text-primary">商家入門</p>
          <h1 id="onboarding-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">商家使用指南</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">依照下列六個步驟，從建立帳號到處理客服與退款，完成開始銷售前的準備。</p>
        </div>
        <PolicyScopeNotice />
        <section className="mt-8 rounded-lg border border-border bg-white p-6 shadow-sm" aria-labelledby="steps-title">
          <h2 id="steps-title" className="text-lg font-semibold text-slate-950">開始銷售的六個步驟</h2>
          <ol className="mt-4 grid gap-3">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-4 rounded-md border border-border p-4">
                <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-50 text-sm font-bold text-primary">{index + 1}</span>
                <div>
                  <h3 className="font-semibold text-slate-950">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{step.description}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {step.links.map((link) => (
                      <Link key={link.href} href={link.href} className="font-semibold text-primary hover:underline">{link.label} →</Link>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="mt-6 rounded-lg border border-border bg-white p-6 shadow-sm" aria-labelledby="help-title">
          <h2 id="help-title" className="text-lg font-semibold text-slate-950">需要協助？</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">以上頁面需要登入商家帳號才能開啟。設定過程遇到問題，可以查看客服與付款協助，或先閱讀各項政策。</p>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <Link href="/support" className="font-semibold text-primary hover:underline">客服與付款協助 →</Link>
            <Link href="/policies" className="font-semibold text-primary hover:underline">政策與協助中心 →</Link>
          </div>
        </section>
      </section>
    </PublicPolicyShell>
  );
}
