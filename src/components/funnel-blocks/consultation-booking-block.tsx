"use client";

import { createConsultationBookingAction, getConsultationSlots } from "@/app/actions/consultation-actions";
import { ConsultationBookingCalendar, type ConsultationBookingCalendarProps } from "@/components/consultation-booking-calendar";
import type { ConsultationBookingBlock as ConsultationBookingBlockType } from "@/lib/funnel-blocks-schema";

export function ConsultationBookingBlock({ settings, loadSlots, onSubmit, eventId, csrfToken }: { settings: ConsultationBookingBlockType["settings"]; loadSlots?: ConsultationBookingCalendarProps["loadSlots"]; onSubmit?: ConsultationBookingCalendarProps["onSubmit"]; eventId?: string; csrfToken?: string }) {
  const resolvedLoadSlots = loadSlots ?? (eventId ? async (date: string) => (await getConsultationSlots(eventId, date)).map((slot) => ({ id: slot.startTime, start: slot.startTime, end: slot.endTime })) : undefined);
  const resolvedSubmit = onSubmit ?? (eventId && csrfToken ? async (input: Parameters<NonNullable<ConsultationBookingCalendarProps["onSubmit"]>>[0]) => {
    const data = new FormData();
    data.set("_csrf", csrfToken);
    data.set("eventId", eventId);
    data.set("startTime", input.slot.start);
    data.set("clientName", input.clientName);
    data.set("clientEmail", input.clientEmail);
    data.set("clientPhone", input.clientPhone);
    data.set("answers", JSON.stringify(input.answers));
    const result = await createConsultationBookingAction(data);
    if (result.status !== "booked") throw new Error("slot_unavailable");
    const calendar = new URL("https://calendar.google.com/calendar/render");
    calendar.searchParams.set("action", "TEMPLATE");
    calendar.searchParams.set("text", settings.title);
    calendar.searchParams.set("dates", `${input.slot.start.replace(/[-:]/gu, "").replace(".000", "")}/${input.slot.end.replace(/[-:]/gu, "").replace(".000", "")}`);
    return { calendarUrl: calendar.toString(), message: settings.successMessage, notice: "請準時上線；若需調整時間，請提前聯絡主辦方。" };
  } : undefined);
  return <ConsultationBookingCalendar settings={settings} loadSlots={resolvedLoadSlots} onSubmit={resolvedSubmit} />;
}
