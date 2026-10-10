import { portalText } from "@/lib/student-portal-translations";
import { resolveStudentPortalLocale } from "@/lib/student-portal-locale";
import type { CSSProperties } from "react";
import Image from "next/image";
import { CsrfField } from "@/components/csrf-field";
import { logoutStudentPortalAction } from "@/app/actions/student-portal-actions";
import { getDb } from "@/lib/db";
import { getStudentPortalDashboard } from "@/lib/student-portal";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";
export const dynamic = "force-dynamic";
const orderLabels: Record<string, string> = {
  paid: "付款完成",
  partially_refunded: "部分退款",
  refunded: "已退款"
};
const bookingLabels: Record<string, string> = {
  scheduled: "已預約",
  completed: "已完成",
  cancelled: "已取消",
  no_show: "未出席"
};
function amount(value: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(value / 100);
}
function dateTime(value: Date, locale: string, zone = "Asia/Taipei") {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone
  }).format(value);
}
function safeBrandColor(value: string) {
  return /^#[0-9a-f]{6}$/iu.test(value) ? value : "#2563eb";
}
export default async function StudentPortalPage({
  params
}: {
  params: Promise<{
    vendorSlug: string;
  }>;
}) {
  const locale = await resolveStudentPortalLocale();
  const t = (text: string) => portalText(locale, text);
  const {
    vendorSlug
  } = await params;
  const {
    session,
    vendor
  } = await requireStudentPortalSession(vendorSlug);
  const dashboard = await getStudentPortalDashboard(getDb(), session);
  const accent = safeBrandColor(vendor.primaryColor);
  const style = {
    "--portal-accent": accent
  } as CSSProperties;
  return <main className="min-h-screen bg-slate-100 text-slate-950" style={style}>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {vendor.logoUrl ? <Image src={vendor.logoUrl} alt="" width={44} height={44} className="size-11 rounded-xl object-cover" /> : <div aria-hidden="true" className="grid size-11 place-items-center rounded-xl bg-slate-900 font-bold text-white">{vendor.name.slice(0, 1)}</div>}
            <div className="min-w-0"><p className="truncate font-bold">{vendor.name}</p><p className="truncate text-sm text-slate-600">{dashboard.maskedEmail ?? t("\u5DF2\u5B89\u5168\u9A57\u8B49\u7684\u5B78\u54E1")}</p></div>
          </div>
          <a href={`/portal/${encodeURIComponent(vendorSlug)}/notifications`} className="min-h-11 shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800">{t("通知設定")}</a>
          <form action={logoutStudentPortalAction}>
            <CsrfField /><input type="hidden" name="vendorSlug" value={vendorSlug} />
            <button className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 transition hover:bg-slate-50">{t("\u5B89\u5168\u767B\u51FA")}</button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-[-0.03em] text-balance sm:text-4xl">{t("\u4F60\u7684\u8AB2\u7A0B\u3001\u9810\u7D04\u8207\u8CFC\u8CB7\u7D00\u9304\uFF0C\u90FD\u5728\u9019\u88E1\u3002")}</h1>
          <p className="mt-3 text-pretty leading-7 text-slate-700">{t("\u5F9E\u4E0B\u4E00\u500B\u8981\u5B8C\u6210\u7684\u5167\u5BB9\u958B\u59CB\uFF0C\u4E0D\u5FC5\u518D\u56DE\u982D\u7FFB\u627E Email \u6216\u804A\u5929\u7D00\u9304\u3002")}</p>
        </div>
        <nav aria-label={t("\u5B78\u54E1\u4E2D\u5FC3\u5206\u985E")} className="mt-7 flex gap-2 overflow-x-auto pb-2">
          {[['courses', t("\u6211\u7684\u8AB2\u7A0B")], ['consultations', t("1 \u5C0D 1 \u8AEE\u8A62")], ['vouchers', t("\u5C08\u5C6C\u512A\u60E0\u5238")], ['orders', t("\u8A02\u55AE\u8207\u767C\u7968")]].map(([id, label]) => <a key={id} href={`#${id}`} className="min-h-11 shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:border-[var(--portal-accent)] hover:text-[var(--portal-accent)]">{label}</a>)}
        </nav>

        <section id="courses" className="scroll-mt-6 pt-10" aria-labelledby="courses-title">
          <div className="flex items-end justify-between gap-4"><div><h2 id="courses-title" className="text-2xl font-bold">{t("\u6211\u7684\u8AB2\u7A0B")}</h2><p className="mt-1 text-sm text-slate-600">{t("\u5DF2\u4ED8\u6B3E\u4E26\u5B8C\u6210\u958B\u901A\u7684\u8AB2\u7A0B\u8207\u6578\u4F4D\u5167\u5BB9")}</p></div><span className="text-sm font-semibold text-slate-600">{dashboard.courses.length}{t("\u9805")}</span></div>
          {dashboard.courses.length ? <div className="mt-5 divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white shadow-[0_6px_8px_rgba(15,23,42,0.05)]">{dashboard.courses.map(course => <article key={course.id} className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
            {course.imageUrl ? <Image src={course.imageUrl} alt="" width={160} height={96} className="h-28 w-full rounded-xl object-cover sm:w-44" /> : <div aria-hidden="true" className="grid h-28 w-full place-items-center rounded-xl bg-slate-900 text-3xl sm:w-44">🎓</div>}
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold">{course.title}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${course.accessStatus === 'active' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{course.accessStatus === 'active' ? t("\u5DF2\u958B\u901A") : t("\u66AB\u4E0D\u53EF\u7528")}</span></div>{course.deliveryTitle ? <p className="mt-2 text-sm text-slate-700">{course.deliveryTitle}</p> : null}{course.instructions ? <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-slate-600">{course.instructions}</p> : null}</div>
            {course.learningProductId ? <a href={`/portal/${encodeURIComponent(vendorSlug)}/learn/${encodeURIComponent(course.learningProductId)}`} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-4 text-sm font-bold text-white" style={{
              backgroundColor: accent
            }}>{t("\u958B\u59CB\u8AB2\u7A0B\u5B78\u7FD2 \u2192")}</a> : null}
            {course.destinationUrl && course.accessStatus === 'active' ? <a href={course.destinationUrl} rel="noreferrer" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-4 text-sm font-bold text-white" style={{
              backgroundColor: accent
            }}>{course.deliveryKind === 'digital_link' ? t("\u4E0B\u8F09\u6559\u6750") : t("\u9032\u5165\u5B78\u7FD2")} →</a> : null}
          </article>)}</div> : <EmptyCopy title={t("\u76EE\u524D\u9084\u6C92\u6709\u5DF2\u958B\u901A\u8AB2\u7A0B")} body={t("\u5B8C\u6210\u8CFC\u8AB2\u4E26\u78BA\u8A8D\u4ED8\u6B3E\u5F8C\uFF0C\u8AB2\u7A0B\u5165\u53E3\u6703\u51FA\u73FE\u5728\u9019\u88E1\u3002")} />}
        </section>

        <section id="consultations" className="scroll-mt-6 pt-12" aria-labelledby="consultations-title"><h2 id="consultations-title" className="text-2xl font-bold">{t("1 \u5C0D 1 \u8AEE\u8A62")}</h2><p className="mt-1 text-sm text-slate-600">{t("\u6642\u9593\u3001\u6703\u8B70\u5165\u53E3\u8207\u884C\u4E8B\u66C6\u63D0\u9192")}</p>
          {dashboard.consultations.length ? <div className="mt-5 space-y-3">{dashboard.consultations.map(booking => <article key={booking.id} className="rounded-2xl bg-white p-5 shadow-[0_6px_8px_rgba(15,23,42,0.05)] sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold">{booking.event.title}</h3><p className="mt-2 text-base font-semibold" style={{
                  color: accent
                }}>{dateTime(booking.startTime, locale, booking.event.timezone)}</p><p className="mt-1 text-sm text-slate-600">{booking.event.timezone}</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800">{t(bookingLabels[booking.status] ?? booking.status)}</span></div><div className="mt-5 flex flex-wrap gap-3 border-t border-slate-200 pt-5">{booking.meetingUrl && booking.status === 'scheduled' ? <a href={booking.meetingUrl} rel="noreferrer" className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold text-white" style={{
                backgroundColor: accent
              }}>{t("\u52A0\u5165\u7DDA\u4E0A\u6703\u8B70")}</a> : null}<a href={booking.googleCalendarUrl} rel="noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-bold">{t("\u52A0\u5165 Google \u884C\u4E8B\u66C6")}</a><a href={`/portal/${encodeURIComponent(vendorSlug)}/calendar/${encodeURIComponent(booking.id)}`} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-bold">{t("\u4E0B\u8F09 iCal")}</a></div><p className="mt-3 text-xs leading-5 text-slate-600">{t("\u5982\u9700\u53D6\u6D88\u6216\u6539\u671F\uFF0C\u8ACB\u4F9D\u5546\u5BB6\u539F\u9810\u7D04\u901A\u77E5\u4E2D\u7684\u806F\u7D61\u65B9\u5F0F\u8FA6\u7406\u3002")}</p></article>)}</div> : <EmptyCopy title={t("\u76EE\u524D\u6C92\u6709\u8AEE\u8A62\u9810\u7D04")} body={t("\u5B8C\u6210\u9810\u7D04\u5F8C\uFF0C\u6703\u8B70\u6642\u9593\u8207\u9023\u7D50\u6703\u5B89\u5168\u986F\u793A\u5728\u9019\u88E1\u3002")} />}
        </section>

        <section id="vouchers" className="scroll-mt-6 pt-12" aria-labelledby="vouchers-title"><h2 id="vouchers-title" className="text-2xl font-bold">{t("\u5C08\u5C6C\u512A\u60E0\u5238")}</h2><p className="mt-1 text-sm text-slate-600">{t("\u53EA\u986F\u793A\u5C1A\u672A\u4F7F\u7528\u4E14\u4ECD\u5728\u6709\u6548\u671F\u5167\u7684\u512A\u60E0")}</p>
          {dashboard.vouchers.length ? <div className="mt-5 flex flex-wrap gap-4">{dashboard.vouchers.map(voucher => <article key={voucher.id} className="min-w-[280px] flex-1 rounded-2xl bg-slate-950 p-6 text-white"><p className="text-sm font-semibold text-slate-300">{voucher.product.name}</p><p className="mt-3 text-3xl font-black tracking-[-0.03em]">{voucher.discountType === 'percentage' ? `${voucher.discountValue}% OFF` : amount(voucher.discountValue, voucher.currency, locale)}</p><p className="mt-3 text-sm text-slate-300">{t("\u6709\u6548\u81F3")}{dateTime(voucher.expiresAt, locale)}</p><form method="post" action={`/portal/${encodeURIComponent(vendorSlug)}/vouchers/${encodeURIComponent(voucher.id)}/use`}><CsrfField /><button type="submit" className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-white px-4 text-sm font-bold text-slate-950">{t("\u7ACB\u5373\u4F7F\u7528")}</button></form></article>)}</div> : <EmptyCopy title={t("\u76EE\u524D\u6C92\u6709\u53EF\u7528\u512A\u60E0\u5238")} body={t("\u76F4\u64AD\u6216\u5C08\u5C6C\u6D3B\u52D5\u6D3E\u767C\u7684\u512A\u60E0\uFF0C\u6703\u5728\u6709\u6548\u671F\u9593\u986F\u793A\u65BC\u6B64\u3002")} />}
        </section>

        <section id="orders" className="scroll-mt-6 pt-12" aria-labelledby="orders-title"><h2 id="orders-title" className="text-2xl font-bold">{t("\u8A02\u55AE\u8207\u767C\u7968")}</h2><p className="mt-1 text-sm text-slate-600">{t("\u8CFC\u8CB7\u91D1\u984D\u3001\u4ED8\u6B3E\u65B9\u5F0F\u8207\u53F0\u7063 B2C \u96FB\u5B50\u767C\u7968")}</p>
          {dashboard.orders.length ? <div className="mt-5 overflow-x-auto rounded-2xl bg-white shadow-[0_6px_8px_rgba(15,23,42,0.05)]"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-slate-700"><tr><th className="px-5 py-4 font-bold">{t("\u8A02\u55AE")}</th><th className="px-5 py-4 font-bold">{t("\u65E5\u671F")}</th><th className="px-5 py-4 font-bold">{t("\u91D1\u984D")}</th><th className="px-5 py-4 font-bold">{t("\u4ED8\u6B3E")}</th><th className="px-5 py-4 font-bold">{t("\u96FB\u5B50\u767C\u7968")}</th></tr></thead><tbody className="divide-y divide-slate-200">{dashboard.orders.map(order => <tr key={order.id}><td className="px-5 py-4"><p className="font-bold">{order.orderNumber}</p><p className="mt-1 text-xs text-slate-600">{t(orderLabels[order.status] ?? order.status)} · {order.items.map(item => item.name).join('、')}</p></td><td className="px-5 py-4 text-slate-700">{dateTime(order.paidAt ?? order.createdAt, locale)}</td><td className="px-5 py-4 font-bold">{amount(order.totalAmountCents, order.currency, locale)}</td><td className="px-5 py-4 text-slate-700">{order.paymentMethod ?? '—'}</td><td className="px-5 py-4">{order.invoice ? <><p className="font-bold">{order.invoice.invoiceNumber ?? t("\u958B\u7ACB\u8655\u7406\u4E2D")}</p><p className="mt-1 text-xs text-slate-600">{order.invoice.invoiceType} · {order.invoice.buyerDisplay}</p></> : <span className="text-slate-600">{t("\u5C1A\u7121\u767C\u7968\u8CC7\u6599")}</span>}</td></tr>)}</tbody></table></div> : <EmptyCopy title={t("\u76EE\u524D\u6C92\u6709\u8A02\u55AE\u7D00\u9304")} body={t("\u5B8C\u6210\u4ED8\u6B3E\u5F8C\uFF0C\u8A02\u55AE\u8207\u767C\u7968\u72C0\u614B\u6703\u986F\u793A\u5728\u9019\u88E1\u3002")} />}
        </section>
      </div>
    </main>;
}
function EmptyCopy({
  title,
  body
}: {
  title: string;
  body: string;
}) {
  return <div className="mt-5 rounded-2xl border border-slate-300 bg-white p-8 text-center"><h3 className="font-bold">{title}</h3><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{body}</p></div>;
}
