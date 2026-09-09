import { saveMobileConsultationAction } from "@/app/actions/mobile-consultation-actions";
import { CsrfField } from "@/components/csrf-field";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listTodayConsultations, safeTelHref, type MobileConsultationDatabase } from "@/lib/mobile-consultation-cockpit";

export default async function MobileConsultationsPage() {
  const vendor = await requireVendorManager();
  const bookings = await listTodayConsultations(getDb() as unknown as MobileConsultationDatabase, vendor.id);

  return (
    <main className="mx-auto max-w-lg pb-24">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur">
        <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Mobile cockpit</p>
        <h1 className="text-2xl font-black text-slate-950">今日諮詢</h1>
        <p className="mt-1 text-sm text-slate-600">依時間排序，共 {bookings.length} 場</p>
      </header>

      <section className="grid gap-4 p-4" aria-label="今日諮詢排程">
        {bookings.map((booking) => {
          const phoneHref = safeTelHref(booking.clientPhone);
          return (
            <article key={booking.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <time className="text-lg font-black text-blue-700" dateTime={booking.startTime.toISOString()}>
                    {booking.startTime.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei" })}
                  </time>
                  <h2 className="mt-1 text-lg font-bold text-slate-950">{booking.clientName}</h2>
                  <p className="text-sm text-slate-600">{booking.event.title}</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">{booking.status === "completed" ? "已完成" : "待諮詢"}</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                {phoneHref ? <a href={phoneHref} className="flex min-h-12 items-center justify-center rounded-xl bg-slate-950 px-3 font-bold text-white">立即撥打</a> : <span className="flex min-h-12 items-center justify-center rounded-xl bg-slate-100 px-3 text-sm text-slate-500">電話格式不適用</span>}
                {booking.meetingUrl ? <a href={booking.meetingUrl} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center rounded-xl bg-blue-700 px-3 font-bold text-white">開啟視訊</a> : <span className="flex min-h-12 items-center justify-center rounded-xl bg-slate-100 px-3 text-sm text-slate-500">未設定視訊</span>}
              </div>

              <form action={saveMobileConsultationAction} className="mt-4 grid gap-3 border-t border-slate-200 pt-4">
                <CsrfField />
                <input type="hidden" name="bookingId" value={booking.id} />
                <label className="grid gap-1 text-sm font-bold text-slate-800">快速備註
                  <textarea name="note" maxLength={4_000} rows={2} className="rounded-xl border border-slate-300 p-3 font-normal" placeholder="記下需求與下一步…" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="submit" name="tag" value="預算足夠" className="min-h-12 rounded-xl border border-emerald-300 bg-emerald-50 px-2 text-sm font-bold text-emerald-900">＋ 預算足夠</button>
                  <button type="submit" name="tag" value="需再跟進" className="min-h-12 rounded-xl border border-amber-300 bg-amber-50 px-2 text-sm font-bold text-amber-900">＋ 需再跟進</button>
                  <button type="submit" className="min-h-12 rounded-xl border border-slate-300 px-2 text-sm font-bold text-slate-800">儲存備註</button>
                  <button type="submit" name="closedWon" value="true" className="min-h-12 rounded-xl bg-emerald-700 px-2 text-sm font-black text-white">標記成交</button>
                </div>
              </form>
            </article>
          );
        })}
        {!bookings.length ? <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-600">今天沒有排定諮詢，可以稍微喘口氣。</div> : null}
      </section>
    </main>
  );
}
