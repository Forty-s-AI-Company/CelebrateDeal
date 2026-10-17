import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { metricVideoFingerprint } from "./live-metric-version";
import { createEmailRecipientHash, revealEmailDeliveryPayload } from "./email-delivery-pii";
import { completedFollowupDeliveryId, completedFollowupDeliveryKey, isCurrentCompletedFollowupDelivery, processDueCompletedFollowups, readCompletedFollowupSource } from "./completed-followup";
const monitoring = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: monitoring.capture }));
const now = new Date("2026-10-16T06:00:00Z");
const scope = { vendorId: "vendor-1", liveId: "live-1", submissionId: "submission-1" };
const ref = { ...scope, reportId: "report-1", ruleId: "rule-1", ruleVersion: 2 };
const video = { id: "video-1", vendorId: scope.vendorId, sourceType: "url", videoUrl: "https://example.test/video.mp4", durationSec: 100,
  cloudflareStreamUid: null, cloudflareLiveInputUid: null, cloudflarePlaybackId: null };
const row = { personId: "registration-1", completedAtMs: +now-1000, email: "buyer@example.test", slug: "live-slug", fingerprint: metricVideoFingerprint(video),
  durationMs: 100000, ...video, videoId: video.id, videoVendorId: video.vendorId };
function database() {
  const mode = { isolation: "repeatable read", current: true, ready: true, eligible: true, ordered: false, unknownOrder: false, row: { ...row } };
  const query = vi.fn(async (sql: Prisma.Sql) => {
    if (sql.sql.includes("current_setting")) return [{ isolation: mode.isolation }];
    if (sql.sql.includes("set_config")) return [];
    if (sql.sql.includes("WITH ready_reports")) return [{ ...ref, tried: null, completed: row.completedAtMs }];
    if (sql.sql.includes("SELECT video.id")) return [video];
    if (sql.sql.includes("SELECT fresh.id")) return mode.current ? [{ id: "fresh-report", versionId: "version-1" }] : [];
    if (sql.sql.includes("SELECT r.result")) return mode.ready ? [{ result: { completionRate: { status: "available" } } }] : [];
    if (sql.sql.includes('AS "personId"')) return mode.eligible ? [mode.row] : [];
    if (sql.sql.includes("SELECT EXISTS")) return [{ exists: mode.ordered, attributionUnknown: mode.unknownOrder }];
    if (sql.sql.includes('FROM "FormSubmission" WHERE')) return [{ id: scope.submissionId }];
    throw new Error("Unexpected test query");
  });
  const tx = { $queryRaw: query, emailDelivery: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "queued" }) },
    automationExecutionLog: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ id: "execution" }) } };
  const db = { $queryRaw: vi.fn().mockResolvedValue([{ ...ref, tried: null, completed: row.completedAtMs }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    automationExecutionLog: { upsert: vi.fn().mockResolvedValue({ id: "failure" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
  return { mode, tx, db };
}
function delivery() { return { id: completedFollowupDeliveryId(scope), vendorId: scope.vendorId, sourceLiveId: scope.liveId, sourceFormSubmissionId: scope.submissionId,
  trigger: "completed_followup", idempotencyKey: completedFollowupDeliveryKey(ref), recipientHash: createEmailRecipientHash(row.email, scope.vendorId) }; }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CSRF_SECRET", "wp18-owned-synthetic-completion-key-20261016"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test"); });
afterEach(() => vi.unstubAllEnvs());

describe("trusted completed/not-ordered followup", () => {
  it("uses distinct vendor outbox keys for different eligible recipients in the same report/rule", () => {
    expect(completedFollowupDeliveryKey(ref)).not.toBe(completedFollowupDeliveryKey({ ...ref, submissionId: "other-submission" }));
  });
  it("reads current ready completion provenance and rechecks established orders in the same RR snapshot", async () => {
    const { tx } = database(); const result = await readCompletedFollowupSource(tx as never, ref, now);
    expect(result).toMatchObject({ status: "eligible", recipientEmail: row.email });
    const sql = tx.$queryRaw.mock.calls.map(c => c[0] as Prisma.Sql);
    expect(sql.find(s => s.sql.includes('AS "personId"'))?.sql).toContain('g."verifiedAt"=f."verifiedAt"');
    expect(sql.find(s => s.sql.includes('SELECT EXISTS'))?.sql).toContain("o.status<>'draft'");
    expect(sql.find(s => s.sql.includes('SELECT EXISTS'))?.values).toContain(scope.vendorId);
    expect(sql.find(s => s.sql.includes('SELECT EXISTS'))?.sql).toContain('buyer."liveId"=payment.metadata');
  });
  it("requires RR rather than mixing independent committed snapshots", async () => {
    const { tx, mode } = database(); mode.isolation = "read committed";
    await expect(readCompletedFollowupSource(tx as never, ref, now)).rejects.toThrow("repeatable-read");
  });
  it.each(["current", "ready"] as const)("keeps a missing %s source unavailable, never evidence of completion", async key => {
    const { tx, mode } = database(); mode[key] = false;
    await expect(readCompletedFollowupSource(tx as never, ref, now)).resolves.toEqual({ status: "unavailable" });
  });
  it("treats any established attributed order as already ordered", async () => {
    const { tx, mode } = database(); mode.ordered = true;
    await expect(readCompletedFollowupSource(tx as never, ref, now)).resolves.toEqual({ status: "ineligible" });
  });
  it("never infers no order from an unclassified legacy/partial order", async () => {
    const { tx, mode } = database(); mode.unknownOrder = true;
    await expect(readCompletedFollowupSource(tx as never, ref, now)).resolves.toEqual({ status: "unavailable" });
  });
  it.each(["fingerprint", "future", "expired", "invalid-email"])("rejects %s source facts", async kind => {
    const { tx, mode } = database();
    if (kind === "fingerprint") mode.row.fingerprint = "0".repeat(64);
    if (kind === "future") mode.row.completedAtMs = +now+1;
    if (kind === "expired") mode.row.completedAtMs = +now-8*86_400_000;
    if (kind === "invalid-email") mode.row.email = "invalid";
    await expect(readCompletedFollowupSource(tx as never, ref, now)).resolves.toEqual({ status: "ineligible" });
  });
  it("binds send-time identity and recipient to current source inside RR", async () => {
    const { db } = database(); await expect(isCurrentCompletedFollowupDelivery(delivery(), db as never, now)).resolves.toBe(true);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 10000 });
    await expect(isCurrentCompletedFollowupDelivery({ ...delivery(), recipientHash: createEmailRecipientHash("other@example.test", scope.vendorId) }, db as never, now)).resolves.toBe(false);
  });
  it.each(["id", "sourceLiveId", "sourceFormSubmissionId", "idempotencyKey", "recipientHash"])("rejects malformed %s binding before transaction", async key => {
    const { db } = database(); await expect(isCurrentCompletedFollowupDelivery({ ...delivery(), [key]: "invalid" }, db as never, now)).resolves.toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("keeps old notification triggers independent from completion DB methods", async () => {
    await expect(isCurrentCompletedFollowupDelivery({ ...delivery(), trigger: "registration_confirmed" }, {})).resolves.toBe(true);
  });
  it("queues encrypted payload and execution receipt atomically, once across rules/report generations", async () => {
    const { db, tx } = database(); await expect(processDueCompletedFollowups(db as never, { now })).resolves.toEqual([{ status: "queued" }]);
    const data = tx.emailDelivery.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ id: completedFollowupDeliveryId(scope), sourceLiveId: scope.liveId, sourceFormSubmissionId: scope.submissionId, trigger: "completed_followup" });
    const payload = revealEmailDeliveryPayload(data.payloadEncryptedEnvelope, { vendorId: scope.vendorId, deliveryId: data.id });
    expect(payload.recipientEmail).toBe(row.email); expect(payload.body).toContain("/live/live-slug"); expect(payload.body).toContain("/unsubscribe?");
    expect(JSON.stringify(tx.emailDelivery.create.mock.calls)).not.toContain(row.email);
    expect(tx.automationExecutionLog.upsert.mock.calls[0][0].create.status).toBe("completed");
  });
  it("does not requeue an existing order-scoped notification", async () => {
    const { db, tx } = database(); tx.emailDelivery.findUnique.mockResolvedValue({ id: "existing" });
    await expect(processDueCompletedFollowups(db as never, { now })).resolves.toEqual([{ status: "duplicate" }]); expect(tx.emailDelivery.create).not.toHaveBeenCalled();
  });
  it("permanently skips ordered/ineligible sources, with no outbox side effect", async () => {
    const { db, tx, mode } = database(); mode.ordered = true;
    await expect(processDueCompletedFollowups(db as never, { now })).resolves.toEqual([{ status: "superseded" }]);
    expect(tx.emailDelivery.create).not.toHaveBeenCalled(); expect(tx.automationExecutionLog.upsert.mock.calls[0][0].create.status).toBe("skipped");
  });
  it("defers unavailable reports and still processes later pairs if the failure receipt fails", async () => {
    const { db, mode, tx } = database(); mode.current = false; const original = tx.$queryRaw.getMockImplementation()!;
    tx.$queryRaw.mockImplementation(sql => sql.sql.includes("WITH ready_reports")
      ? Promise.resolve([{ ...ref, tried: null, completed: row.completedAtMs }, { ...ref, tried: null, completed: row.completedAtMs }]) : original(sql));
    db.automationExecutionLog.upsert.mockRejectedValue(new Error("synthetic ledger unavailable"));
    await expect(processDueCompletedFollowups(db as never, { now })).resolves.toEqual([{ status: "failed" }, { status: "failed" }]);
    expect(monitoring.capture).toHaveBeenCalledTimes(2); expect(monitoring.capture.mock.calls[0][0].message).toBe("Completed follow-up unavailable");
  });
  it.each([0, 101, -1, 1.5])("rejects invalid batch limit %s before DB access", async limit => {
    const { db } = database(); await expect(processDueCompletedFollowups(db as never, { limit })).rejects.toThrow(); expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
