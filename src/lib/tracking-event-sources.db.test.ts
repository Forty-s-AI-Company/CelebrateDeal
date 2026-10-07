import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { saveTrackingCredentialConfiguration } from "@/lib/tracking-settings";
import { enqueueAuthoritativeTrackingEvent } from "@/lib/tracking-event-outbox";
import { runPurchaseTrackingBatch } from "@/lib/tracking-purchase-worker";
import { verifyFormSubmission } from "@/lib/form-submission-verification-domain";
import { createFormSubmissionVerificationToken } from "@/lib/form-submission-verification";
import { reserveConsultationBooking, type ConsultationDatabase } from "@/app/actions/consultation-actions";

const db = getDb();
const context = { sourceUrl: "https://tracking.example.test/live/synthetic", userAgent: "SyntheticTrackingBrowser/1.0" };
beforeEach(() => vi.stubEnv("CSRF_SECRET", "synthetic-tracking-encryption-key-at-least-32-bytes"));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function fixture() {
  const id = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic source shop", slug: `source-${id}`, email: `${id}@example.test`, passwordHash: "synthetic-only" } });
  await saveTrackingCredentialConfiguration(vendor.id, { expectedRevision: 0, token: "synthetic-meta-source-token", testEventCode: "TEST_SOURCES", clearToken: false });
  await db.trackingSetting.update({ where: { vendorId: vendor.id }, data: { facebookPixelId: "123456789" } });
  const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "Synthetic form", slug: `source-form-${id}`, headline: "Synthetic only", fields: [] } });
  const submission = await db.formSubmission.create({ data: { formId: form.id, name: "Synthetic buyer", email: "tracking-source-buyer@example.test", verificationStatus: "VERIFIED", verifiedAt: new Date(), verificationExpiresAt: new Date(Date.now() + 60_000) } });
  const live = await db.live.create({ data: { vendorId: vendor.id, title: "Synthetic live", slug: `source-live-${id}`, formId: form.id, status: "scheduled", scheduledAt: new Date() } });
  const event = await db.analyticsEvent.create({ data: { vendorId: vendor.id, liveId: live.id, trustLevel: "ADMITTED_LIVE_SESSION", visitorId: createHash("sha256").update(id).digest("hex"), eventType: "page_view", payload: { slug: live.slug } } });
  const calendar = await db.consultationEvent.create({ data: { vendorId: vendor.id, title: "Synthetic consultation", weeklySchedule: [], intakeFormFields: [] } });
  const booking = await db.consultationBooking.create({ data: { vendorId: vendor.id, eventId: calendar.id, clientName: "Synthetic buyer", clientEmail: "tracking-source-buyer@example.test", clientPhone: "0900000000", startTime: new Date(Date.now() + 60_000), endTime: new Date(Date.now() + 1_860_000) } });
  return { vendor, form, submission, live, event, calendar, booking };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const sourceId = (f: Fixture, name: "Lead" | "ViewContent" | "Schedule") => name === "Lead" ? f.submission.id : name === "ViewContent" ? f.event.id : f.booking.id;
const enqueue = (f: Fixture, name: "Lead" | "ViewContent" | "Schedule", id = sourceId(f, name)) => db.$transaction(tx => enqueueAuthoritativeTrackingEvent(tx, { vendorId: f.vendor.id, eventName: name, sourceId: id, context }));
const run = (f: Fixture) => runPurchaseTrackingBatch({ vendorId: f.vendor.id, apiVersion: "v22.0" });

it.each(["Lead", "ViewContent", "Schedule"] as const)("%s persists one encrypted tenant-bound source and keeps retries idempotent", async name => {
  const f = await fixture(); await Promise.all([enqueue(f, name), enqueue(f, name)]);
  const rows = await db.trackingDelivery.findMany({ where: { vendorId: f.vendor.id } });
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ eventName: name, status: "queued", attemptCount: 0 });
  expect(JSON.stringify(rows)).not.toContain(context.userAgent); expect(JSON.stringify(rows)).not.toContain("tracking-source-buyer@example.test");
});
it("an unverified registration cannot become Lead", async () => {
  const f = await fixture(); await db.formSubmission.update({ where: { id: f.submission.id }, data: { verificationStatus: "UNVERIFIED", verifiedAt: null } });
  expect(await enqueue(f, "Lead")).toBeNull(); expect(await db.trackingDelivery.count({ where: { vendorId: f.vendor.id } })).toBe(0);
});
it("the real email verification domain atomically queues exactly one Lead", async () => {
  const f = await fixture(); await db.formSubmission.update({ where: { id: f.submission.id }, data: { verificationStatus: "UNVERIFIED", verifiedAt: null } });
  const token = createFormSubmissionVerificationToken({ submissionId: f.submission.id, version: 1, expiresAt: f.submission.verificationExpiresAt! });
  expect((await verifyFormSubmission(db, token, new Date(), context)).status).toBe("verified");
  expect((await verifyFormSubmission(db, token, new Date(), context)).status).toBe("already_verified");
  expect(await db.trackingDelivery.findMany({ where: { vendorId: f.vendor.id } })).toMatchObject([{ eventName: "Lead", submissionId: f.submission.id, formId: f.form.id }]);
});
it("deduplicates ViewContent across different analytics rows for the same admitted session/page", async () => {
  const f = await fixture();
  const retry = await db.analyticsEvent.create({ data: { vendorId: f.vendor.id, liveId: f.live.id, trustLevel: "ADMITTED_LIVE_SESSION", visitorId: f.event.visitorId, eventType: "page_view", payload: f.event.payload! } });
  await Promise.all([enqueue(f, "ViewContent"), enqueue(f, "ViewContent", retry.id)]);
  expect(await db.trackingDelivery.count({ where: { vendorId: f.vendor.id } })).toBe(1);
  await db.analyticsEvent.update({ where: { id: retry.id }, data: { trustLevel: "LEGACY_UNVERIFIED" } });
  expect(await enqueue(f, "ViewContent", retry.id)).toBeNull();
});
it.each(["Lead", "ViewContent", "Schedule"] as const)("%s refuses foreign source lookup and the database rejects a forged tenant/source pair", async name => {
  const a = await fixture(), b = await fixture();
  expect(await enqueue(b, name, sourceId(a, name))).toBeNull();
  const source = name === "Lead" ? { formId: b.form.id, submissionId: a.submission.id } : name === "ViewContent" ? { analyticsEventId: a.event.id } : { bookingId: a.booking.id };
  await expect(db.trackingDelivery.create({ data: { vendorId: b.vendor.id, eventName: name, eventId: `foreign:${randomUUID()}`, credentialRevision: 1, pixelId: "123456789", ...source } })).rejects.toMatchObject({ code: "P2003" });
  expect(await db.trackingDelivery.count({ where: { vendorId: b.vendor.id } })).toBe(0);
});
it("all three new events share conditional claims and deliver hashed source identities with simulated HTTP only", async () => {
  const f = await fixture(); for (const name of ["Lead", "ViewContent", "Schedule"] as const) await enqueue(f, name);
  const fetchMock = vi.fn().mockImplementation(async () => new Response('{"events_received":1}', { status: 200 })); vi.stubGlobal("fetch", fetchMock);
  const results = await Promise.all([run(f), run(f)]);
  expect(results.reduce((total, result) => total + result.accepted, 0)).toBe(3); expect(fetchMock).toHaveBeenCalledTimes(3);
  const events = fetchMock.mock.calls.map(call => JSON.parse(call[1].body).data[0]);
  expect(events.map(event => event.event_name).sort()).toEqual(["Lead", "Schedule", "ViewContent"]);
  for (const event of events) { expect(event.event_source_url).toBe(context.sourceUrl); expect(event.user_data.client_user_agent).toBe(context.userAgent); expect(event.user_data.external_id[0]).toMatch(/^[a-f0-9]{64}$/u); }
  expect(JSON.stringify(events)).not.toContain(f.submission.email); await run(f); expect(fetchMock).toHaveBeenCalledTimes(3);
});
it("cancels a booking before any provider request when the actual reservation is cancelled", async () => {
  const f = await fixture(); await enqueue(f, "Schedule"); await db.consultationBooking.update({ where: { id: f.booking.id }, data: { status: "cancelled" } });
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); expect(await run(f)).toMatchObject({ cancelled: 1 }); expect(fetchMock).not.toHaveBeenCalled();
});
it("rolls all new event types back with the owning domain transaction", async () => {
  const f = await fixture();
  await expect(db.$transaction(async tx => { for (const name of ["Lead", "ViewContent", "Schedule"] as const) await enqueueAuthoritativeTrackingEvent(tx, { vendorId: f.vendor.id, eventName: name, sourceId: sourceId(f, name), context }); throw new Error("synthetic rollback"); })).rejects.toThrow("synthetic rollback");
  expect(await db.trackingDelivery.count({ where: { vendorId: f.vendor.id } })).toBe(0);
});
it("rejects mixed and missing source pointers at the database boundary", async () => {
  const f = await fixture();
  for (const source of [{ submissionId: f.submission.id }, { formId: f.form.id, submissionId: f.submission.id, analyticsEventId: f.event.id }]) {
    await expect(db.trackingDelivery.create({ data: { vendorId: f.vendor.id, eventName: "Lead", eventId: `invalid:${randomUUID()}`, credentialRevision: 1, pixelId: "123456789", ...source } })).rejects.toThrow();
  }
});
it("rejects a tampered context without leaking it or contacting the provider", async () => {
  const f = await fixture(); const row = await enqueue(f, "Lead");
  await db.trackingDelivery.updateMany({ where: { vendorId: f.vendor.id }, data: { contextEncrypted: "synthetic-invalid-envelope" } });
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); expect(await run(f)).toMatchObject({ rejected: 1 }); expect(fetchMock).not.toHaveBeenCalled();
  expect(row).not.toBeNull();
});
it("honors the page-view toggle both before enqueue and before worker delivery", async () => {
  const f = await fixture(); await enqueue(f, "ViewContent");
  await db.trackingSetting.update({ where: { vendorId: f.vendor.id }, data: { enablePageView: false } });
  expect(await enqueue(f, "ViewContent")).toBeNull(); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); expect(await run(f)).toMatchObject({ cancelled: 1 }); expect(fetchMock).not.toHaveBeenCalled();
});
it("the real serializable consultation reservation atomically creates Schedule", async () => {
  const f = await fixture();
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 2); start.setUTCHours(9, 0, 0, 0);
  await db.consultationEvent.update({ where: { id: f.calendar.id }, data: { timezone: "UTC", weeklySchedule: [{ day: start.getUTCDay(), ranges: ["09:00-10:00"] }], durationMinutes: 30 } });
  const result = await reserveConsultationBooking(db as unknown as ConsultationDatabase, { eventId: f.calendar.id, startTime: start.toISOString(), clientName: "Synthetic reservation", clientEmail: "actual-reservation@example.test", clientPhone: "0900000000", answers: {} }, undefined, context);
  expect(result.status).toBe("booked"); if (result.status !== "booked") throw new Error("Synthetic reservation did not complete.");
  expect(await db.trackingDelivery.findFirstOrThrow({ where: { vendorId: f.vendor.id } })).toMatchObject({ eventName: "Schedule", bookingId: result.booking.id });
});
it("real booking preserves published-project and cross-tenant isolation before any reservation/outbox write", async () => {
  const f = await fixture(), foreign = await fixture();
  const project = await db.salesProject.create({ data: { vendorId: f.vendor.id, name: "Synthetic consultation project", slug: randomUUID(), mode: "consulting", primaryFlow: "consultation", status: "draft" } });
  const otherProject = await db.salesProject.create({ data: { vendorId: foreign.vendor.id, name: "Foreign synthetic project", slug: randomUUID(), mode: "consulting", primaryFlow: "consultation" } });
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 2); start.setUTCHours(9, 0, 0, 0);
  await db.consultationEvent.update({ where: { id: f.calendar.id }, data: { projectId: project.id, timezone: "UTC", weeklySchedule: [{ day: start.getUTCDay(), ranges: ["09:00-10:00"] }] } });
  const input = { eventId: f.calendar.id, startTime: start.toISOString(), clientName: "Synthetic project buyer", clientEmail: "project-reservation@example.test", clientPhone: "0900000000", answers: {} };
  expect((await reserveConsultationBooking(db as unknown as ConsultationDatabase, input, undefined, context)).status).toBe("unavailable");
  await db.salesProject.update({ where: { id: project.id }, data: { status: "published", publishedAt: null } });
  expect((await reserveConsultationBooking(db as unknown as ConsultationDatabase, input, undefined, context)).status).toBe("unavailable");
  expect(await db.trackingDelivery.count({ where: { vendorId: f.vendor.id } })).toBe(0);
  await expect(db.consultationEvent.update({ where: { id: f.calendar.id }, data: { projectId: otherProject.id } })).rejects.toMatchObject({ code: "P2003" });
  await db.salesProject.update({ where: { id: project.id }, data: { publishedAt: new Date() } });
  expect((await reserveConsultationBooking(db as unknown as ConsultationDatabase, input, undefined, context)).status).toBe("booked");
  expect(await db.salesProjectCustomer.count({ where: { vendorId: f.vendor.id, projectId: project.id } })).toBe(1);
  expect(await db.trackingDelivery.count({ where: { vendorId: f.vendor.id, eventName: "Schedule" } })).toBe(1);
});


it.each(["P1001", "P2024"])("source database %s schedules a bounded retry then delivers once with the original event identity", async code => {
  const f = await fixture(); const row = await enqueue(f, "Lead");
  vi.spyOn(db.formSubmission, "findFirst").mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Synthetic temporary database failure", { code, clientVersion: "synthetic" }));
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"events_received":1}', { status: 200 })); vi.stubGlobal("fetch", fetchMock);
  expect(await run(f)).toMatchObject({ claimed: 1, retried: 1, rejected: 0 });
  expect(fetchMock).not.toHaveBeenCalled();
  const retry = await db.trackingDelivery.findUniqueOrThrow({ where: { id: row!.id } });
  expect(retry).toMatchObject({ status: "queued", attemptCount: 1, leaseToken: null, eventId: row!.eventId });
  expect(retry.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  expect(await runPurchaseTrackingBatch({ vendorId: f.vendor.id, apiVersion: "v22.0", now: new Date(retry.nextAttemptAt.getTime() + 1) })).toMatchObject({ accepted: 1 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).data[0].event_id).toBe(row!.eventId);
  await run(f); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("the eighth temporary source failure terminates without a provider call or ninth attempt", async () => {
  const f = await fixture(); const row = await enqueue(f, "Lead");
  await db.trackingDelivery.update({ where: { id: row!.id }, data: { attemptCount: 7 } });
  vi.spyOn(db.formSubmission, "findFirst").mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Synthetic temporary database failure", { code: "P1001", clientVersion: "synthetic" }));
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect(await run(f)).toMatchObject({ claimed: 1, rejected: 1, retried: 0 });
  expect(await db.trackingDelivery.findUniqueOrThrow({ where: { id: row!.id } })).toMatchObject({ status: "rejected", attemptCount: 8, leaseToken: null });
  expect(await run(f)).toMatchObject({ claimed: 0 }); expect(fetchMock).not.toHaveBeenCalled();
});
