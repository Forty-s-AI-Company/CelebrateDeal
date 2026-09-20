/** Pure, timezone-neutral slot generation for a consultation event.
 * Dates are expected to be the event's local wall-clock represented as UTC by
 * the caller. Keeping this module pure makes it safe to use in server actions
 * and easy to verify without loading secrets or a database.
 */

export type ConsultationBookingStatus = "scheduled" | "completed" | "cancelled" | "no_show";

export type ScheduleWindow = { start: string; end: string };
export type WeeklySchedule = Record<string, readonly ScheduleWindow[]>;

export interface ConsultationSlotEngineEvent {
  weeklySchedule: unknown;
  durationMinutes: number;
  bufferMinutes?: number;
  dailyLimit?: number | null;
}

export interface ConsultationSlotBooking {
  startTime: Date;
  endTime: Date;
  status?: ConsultationBookingStatus;
}

export interface ConsultationSlot {
  startTime: Date;
  endTime: Date;
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

function dayNumber(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (/^[0-6]$/.test(normalized)) return Number(normalized);
  return DAY_NAMES[normalized] ?? null;
}

function minutes(value: string): number | null {
  const match = /^(?:([01]\d|2[0-3]):([0-5]\d))$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function scheduleForDay(schedule: unknown, day: number): ScheduleWindow[] {
  // Canonical persisted shape: [{ day: 2, ranges: ["14:00-18:00"] }].
  if (Array.isArray(schedule)) {
    const result: ScheduleWindow[] = [];
    for (const entry of schedule) {
      if (!entry || typeof entry !== "object") continue;
      const candidate = entry as Record<string, unknown>;
      if (candidate.day !== day || !Array.isArray(candidate.ranges)) continue;
      for (const range of candidate.ranges) {
        if (typeof range !== "string") continue;
        const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(range.trim());
        if (match) result.push({ start: match[1]!, end: match[2]! });
      }
    }
    return result;
  }
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) return [];
  const result: ScheduleWindow[] = [];
  for (const [key, value] of Object.entries(schedule as Record<string, unknown>)) {
    if (dayNumber(key) !== day || !Array.isArray(value)) continue;
    for (const window of value) {
      if (!window || typeof window !== "object") continue;
      const candidate = window as Record<string, unknown>;
      if (typeof candidate.start === "string" && typeof candidate.end === "string") {
        result.push({ start: candidate.start, end: candidate.end });
      }
    }
  }
  return result;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function activeBooking(booking: ConsultationSlotBooking): boolean {
  return booking.status !== "cancelled" && booking.status !== "no_show";
}

/** Generate available slots in [from, to), never emitting a slot crossing a day. */
export function generateConsultationSlots(input: {
  event: ConsultationSlotEngineEvent;
  from: Date;
  to: Date;
  bookings?: readonly ConsultationSlotBooking[];
}): ConsultationSlot[] {
  const { event, from, to } = input;
  if (!(from instanceof Date) || !(to instanceof Date) || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("from and to must be valid dates");
  }
  if (to <= from) return [];
  if (!Number.isInteger(event.durationMinutes) || event.durationMinutes <= 0) throw new Error("durationMinutes must be positive");
  const buffer = event.bufferMinutes ?? 0;
  if (!Number.isInteger(buffer) || buffer < 0) throw new Error("bufferMinutes must be non-negative");
  if (event.dailyLimit != null && (!Number.isInteger(event.dailyLimit) || event.dailyLimit < 0)) throw new Error("dailyLimit must be non-negative");

  const bookings = (input.bookings ?? []).filter(activeBooking);
  const slots: ConsultationSlot[] = [];
  for (let day = startOfUtcDay(from); day < to; day = new Date(day.getTime() + 86_400_000)) {
    const dayEnd = new Date(day.getTime() + 86_400_000);
    const windows = scheduleForDay(event.weeklySchedule, day.getUTCDay());
    const dayBookings = bookings.filter((booking) => booking.startTime >= day && booking.startTime < dayEnd);
    const windowsSeen = new Set<string>();
    for (const window of windows) {
      const startMinute = minutes(window.start);
      const endMinute = minutes(window.end);
      if (startMinute == null || endMinute == null || endMinute <= startMinute) continue;
      const key = `${startMinute}:${endMinute}`;
      if (windowsSeen.has(key)) continue;
      windowsSeen.add(key);
      for (let offset = startMinute; offset + event.durationMinutes <= endMinute; offset += event.durationMinutes + buffer) {
        const startTime = new Date(day.getTime() + offset * 60_000);
        const endTime = new Date(startTime.getTime() + event.durationMinutes * 60_000);
        if (startTime < from || endTime > to || endTime > dayEnd) continue;
        if (event.dailyLimit != null && dayBookings.length + slots.filter((slot) => slot.startTime >= day && slot.startTime < dayEnd).length >= event.dailyLimit) continue;
        const conflicts = dayBookings.some((booking) => startTime < new Date(booking.endTime.getTime() + buffer * 60_000) && endTime > booking.startTime);
        if (!conflicts) slots.push({ startTime, endTime });
      }
    }
  }
  return slots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

export const getAvailableConsultationSlots = generateConsultationSlots;
