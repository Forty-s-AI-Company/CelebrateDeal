import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsultationDatabase } from "./consultation-actions";

const runtime = vi.hoisted(() => ({
  security: vi.fn(),
  manager: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
  eventCreate: vi.fn(),
  eventUpdateMany: vi.fn(),
  eventFindFirst: vi.fn(),
  eventFindMany: vi.fn(),
  bookingFindMany: vi.fn(),
  bookingUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: runtime.revalidate }));
vi.mock("next/navigation", () => ({ redirect: runtime.redirect }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: runtime.security }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: runtime.manager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  consultationEvent: { create: runtime.eventCreate, updateMany: runtime.eventUpdateMany, findFirst: runtime.eventFindFirst, findMany: runtime.eventFindMany },
  consultationBooking: { findMany: runtime.bookingFindMany, updateMany: runtime.bookingUpdateMany },
  $transaction: runtime.transaction,
}) }));

import {
  cancelConsultationBookingAction,
  createConsultationBookingAction,
  createConsultationEventAction,
  getConsultationSlots,
  reserveConsultationBooking,
  toggleConsultationEventAction,
  updateConsultationEventAction,
} from "./consultation-actions";

const event = {
  id: "event-1", vendorId: "vendor-1", title: "策略諮詢", description: null,
  durationMinutes: 30, bufferMinutes: 0, dailyLimit: null, timezone: "Asia/Taipei",
  weeklySchedule: [{ day: 1, ranges: ["09:00-10:00"] }], intakeFormFields: [], isActive: true,
};

function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  data.set("_csrf", "valid-token");
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function eventForm() {
  return form({
    title: "策略諮詢", durationMinutes: "30", bufferMinutes: "0", timezone: "Asia/Taipei",
    weeklySchedule: JSON.stringify(event.weeklySchedule), intakeFormFields: "[]",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.security.mockResolvedValue(undefined);
  runtime.manager.mockResolvedValue({ vendor: { id: "vendor-1" } });
  runtime.eventCreate.mockResolvedValue(event);
  runtime.eventUpdateMany.mockResolvedValue({ count: 1 });
  runtime.bookingUpdateMany.mockResolvedValue({ count: 1 });
  runtime.eventFindFirst.mockResolvedValue(event);
  runtime.bookingFindMany.mockResolvedValue([]);
});

describe("consultation management actions", () => {
  it("uses CSRF and the manager session vendor when creating an event", async () => {
    await expect(createConsultationEventAction(eventForm())).rejects.toThrow("redirect:/consultations?updated=created");
    expect(runtime.security).toHaveBeenCalledOnce();
    expect(runtime.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vendorId: "vendor-1", title: "策略諮詢" }),
    }));
    expect(runtime.revalidate).toHaveBeenCalledWith("/consultations");
  });

  it("does not let a cross-tenant event or booking id mutate a current vendor record", async () => {
    const toggle = form({ eventId: "event-from-another-vendor", isActive: "false", vendorId: "attacker-vendor" });
    await expect(toggleConsultationEventAction(toggle)).rejects.toThrow("redirect:/consultations?updated=event_status");
    expect(runtime.eventUpdateMany).toHaveBeenCalledWith({
      where: { id: "event-from-another-vendor", vendorId: "vendor-1" }, data: { isActive: false },
    });

    const cancel = form({ bookingId: "booking-from-another-vendor", vendorId: "attacker-vendor" });
    await expect(cancelConsultationBookingAction(cancel)).rejects.toThrow("redirect:/consultations?updated=booking_cancelled");
    expect(runtime.bookingUpdateMany).toHaveBeenCalledWith({
      where: { id: "booking-from-another-vendor", vendorId: "vendor-1", status: "scheduled" }, data: { status: "cancelled" },
    });
  });

  it("updates an event only when it belongs to the manager's current tenant", async () => {
    const data = eventForm();
    data.set("eventId", "event-from-another-vendor");
    await expect(updateConsultationEventAction(data)).rejects.toThrow("redirect:/consultations?updated=saved");
    expect(runtime.eventUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "event-from-another-vendor", vendorId: "vendor-1" },
      data: expect.objectContaining({ title: "策略諮詢" }),
    }));
  });
});

describe("public consultation slots", () => {
  it("derives the vendor from the active event and does not accept a client vendor id", async () => {
    const slots = await getConsultationSlots("event-1", "2026-09-07");
    expect(slots).toHaveLength(2);
    expect(slots[0]?.startTime).toBe("2026-09-07T01:00:00.000Z");
    expect(runtime.eventFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "event-1", isActive: true } }));
    expect(runtime.bookingFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", eventId: "event-1" }) }));
  });

  it("fails closed before booking when an anonymous payload uses an invalid event", async () => {
    const result = await createConsultationBookingAction(form({ eventId: "", startTime: "2026-09-07T01:00:00.000Z", clientName: "林小安", clientEmail: "a@example.test", clientPhone: "0912345678", vendorId: "attacker-vendor" }));
    expect(result).toEqual({ status: "unavailable" });
    expect(runtime.transaction).not.toHaveBeenCalled();
  });
});

function concurrentReservationDatabase(): ConsultationDatabase {
  const bookings: Array<{ id: string; vendorId: string; eventId: string; startTime: Date; endTime: Date; status: "scheduled" }> = [];
  let tail = Promise.resolve();
  let id = 0;
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    consultationEvent: { findFirst: vi.fn().mockResolvedValue(event) },
    consultationBooking: {
      findMany: vi.fn(async () => bookings),
      findFirst: vi.fn(async (input: unknown) => {
        const where = (input as { where: { startTime: { lt: Date }; endTime: { gt: Date } } }).where;
        return bookings.find((booking) => booking.startTime < where.startTime.lt && booking.endTime > where.endTime.gt) ?? null;
      }),
      count: vi.fn(async () => bookings.length),
      create: vi.fn(async (input: unknown) => {
        const data = (input as { data: { vendorId: string; eventId: string; startTime: Date; endTime: Date; status: "scheduled" } }).data;
        const created = { id: `booking-${++id}`, ...data };
        bookings.push(created);
        return created;
      }),
    },
  };
  return {
    consultationEvent: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    consultationBooking: { findMany: vi.fn(), updateMany: vi.fn() },
    $transaction: async (callback, options) => {
      expect(options).toEqual({ isolationLevel: "Serializable" });
      const previous = tail;
      let release: (() => void) | undefined;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await callback(transaction);
      } finally {
        release?.();
      }
    },
  };
}

describe("consultation reservation concurrency", () => {
  it("allows only one concurrent reservation for the same slot", async () => {
    const database = concurrentReservationDatabase();
    const request = { eventId: "event-1", startTime: "2026-09-07T01:00:00.000Z", clientName: "林小安", clientEmail: "a@example.test", clientPhone: "0912345678", answers: {} };
    const [first, second] = await Promise.all([
      reserveConsultationBooking(database, request, (vendorId, email) => `${vendorId}:${email}`),
      reserveConsultationBooking(database, { ...request, clientName: "陳小明", clientEmail: "b@example.test" }, (vendorId, email) => `${vendorId}:${email}`),
    ]);
    expect([first.status, second.status].filter((status) => status === "booked")).toHaveLength(1);
    expect([first.status, second.status].filter((status) => status === "unavailable")).toHaveLength(1);
  });
});
