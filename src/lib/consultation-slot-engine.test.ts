import { describe, expect, it } from "vitest";
import { generateConsultationSlots } from "@/lib/consultation-slot-engine";

const event = (overrides = {}) => ({
  weeklySchedule: { "1": [{ start: "09:00", end: "11:00" }] },
  durationMinutes: 30,
  bufferMinutes: 0,
  dailyLimit: null,
  ...overrides,
});

describe("consultation slot engine", () => {
  it("accepts the canonical weekly schedule array with day and ranges", () => {
    const slots = generateConsultationSlots({
      event: event({ weeklySchedule: [{ day: 1, ranges: ["14:00-15:00"] }] }),
      from: new Date("2026-09-07T00:00:00Z"),
      to: new Date("2026-09-08T00:00:00Z"),
    });
    expect(slots.map((slot) => slot.startTime.toISOString())).toEqual([
      "2026-09-07T14:00:00.000Z",
      "2026-09-07T14:30:00.000Z",
    ]);
  });

  it("generates slots for the configured weekday and skips other weekdays", () => {
    const slots = generateConsultationSlots({
      event: event(),
      from: new Date("2026-09-07T00:00:00Z"),
      to: new Date("2026-09-09T00:00:00Z"),
    });
    expect(slots.map((slot) => slot.startTime.toISOString())).toEqual([
      "2026-09-07T09:00:00.000Z", "2026-09-07T09:30:00.000Z",
      "2026-09-07T10:00:00.000Z", "2026-09-07T10:30:00.000Z",
    ]);
  });

  it("honours buffer time between starts", () => {
    const slots = generateConsultationSlots({ event: event({ bufferMinutes: 15 }), from: new Date("2026-09-07"), to: new Date("2026-09-08") });
    expect(slots.map((slot) => slot.startTime.toISOString())).toEqual([
      "2026-09-07T09:00:00.000Z", "2026-09-07T09:45:00.000Z", "2026-09-07T10:30:00.000Z",
    ]);
  });

  it("applies dailyLimit to existing and newly generated bookings", () => {
    const slots = generateConsultationSlots({
      event: event({ dailyLimit: 2 }), from: new Date("2026-09-07"), to: new Date("2026-09-08"),
      bookings: [{ startTime: new Date("2026-09-07T08:00:00Z"), endTime: new Date("2026-09-07T08:30:00Z"), status: "scheduled" }],
    });
    expect(slots).toHaveLength(1);
  });

  it("does not emit a slot crossing midnight or the requested range", () => {
    const slots = generateConsultationSlots({
      event: event({ weeklySchedule: { "1": [{ start: "23:30", end: "23:59" }] }, durationMinutes: 30 }),
      from: new Date("2026-09-07T00:00:00Z"), to: new Date("2026-09-08T00:00:00Z"),
    });
    expect(slots).toEqual([]);
  });

  it("treats cancelled and no-show bookings as available, but blocks active overlap", () => {
    const base = { startTime: new Date("2026-09-07T09:00:00Z"), endTime: new Date("2026-09-07T09:30:00Z") };
    const available = generateConsultationSlots({ event: event(), from: new Date("2026-09-07"), to: new Date("2026-09-08"), bookings: [{ ...base, status: "cancelled" }] });
    expect(available[0]?.startTime.toISOString()).toBe("2026-09-07T09:00:00.000Z");
    const blocked = generateConsultationSlots({ event: event(), from: new Date("2026-09-07"), to: new Date("2026-09-08"), bookings: [{ ...base, status: "scheduled" }] });
    expect(blocked[0]?.startTime.toISOString()).toBe("2026-09-07T09:30:00.000Z");
  });
});
