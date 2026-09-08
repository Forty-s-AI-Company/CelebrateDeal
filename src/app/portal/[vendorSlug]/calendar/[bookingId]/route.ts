import { getDb } from "@/lib/db";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";

function icsText(value: string) {
  return value.replace(/[\r\n]+/gu, " ").replace(/([,;\\])/gu, "\\$1");
}

function icsDate(value: Date) {
  return value.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");
}

function safeMeetingUrl(value: string | null) {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" ? url.toString() : null; } catch { return null; }
}

export async function GET(_request: Request, { params }: { params: Promise<{ vendorSlug: string; bookingId: string }> }) {
  const { vendorSlug, bookingId } = await params;
  const { session } = await requireStudentPortalSession(vendorSlug);
  const booking = await getDb().consultationBooking.findFirst({
    where: { id: bookingId, vendorId: session.vendorId, customerKeyHash: session.customerKeyHash },
    select: { id: true, startTime: true, endTime: true, meetingUrl: true, event: { select: { title: true, description: true } } },
  });
  if (!booking) return new Response("Not found", { status: 404 });
  const description = [booking.event.description, safeMeetingUrl(booking.meetingUrl)].filter(Boolean).join(" ");
  const body = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CelebrateDeal//Student Portal//ZH-TW", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", `UID:${icsText(booking.id)}@celebratedeal`, `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(booking.startTime)}`, `DTEND:${icsDate(booking.endTime)}`,
    `SUMMARY:${icsText(booking.event.title)}`, `DESCRIPTION:${icsText(description)}`, "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": "attachment; filename=consultation.ics", "Cache-Control": "private, no-store" } });
}
