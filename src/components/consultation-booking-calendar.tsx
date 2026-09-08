"use client";

import { useMemo, useState } from "react";
import type { ConsultationBookingBlock } from "@/lib/funnel-blocks-schema";

export type ConsultationSlot = {
  id: string;
  start: string;
  end: string;
  label?: string;
};
export type ConsultationBookingResult = {
  eventId?: string;
  calendarUrl?: string;
  message?: string;
  notice?: string;
};
export type ConsultationBookingCalendarProps = {
  settings: ConsultationBookingBlock["settings"];
  loadSlots?: (date: string) => Promise<ConsultationSlot[]>;
  onSubmit?: (input: {
    date: string;
    slot: ConsultationSlot;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    answers: Record<string, string>;
  }) => Promise<ConsultationBookingResult | void>;
};

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
const pad = (value: number) => String(value).padStart(2, "0");
const isoDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const monthLabel = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "long",
});

export function ConsultationSlotButtons({
  slots,
  selectedSlotId,
  onSelect,
}: {
  slots: ConsultationSlot[];
  selectedSlotId?: string;
  onSelect: (slot: ConsultationSlot) => void;
}) {
  return (
    <div className="mt-3 grid gap-2">
      {slots.map((slot) => (
        <button
          type="button"
          key={slot.id}
          onClick={() => onSelect(slot)}
          aria-pressed={selectedSlotId === slot.id}
          className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold ${selectedSlotId === slot.id ? "border-blue-600 bg-blue-50 text-blue-900" : "hover:border-blue-400"}`}
        >
          {slot.label ??
            `${new Date(slot.start).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })} – ${new Date(slot.end).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`}
        </button>
      ))}
    </div>
  );
}

function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const count = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  return [
    ...Array(first.getDay()).fill(null),
    ...Array.from(
      { length: count },
      (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1),
    ),
  ];
}

export function ConsultationBookingCalendar({
  settings,
  loadSlots,
  onSubmit,
}: ConsultationBookingCalendarProps) {
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<ConsultationSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<ConsultationSlot | null>(
    null,
  );
  const [intake, setIntake] = useState<Record<string, string>>({
    clientName: "",
    clientEmail: "",
    clientPhone: "",
  });
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<ConsultationBookingResult | null>(
    null,
  );
  const days = useMemo(() => calendarDays(month), [month]);
  const intakeFields = useMemo(
    () => [
      {
        id: "clientName",
        label: "姓名",
        type: "text" as const,
        required: true,
      },
      {
        id: "clientEmail",
        label: "Email",
        type: "email" as const,
        required: true,
      },
      {
        id: "clientPhone",
        label: "手機",
        type: "tel" as const,
        required: true,
      },
      ...settings.intakeFields,
    ],
    [settings.intakeFields],
  );

  async function chooseDate(nextDate: string) {
    setDate(nextDate);
    setSelectedSlot(null);
    setSuccess(null);
    setError("");
    setSlots([]);
    if (!loadSlots) return;
    setLoading(true);
    try {
      setSlots(await loadSlots(nextDate));
    } catch {
      setError("目前無法載入可預約時段，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot || !date || !onSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      setSuccess(
        (await onSubmit({
          date,
          slot: selectedSlot,
          clientName: intake.clientName ?? "",
          clientEmail: intake.clientEmail ?? "",
          clientPhone: intake.clientPhone ?? "",
          answers: Object.fromEntries(
            Object.entries(intake).filter(
              ([key]) =>
                !["clientName", "clientEmail", "clientPhone"].includes(key),
            ),
          ),
        })) ?? {},
      );
    } catch {
      setError("預約送出失敗，請確認資料後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  if (success)
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <div
          role="status"
          className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950 shadow-sm"
        >
          <h2 className="text-2xl font-black">預約成功</h2>
          <p className="mt-3 leading-7">
            {success.message ?? settings.successMessage}
          </p>
          <p className="mt-3 text-sm font-semibold">
            時間：{date}{" "}
            {selectedSlot
              ? (selectedSlot.label ??
                `${new Date(selectedSlot.start).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })} – ${new Date(selectedSlot.end).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`)
              : ""}
          </p>
          {success.notice ? (
            <p className="mt-2 text-sm">注意事項：{success.notice}</p>
          ) : null}
          {success.calendarUrl ? (
            <a
              href={success.calendarUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white"
            >
              加入行事曆
            </a>
          ) : null}
        </div>
      </section>
    );

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl sm:p-8">
        <h2 className="text-2xl font-black text-slate-950">{settings.title}</h2>
        {settings.description ? (
          <p className="mt-2 leading-7 text-slate-600">
            {settings.description}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-slate-500">
          每次諮詢 {settings.durationMinutes} 分鐘・{settings.timezone}
        </p>
        <div className="mt-6 grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label="上個月"
                onClick={() =>
                  setMonth(
                    (value) =>
                      new Date(value.getFullYear(), value.getMonth() - 1, 1),
                  )
                }
                className="rounded-lg border px-3 py-2"
              >
                ←
              </button>
              <h3 className="font-bold">{monthLabel.format(month)}</h3>
              <button
                type="button"
                aria-label="下個月"
                onClick={() =>
                  setMonth(
                    (value) =>
                      new Date(value.getFullYear(), value.getMonth() + 1, 1),
                  )
                }
                className="rounded-lg border px-3 py-2"
              >
                →
              </button>
            </div>
            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-500">
              {weekdays.map((day) => (
                <span key={day} className="py-2">
                  {day}
                </span>
              ))}
              {days.map((day, index) =>
                day ? (
                  <button
                    key={isoDate(day)}
                    type="button"
                    onClick={() => void chooseDate(isoDate(day))}
                    aria-pressed={date === isoDate(day)}
                    className={`min-h-10 rounded-lg text-sm ${date === isoDate(day) ? "bg-slate-950 text-white" : "hover:bg-blue-50"}`}
                  >
                    {day.getDate()}
                  </button>
                ) : (
                  <span key={`empty-${index}`} />
                ),
              )}
            </div>
          </div>
          <div aria-live="polite">
            <h3 className="font-bold text-slate-950">
              {date ? `${date} 可預約時段` : "先選擇日期"}
            </h3>
            {loading ? (
              <p className="mt-4 text-sm text-slate-500">載入時段中…</p>
            ) : null}
            {!loading && date && slots.length === 0 ? (
              <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                {loadSlots ? "這天目前沒有可預約時段。" : "預約服務尚未連接。"}
              </p>
            ) : null}
            <ConsultationSlotButtons
              slots={slots}
              selectedSlotId={selectedSlot?.id}
              onSelect={setSelectedSlot}
            />
          </div>
        </div>
        {selectedSlot ? (
          <form
            onSubmit={submit}
            className="mt-7 border-t border-slate-200 pt-6"
          >
            <h3 className="font-bold">留下預約資料</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {intakeFields.map((field) => (
                <label
                  key={field.id}
                  className={`grid gap-1 text-sm font-semibold ${field.type === "textarea" ? "sm:col-span-2" : ""}`}
                >
                  {field.label}
                  {field.type === "textarea" ? (
                    <textarea
                      required={field.required}
                      rows={3}
                      value={intake[field.id] ?? ""}
                      onChange={(event) =>
                        setIntake((current) => ({
                          ...current,
                          [field.id]: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2"
                    />
                  ) : (
                    <input
                      required={field.required}
                      type={field.type}
                      value={intake[field.id] ?? ""}
                      onChange={(event) =>
                        setIntake((current) => ({
                          ...current,
                          [field.id]: event.target.value,
                        }))
                      }
                      className="h-11 rounded-lg border border-slate-300 px-3"
                    />
                  )}
                </label>
              ))}
            </div>
            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
              >
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting || !onSubmit}
              className="mt-5 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "送出中…" : settings.submitLabel}
            </button>
            {!onSubmit ? (
              <p className="mt-2 text-xs text-slate-500">
                預約服務尚未連接，請稍後再試。
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
    </section>
  );
}
