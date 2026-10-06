import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { decryptSensitiveValue } from "./sensitive-data";
import { getStudentCourse } from "./student-course-learning";
import { confirmLearnerConsultationReminder, listLearnerConsultationReminders } from "./learner-consultation-reminders";
vi.mock("./student-course-learning", () => ({ getStudentCourse: vi.fn() }));
const scope = { vendorId: "vendor-1", customerKeyHash: "a".repeat(43) };
const now = new Date("2026-10-08T06:00:00.000Z");
const booking = { id: "booking-1", startTime: new Date("2026-10-08T08:00:00.000Z"), event: { title: "Synthetic appointment" } };
const input = { bookingId: booking.id, expectedStartTime: booking.startTime.toISOString() };
function fixture() {
  const tx = { consultationBooking: { findFirst: vi.fn(async () => booking), findMany: vi.fn(async () => [booking]) },
    learnerNotificationPreference: { findFirst: vi.fn(async () => ({ id: "pref-1" })) }, vendor: { findUniqueOrThrow: vi.fn(async () => ({ slug: "academy" })) },
    learnerNotificationSourceEvent: { upsert: vi.fn(async () => ({ id: "source-1" })), findFirstOrThrow: vi.fn(async () => ({ availableAt: new Date("2026-10-08T07:00:00.000Z") })), findMany: vi.fn(async () => [] as Array<{ eventIdentity: string }>) } };
  const db = { ...tx, $transaction: vi.fn(async (run: (store: typeof tx) => unknown) => run(tx)) };
  return { tx, db };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv("CSRF_SECRET", "synthetic-consultation-reminder-encryption-key-32-bytes");
  vi.mocked(getStudentCourse).mockReset(); vi.mocked(getStudentCourse).mockResolvedValue({} as never);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it("invalid booking identity/contact override never opens a transaction", async () => {
  const f = fixture(); await expect(confirmLearnerConsultationReminder(f.db as never, scope, "course-1", { ...input, customerKeyHash: "b".repeat(43) })).rejects.toThrow(); expect(f.db.$transaction).not.toHaveBeenCalled();
});
it("revoked course rights refuse confirmation before reading private bookings", async () => {
  const f = fixture(); vi.mocked(getStudentCourse).mockResolvedValue(null); expect(await confirmLearnerConsultationReminder(f.db as never, scope, "course-1", input)).toEqual({ status: "not_found" }); expect(f.tx.consultationBooking.findFirst).not.toHaveBeenCalled();
});
it("missing or stale own booking refuses source creation", async () => {
  const f = fixture(); f.tx.consultationBooking.findFirst.mockResolvedValueOnce(null as never); expect((await confirmLearnerConsultationReminder(f.db as never, scope, "course-1", input)).status).toBe("not_found"); expect(f.tx.learnerNotificationSourceEvent.upsert).not.toHaveBeenCalled();
});
it("unverified or disabled consent refuses confirmation without implicit opt-in", async () => {
  const f = fixture(); f.tx.learnerNotificationPreference.findFirst.mockResolvedValueOnce(null as never); expect((await confirmLearnerConsultationReminder(f.db as never, scope, "course-1", input)).status).toBe("verification_required"); expect(f.tx.learnerNotificationSourceEvent.upsert).not.toHaveBeenCalled();
});
it("binds exact recipient, active project/course and expected future start within one transaction", async () => {
  const f = fixture(); expect(await confirmLearnerConsultationReminder(f.db as never, scope, "course-1", input)).toEqual({ status: "scheduled", availableAt: "2026-10-08T07:00:00.000Z" });
  expect(f.tx.consultationBooking.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ...scope, id: booking.id, status: "scheduled", startTime: { equals: booking.startTime, gt: now }, event: { is: expect.objectContaining({ vendorId: scope.vendorId, isActive: true, salesProject: { is: expect.objectContaining({ vendorId: scope.vendorId, status: "published", products: { some: { vendorId: scope.vendorId, productId: "course-1" } } }) } }) } }) }));
  const args = f.tx.learnerNotificationSourceEvent.upsert.mock.calls[0] as unknown as [{ create: Record<string, unknown>; update: Record<string, unknown> }]; const data = args[0].create;
  expect(data).toEqual(expect.objectContaining({ vendorId: scope.vendorId, productId: "course-1", audienceCustomerKeyHash: scope.customerKeyHash, event: "consultation_reminder", occurredAt: now, availableAt: new Date("2026-10-08T07:00:00.000Z") })); expect(args[0].update).toEqual({});
  const purpose = `learner-notification-source-v1:${JSON.stringify([scope.vendorId,"course-1","consultation_reminder",data.eventIdentity])}`;
  expect(JSON.parse(decryptSensitiveValue(String(data.payloadEncryptedEnvelope), purpose))).toEqual(expect.objectContaining({ consultationBooking: { id: booking.id, startTime: input.expectedStartTime, customerKeyHash: scope.customerKeyHash, confirmedAt: now.toISOString() } }));
});
it("confirming within an hour schedules immediate delivery rather than a past due time", async () => {
  const f = fixture(); const startTime = new Date(now.getTime() + 20 * 60000); f.tx.consultationBooking.findFirst.mockResolvedValueOnce({ ...booking, startTime }); await confirmLearnerConsultationReminder(f.db as never, scope, "course-1", { ...input, expectedStartTime: startTime.toISOString() });
  expect(f.tx.learnerNotificationSourceEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ occurredAt: now, availableAt: now }) }));
});
it.each(["P2002", "P2034"])("retries only bounded transactional conflict %s before provider work", async code => {
  const f = fixture(); f.db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("synthetic conflict", { code, clientVersion: "synthetic" })); expect((await confirmLearnerConsultationReminder(f.db as never, scope, "course-1", input)).status).toBe("scheduled"); expect(f.db.$transaction).toHaveBeenCalledTimes(2);
});
it("conflict budget ends after three attempts", async () => {
  const f = fixture(); f.db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("synthetic conflict", { code: "P2034", clientVersion: "synthetic" })); await expect(confirmLearnerConsultationReminder(f.db as never, scope, "course-1", input)).rejects.toThrow(); expect(f.db.$transaction).toHaveBeenCalledTimes(3);
});
it("unrelated errors do not replay confirmation", async () => {
  const f = fixture(); f.db.$transaction.mockRejectedValueOnce(new Error("synthetic persistence fault")); await expect(confirmLearnerConsultationReminder(f.db as never, scope, "course-1", input)).rejects.toThrow(); expect(f.db.$transaction).toHaveBeenCalledTimes(1);
});
it("unowned course list never reads private appointments", async () => {
  const f = fixture(); vi.mocked(getStudentCourse).mockResolvedValue(null); expect(await listLearnerConsultationReminders(f.db as never, scope, "course-1")).toBeNull(); expect(f.tx.consultationBooking.findMany).not.toHaveBeenCalled();
});
it("rejects traversal cursors before reading appointments", async () => {
  const f = fixture(); await expect(listLearnerConsultationReminders(f.db as never, scope, "course-1", "../foreign")).rejects.toThrow(); expect(f.tx.consultationBooking.findMany).not.toHaveBeenCalled();
});
it("lists twenty exact own appointments and advances the bounded cursor without contact data", async () => {
  const f = fixture(); f.tx.consultationBooking.findMany.mockResolvedValueOnce(Array.from({ length: 21 }, (_, index) => ({ ...booking, id: `booking-${String(index).padStart(2,"0")}` })));
  const session = { ...scope, issuedAt: now, expiresAt: new Date(now.getTime() + 60000) };
  const result = await listLearnerConsultationReminders(f.db as never, session, "course-1", "prior"); expect(result?.bookings).toHaveLength(20); expect(result?.nextAfter).toBe("booking-19");
  expect(f.tx.consultationBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ...scope, id: { gt: "prior" }, status: "scheduled", startTime: { gt: now } }), take: 21, select: { id: true, startTime: true, event: { select: { title: true } } } }));
  expect(result?.bookings[0]).toEqual({ id: "booking-00", startTime: booking.startTime.toISOString(), title: booking.event.title, confirmed: false });
});
it("empty booking page exposes neither recipient identifiers nor a continuation cursor", async () => {
  const f = fixture(); f.tx.consultationBooking.findMany.mockResolvedValueOnce([]); expect(await listLearnerConsultationReminders(f.db as never, scope, "course-1")).toEqual({ bookings: [], nextAfter: null });
});
