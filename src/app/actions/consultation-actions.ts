"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { generateConsultationSlots, type ConsultationSlot } from "@/lib/consultation-slot-engine";
import { automationCustomerKeyHash, dispatchAutomationEvent } from "@/lib/automation-workflow";

const MANAGEMENT_PATH = "/consultations";
const EVENT_ID = z.string().trim().min(1).max(191);
const CalendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const BookingInput = z.object({
  eventId: EVENT_ID,
  startTime: z.string().datetime({ offset: true }),
  clientName: z.string().trim().min(1).max(160),
  clientEmail: z.string().trim().email().max(320),
  clientPhone: z.string().trim().min(3).max(40),
  answers: z.unknown().optional(),
}).strict();

type ConsultationEvent = {
  id: string;
  vendorId: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  bufferMinutes: number;
  dailyLimit: number | null;
  timezone: string;
  weeklySchedule: unknown;
  intakeFormFields: unknown;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

type ConsultationBooking = {
  id: string;
  vendorId: string;
  eventId: string;
  startTime: Date;
  endTime: Date;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  answers?: unknown;
  meetingUrl?: string | null;
  createdAt?: Date;
};

type ConsultationTransaction = {
  $executeRaw: (query: Prisma.Sql) => Promise<unknown>;
  consultationEvent: {
    findFirst: (args: unknown) => Promise<ConsultationEvent | null>;
  };
  consultationBooking: {
    findFirst: (args: unknown) => Promise<Pick<ConsultationBooking, "id"> | null>;
    findMany: (args: unknown) => Promise<Array<Pick<ConsultationBooking, "startTime" | "endTime" | "status">>>;
    count: (args: unknown) => Promise<number>;
    create: (args: unknown) => Promise<ConsultationBooking>;
  };
};

/** The intentionally small Prisma surface also keeps unit tests independent of a generated client. */
export type ConsultationDatabase = {
  consultationEvent: {
    findFirst: (args: unknown) => Promise<ConsultationEvent | null>;
    create: (args: unknown) => Promise<ConsultationEvent>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
    findMany: (args: unknown) => Promise<ConsultationEvent[]>;
  };
  consultationBooking: {
    findFirst?: (args: unknown) => Promise<ConsultationBooking | null>;
    findMany: (args: unknown) => Promise<ConsultationBooking[]>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  $transaction: <T>(
    callback: (transaction: ConsultationTransaction) => Promise<T>,
    options?: { isolationLevel?: "Serializable" },
  ) => Promise<T>;
};

function db(): ConsultationDatabase {
  // The Prisma client can lag the schema during a staged migration. Keep this
  // boundary narrow; the production client remains the only runtime database.
  return getDb() as unknown as ConsultationDatabase;
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value || null;
}

function integer(formData: FormData, key: string, minimum: number, maximum: number, allowBlank = false) {
  const value = text(formData, key);
  if (allowBlank && !value) return null;
  if (!/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

function parseJson(formData: FormData, key: string, fallback: unknown) {
  const raw = text(formData, key);
  if (!raw) return fallback;
  if (raw.length > 12_000) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function safeTimezone(value: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return null;
  }
}

function eventDraft(formData: FormData) {
  const title = text(formData, "title");
  const description = optionalText(formData, "description");
  const durationMinutes = integer(formData, "durationMinutes", 15, 480);
  const bufferMinutes = integer(formData, "bufferMinutes", 0, 180);
  const dailyLimit = integer(formData, "dailyLimit", 1, 100, true);
  const timezone = safeTimezone(text(formData, "timezone") || "Asia/Taipei");
  const weeklySchedule = parseJson(formData, "weeklySchedule", {});
  const intakeFormFields = parseJson(formData, "intakeFormFields", []);

  if (!title || title.length > 160 || (description?.length ?? 0) > 2_000 || durationMinutes === undefined || bufferMinutes === undefined || dailyLimit === undefined || !timezone || weeklySchedule === undefined || intakeFormFields === undefined) {
    return null;
  }
  if (!Array.isArray(weeklySchedule) || !Array.isArray(intakeFormFields)) return null;
  for (const entry of weeklySchedule) {
    if (!entry || typeof entry !== "object") return null;
    const candidate = entry as Record<string, unknown>;
    if (!Number.isInteger(candidate.day) || (candidate.day as number) < 0 || (candidate.day as number) > 6 || !Array.isArray(candidate.ranges) || candidate.ranges.some((range) => typeof range !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/u.test(range))) return null;
  }
  return { title, description, durationMinutes, bufferMinutes, dailyLimit, timezone, weeklySchedule, intakeFormFields };
}

function redirectWithError(code: string): never {
  redirect(`${MANAGEMENT_PATH}?error=${encodeURIComponent(code)}`);
}

/** Manager-only event creation. Tenant identity is always derived from the session. */
export async function createConsultationEventAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorManagerContext();
  const draft = eventDraft(formData);
  if (!draft) redirectWithError("invalid_event");

  await db().consultationEvent.create({
    data: {
      vendorId: vendor.id,
      ...draft,
      weeklySchedule: draft.weeklySchedule as Prisma.InputJsonValue,
      intakeFormFields: draft.intakeFormFields as Prisma.InputJsonValue,
    },
  });
  revalidatePath(MANAGEMENT_PATH);
  redirect(`${MANAGEMENT_PATH}?updated=created`);
}

/** Saves an existing event with a vendor-qualified conditional update. */
export async function updateConsultationEventAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorManagerContext();
  const id = EVENT_ID.safeParse(text(formData, "eventId"));
  const draft = eventDraft(formData);
  if (!id.success || !draft) redirectWithError("invalid_event");

  const result = await db().consultationEvent.updateMany({
    where: { id: id.data, vendorId: vendor.id },
    data: {
      ...draft,
      weeklySchedule: draft.weeklySchedule as Prisma.InputJsonValue,
      intakeFormFields: draft.intakeFormFields as Prisma.InputJsonValue,
    },
  });
  if (result.count !== 1) redirectWithError("not_found");
  revalidatePath(MANAGEMENT_PATH);
  redirect(`${MANAGEMENT_PATH}?updated=saved`);
}

/** Deactivation is deliberately non-destructive: booking history stays intact. */
export async function toggleConsultationEventAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorManagerContext();
  const id = EVENT_ID.safeParse(text(formData, "eventId"));
  const isActive = text(formData, "isActive");
  if (!id.success || (isActive !== "true" && isActive !== "false")) redirectWithError("invalid_event");

  const result = await db().consultationEvent.updateMany({
    where: { id: id.data, vendorId: vendor.id },
    data: { isActive: isActive === "true" },
  });
  if (result.count !== 1) redirectWithError("not_found");
  revalidatePath(MANAGEMENT_PATH);
  redirect(`${MANAGEMENT_PATH}?updated=event_status`);
}

/** Cancellation is tenant-scoped, so an ID from another vendor is never mutable. */
export async function cancelConsultationBookingAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorManagerContext();
  const id = EVENT_ID.safeParse(text(formData, "bookingId"));
  if (!id.success) redirectWithError("invalid_booking");

  const result = await db().consultationBooking.updateMany({
    where: { id: id.data, vendorId: vendor.id, status: "scheduled" },
    data: { status: "cancelled" },
  });
  if (result.count !== 1) redirectWithError("not_found_or_closed");
  revalidatePath(MANAGEMENT_PATH);
  redirect(`${MANAGEMENT_PATH}?updated=booking_cancelled`);
}

/** Records the operational outcome without ever crossing the current vendor boundary. */
export async function updateConsultationBookingStatusAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorManagerContext();
  const id = EVENT_ID.safeParse(text(formData, "bookingId"));
  const status = z.enum(["completed", "no_show"]).safeParse(text(formData, "status"));
  if (!id.success || !status.success) redirectWithError("invalid_booking");

  const database = db();
  const booking = status.data === "no_show" ? await database.consultationBooking.findFirst?.({
    where: { id: id.data, vendorId: vendor.id, status: "scheduled" },
    select: { id: true, clientEmail: true, meetingUrl: true },
  }) : null;
  const result = await database.consultationBooking.updateMany({
    where: { id: id.data, vendorId: vendor.id, status: "scheduled" },
    data: { status: status.data },
  });
  if (result.count !== 1) redirectWithError("not_found_or_closed");
  if (booking?.clientEmail && status.data === "no_show") {
    await dispatchAutomationEvent(getDb(), {
      vendorId: vendor.id,
      eventId: `consultation-no-show:${booking.id}`,
      trigger: "consultation_no_show",
      subjectType: "buyer_registration",
      subjectId: booking.id,
      subjectKeyHash: automationCustomerKeyHash(vendor.id, booking.clientEmail),
      recipientEmail: booking.clientEmail,
      consultationUrl: booking.meetingUrl ?? undefined,
    }).catch(() => undefined);
  }
  revalidatePath(MANAGEMENT_PATH);
  redirect(`${MANAGEMENT_PATH}?updated=booking_status`);
}

function dayRange(value: string) {
  if (!CalendarDay.safeParse(value).success) return null;
  const from = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime())) return null;
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
  };
}

/** Represents a real instant as a timezone-local wall clock on the engine's UTC-neutral timeline. */
function instantToWallClock(instant: Date, timeZone: string) {
  const value = zonedParts(instant, timeZone);
  return new Date(Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second));
}

/** Converts an engine wall-clock value back to the real UTC instant persisted by Prisma. */
function wallClockToInstant(wallClock: Date, timeZone: string) {
  const target = wallClock.getTime();
  let guess = target;
  // A second pass handles DST boundaries where the offset differs at the first guess.
  for (let pass = 0; pass < 2; pass += 1) {
    const represented = instantToWallClock(new Date(guess), timeZone).getTime();
    guess += target - represented;
  }
  return new Date(guess);
}

function eventDayRanges(date: string, timeZone: string) {
  const wall = dayRange(date);
  if (!wall) return null;
  return {
    wall,
    actual: {
      from: wallClockToInstant(wall.from, timeZone),
      to: wallClockToInstant(wall.to, timeZone),
    },
  };
}

function slotDto(slot: ConsultationSlot) {
  return { startTime: slot.startTime.toISOString(), endTime: slot.endTime.toISOString() };
}

function bookingRecordsForDay(database: ConsultationDatabase, event: ConsultationEvent, range: { from: Date; to: Date }) {
  return database.consultationBooking.findMany({
    where: {
      vendorId: event.vendorId,
      eventId: event.id,
      startTime: { gte: range.from, lt: range.to },
    },
    select: { startTime: true, endTime: true, status: true },
  }) as Promise<Array<Pick<ConsultationBooking, "startTime" | "endTime" | "status">>>;
}

/** Public read model. The event lookup determines the vendor; no client tenant id is accepted. */
export async function getConsultationSlots(eventId: string, date: string) {
  const id = EVENT_ID.safeParse(eventId);
  if (!id.success || !CalendarDay.safeParse(date).success) return [];
  const database = db();
  const event = await database.consultationEvent.findFirst({
    where: { id: id.data, isActive: true },
    select: { id: true, vendorId: true, durationMinutes: true, bufferMinutes: true, dailyLimit: true, weeklySchedule: true },
  });
  if (!event) return [];
  const ranges = eventDayRanges(date, event.timezone);
  if (!ranges) return [];
  const bookings = await bookingRecordsForDay(database, event, ranges.actual);
  const wallBookings = bookings.map((booking) => ({
    ...booking,
    startTime: instantToWallClock(booking.startTime, event.timezone),
    endTime: instantToWallClock(booking.endTime, event.timezone),
  }));
  return generateConsultationSlots({ event, ...ranges.wall, bookings: wallBookings }).map((slot) => slotDto({
    startTime: wallClockToInstant(slot.startTime, event.timezone),
    endTime: wallClockToInstant(slot.endTime, event.timezone),
  }));
}

function parseIntakeResponses(value: unknown, fields: unknown) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  const configured = Array.isArray(fields) ? fields : [];
  const allowed = new Map<string, { required: boolean }>();
  for (const field of configured) {
    if (!field || typeof field !== "object") continue;
    const candidate = field as Record<string, unknown>;
    if (typeof candidate.id === "string") allowed.set(candidate.id, { required: candidate.required === true });
  }
  if (Object.keys(response).some((key) => !allowed.has(key))) return null;
  const safe: Record<string, string> = {};
  for (const [key, definition] of allowed) {
    const valueForField = response[key];
    if (valueForField === undefined || valueForField === null) {
      if (definition.required) return null;
      continue;
    }
    if (typeof valueForField !== "string" || valueForField.trim().length > 2_000 || (definition.required && !valueForField.trim())) return null;
    safe[key] = valueForField.trim();
  }
  return safe;
}

function serializableConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

export type ConsultationReservationResult =
  | { status: "booked"; booking: { id: string; startTime: string; endTime: string } }
  | { status: "unavailable" };

/**
 * Reserves a public slot under a serializable transaction. PostgreSQL's
 * transaction-scoped advisory lock serializes competing reservations for the
 * same event, including overlapping starts when a buffer is configured.
 */
export async function reserveConsultationBooking(
  database: ConsultationDatabase,
  input: z.infer<typeof BookingInput>,
  customerHash: (vendorId: string, email: string) => string = automationCustomerKeyHash,
): Promise<ConsultationReservationResult> {
  const requestedStart = new Date(input.startTime);
  if (Number.isNaN(requestedStart.getTime())) return { status: "unavailable" };

  try {
    return await database.$transaction(async (transaction) => {
      const event = await transaction.consultationEvent.findFirst({
        where: { id: input.eventId, isActive: true },
        select: { id: true, vendorId: true, durationMinutes: true, bufferMinutes: true, dailyLimit: true, weeklySchedule: true, intakeFormFields: true, isActive: true },
      });
      if (!event) return { status: "unavailable" };

      // This lock is event-wide rather than start-time-only. It therefore also
      // protects buffer-overlap and daily-limit checks from a concurrent POST.
      await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${event.vendorId}:${event.id}`}, 0))`);

      const localDate = instantToWallClock(requestedStart, event.timezone).toISOString().slice(0, 10);
      const ranges = eventDayRanges(localDate, event.timezone);
      if (!ranges) return { status: "unavailable" };
      const bookings = await transaction.consultationBooking.findMany({
        where: { vendorId: event.vendorId, eventId: event.id, startTime: { gte: ranges.actual.from, lt: ranges.actual.to } },
        select: { startTime: true, endTime: true, status: true },
      });
      const wallBookings = bookings.map((booking) => ({
        ...booking,
        startTime: instantToWallClock(booking.startTime, event.timezone),
        endTime: instantToWallClock(booking.endTime, event.timezone),
      }));
      const slots = generateConsultationSlots({ event, ...ranges.wall, bookings: wallBookings }).map((slot) => ({
        startTime: wallClockToInstant(slot.startTime, event.timezone),
        endTime: wallClockToInstant(slot.endTime, event.timezone),
      }));
      const requestedSlot = slots.find((slot) => slot.startTime.getTime() === requestedStart.getTime());
      if (!requestedSlot) return { status: "unavailable" };

      const answers = parseIntakeResponses(input.answers, event.intakeFormFields);
      if (!answers) return { status: "unavailable" };

      // Defense in depth: the lock makes this query deterministic; the exact
      // overlap predicate remains correct if the lock policy changes later.
      const conflict = await transaction.consultationBooking.findFirst({
        where: {
          vendorId: event.vendorId,
          eventId: event.id,
          status: { in: ["scheduled", "completed"] },
          startTime: { lt: requestedSlot.endTime },
          endTime: { gt: requestedSlot.startTime },
        },
        select: { id: true },
      });
      if (conflict) return { status: "unavailable" };

      const booking = await transaction.consultationBooking.create({
        data: {
          vendorId: event.vendorId,
          eventId: event.id,
          startTime: requestedSlot.startTime,
          endTime: requestedSlot.endTime,
          status: "scheduled",
          clientName: input.clientName,
          clientEmail: input.clientEmail.toLowerCase(),
          customerKeyHash: customerHash(event.vendorId, input.clientEmail),
          clientPhone: input.clientPhone,
          answers: answers as Prisma.InputJsonObject,
        },
        select: { id: true, startTime: true, endTime: true },
      });
      return { status: "booked", booking: { id: booking.id, startTime: booking.startTime.toISOString(), endTime: booking.endTime.toISOString() } };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    // Serializable retries are intentionally surfaced as a retryable slot
    // outcome; a caller must re-fetch availability before another attempt.
    if (serializableConflict(error)) return { status: "unavailable" };
    throw error;
  }
}

/** Anonymous, CSRF-protected booking entry point used by the public calendar. */
export async function createConsultationBookingAction(formData: FormData): Promise<ConsultationReservationResult> {
  await assertServerActionSecurity(formData);
  const rawAnswers = parseJson(formData, "answers", {});
  const parsed = BookingInput.safeParse({
    eventId: text(formData, "eventId"),
    startTime: text(formData, "startTime"),
    clientName: text(formData, "clientName"),
    clientEmail: text(formData, "clientEmail"),
    clientPhone: text(formData, "clientPhone"),
    answers: rawAnswers,
  });
  if (!parsed.success) return { status: "unavailable" };
  const database = db();
  const result = await reserveConsultationBooking(database, parsed.data);
  if (result.status === "booked") {
    const booking = await database.consultationBooking.findFirst?.({
      where: { id: result.booking.id, eventId: parsed.data.eventId },
      select: { id: true, vendorId: true, meetingUrl: true },
    });
    if (booking) {
      await dispatchAutomationEvent(getDb(), {
        vendorId: booking.vendorId,
        eventId: `consultation-booked:${booking.id}`,
        trigger: "consultation_booked",
        subjectType: "buyer_registration",
        subjectId: booking.id,
        subjectKeyHash: automationCustomerKeyHash(booking.vendorId, parsed.data.clientEmail),
        recipientEmail: parsed.data.clientEmail,
        consultationUrl: booking.meetingUrl ?? undefined,
      }).catch(() => undefined);
    }
  }
  return result;
}
