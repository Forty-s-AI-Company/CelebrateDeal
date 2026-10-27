import { FullPageLink } from "@/components/full-page-link";
import type { PublicPolicy } from "@/lib/public-policy-content";
import { publicPolicyLinks, publicSupportContact } from "@/lib/public-policy-content";

export function PublicResourceLinks({ compact = false }: { compact?: boolean }) {
  return (
    <nav aria-label="公開資訊" className={compact ? "flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs" : "grid gap-2 sm:grid-cols-2"}>
      {publicPolicyLinks.map((link) => (
        <FullPageLink key={link.href} href={link.href} className="font-semibold text-primary hover:underline">
          {link.label}
        </FullPageLink>
      ))}
    </nav>
  );
}

export function PublicPolicyShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <FullPageLink href="/policies" className="text-sm font-bold text-slate-950">CelebrateDeal</FullPageLink>
          <FullPageLink href="/login" className="min-h-11 inline-flex items-center rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            返回登入
          </FullPageLink>
        </header>
        {children}
        <footer className="mt-12 border-t border-border pt-6">
          <PublicResourceLinks compact />
          <address className="mt-4 text-center text-sm not-italic leading-6 text-slate-700">
            <p>{publicSupportContact.displayName}</p>
            <a href={`mailto:${publicSupportContact.email}`} className="inline-flex min-h-11 items-center break-all font-semibold text-primary underline">
              客服信箱：{publicSupportContact.email}
            </a>
          </address>
          <p className="mt-4 text-center text-xs leading-5 text-slate-700">各政策頁會顯示其版本與生效狀態。</p>
        </footer>
      </div>
    </main>
  );
}

/** 公開頁只顯示能力限制，不呈現內部核准者、優先級或發布流程。 */
export function PolicyScopeNotice() {
  return (
    <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
      <p className="font-bold">目前功能範圍</p>
      <p className="mt-1 leading-6">本頁說明目前可使用的功能與限制；實際交易、帳號與服務狀態仍以畫面顯示及訂單紀錄為準。</p>
    </div>
  );
}

export function PolicyDocument({ policy }: { policy: PublicPolicy }) {
  return (
    <PublicPolicyShell>
      <article className="mx-auto max-w-3xl">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">政策與協助中心</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{policy.title}</h1>
          <p className="mt-3 text-base leading-7 text-slate-600">{policy.summary}</p>
        </div>
        <dl className="grid gap-3 rounded-lg border border-border bg-white p-4 text-sm text-slate-700 sm:grid-cols-2" data-policy-publication={policy.publication.status}>
          <div><dt className="font-semibold">版本</dt><dd className="mt-1">{policy.publication.version}</dd></div>
          <div>
            <dt className="font-semibold">{policy.publication.status === "scheduled" ? "預定生效日期" : "生效日期"}</dt>
            <dd className="mt-1"><time dateTime={policy.publication.effectiveDate}>{policy.publication.effectiveDateLabel}</time></dd>
          </div>
        </dl>
        {policy.publication.status === "scheduled" ? (
          <div role="status" className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
            本版本尚未生效。生效日前的帳號使用與資料處理，依當時已公開的通知及畫面說明；已成立交易依交易當時顯示的條件與訂單紀錄處理。若正式公開日期異動，預定生效日會同步更新，避免倒填生效。
          </div>
        ) : null}
        <div className="mt-8 grid gap-6">
          {policy.sections.map((section) => (
            <section key={section.heading} className="rounded-lg border border-border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">{section.heading}</h2>
              <div className="mt-3 grid gap-3 text-sm leading-7 text-slate-700">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>
        <section className="mt-8 rounded-lg border border-border bg-white p-6 shadow-sm" aria-labelledby="policy-help-title">
          <h2 id="policy-help-title" className="text-lg font-semibold text-slate-950">需要訂單協助？</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">你可以先查看訂單與履約進度，或查詢已有的客服案件。</p>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <FullPageLink className="min-h-11 inline-flex items-center font-semibold text-primary underline" href="/support/orders">查看訂單與履約進度</FullPageLink>
            <FullPageLink className="min-h-11 inline-flex items-center font-semibold text-primary underline" href="/support/requests">查詢客服案件</FullPageLink>
          </div>
        </section>
      </article>
    </PublicPolicyShell>
  );
}
