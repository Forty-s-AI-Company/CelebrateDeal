import type { CSSProperties } from "react";
import Image from "next/image";
import { CsrfField } from "@/components/csrf-field";
import { logoutStudentPortalAction } from "@/app/actions/student-portal-actions";
import { getDb } from "@/lib/db";
import { getStudentPortalDashboard } from "@/lib/student-portal";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";

export const dynamic = "force-dynamic";

const orderLabels: Record<string, string> = { paid: "付款完成", partially_refunded: "部分退款", refunded: "已退款" };
const bookingLabels: Record<string, string> = { scheduled: "已預約", completed: "已完成", cancelled: "已取消", no_show: "未出席" };

function amount(value: number, currency: string) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency, maximumFractionDigits: 0 }).format(value / 100);
}

function dateTime(value: Date) {
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(value);
}

function safeBrandColor(value: string) { return /^#[0-9a-f]{6}$/iu.test(value) ? value : "#2563eb"; }

export default async function StudentPortalPage({ params }: { params: Promise<{ vendorSlug: string }> }) {
  const { vendorSlug } = await params;
  const { session, vendor } = await requireStudentPortalSession(vendorSlug);
  const dashboard = await getStudentPortalDashboard(getDb(), session);
  const accent = safeBrandColor(vendor.primaryColor);
  const style = { "--portal-accent": accent } as CSSProperties;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950" style={style}>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {vendor.logoUrl ? <Image src={vendor.logoUrl} alt="" width={44} height={44} className="size-11 rounded-xl object-cover" /> : <div aria-hidden="true" className="grid size-11 place-items-center rounded-xl bg-slate-900 font-bold text-white">{vendor.name.slice(0, 1)}</div>}
            <div className="min-w-0"><p className="truncate font-bold">{vendor.name}</p><p className="truncate text-sm text-slate-600">{dashboard.maskedEmail ?? "已安全驗證的學員"}</p></div>
          </div>
          <form action={logoutStudentPortalAction}>
            <CsrfField /><input type="hidden" name="vendorSlug" value={vendorSlug} />
            <button className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 transition hover:bg-slate-50">安全登出</button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-[-0.03em] text-balance sm:text-4xl">你的課程、預約與購買紀錄，都在這裡。</h1>
          <p className="mt-3 text-pretty leading-7 text-slate-700">從下一個要完成的內容開始，不必再回頭翻找 Email 或聊天紀錄。</p>
        </div>
        <nav aria-label="學員中心分類" className="mt-7 flex gap-2 overflow-x-auto pb-2">
          {[['courses','我的課程'],['consultations','1 對 1 諮詢'],['vouchers','專屬優惠券'],['orders','訂單與發票']].map(([id,label]) => <a key={id} href={`#${id}`} className="min-h-11 shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:border-[var(--portal-accent)] hover:text-[var(--portal-accent)]">{label}</a>)}
        </nav>

        <section id="courses" className="scroll-mt-6 pt-10" aria-labelledby="courses-title">
          <div className="flex items-end justify-between gap-4"><div><h2 id="courses-title" className="text-2xl font-bold">我的課程</h2><p className="mt-1 text-sm text-slate-600">已付款並完成開通的課程與數位內容</p></div><span className="text-sm font-semibold text-slate-600">{dashboard.courses.length} 項</span></div>
          {dashboard.courses.length ? <div className="mt-5 divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white shadow-[0_6px_8px_rgba(15,23,42,0.05)]">{dashboard.courses.map((course) => <article key={course.id} className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
            {course.imageUrl ? <Image src={course.imageUrl} alt="" width={160} height={96} className="h-28 w-full rounded-xl object-cover sm:w-44" /> : <div aria-hidden="true" className="grid h-28 w-full place-items-center rounded-xl bg-slate-900 text-3xl sm:w-44">🎓</div>}
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold">{course.title}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${course.accessStatus === 'active' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{course.accessStatus === 'active' ? '已開通' : '暫不可用'}</span></div>{course.deliveryTitle ? <p className="mt-2 text-sm text-slate-700">{course.deliveryTitle}</p> : null}{course.instructions ? <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-slate-600">{course.instructions}</p> : null}</div>
            {course.destinationUrl && course.accessStatus === 'active' ? <a href={course.destinationUrl} rel="noreferrer" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-4 text-sm font-bold text-white" style={{ backgroundColor: accent }}>{course.deliveryKind === 'digital_link' ? '下載教材' : '進入學習'} →</a> : null}
          </article>)}</div> : <EmptyCopy title="目前還沒有已開通課程" body="完成購課並確認付款後，課程入口會出現在這裡。" />}
        </section>

        <section id="consultations" className="scroll-mt-6 pt-12" aria-labelledby="consultations-title"><h2 id="consultations-title" className="text-2xl font-bold">1 對 1 諮詢</h2><p className="mt-1 text-sm text-slate-600">時間、會議入口與行事曆提醒</p>
          {dashboard.consultations.length ? <div className="mt-5 space-y-3">{dashboard.consultations.map((booking) => <article key={booking.id} className="rounded-2xl bg-white p-5 shadow-[0_6px_8px_rgba(15,23,42,0.05)] sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold">{booking.event.title}</h3><p className="mt-2 text-base font-semibold" style={{ color: accent }}>{dateTime(booking.startTime)}</p><p className="mt-1 text-sm text-slate-600">{booking.event.timezone}</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800">{bookingLabels[booking.status] ?? booking.status}</span></div><div className="mt-5 flex flex-wrap gap-3 border-t border-slate-200 pt-5">{booking.meetingUrl && booking.status === 'scheduled' ? <a href={booking.meetingUrl} rel="noreferrer" className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold text-white" style={{ backgroundColor: accent }}>加入線上會議</a> : null}<a href={booking.googleCalendarUrl} rel="noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-bold">加入 Google 行事曆</a><a href={`/portal/${encodeURIComponent(vendorSlug)}/calendar/${encodeURIComponent(booking.id)}`} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-bold">下載 iCal</a></div><p className="mt-3 text-xs leading-5 text-slate-600">如需取消或改期，請依商家原預約通知中的聯絡方式辦理。</p></article>)}</div> : <EmptyCopy title="目前沒有諮詢預約" body="完成預約後，會議時間與連結會安全顯示在這裡。" />}
        </section>

        <section id="vouchers" className="scroll-mt-6 pt-12" aria-labelledby="vouchers-title"><h2 id="vouchers-title" className="text-2xl font-bold">專屬優惠券</h2><p className="mt-1 text-sm text-slate-600">只顯示尚未使用且仍在有效期內的優惠</p>
          {dashboard.vouchers.length ? <div className="mt-5 flex flex-wrap gap-4">{dashboard.vouchers.map((voucher) => <article key={voucher.id} className="min-w-[280px] flex-1 rounded-2xl bg-slate-950 p-6 text-white"><p className="text-sm font-semibold text-slate-300">{voucher.product.name}</p><p className="mt-3 text-3xl font-black tracking-[-0.03em]">{voucher.discountType === 'percentage' ? `${voucher.discountValue}% OFF` : amount(voucher.discountValue, voucher.currency)}</p><p className="mt-3 text-sm text-slate-300">有效至 {dateTime(voucher.expiresAt)}</p><a href={`/portal/${encodeURIComponent(vendorSlug)}/vouchers/${encodeURIComponent(voucher.id)}/use`} className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-white px-4 text-sm font-bold text-slate-950">立即使用</a></article>)}</div> : <EmptyCopy title="目前沒有可用優惠券" body="直播或專屬活動派發的優惠，會在有效期間顯示於此。" />}
        </section>

        <section id="orders" className="scroll-mt-6 pt-12" aria-labelledby="orders-title"><h2 id="orders-title" className="text-2xl font-bold">訂單與發票</h2><p className="mt-1 text-sm text-slate-600">購買金額、付款方式與台灣 B2C 電子發票</p>
          {dashboard.orders.length ? <div className="mt-5 overflow-x-auto rounded-2xl bg-white shadow-[0_6px_8px_rgba(15,23,42,0.05)]"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-slate-700"><tr><th className="px-5 py-4 font-bold">訂單</th><th className="px-5 py-4 font-bold">日期</th><th className="px-5 py-4 font-bold">金額</th><th className="px-5 py-4 font-bold">付款</th><th className="px-5 py-4 font-bold">電子發票</th></tr></thead><tbody className="divide-y divide-slate-200">{dashboard.orders.map((order) => <tr key={order.id}><td className="px-5 py-4"><p className="font-bold">{order.orderNumber}</p><p className="mt-1 text-xs text-slate-600">{orderLabels[order.status] ?? order.status} · {order.items.map((item) => item.name).join('、')}</p></td><td className="px-5 py-4 text-slate-700">{dateTime(order.paidAt ?? order.createdAt)}</td><td className="px-5 py-4 font-bold">{amount(order.totalAmountCents, order.currency)}</td><td className="px-5 py-4 text-slate-700">{order.paymentMethod ?? '—'}</td><td className="px-5 py-4">{order.invoice ? <><p className="font-bold">{order.invoice.invoiceNumber ?? '開立處理中'}</p><p className="mt-1 text-xs text-slate-600">{order.invoice.invoiceType} · {order.invoice.buyerDisplay}</p></> : <span className="text-slate-600">尚無發票資料</span>}</td></tr>)}</tbody></table></div> : <EmptyCopy title="目前沒有訂單紀錄" body="完成付款後，訂單與發票狀態會顯示在這裡。" />}
        </section>
      </div>
    </main>
  );
}

function EmptyCopy({ title, body }: { title: string; body: string }) {
  return <div className="mt-5 rounded-2xl border border-slate-300 bg-white p-8 text-center"><h3 className="font-bold">{title}</h3><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{body}</p></div>;
}
