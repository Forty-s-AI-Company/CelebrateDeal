import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import type { TeamFunnelPublicPageView } from "@/lib/team-funnel-public-page";
import { LeadForm } from "@/components/lead-form";
import { TrackedTeamFunnelProductLink } from "@/components/tracked-team-funnel-product-link";

const slotLabels: Record<string, string> = {
  main_product: "推薦商品",
  bundle_product: "精選組合",
  join_member: "加入方案",
  consultation: "預約諮詢",
};

export function TeamFunnelPublicPage({ view }: { view: TeamFunnelPublicPageView }) {
  if (view.state !== "ready" || !view.page) return <PublicPageState state={view.state as Exclude<TeamFunnelPublicPageView["state"], "ready">} />;
  const { page } = view;
  const hasPlatformCheckout = page.productSlots.some((slot) => slot.checkoutMode === "platform");
  const hasExternalCheckout = page.productSlots.some((slot) => slot.checkoutMode === "external");

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 sm:py-12">
      <article className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <header className="border-b border-slate-100 pb-6">
          <p className="text-sm font-semibold text-blue-700">由 {page.partner.name} 為您服務</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">{page.headline}</h1>
          {page.subheadline ? <p className="mt-3 text-lg leading-8 text-slate-600">{page.subheadline}</p> : null}
        </header>

        <section className="mt-6 rounded-xl bg-blue-50 p-4" aria-labelledby="webinar-heading">
          <h2 id="webinar-heading" className="text-base font-bold text-slate-900">{page.webinar.title}</h2>
          <p className="mt-1 text-sm text-slate-700">
            <time dateTime={page.webinar.startsAt}>{formatDateTime(page.webinar.startsAt)}</time>
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <a className="inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2" href={page.webinar.playbackHref}>
              前往直播與回放
            </a>
          </div>
        </section>

        <section className="mt-7 rounded-xl border border-orange-200 bg-orange-50 p-4" aria-labelledby="registration-heading">
          <h2 id="registration-heading" className="text-xl font-bold text-slate-950">立即報名</h2>
          <p className="mt-1 text-sm text-slate-700">報名資料會由 {page.partner.name} 協助服務，並綁定本場研討會。</p>
          <div className="mt-4">
            {page.webinar.registration ? (
              <LeadForm
                formId={page.webinar.registration.formId}
                liveId={page.webinar.id}
                fields={page.webinar.registration.fields}
                submitLabel={page.webinar.registration.submitLabel}
                successMessage={page.webinar.registration.successMessage}
              />
            ) : (
              <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">報名表欄位需要商家重新確認，目前暫停接收資料。</p>
            )}
          </div>
        </section>

        {page.body.length ? (
          <section className="mt-7 space-y-4 text-base leading-8 text-slate-700" aria-label="活動說明">
            {page.body.map((block, index) => block.type === "paragraph" ? (
              <p key={`paragraph-${index}`}>{block.text}</p>
            ) : (
              <ul key={`list-${index}`} className="list-disc space-y-1 pl-6">
                {block.items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{item}</li>)}
              </ul>
            ))}
          </section>
        ) : (
          <section className="mt-7 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600" aria-label="活動說明" role="status">
            活動說明即將更新。
          </section>
        )}

        <section className="mt-7" aria-labelledby="offers-heading">
          <h2 id="offers-heading" className="text-xl font-bold text-slate-950">合作夥伴推薦</h2>
          <p className="mt-1 text-sm text-slate-600">
            {hasPlatformCheckout ? "平台內商品會建立可追蹤訂單，並由 CelebrateDeal 處理付款與售後紀錄。" : null}
            {hasPlatformCheckout && hasExternalCheckout ? " " : null}
            {hasExternalCheckout ? "外部連結只記錄推薦點擊；付款、退款與外部佣金由外部平台處理。" : null}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {page.productSlots.map((slot) => (
              <TrackedTeamFunnelProductLink
                key={slot.slotKey}
                href={slot.url!}
                vendorId={page.vendorId}
                liveId={page.webinar.id}
                sourcePageSlug={page.slug}
                referralCode={page.partner.referralCode}
                slotKey={slot.slotKey}
              >
                <span className="flex items-center justify-between gap-3">
                  <span>{slot.offerLabel || slotLabels[slot.slotKey] || "推薦連結"}</span>
                  <span className="shrink-0 text-xs font-medium text-slate-500">
                    {slot.checkoutMode === "platform" ? "平台安全結帳" : "外部連結"}
                  </span>
                </span>
              </TrackedTeamFunnelProductLink>
            ))}
          </div>
        </section>

        <section className="mt-7 rounded-xl border border-slate-200 p-4" aria-labelledby="contact-heading">
          <h2 id="contact-heading" className="font-bold text-slate-950">聯絡 {page.partner.name}</h2>
          {page.partner.email ? <a className="mt-2 inline-block text-sm text-blue-700 underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-blue-600" href={`mailto:${page.partner.email}`}>{page.partner.email}</a> : <p className="mt-2 text-sm text-slate-500">目前未提供公開聯絡方式。</p>}
        </section>

        <a className="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2" href={page.cta.href}>
          {page.cta.label}
        </a>
      </article>
    </main>
  );
}

export function PublicPageState({ state }: { state: Exclude<TeamFunnelPublicPageView["state"], "ready"> }) {
  const message = {
    not_found: ["找不到此公開頁", "請確認連結是否正確。"],
    unpublished: ["此頁尚未公開", "此夥伴頁目前無法提供瀏覽。"],
    disabled: ["此頁目前無法使用", "公開連結已停用或到期。"],
    inactive_partner: ["此頁目前無法使用", "合作夥伴帳號目前未啟用。"],
    missing_webinar: ["活動資訊尚未完成", "此頁缺少可用的報名活動。"],
    missing_slot: ["推薦內容尚未完成", "此頁缺少必要的商品連結。"],
  }[state];

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-8">
      <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm" role="status" aria-live="polite">
        <h1 className="text-xl font-bold text-slate-950">{message[0]}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{message[1]}</p>
        <Link
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
          href="/"
        >
          返回首頁
        </Link>
      </section>
    </main>
  );
}
