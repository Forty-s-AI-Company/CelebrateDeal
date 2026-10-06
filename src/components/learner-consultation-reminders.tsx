"use client";
import { portalText } from "@/lib/student-portal-translations";
import type { StudentPortalLocale } from "@/lib/student-portal-locale";
import { useId, useRef, useState } from "react";
import { z } from "zod";
const Booking = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u), startTime: z.string().datetime(), title: z.string().max(2000), confirmed: z.boolean() }).strict();
const Snapshot = z.object({ bookings: z.array(Booking).max(20), nextAfter: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u).nullable(), csrfToken: z.string().min(1).max(2048) }).strict();
class ReminderUiError extends Error {
}
const button = "min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50";
/** Explicit confirmation is separate from public calendar reservation and
 * channel opt-in. Private bookings/CSRF remain transient browser memory only. */
export function LearnerConsultationReminders({ vendorSlug, courseId, locale }: {
    vendorSlug: string;
    courseId: string;
    locale?: StudentPortalLocale;
}) {
    const t = (text: string) => portalText(locale ?? "zh-TW", text);
    const heading = useId();
    const endpoint = `/portal/${encodeURIComponent(vendorSlug)}/learn/${encodeURIComponent(courseId)}/notifications/reminders`;
    const [snapshot, setSnapshot] = useState<z.infer<typeof Snapshot> | null>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState("");
    const lock = useRef(false);
    const csrf = useRef("");
    const cursor = useRef<string | undefined>(undefined);
    async function load(after?: string) {
        const response = await fetch(endpoint + (after ? `?after=${encodeURIComponent(after)}` : ""), { credentials: "same-origin", cache: "no-store", headers: { "x-celebratedeal-client": "web" } });
        if (!response.ok)
            throw new ReminderUiError(t("目前無法讀取預約，請確認登入與課程權益。"));
        const parsed = Snapshot.safeParse(await response.json());
        if (!parsed.success)
            throw new ReminderUiError(t("預約資料不完整，請稍後再試。"));
        csrf.current = parsed.data.csrfToken;
        cursor.current = after;
        setSnapshot(parsed.data);
    }
    async function action(run: () => Promise<void>) {
        if (lock.current)
            return;
        lock.current = true;
        setBusy(true);
        setNotice("");
        try {
            await run();
        }
        catch (error) {
            setNotice(error instanceof ReminderUiError ? error.message : t("目前無法設定預約提醒。"));
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    }
    async function confirm(booking: z.infer<typeof Booking>) {
        const body = JSON.stringify({ bookingId: booking.id, expectedStartTime: booking.startTime });
        const send = () => fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-celebratedeal-client": "web", "x-csrf-token": csrf.current }, body });
        let response = await send();
        // Retry only explicit CSRF refusal, with the exact original booking revision.
        if (response.status === 403) {
            await load(cursor.current);
            response = await send();
        }
        if (!response.ok)
            throw new ReminderUiError(response.status === 409 ? t("請先驗證收件方式並開啟課程通知。") : response.status === 404 ? t("預約或權益已變更，請重新載入。") : t("目前無法設定預約提醒，請稍後再試。"));
        if (!z.object({ status: z.literal("scheduled"), availableAt: z.string().datetime() }).strict().safeParse(await response.json()).success)
            throw new ReminderUiError(t("提醒狀態不完整，請重新載入。"));
        await load(cursor.current);
        setNotice(t("已確認這筆預約。開始前一小時會依有效的通知設定寄送提醒；取消或變更的預約不會寄送舊提醒。"));
    }
    return <section aria-labelledby={heading} className="mt-6 border-t border-slate-200 pt-5">
    <h3 id={heading} className="text-lg font-bold">{t("預約提醒")}</h3>
    <p className="mt-2 text-sm text-slate-600">{t("查看這門課程連結的預約，確認需要提醒的場次。請先驗證收件方式並開啟通知。")}</p>
    <button className={`${button} mt-3`} type="button" disabled={busy} onClick={() => void action(() => load())}>{snapshot ? t("重新載入我的預約") : t("查看我的預約")}</button>
    {snapshot ? <div className="mt-3 space-y-3">
      {snapshot.bookings.length ? snapshot.bookings.map(booking => <article key={booking.id} className="rounded-lg border border-slate-200 p-3">
        <h4 className="font-semibold">{booking.title}</h4><p className="my-2 text-sm"><time dateTime={booking.startTime}>{new Date(booking.startTime).toLocaleString(locale ?? "zh-TW")}</time></p>
        <button className={button} type="button" disabled={busy || booking.confirmed} onClick={() => void action(() => confirm(booking))}>{booking.confirmed ? t("已確認預約提醒") : t("開啟這筆預約提醒")}</button>
      </article>) : <p className="text-sm text-slate-600">{t("目前沒有可確認的預約。")}</p>}
      {snapshot.nextAfter ? <button className={button} type="button" disabled={busy} onClick={() => void action(() => load(snapshot.nextAfter!))}>{t("下一頁預約")}</button> : null}
    </div> : null}
    <p role="status" aria-label={t("預約提醒狀態")} aria-live="polite" className="mt-3 text-sm">{busy ? t("處理中…") : notice}</p>
  </section>;
}
