import { cancelConsultationBookingAction, createConsultationEventAction, toggleConsultationEventAction, updateConsultationBookingStatusAction, updateConsultationEventAction, type ConsultationDatabase } from "@/app/actions/consultation-actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, Field, PageHeader, SubmitButton, TextArea } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

type PageSearchParams = { updated?: string; error?: string };

function database() {
  return getDb() as unknown as ConsultationDatabase;
}

function statusTone(status: string) {
  if (status === "scheduled") return "green" as const;
  if (status === "cancelled" || status === "no_show") return "gray" as const;
  return "blue" as const;
}

export default async function ConsultationsPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const [vendor, params] = await Promise.all([requireVendorManager(), searchParams]);
  const db = database();
  const [events, bookings] = await Promise.all([
    db.consultationEvent.findMany({
      where: { vendorId: vendor.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    db.consultationBooking.findMany({
      where: { vendorId: vendor.id },
      orderBy: [{ startTime: "asc" }, { createdAt: "desc" }],
      take: 100,
    }),
  ]);
  const eventNames = new Map(events.map((event) => [event.id, event.title]));

  return (
    <>
      <PageHeader title="諮詢預約工作台" description="設定可預約時段、掌握即將到來的諮詢；停用不會刪除既有預約紀錄。" />
      {params.updated ? <p role="status" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">諮詢預約設定已更新。</p> : null}
      {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">無法完成這項操作；請確認資料仍屬於目前商家，然後再試一次。</p> : null}

      <Card className="mb-6">
        <h2 className="mb-1 text-lg font-semibold text-slate-950">新增諮詢活動</h2>
        <p className="mb-4 text-sm text-slate-600">時段使用每週 JSON 設定；例如週一與週三 09:00–17:00。公開頁只會顯示尚可預約的時段。</p>
        <form action={createConsultationEventAction} className="grid gap-4">
          <CsrfField />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="活動名稱" name="title" required maxLength={160} placeholder="一對一策略諮詢" />
            <Field label="時區" name="timezone" required maxLength={80} defaultValue="Asia/Taipei" />
          </div>
          <TextArea label="活動說明（選填）" name="description" maxLength={2_000} rows={2} />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="每次分鐘數" name="durationMinutes" type="number" required min={15} max={480} step={15} defaultValue={30} />
            <Field label="緩衝分鐘數" name="bufferMinutes" type="number" required min={0} max={180} step={5} defaultValue={0} />
            <Field label="每日上限（留白不限）" name="dailyLimit" type="number" min={1} max={100} step={1} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <TextArea label="每週開放時段 JSON" name="weeklySchedule" required rows={5} defaultValue={'[{"day":1,"ranges":["09:00-17:00"]},{"day":3,"ranges":["09:00-17:00"]}]'} />
            <TextArea label="自訂收集欄位 JSON（選填）" name="intakeFormFields" rows={5} defaultValue="[]" placeholder='[{"id":"goal","label":"想討論的主題","type":"textarea","required":true}]' />
          </div>
          <SubmitButton pendingChildren="建立中…">建立諮詢活動</SubmitButton>
        </form>
      </Card>

      <Card className="mb-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-950">諮詢活動</h2>
        {events.length ? <div className="grid gap-3">{events.map((event) => (
          <div key={event.id} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-950">{event.title}</h3><Badge tone={event.isActive ? "green" : "gray"}>{event.isActive ? "開放預約" : "已停用"}</Badge></div>
              <p className="mt-1 text-sm text-slate-600">{event.durationMinutes} 分鐘 · 緩衝 {event.bufferMinutes} 分鐘 · {event.dailyLimit ? `每日最多 ${event.dailyLimit} 筆` : "不設每日上限"} · {event.timezone}</p>
              {event.description ? <p className="mt-1 text-sm text-slate-500">{event.description}</p> : null}
              <details className="mt-3 rounded-md border border-border bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">編輯預約設定</summary>
                <form action={updateConsultationEventAction} className="mt-3 grid gap-3">
                  <CsrfField />
                  <input type="hidden" name="eventId" value={event.id} />
                  <Field label="活動名稱" name="title" required maxLength={160} defaultValue={event.title} />
                  <Field label="時區" name="timezone" required maxLength={80} defaultValue={event.timezone} />
                  <TextArea label="活動說明" name="description" maxLength={2_000} rows={2} defaultValue={event.description ?? ""} />
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="每次分鐘數" name="durationMinutes" type="number" required min={15} max={480} step={15} defaultValue={event.durationMinutes} />
                    <Field label="緩衝分鐘數" name="bufferMinutes" type="number" required min={0} max={180} step={5} defaultValue={event.bufferMinutes} />
                    <Field label="每日上限" name="dailyLimit" type="number" min={1} max={100} defaultValue={event.dailyLimit ?? undefined} />
                  </div>
                  <TextArea label="每週開放時段 JSON" name="weeklySchedule" required rows={4} defaultValue={JSON.stringify(event.weeklySchedule)} />
                  <TextArea label="行前問卷欄位 JSON" name="intakeFormFields" rows={4} defaultValue={JSON.stringify(event.intakeFormFields)} />
                  <SubmitButton pendingChildren="儲存中…">儲存設定</SubmitButton>
                </form>
              </details>
            </div>
            <form action={toggleConsultationEventAction}>
              <CsrfField /><input type="hidden" name="eventId" value={event.id} /><input type="hidden" name="isActive" value={String(!event.isActive)} />
              <SubmitButton pendingChildren="更新中…">{event.isActive ? "暫停預約" : "重新開放"}</SubmitButton>
            </form>
          </div>
        ))}</div> : <p className="text-sm text-slate-600">還沒有諮詢活動。先設定一組開放時段，公開漏斗就能串上預約元件。</p>}
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-950">近期預約（最多 100 筆）</h2>
        {bookings.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-slate-500"><th className="p-2">時間</th><th className="p-2">活動</th><th className="p-2">客戶</th><th className="p-2">狀態</th><th className="p-2"><span className="sr-only">操作</span></th></tr></thead><tbody>{bookings.map((booking) => <tr key={booking.id} className="border-b border-border"><td className="p-2 whitespace-nowrap">{booking.startTime.toLocaleString("zh-TW")}</td><td className="p-2">{eventNames.get(booking.eventId) ?? "已移除活動"}</td><td className="p-2"><p className="font-medium text-slate-900">{booking.clientName}</p><p className="text-xs text-slate-500">{booking.clientEmail} · {booking.clientPhone}</p></td><td className="p-2"><Badge tone={statusTone(booking.status)}>{booking.status}</Badge></td><td className="p-2">{booking.status === "scheduled" ? <div className="flex flex-wrap gap-2"><form action={updateConsultationBookingStatusAction}><CsrfField /><input type="hidden" name="bookingId" value={booking.id} /><input type="hidden" name="status" value="completed" /><button type="submit" className="min-h-11 rounded-md border border-border px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">完成</button></form><form action={updateConsultationBookingStatusAction}><CsrfField /><input type="hidden" name="bookingId" value={booking.id} /><input type="hidden" name="status" value="no_show" /><button type="submit" className="min-h-11 rounded-md border border-border px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">未到</button></form><form action={cancelConsultationBookingAction}><CsrfField /><input type="hidden" name="bookingId" value={booking.id} /><button type="submit" className="min-h-11 rounded-md border border-border px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">取消預約</button></form></div> : null}</td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-600">目前還沒有預約。</p>}
        {bookings.some((booking) => booking.answers) ? (
          <section className="mt-6 border-t border-border pt-4" aria-labelledby="consultation-answers-title">
            <h3 id="consultation-answers-title" className="mb-3 font-semibold text-slate-900">行前診斷問卷</h3>
            <div className="grid gap-3">{bookings.filter((booking) => booking.answers).map((booking) => (
              <details key={`answers-${booking.id}`} className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">{booking.clientName} · {booking.startTime.toLocaleString("zh-TW")}</summary>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(booking.answers, null, 2)}</pre>
              </details>
            ))}</div>
          </section>
        ) : null}
      </Card>
    </>
  );
}
