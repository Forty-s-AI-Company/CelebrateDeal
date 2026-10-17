import { verifyRegistrationJob } from "./wp20-registration-job-disposable.mjs";
import assert from "node:assert/strict";
import { verifyIntegratedVisitBrowser } from "./wp20-visit-integrated-browser.mjs";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { main } from "./prisma-loopback-disposable-migration-runner.mjs";

const root = process.cwd();
const output = path.join(root, "docs/ai-team/evidence/product-audit-20261011/WP-20/persistence");
const checks = [];
let checkStage = null;
let loadMetrics = null;
let indexMetrics = null;
let visitDeletionMetrics = null;
let orderContentionMetrics = null;
const registrationClockDiagnostics = [];
const serializationDiagnostics = [];
// Persist only fixed classifications from owned synthetic execution, never raw error text.
function recordSerialization(error, attempt, phase) {
  const message = String(error?.meta?.message ?? "") + String(error?.message ?? "");
  const reason = /pivot.*commit|commit.*pivot/i.test(message) ? "pivot_at_commit"
    : /pivot/i.test(message) ? "pivot_other"
    : /read.write dependencies/i.test(message) ? "read_write_dependency"
    : /concurrent update/i.test(message) ? "concurrent_update"
    : /deadlock detected/i.test(message) ? "deadlock_detected"
    : "provider_reason_not_exposed";
  serializationDiagnostics.push({attempt: attempt + 1, phase, code: diagnostic(error), reason});
}
const tables = new Set(["LiveMetricOrderSource", "LiveMetricCoverageAudit", "LiveMetricRegistrationCapture", "LiveMetricVisitLoss", "LiveMetricVisit", "LiveMetricVersion", "LiveMetricVisitor", "LiveMetricRegistration", "LiveMetricSession", "LiveMetricInterval", "LiveMetricReport"]);
const require = createRequire(import.meta.url);

function diagnostic(error) {
  const code = error?.meta?.code ?? error?.code;
  return typeof code === "string" && /^(?:P\d{4}|[0-9A-Z]{5})$/u.test(code) ? code : "ASSERTION_OR_RUNNER_ERROR";
}
async function check(name, run) {
  try { checkStage = null; await run(); checks.push({ name, status: "PASS" }); }
  catch (error) { checks.push({ name, status: "FAIL", code: diagnostic(error), stage: checkStage, statuses: [error?.actual?.status, error?.expected?.status, error?.actual, error?.expected].map(value => ["recorded", "identity_conflict", "pending_clock", "clock_order_conflict", "pending_verification", "outside_retention", "missing_capture", "captured", "unavailable", "incomplete", "source_changed"].includes(value) ? value : null), errorType: ["AssertionError", "MetricIngestError", "MetricSessionLimitError", "Error", "TypeError", "PrismaClientValidationError", "PrismaClientUnknownRequestError"].includes(error?.name) ? error.name : "OTHER", differingReceiptFields: ["sessionId", "versionId", "anchorAtMs", "expiresAtMs", "durationMs", "lastSequence", "lastElapsedMs"].filter(key => error?.actual && error?.expected && error.actual[key] !== error.expected[key]), guard: ["LiveMetricInterval_values_check", "LiveMetricSession_state_check", "LiveMetricReport_state_check", "metric progress requires stored interval", "metric intervals must be contiguous and nonoverlapping", "metric interval scope or lifetime invalid", "metric session outside server lifetime", "active scoped metric admission required", "metric report input is stale", "metric report requires worker function", "metric report window must have ended", "metric completion requires all stored intervals"].find((message) => String(error?.meta?.message ?? "").includes(message)) ?? null, assertion: typeof error?.actual === "number" && typeof error?.expected === "number" ? { actual: error.actual, expected: error.expected } : null }); throw new Error("wp20-persistence-check-failed"); }
}
async function rejected(run, codes = ["23514", "23503"]) {
  try { await run(); } catch (error) { assert.ok(codes.includes(diagnostic(error)), "Unexpected rejection category"); return; }
  assert.fail("Unsafe write was accepted");
}
function insert(db, table, row) {
  // Direct synthetic fixtures use their stable UUID as the request key too.
  if (table === "LiveMetricVisit" && row.eventId === undefined) row = { ...row, eventId: row.id };
  assert.ok(tables.has(table));
  if (table === "LiveMetricReport") return db.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamp,$6::timestamp,$7::bigint,$8::timestamp)', row.vendorId, row.liveId, row.versionId, row.id, row.windowStartAt, row.windowEndAt, row.inputRevision, row.expiresAt);
  const keys = Object.keys(row);
  assert.ok(keys.every((key) => /^[a-zA-Z]+$/u.test(key)));
  return db.$executeRawUnsafe(`INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, ...Object.values(row));
}
async function revision(db, id) {
  const rows = await db.$queryRawUnsafe('SELECT "sourceRevision" FROM "LiveMetricVersion" WHERE id=$1', id);
  return rows[0].sourceRevision;
}

async function fixture(db, suffix, now, initialCapture = false) {
  const vendor = await db.vendor.create({ data: { name: "Synthetic metric", slug: `metric-${suffix}`, email: `metric-${suffix}@example.test`, passwordHash: "synthetic-unused" } });
  const video = await db.video.create({ data: { vendorId: vendor.id, title: "Synthetic", videoUrl: "https://example.test/synthetic.mp4", durationSec: 100 } });
  const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "Synthetic", slug: `metric-${suffix}`, headline: "Synthetic", fields: [] } });
  const live = await db.live.create({ data: { vendorId: vendor.id, videoId: video.id, formId: form.id, title: "Synthetic", slug: `metric-${suffix}`, scheduledAt: now } });
  let verifiedAt = new Date(+now - 15000);
  const submission = await db.formSubmission.create({ data: { formId: form.id, liveId: live.id, name: "Synthetic", email: `viewer-${suffix}@example.test`, verificationStatus: initialCapture ? "UNVERIFIED" : "VERIFIED", verifiedAt: initialCapture ? null : verifiedAt } });
  const admission = await db.liveViewerSession.create({ data: { vendorId: vendor.id, liveId: live.id, tokenHash: suffix.repeat(64), createdAt: new Date(+now - 12000), lastSeenAt: now, expiresAt: new Date(+now + 3600000) } });
  const version = { id: `version-${suffix}`, vendorId: vendor.id, liveId: live.id, videoId: video.id, mode: "replay", fingerprint: suffix.repeat(64), durationMs: 100000, collectionEnabled: true, collectionStartedAt: new Date(+now - 20000), expiresAt: new Date(+now + 3600000) };
  await insert(db, "LiveMetricVersion", version);
  const visitor = { id: `visitor-${suffix}`, vendorId: vendor.id, liveId: live.id, versionId: version.id, browserHash: suffix.repeat(64), firstVisitedAt: new Date(+now - 18000) };
  await insert(db, "LiveMetricVisitor", visitor);
  if (initialCapture) {
    await insert(db,"LiveMetricRegistrationCapture",{submissionId:submission.id,vendorId:vendor.id,liveId:live.id,versionId:version.id,visitorId:visitor.id});
    const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
    verifiedAt=clock.now;
    await db.formSubmission.update({where:{id:submission.id},data:{verificationStatus:"VERIFIED",verifiedAt}});
  }
  const registration = { id: `registration-${suffix}`, vendorId: vendor.id, liveId: live.id, versionId: version.id, submissionId: submission.id, visitorId: visitor.id, verifiedAt };
  await insert(db, "LiveMetricRegistration", registration);
  const session = { id: `session-${suffix}`, vendorId: vendor.id, liveId: live.id, versionId: version.id, registrationId: registration.id, admissionSessionId: admission.id, anchorAt: initialCapture ? new Date(+verifiedAt+1) : new Date(+now - 10000), expiresAt: new Date(+now + 3600000) };
  await insert(db, "LiveMetricSession", session);
  return { vendor, video, form, live, submission, admission, version, visitor, registration, session };
}

async function exercise(db) {
  const [{ now }] = await db.$queryRawUnsafe('SELECT clock_timestamp() AS now');
  const a = await fixture(db, "a", now), b = await fixture(db, "b", now);
  // Compile only trusted workspace source in memory; module resolution stays in
  // this isolated worktree and the Prisma client dotenv paths were checked above.
  const compiled = await require("esbuild").build({ stdin: { contents: 'export * from "./src/lib/live-metric-registration-coverage.ts"; export * from "./src/lib/live-metric-order-coverage.ts"; export * from "./src/lib/live-metric-completion-store.ts"; export * from "./src/lib/live-metric-report-job.ts"; export * from "./src/lib/live-metric-executor.ts"; export * from "./src/lib/live-metric-coverage-reader.ts"; export * from "./src/lib/live-metric-registration-reconcile.ts"; export * from "./src/lib/form-submission-verification-domain.ts"; export * from "./src/lib/form-submission-verification.ts"; export * from "./src/lib/live-metric-registration-capture.ts"; export * from "./src/lib/live-metric-visit-collection.ts"; export * from "./src/lib/live-metric-visitor.ts"; export * from "./src/lib/live-metric-visitor-proof.ts"; export * from "./src/lib/live-metric-visit-cleanup.ts"; export * from "./src/lib/live-metric-visit.ts"; export * from "./src/lib/live-metric-ingestion.ts"; export * from "./src/lib/live-metric-session.ts"; export * from "./src/lib/live-metric-close.ts"; export * from "./src/lib/live-metric-version.ts"; export * from "./src/lib/live-metric-report-lease.ts"; export * from "./src/lib/live-metric-report-reader.ts"; export * from "./src/lib/live-metric-report-snapshot.ts"; export { releaseLiveViewer, hashLiveViewerToken } from "./src/lib/live-quota-admission.ts";', resolveDir: root, sourcefile: "metric-integration-entry.ts", loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false, logLevel: "silent", define: { "process.env.CSRF_SECRET": JSON.stringify("synthetic-wp20-verification-key-minimum-thirty-two-bytes"), "process.env.JOB_SECRET": '""' } });
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, compiledModule, compiledModule.exports);
  const { ingestMetricIntervals, MetricIngestError } = compiledModule.exports;
  await check("reconciliation pages past pending failures and terminal gaps then repairs later passes", async () => {
    const { reconcileMetricRegistrations, materializeMetricRegistration } = compiledModule.exports;
    const ids = Array.from({ length: 5 }, (_, n) => `reconcile-${n}`);
    try {
      for (const submissionId of ids) {
        await db.$transaction(async tx => {
          await tx.formSubmission.create({ data: { id: submissionId, formId: a.form.id, liveId: a.live.id, name: "Synthetic reconcile", email: `${submissionId}@example.test` } });
          await insert(tx, "LiveMetricRegistrationCapture", { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, submissionId, visitorId: null });
        });
      }
      await db.$executeRawUnsafe(`UPDATE "FormSubmission" SET "verificationStatus"='VERIFIED',"verifiedAt"=date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC' WHERE id IN ($1,$2,$3,$4)`, ...ids.slice(1));
      await db.$executeRawUnsafe(`UPDATE "FormSubmission" SET "verifiedAt"=$2::timestamptz AT TIME ZONE 'UTC' WHERE id=$1`, ids[2], new Date(+a.version.expiresAt+1000));
      const scope = { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, afterSubmissionId: null, take: 2 };
      let calls = 0;
      const failing = { $transaction: (action, options) => ++calls === 3 ? Promise.reject(new Error("synthetic retryable projection failure")) : db.$transaction(action, options) };
      const first = await reconcileMetricRegistrations(failing, scope);
      assert.equal(first.processed, 2); assert.equal(first.nextSubmissionId, ids[1]); assert.equal(first.hasMore, true);
      assert.equal(first.retryable, 2); assert.equal(first.coverage, "unknown");
      const next = await reconcileMetricRegistrations(db, { ...scope, afterSubmissionId: first.nextSubmissionId, take: 3 });
      assert.equal(next.processed, 3); assert.equal(next.hasMore, false); assert.equal(next.terminalGaps, 1); assert.equal(next.outcomes.recorded, 2);
      const repaired = await reconcileMetricRegistrations(db, { ...scope, take: 20 });
      assert.equal(repaired.outcomes.recorded, 3); assert.equal(repaired.retryable, 1); assert.equal(repaired.terminalGaps, 1); assert.equal(repaired.coverage, "unknown");
      await db.$executeRawUnsafe(`UPDATE "FormSubmission" SET "verificationStatus"='VERIFIED',"verifiedAt"=date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC' WHERE id=$1`, ids[0]);
      const final = await reconcileMetricRegistrations(db, { ...scope, take: 20 });
      assert.equal(final.outcomes.recorded, 4); assert.equal(final.terminalGaps, 1); assert.equal(final.retryable, 0); assert.equal(final.coverage, "unknown");
      await verifyRegistrationJob(db, { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id });
      const foreign = await reconcileMetricRegistrations(db, { ...scope, vendorId: b.vendor.id }); assert.equal(foreign.processed, 0);
      assert.equal((await materializeMetricRegistration(db, { vendorId: a.vendor.id, liveId: a.live.id, submissionId: ids[1] }, b.version.id)).status, "missing_capture");
      await assert.rejects(() => reconcileMetricRegistrations(db, { ...scope, take: 21 }), error => error.code === "INVALID_INPUT");
    } finally { await db.formSubmission.deleteMany({ where: { id: { in: ids } } }); }
  });
  await check("real verification records DB epoch despite app clock skew and nonUTC session", async () => {
    const { captureMetricRegistration, materializeMetricRegistration, createMetricVisitorProofService, createFormSubmissionVerificationToken, verifyFormSubmission } = compiledModule.exports;
    const proofs = createMetricVisitorProofService(new Uint8Array(32).fill(47));
    const created = [];
    try {
      for (const offset of [-60000, 60000]) {
        const [{ clock }] = await db.$queryRawUnsafe('SELECT clock_timestamp() AS clock');
        const expiresAt = new Date(+clock + 3600000);
        const fresh = await db.$transaction(async tx => {
          const submission = await tx.formSubmission.create({ data: { formId: a.form.id, liveId: a.live.id, name: "Synthetic skew", email: `skew-${offset}@example.test`, verificationExpiresAt: expiresAt } });
          created.push(submission.id);
          const capture = await captureMetricRegistration(tx, { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, submissionId: submission.id }, proofs);
          assert.equal(capture.status, "captured"); return submission;
        });
        const token = createFormSubmissionVerificationToken({ submissionId: fresh.id, expiresAt, version: fresh.verificationVersion });
        const nonUtcDb = { $transaction: (action, options) => {
          assert.ok(["Serializable", "ReadCommitted"].includes(options.isolationLevel));
          return db.$transaction(async tx => { await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Taipei'"); return action(tx); }, options);
        } };
        assert.equal((await verifyFormSubmission(nonUtcDb, token, new Date(+clock + offset))).status, "verified");
        const [ordering] = await db.$queryRawUnsafe(`SELECT (f."verifiedAt" AT TIME ZONE 'UTC')>=c."capturedAt" AS ordered,
          (f."verifiedAt" AT TIME ZONE 'UTC')<=clock_timestamp() AS not_future
          FROM "FormSubmission" f JOIN "LiveMetricRegistrationCapture" c ON c."submissionId"=f.id WHERE f.id=$1`, fresh.id);
        assert.deepEqual(ordering, { ordered: true, not_future: true });
        const identity = { vendorId: a.vendor.id, liveId: a.live.id, submissionId: fresh.id };
        assert.equal((await materializeMetricRegistration(db, identity)).status, "recorded");
        const stored = await db.formSubmission.findUnique({ where: { id: fresh.id }, select: { verifiedAt: true } });
        assert.equal((await verifyFormSubmission(nonUtcDb, token, new Date(+clock + offset))).status, "already_verified");
        assert.deepEqual(await db.formSubmission.findUnique({ where: { id: fresh.id }, select: { verifiedAt: true } }), stored);
        assert.equal((await verifyFormSubmission(nonUtcDb, token, new Date(+expiresAt + 1000))).status, "invalid");
      }
    } finally {
      // Legacy lead events use synthetic hashed identity and have no submission FK.
      await db.analyticsEvent.deleteMany({ where: { vendorId: a.vendor.id, liveId: a.live.id, eventType: "lead_submit" } });
      await db.formSubmission.deleteMany({ where: { id: { in: created } } });
    }
  });
  await check("verification commits despite projection failure and replay repairs it", async () => {
    const { captureMetricRegistration, verifyFormSubmission, createMetricVisitorProofService, createFormSubmissionVerificationToken } = compiledModule.exports;
    const proofs = createMetricVisitorProofService(new Uint8Array(32).fill(53));
    const expiresAt = new Date(Date.now()+3600000);
    const fresh = await db.$transaction(async tx => {
      const submission = await tx.formSubmission.create({ data: { formId: a.form.id, liveId: a.live.id, name: "Synthetic projection retry", email: "projection-retry@example.test", verificationExpiresAt: expiresAt } });
      assert.equal((await captureMetricRegistration(tx, { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, submissionId: submission.id }, proofs)).status, "captured");
      return submission;
    });
    let failedProjection = false;
    const failingDb = { $transaction: (action, options) => {
      if (options.isolationLevel === "ReadCommitted") { failedProjection = true; return Promise.reject(new Error("synthetic optional projection failure")); }
      assert.equal(options.isolationLevel, "Serializable"); return db.$transaction(action, options);
    } };
    try {
      const token = createFormSubmissionVerificationToken({ submissionId: fresh.id, version: fresh.verificationVersion, expiresAt });
      assert.equal((await verifyFormSubmission(failingDb, token)).status, "verified"); assert.equal(failedProjection, true);
      const stored = await db.formSubmission.findUnique({ where: { id: fresh.id }, select: { verificationStatus: true, verifiedAt: true } });
      assert.equal(stored.verificationStatus, "VERIFIED");
      const count = async () => (await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricRegistration" WHERE "submissionId"=$1', fresh.id))[0].n;
      assert.equal(await count(), 0);
      assert.equal((await verifyFormSubmission(db, token)).status, "already_verified");
      assert.equal(await count(), 1);
      assert.deepEqual(await db.formSubmission.findUnique({ where: { id: fresh.id }, select: { verificationStatus: true, verifiedAt: true } }), stored);
    } finally {
      await db.analyticsEvent.deleteMany({ where: { vendorId: a.vendor.id, liveId: a.live.id, eventType: "lead_submit" } });
      await db.formSubmission.delete({ where: { id: fresh.id } });
    }
  });
  await check("session and projection preserve first capture in either order and concurrently", async () => {
    const { resolveMetricRegistrationVisitor, materializeMetricRegistration, issueMetricSession } = compiledModule.exports;
    for (const order of ["session-first", "projection-first", "concurrent", "unknown-existing"]) {
      checkStage = `${order}:create`;
      const submission = await db.$transaction(async tx => {
        const fresh = await tx.formSubmission.create({ data: { formId: a.form.id, liveId: a.live.id, name: "Synthetic session race", email: `race-${order}@example.test` } });
        await insert(tx, "LiveMetricRegistrationCapture", { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, submissionId: fresh.id, visitorId: a.visitor.id });
        return fresh;
      });
      const identity = { vendorId: a.vendor.id, liveId: a.live.id, submissionId: submission.id, admissionId: a.admission.id };
      const projectionIdentity = { vendorId: a.vendor.id, liveId: a.live.id, submissionId: submission.id };
      try {
        checkStage = `${order}:before-verification`;
        assert.equal(await resolveMetricRegistrationVisitor(db, identity, a.version.id), null);
        await db.$executeRawUnsafe(`UPDATE "FormSubmission" SET "verificationStatus"='VERIFIED',"verifiedAt"=date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC' WHERE id=$1`, submission.id);
        checkStage = `${order}:after-verification`;
        assert.equal(await resolveMetricRegistrationVisitor(db, identity, a.version.id), a.visitor.id);
        checkStage = `${order}:foreign-scope`;
        assert.equal(await resolveMetricRegistrationVisitor(db, { ...identity, vendorId: b.vendor.id }, a.version.id), null);
        assert.equal(await resolveMetricRegistrationVisitor(db, identity, b.version.id), null);
        if (order === "unknown-existing") {
          checkStage = `${order}:existing-null`;
          await db.$executeRawUnsafe(`INSERT INTO "LiveMetricRegistration" (id,"vendorId","liveId","versionId","submissionId","visitorId","verifiedAt")
            SELECT $1,$2,$3,$4,id,NULL,"verifiedAt" AT TIME ZONE 'UTC' FROM "FormSubmission" WHERE id=$5`, "race-unknown-existing", a.vendor.id, a.live.id, a.version.id, submission.id);
          assert.equal(await resolveMetricRegistrationVisitor(db, identity, a.version.id), null);
          assert.deepEqual(await materializeMetricRegistration(db, projectionIdentity), { status: "identity_conflict", retryable: false });
          continue;
        }
        const session = () => issueMetricSession(db, async () => identity, async tx => ({ versionId: a.version.id, expiresAt: a.version.expiresAt,
          visitorId: await resolveMetricRegistrationVisitor(tx, identity, a.version.id) }), { requestId: "c0000000-0000-4000-8000-000000000001" });
        const projection = () => materializeMetricRegistration(db, projectionIdentity);
        checkStage = `${order}:execute`;
        let issued, projected;
        if (order === "session-first") { issued = await session(); projected = await projection(); }
        else if (order === "projection-first") { projected = await projection(); issued = await session(); }
        else [issued, projected] = await Promise.all([session(), projection()]);
        checkStage = `${order}:projection-status:${["recorded", "identity_conflict", "pending_clock", "clock_order_conflict"].includes(projected.status) ? projected.status : "other"}`;
        assert.equal(projected.status, "recorded");
        const rows = await db.$queryRawUnsafe('SELECT id,"visitorId" FROM "LiveMetricRegistration" WHERE "submissionId"=$1', submission.id);
        checkStage = `${order}:row-count`; assert.equal(rows.length, 1);
        checkStage = `${order}:visitor-binding`; assert.equal(rows[0].visitorId, a.visitor.id);
        checkStage = `${order}:projection-binding`; assert.equal(rows[0].id, projected.registrationId);
        const [stored] = await db.$queryRawUnsafe('SELECT "registrationId" FROM "LiveMetricSession" WHERE id=$1', issued.sessionId);
        checkStage = `${order}:session-binding`;
        assert.equal(stored.registrationId, rows[0].id);
      } finally { await db.formSubmission.delete({ where: { id: submission.id } }); }
    }
  });
  await check("projection and Live source update use compatible lock ordering", async () => {
    const fresh = await db.$transaction(async tx => {
      const row = await tx.formSubmission.create({ data: { formId: a.form.id, liveId: a.live.id, name: "Synthetic lock order", email: "projection-lock-order@example.test" } });
      await insert(tx, "LiveMetricRegistrationCapture", { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, submissionId: row.id, visitorId: null });
      return row;
    });
    await db.$executeRawUnsafe(`UPDATE "FormSubmission" SET "verificationStatus"='VERIFIED',"verifiedAt"=date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC' WHERE id=$1`, fresh.id);
    let signalFirst, releaseFirst;
    const firstLocked = new Promise(resolve => { signalFirst = resolve; });
    const release = new Promise(resolve => { releaseFirst = resolve; });
    let first = true, updaterPid = null;
    const rollback = new Error("synthetic-source-update-rollback");
    const projection = compiledModule.exports.materializeMetricRegistration({ $transaction: (callback, options) => db.$transaction(tx => callback(new Proxy(tx, {
      get(target, key) {
        if (key === "$queryRaw") return async query => {
          const rows = await target.$queryRaw(query);
          if (first && query.sql.includes("FOR SHARE")) {
            first = false; signalFirst(); await release;
          }
          return rows;
        };
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      },
    })), options) }, { vendorId: a.vendor.id, liveId: a.live.id, submissionId: fresh.id });
    // Attach rejection handlers immediately; all branches are awaited in finally.
    const projectionResult = projection.then(value => ({ value }), error => ({ error }));
    let updateResult;
    try {
      await Promise.race([firstLocked, projection.then(() => { throw new Error("missing first lock"); })]);
      updateResult = db.$transaction(async tx => {
        const [backend] = await tx.$queryRawUnsafe("SELECT pg_backend_pid() AS pid"); updaterPid = backend.pid;
        await tx.$executeRawUnsafe('UPDATE "Live" SET "formId"=NULL WHERE id=$1', a.live.id);
        throw rollback;
      }, { timeout: 10000 }).then(() => ({ unexpectedCommit: true }), error => ({ error }));
      // Observe a real blocked backend before releasing the first projection lock.
      let blocked = false;
      const until = Date.now() + 3000;
      while (Date.now() < until) {
        if (updaterPid !== null) {
          const [state] = await db.$queryRawUnsafe("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", updaterPid);
          if (state?.wait_event_type === "Lock") { blocked = true; break; }
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(blocked, "Concurrent source update must actually contend on a lock");
      releaseFirst();
      const projected = await projectionResult, updated = await updateResult;
      assert.equal(projected.error, undefined); assert.equal(projected.value.status, "recorded");
      assert.equal(updated.error, rollback);
    } finally {
      releaseFirst(); await projectionResult; if (updateResult) await updateResult;
      await db.formSubmission.delete({ where: { id: fresh.id } });
    }
  });
  await check("capture SQL failure preserves outer submission and transaction settings", async () => {
    const { captureMetricRegistration, createMetricVisitorProofService } = compiledModule.exports;
    const proofs = createMetricVisitorProofService(new Uint8Array(32).fill(41));
    for (const fault of ["guard", "sql"]) {
      let submissionId;
      try {
        await db.$transaction(async tx => {
          const fresh = await tx.formSubmission.create({ data: { formId: a.form.id, liveId: a.live.id, name: "Synthetic failure isolation", email: `savepoint-${fault}@example.test`, ...(fault === "guard" ? { verificationStatus: "VERIFIED", verifiedAt: now } : {}) } });
          submissionId = fresh.id;
          const settings = () => tx.$queryRawUnsafe("SELECT current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock");
          const before = await settings();
          const context = fault === "sql" ? new Proxy(tx, { get(target, key) {
            if (key === "$executeRaw") return async query => {
              if (query.sql.startsWith('INSERT INTO "LiveMetricRegistrationCapture"')) return target.$executeRawUnsafe('SELECT 1/0');
              return target.$executeRaw(query);
            };
            const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
          } }) : tx;
          const result = await captureMetricRegistration(context, { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, submissionId }, proofs);
          assert.equal(result.status, "unavailable");
          assert.equal(result.code, fault === "guard" ? "SCOPE_UNAVAILABLE" : "PERSISTENCE_UNAVAILABLE");
          assert.deepEqual(await settings(), before);
          // A real DB write after the error proves the outer transaction is usable.
          await tx.formSubmission.update({ where: { id: submissionId }, data: { name: "Synthetic still committed" } });
        });
        assert.equal((await db.formSubmission.findUnique({ where: { id: submissionId } })).name, "Synthetic still committed");
        const [count] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricRegistrationCapture" WHERE "submissionId"=$1', submissionId);
        assert.equal(count.n, 0);
      } finally { if (submissionId) await db.formSubmission.deleteMany({ where: { id: submissionId } }); }
    }
  });
  await check("capture lock timeout preserves a valid first submission", async () => {
    const { captureMetricRegistration, createMetricVisitorProofService } = compiledModule.exports;
    const proofs = createMetricVisitorProofService(new Uint8Array(32).fill(43));
    let unlock, signalLocked, submissionId;
    const held = new Promise(resolve => { signalLocked = resolve; });
    const release = new Promise(resolve => { unlock = resolve; });
    const holder = db.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT id FROM "LiveMetricVersion" WHERE id=$1 FOR UPDATE', a.version.id);
      signalLocked(); await release;
    }, { timeout: 10000 });
    try {
      await held;
      await db.$transaction(async tx => {
        const fresh = await tx.formSubmission.create({ data: { formId: a.form.id, liveId: a.live.id, name: "Synthetic lock wait", email: "lockwait@example.test" } });
        submissionId = fresh.id;
        const result = await captureMetricRegistration(tx, { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, submissionId }, proofs);
        assert.equal(result.status, "unavailable"); assert.equal(result.code, "PERSISTENCE_UNAVAILABLE");
        assert.equal(await tx.formSubmission.count({ where: { id: submissionId } }), 1);
      });
      assert.equal(await db.formSubmission.count({ where: { id: submissionId } }), 1);
    } finally { unlock(); await holder; if (submissionId) await db.formSubmission.deleteMany({ where: { id: submissionId } }); }
  });
  await check("verified nonviewer registration materializes once from immutable capture", async () => {
    const { captureMetricRegistration, materializeMetricRegistration, createMetricVisitorProofService, provisionMetricVisitor } = compiledModule.exports;
    const proofs = createMetricVisitorProofService(new Uint8Array(32).fill(37));
    const scope = { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id };
    const visitor = await provisionMetricVisitor(db, proofs, { ...scope, expiresAt: a.version.expiresAt });
    const submissions = [];
    try {
      for (const known of [true, false]) {
        const submission = await db.$transaction(async tx => {
          const fresh = await tx.formSubmission.create({ data: { formId: a.form.id, liveId: a.live.id, name: "Synthetic service", email: `service-${known}@example.test` } });
          submissions.push(fresh.id);
          const captured = await captureMetricRegistration(tx, { ...scope, submissionId: fresh.id }, proofs, known ? visitor.proof : null);
        checkStage = `nonviewer-${known}:assert-1`;
          assert.equal(captured.visitorId, known ? visitor.visitorId : null);
          // A repeated call cannot repair unknown attribution from a later cookie.
        checkStage = `nonviewer-${known}:assert-2`;
          assert.equal((await captureMetricRegistration(tx, { ...scope, submissionId: fresh.id }, proofs, visitor.proof)).visitorId, known ? visitor.visitorId : null);
          return fresh;
        });
        const identity = { vendorId: a.vendor.id, liveId: a.live.id, submissionId: submission.id };
        checkStage = `nonviewer-${known}:assert-3`;
        assert.deepEqual(await materializeMetricRegistration(db, identity), { status: "pending_verification", retryable: true });
        checkStage = `nonviewer-${known}:assert-4`;
        assert.equal((await materializeMetricRegistration(db, { ...identity, vendorId: b.vendor.id })).status, "missing_capture");
        await db.$executeRawUnsafe(`UPDATE "FormSubmission" SET "verificationStatus"='VERIFIED',"verifiedAt"=$2::timestamptz AT TIME ZONE 'UTC' WHERE id=$1`, submission.id, new Date(+a.version.expiresAt + 1000));
        checkStage = `nonviewer-${known}:assert-5`;
        assert.deepEqual(await materializeMetricRegistration(db, identity), { status: "outside_retention", retryable: false });
        await db.$executeRawUnsafe(`UPDATE "FormSubmission" SET "verifiedAt"=(SELECT "capturedAt" AT TIME ZONE 'UTC' - interval '1 second' FROM "LiveMetricRegistrationCapture" WHERE "submissionId"=$1) WHERE id=$1`, submission.id);
        checkStage = `nonviewer-${known}:assert-6`;
        assert.deepEqual(await materializeMetricRegistration(db, identity), { status: "clock_order_conflict", retryable: false });
        await db.$executeRawUnsafe(`UPDATE "FormSubmission" SET "verifiedAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '10 seconds' WHERE id=$1`, submission.id);
        checkStage = `nonviewer-${known}:assert-7`;
        assert.deepEqual(await materializeMetricRegistration(db, identity), { status: "pending_clock", retryable: true });
        const [notRecorded] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricRegistration" WHERE "submissionId"=$1', submission.id);
        checkStage = `nonviewer-${known}:assert-8`;
        assert.equal(notRecorded.n, 0);
        await db.$executeRawUnsafe(`UPDATE "FormSubmission" SET "verificationStatus"='VERIFIED',"verifiedAt"=date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC' WHERE id=$1`, submission.id);
        const repeated = await db.$transaction(tx => captureMetricRegistration(tx, { ...scope, submissionId: submission.id }, proofs, visitor.proof));
        checkStage = `nonviewer-${known}:assert-9`;
        assert.equal(repeated.status, "captured"); assert.equal(repeated.visitorId, known ? visitor.visitorId : null);
        const nonUtcDb = { $transaction: (action, options) => db.$transaction(async tx => {
          await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Taipei'"); return action(tx);
        }, options) };
        // Only synthetic time deltas and DB timezone are retained; no identifiers or raw rows.
        const [clockDiagnostic] = await db.$queryRawUnsafe(`SELECT
          current_setting('TimeZone') AS zone,
          (extract(epoch FROM ((f."verifiedAt" AT TIME ZONE 'UTC')-c."capturedAt"))*1000)::float8 AS "verifiedAfterCaptureMs",
          (extract(epoch FROM (clock_timestamp()-c."capturedAt"))*1000)::float8 AS "captureAgeMs"
          FROM "FormSubmission" f JOIN "LiveMetricRegistrationCapture" c ON c."submissionId"=f.id WHERE f.id=$1`,submission.id);
        registrationClockDiagnostics.push({known,...clockDiagnostic});
        const receipts = await Promise.all([materializeMetricRegistration(db, identity), materializeMetricRegistration(nonUtcDb, identity)]);
        checkStage = `nonviewer-${known}:assert-10`;
        assert.equal(receipts[0].status, "recorded"); assert.deepEqual(receipts[0], receipts[1]);
        const rows = await db.$queryRawUnsafe('SELECT id,"visitorId" FROM "LiveMetricRegistration" WHERE "submissionId"=$1', submission.id);
        checkStage = `nonviewer-${known}:assert-11`;
        assert.equal(rows.length, 1); assert.equal(rows[0].visitorId, known ? visitor.visitorId : null);
        const [sessions] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricSession" WHERE "registrationId"=$1', rows[0].id);
        checkStage = `nonviewer-${known}:assert-12`;
        assert.equal(sessions.n, 0);
        await db.$executeRawUnsafe(`UPDATE "FormSubmission" SET "verifiedAt"="verifiedAt"+interval '1 millisecond' WHERE id=$1`, submission.id);
        checkStage = `nonviewer-${known}:assert-13`;
        assert.deepEqual(await materializeMetricRegistration(db, identity), { status: "identity_conflict", retryable: false });
      }
    } finally {
      await db.formSubmission.deleteMany({ where: { id: { in: submissions } } });
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVisitor" WHERE id=$1', visitor.visitorId);
    }
  });
  await check("initial capture is scoped immutable and rolls back with submission", async () => {
    const submission = await db.formSubmission.create({ data: { formId: a.submission.formId, liveId: a.live.id, name: "Synthetic capture", email: "capture@example.test" } });
    const row = { submissionId: submission.id, vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, visitorId: a.visitor.id };
    try {
      await rejected(() => insert(db, "LiveMetricRegistrationCapture", { ...row, vendorId: b.vendor.id }));
      await rejected(() => insert(db, "LiveMetricRegistrationCapture", { ...row, visitorId: b.visitor.id }));
      await insert(db, "LiveMetricRegistrationCapture", row);
      await rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricRegistrationCapture" SET "visitorId"=NULL WHERE "submissionId"=$1', submission.id));
      await rejected(() => db.$executeRawUnsafe('DELETE FROM "LiveMetricRegistrationCapture" WHERE "submissionId"=$1', submission.id));
      await rejected(() => db.$executeRawUnsafe('TRUNCATE "LiveMetricRegistrationCapture"'));
      const [stored] = await db.$queryRawUnsafe('SELECT "visitorId","capturedAt" FROM "LiveMetricRegistrationCapture" WHERE "submissionId"=$1', submission.id);
      assert.equal(stored.visitorId, a.visitor.id); assert.ok(stored.capturedAt instanceof Date);
      await rejected(() => insert(db, "LiveMetricRegistrationCapture", { ...row, submissionId: a.submission.id }));
    } finally { await db.formSubmission.delete({ where: { id: submission.id } }); }
    const [remaining] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricRegistrationCapture" WHERE "submissionId"=$1', submission.id);
    assert.equal(remaining.n, 0);
    const rollback = new Error("synthetic-capture-rollback");
    let rolledId;
    try {
      await db.$transaction(async tx => {
        const fresh = await tx.formSubmission.create({ data: { formId: a.submission.formId, liveId: a.live.id, name: "Synthetic rollback", email: "rollback@example.test" } });
        rolledId = fresh.id;
        await insert(tx, "LiveMetricRegistrationCapture", { ...row, submissionId: fresh.id, visitorId: null });
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    assert.equal(await db.formSubmission.count({ where: { id: rolledId } }), 0);
    const [rolled] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricRegistrationCapture" WHERE "submissionId"=$1', rolledId);
    assert.equal(rolled.n, 0);
  });
  await check("registration attribution is scoped and rejects a changed verification epoch", async () => {
    const { resolveMetricRegistrationVisitor } = compiledModule.exports;
    const identity = { vendorId: a.vendor.id, liveId: a.live.id, submissionId: a.submission.id, admissionId: a.admission.id };
    assert.equal(await resolveMetricRegistrationVisitor(db, identity, a.version.id), a.visitor.id);
    assert.equal(await resolveMetricRegistrationVisitor(db, { ...identity, vendorId: b.vendor.id }, a.version.id), null);
    assert.equal(await resolveMetricRegistrationVisitor(db, identity, b.version.id), null);
    assert.equal(await resolveMetricRegistrationVisitor(db, { ...identity, submissionId: b.submission.id }, a.version.id), null);
    const rollback = new Error("synthetic-epoch-rollback");
    try {
      await db.$transaction(async tx => {
        await tx.formSubmission.update({ where: { id: a.submission.id }, data: { verifiedAt: new Date(+a.submission.verifiedAt + 1) } });
        assert.equal(await resolveMetricRegistrationVisitor(tx, identity, a.version.id), null);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    assert.equal(await resolveMetricRegistrationVisitor(db, identity, a.version.id), a.visitor.id);
  });
  await check("real worker report job persists aggregates and rejects stale completion", async () => {
    const { runMetricReportJob, createMetricExecutor, createCompletionExecutor } = compiledModule.exports;
    const version = { ...a.version, id: "report-job-version", fingerprint: "cafeba12".repeat(8) };
    await insert(db, "LiveMetricVersion", version);
    const directory = fs.mkdtempSync(path.join(root, ".ai-team/reports/wp20-job-worker-"));
    const artifact = path.join(directory, "worker.cjs");
    try {
      await require("esbuild").build({ entryPoints: [path.join(root, "src/lib/live-metric-worker.ts")], outfile: artifact,
        bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
      const execute = createMetricExecutor(pathToFileURL(artifact));
      const project = createCompletionExecutor(pathToFileURL(artifact));
      const makeReport = async (id, offset) => {
        const lease = { vendorId: a.vendor.id, liveId: a.live.id, versionId: version.id, reportId: id, workerId: "real-worker" };
        await insert(db, "LiveMetricReport", { id, vendorId: lease.vendorId, liveId: lease.liveId, versionId: version.id,
          windowStartAt: new Date(+now - 17000 + offset), windowEndAt: new Date(+now - 15000), inputRevision: await revision(db, version.id), expiresAt: version.expiresAt });
        return lease;
      };
      const unknown = await makeReport("job-unknown", 0);
      assert.deepEqual(await runMetricReportJob(db, unknown, execute, project), { status: "recorded" });
      const [storedUnknown] = await db.$queryRawUnsafe('SELECT status,result FROM "LiveMetricReport" WHERE id=$1', unknown.reportId);
      assert.equal(storedUnknown.status, "ready");
      assert.deepEqual(storedUnknown.result.registrationRate, { status: "unavailable", reason: "missing_data" });
      assert.deepEqual(await runMetricReportJob(db, unknown, async () => { assert.fail("already finished job must not execute"); }), { status: "not_claimed" });
      const audit = { vendorId: a.vendor.id, liveId: a.live.id, versionId: version.id, status: "covered",
        startAt: new Date(+now - 17000), endAt: new Date(+now - 15000), sourceRevision: await revision(db, version.id), auditDigest: "d".repeat(64) };
      for (const kind of ["visits", "viewing"]) await insert(db, "LiveMetricCoverageAudit", { ...audit, id: `job-audit-${kind}`, kind });
      // Registration completeness must come from the real bidirectional producer.
      assert.equal((await compiledModule.exports.publishRegistrationCoverage(db, {
        vendorId:a.vendor.id,liveId:a.live.id,versionId:version.id,startAt:audit.startAt,endAt:audit.endAt,
      })).status,"recorded");
      const empty = await makeReport("job-audited-empty", 1);
      assert.deepEqual(await runMetricReportJob(db, empty, execute, project), { status: "recorded" });
      const [projection] = await db.$queryRawUnsafe('SELECT "cohortCount",rows FROM "LiveMetricCompletionProjection" WHERE "reportId"=$1', empty.reportId);
      assert.deepEqual(projection, { cohortCount: 0, rows: [] });
      const [storedEmpty] = await db.$queryRawUnsafe('SELECT result FROM "LiveMetricReport" WHERE id=$1', empty.reportId);
      assert.deepEqual(storedEmpty.result.attendanceRate, { status: "not_applicable", reason: "zero_denominator" });
      // Hold the source lock on another connection; exercise the real adapter timeout.
      const blockedLease = await makeReport("job-lock-timeout", 3);
      assert.equal(await compiledModule.exports.claimMetricReport(db, blockedLease), true);
      const sourceRevision = await revision(db, version.id);
      let releaseLock, announceLock;
      const release = new Promise(resolve => { releaseLock = resolve; });
      const locked = new Promise(resolve => { announceLock = resolve; });
      const holder = db.$transaction(async tx => {
        await tx.$queryRawUnsafe('SELECT id FROM "LiveMetricVersion" WHERE id=$1 FOR UPDATE',version.id);
        announceLock();
        await release;
      }, { timeout: 15000 });
      const completionScope = { vendorId: a.vendor.id, liveId: a.live.id, contentVersionId: version.id, mode: version.mode };
      const candidate = { status: "available", cohortCount: 0, rows: [] };
      try {
        await Promise.race([locked, holder.then(() => { throw new Error("lock holder ended before readiness"); })]);
        const started = performance.now();
        await assert.rejects(compiledModule.exports.publishMetricCompletion(db,blockedLease,sourceRevision,completionScope,candidate),
          error => error?.meta?.code === "55P03");
        assert.ok(performance.now() - started < 8000, "lock timeout must bound the real writer");
        assert.equal(Number((await db.$queryRawUnsafe('SELECT count(*) AS n FROM "LiveMetricCompletionProjection" WHERE "reportId"=$1',blockedLease.reportId))[0].n),0);
      } finally { releaseLock(); await holder; }
      // A timeout leaves no partial manifest and does not poison the next transaction.
      assert.equal(await compiledModule.exports.publishMetricCompletion(db,blockedLease,sourceRevision,completionScope,candidate),true);
      const stale = await makeReport("job-stale", 2);
      assert.deepEqual(await runMetricReportJob(db, stale, async input => {
        const calculated = await execute(input);
        assert.equal(calculated.status, "available");
        await insert(db, "LiveMetricCoverageAudit", { ...audit, id: "job-late-gap", kind: "visits", status: "gap" });
        return calculated;
      }), { status: "lease_lost" });
      const [lost] = await db.$queryRawUnsafe('SELECT status,result FROM "LiveMetricReport" WHERE id=$1', stale.reportId);
      assert.deepEqual(lost, { status: "stale", result: null });
    } finally {
      // Delete only this test's explicitly created artifact; no recursive cleanup.
      if (fs.existsSync(artifact)) fs.unlinkSync(artifact);
      fs.rmdirSync(directory);
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1', version.id);
    }
  });
  await check("nonzero five metrics use durable completion through real workers", async () => {
    const [intakeClock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
    const c=await fixture(db,"c",intakeClock.now,true);
    const directory=fs.mkdtempSync(path.join(root,".ai-team/reports/wp20-nonzero-worker-"));
    const artifact=path.join(directory,"worker.cjs");
    let paymentId;
    try {
      const scope={vendorId:c.vendor.id,liveId:c.live.id,versionId:c.version.id};
      checkStage="nonzero:real-viewing-clock";
      // Keep historical attribution unforgeable: wait for the real DB clock
      // instead of backdating capture or weakening the 90-second expectation.
      const target=new Date(+c.session.anchorAt+91100);
      const clockDeadline=performance.now()+120000;
      for (;;) {
        assert.ok(performance.now()<clockDeadline,"DB viewing-clock wait exceeded its bound");
        const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
        const remaining=+target-(+clock.now);
        if(remaining<=0)break;
        await new Promise(resolve=>setTimeout(resolve,Math.min(remaining,1000)));
      }
      const [receiptClock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
      checkStage="nonzero:intervals";
      await insert(db,"LiveMetricVisit",{...scope,id:"20000000-0000-4000-8000-000000000001",visitorId:c.visitor.id,visitedAt:c.visitor.firstVisitedAt});
      for(let sequence=0;sequence<18;sequence+=1)await insert(db,"LiveMetricInterval",{...scope,id:`nonzero-interval-${sequence}`,sessionId:c.session.id,sequence,payloadHash:"c".repeat(64),wallStartAt:new Date(+c.session.anchorAt+sequence*5000),wallEndAt:new Date(+c.session.anchorAt+(sequence+1)*5000),mediaStartMs:sequence*5000,mediaEndMs:(sequence+1)*5000,receivedAt:receiptClock.now});
      await db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "finalSequence"=17,"closedAt"=$1,complete=true WHERE id=$2',receiptClock.now,c.session.id);
      const payment=await db.paymentTransaction.create({data:{vendorId:c.vendor.id,providerName:"synthetic-metric",status:"pending",metadata:{formSubmissionId:c.submission.id,sourceLiveId:c.live.id,billingPurpose:"buyer_order"}}});paymentId=payment.id;
      await db.commerceOrder.create({data:{id:"nonzero-order",vendorId:c.vendor.id,primaryPaymentTransactionId:payment.id,orderNumber:"nonzero-order",checkoutIdempotencyKey:"nonzero-order",checkoutIdentityHash:"c".repeat(43),status:"pending_payment",subtotalAmountCents:100,totalAmountCents:100,buyerEncryptedEnvelope:"synthetic-unused",buyerMaskedName:"Synthetic",buyerMaskedEmail:"synthetic@example.test",isTestOrder:true,createdAt:new Date(+c.session.anchorAt+91000)}});
      const start=c.version.collectionStartedAt,end=receiptClock.now;
      // This controlled synthetic intake is fully enumerated above, not an audit
      // inferred from production row counts or a replacement for a real producer.
      for(const kind of ["visits","viewing"])await insert(db,"LiveMetricCoverageAudit",{...scope,id:`nonzero-audit-${kind}`,kind,status:"covered",startAt:start,endAt:end,sourceRevision:await revision(db,c.version.id),auditDigest:"c".repeat(64)});
      checkStage="nonzero:registration-proof";
      assert.equal((await compiledModule.exports.publishRegistrationCoverage(db,{...scope,startAt:start,endAt:end})).status,"recorded");
      checkStage="nonzero:order-proof";
      assert.equal((await compiledModule.exports.publishOrderCoverage(db,{...scope,startAt:start,endAt:end})).status,"recorded");
      const lease={...scope,reportId:"nonzero-report",workerId:"nonzero-worker"};
      await insert(db,"LiveMetricReport",{...scope,id:lease.reportId,windowStartAt:start,windowEndAt:end,inputRevision:await revision(db,c.version.id),expiresAt:c.version.expiresAt});
      await require("esbuild").build({entryPoints:[path.join(root,"src/lib/live-metric-worker.ts")],outfile:artifact,bundle:true,platform:"node",format:"cjs",logLevel:"silent"});
      const {runMetricReportJob,createMetricExecutor,createCompletionExecutor}=compiledModule.exports;
      assert.deepEqual(await runMetricReportJob(db,lease,createMetricExecutor(pathToFileURL(artifact)),createCompletionExecutor(pathToFileURL(artifact))),{status:"recorded"});
      const [stored]=await db.$queryRawUnsafe('SELECT result FROM "LiveMetricReport" WHERE id=$1',lease.reportId);
      for(const key of ["registrationRate","attendanceRate","completionRate","postCompletionOrderRate"])assert.deepEqual(stored.result[key],{status:"available",value:100,numerator:1,denominator:1,unit:"percent"});
      assert.deepEqual(stored.result.averageViewingSeconds,{status:"available",value:90,numerator:90,denominator:1,unit:"seconds"});
      const [projection]=await db.$queryRawUnsafe('SELECT rows FROM "LiveMetricCompletionProjection" WHERE "reportId"=$1',lease.reportId);
      assert.deepEqual(projection.rows,[{personId:c.registration.id,firstCompletedAtMs:+c.session.anchorAt+90000}]);
    }finally{
      if(fs.existsSync(artifact))fs.unlinkSync(artifact);fs.rmdirSync(directory);
      await db.commerceOrder.deleteMany({where:{id:"nonzero-order"}});
      if(paymentId)await db.paymentTransaction.delete({where:{id:paymentId}});
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1',c.version.id);
      await db.vendor.delete({where:{id:c.vendor.id}});
    }
  });
  await check("order reader uses scoped verified attribution current state and stable pagination", async () => {
    const version = { ...a.version, id: "order-reader-version", fingerprint: "bbccaadd".repeat(8) };
    const paymentIds = [], orderIds = [];
    const otherLive = await db.live.create({ data: { vendorId: a.vendor.id, videoId: a.video.id, formId: a.form.id,
      title: "Synthetic unrelated live", slug: "metric-order-unrelated-live", scheduledAt: now } });
      checkStage = "order-reader:version";
    await insert(db, "LiveMetricVersion", version);
    try {
      checkStage = "order-reader:registration";
      await insert(db, "LiveMetricRegistration", { ...a.registration, id: "order-reader-registration", versionId: version.id, visitorId: null });
      for (const [label, status, vendorId, submissionId, sourceLiveId, purpose] of [
        ["a-pending", "pending_payment", a.vendor.id, a.submission.id, a.live.id, "buyer_order"],
        ["b-cancelled", "cancelled", a.vendor.id, a.submission.id, a.live.id, "buyer_order"],
        ["c-draft", "draft", a.vendor.id, a.submission.id, a.live.id, "buyer_order"],
        ["d-other-live", "paid", a.vendor.id, a.submission.id, otherLive.id, "buyer_order"],
        ["e-other-person", "paid", a.vendor.id, b.submission.id, a.live.id, "buyer_order"],
        ["f-other-vendor", "paid", b.vendor.id, a.submission.id, a.live.id, "buyer_order"],
        ["g-billing", "paid", a.vendor.id, a.submission.id, a.live.id, "platform_subscription"],
      ]) {
      checkStage = "order-reader:payment";
        const payment = await db.paymentTransaction.create({ data: { vendorId, providerName: "synthetic-metric", status: "pending",
          metadata: { formSubmissionId: submissionId, sourceLiveId, billingPurpose: purpose } } });
        paymentIds.push(payment.id);
        const id = `metric-order-${label}`;
      checkStage = "order-reader:order";
        await db.commerceOrder.create({ data: { id, vendorId, primaryPaymentTransactionId: payment.id, orderNumber: id,
          checkoutIdempotencyKey: id, checkoutIdentityHash: "a".repeat(43), status, subtotalAmountCents: 100, totalAmountCents: 100,
          buyerEncryptedEnvelope: "synthetic-unused-envelope", buyerMaskedName: "Synthetic", buyerMaskedEmail: "synthetic@example.test",
          isTestOrder: true, createdAt: new Date(+now - 10000) } });
        orderIds.push(id);
      }
      checkStage = "order-reader:report";
      const lease = { vendorId: a.vendor.id, liveId: a.live.id, versionId: version.id, reportId: "order-reader-report", workerId: "order-reader" };
      await insert(db, "LiveMetricReport", { id: lease.reportId, vendorId: lease.vendorId, liveId: lease.liveId, versionId: version.id,
        windowStartAt: new Date(+now - 17000), windowEndAt: new Date(+now - 5000), inputRevision: await revision(db, version.id), expiresAt: version.expiresAt });
      checkStage = "order-reader:claim";
      assert.equal(await compiledModule.exports.claimMetricReport(db, lease), true);
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Taipei'");
      checkStage = "order-reader:first-page";
        const first = await compiledModule.exports.readMetricOrderPage(tx, { ...lease, afterId: null, take: 1 });
        assert.equal(first.hasMore, true);
        assert.deepEqual(first.rows, [{ id: "metric-order-a-pending", registrationId: "order-reader-registration", establishedAt: new Date(+now - 10000), cancelled: false }]);
      checkStage = "order-reader:second-page";
        const second = await compiledModule.exports.readMetricOrderPage(tx, { ...lease, afterId: first.nextId, take: 1 });
        assert.equal(second.hasMore, false);
        assert.equal(second.rows[0].id, "metric-order-b-cancelled"); assert.equal(second.rows[0].cancelled, true);
        assert.equal((await compiledModule.exports.readMetricOrderPage(tx, { ...lease, vendorId: b.vendor.id, afterId: null, take: 1 })).status, "unavailable");
      }, { isolationLevel: "RepeatableRead" });
      checkStage = "order-reader:snapshot";
      const snapshot = await compiledModule.exports.loadMetricViewingSnapshot(db, lease);
      assert.equal(snapshot.status, "available"); assert.equal(snapshot.data.orders.length, 2);
      assert.deepEqual(snapshot.data.orderCoverage, { status: "unavailable", reason: "unknown_history" });
      checkStage = "order-reader:source-generation";
      const orderSource = async (client, vendorId, liveId = vendorId === a.vendor.id ? a.live.id : b.live.id) => (await client.$queryRawUnsafe('SELECT count(*) AS revision FROM "LiveMetricOrderSource" WHERE "vendorId"=$1 AND "liveId"=$2', vendorId, liveId))[0]?.revision ?? 0n;
      const initial = await orderSource(db, a.vendor.id), foreign = await orderSource(db, b.vendor.id);
      await db.$transaction(async tx => {
        await tx.commerceOrder.update({ where: { id: "metric-order-a-pending" }, data: { status: "cancelled" } });
        assert.equal(await orderSource(tx, a.vendor.id), initial + 1n);
      }, { isolationLevel: "Serializable" });
      assert.equal(await orderSource(db, a.vendor.id), initial + 1n);
      assert.equal(await orderSource(db, b.vendor.id), foreign);
      // No invalidation for provider status which the order reader never reads.
      await db.paymentTransaction.update({ where: { id: paymentIds[0] }, data: { status: "paid" } });
      assert.equal(await orderSource(db, a.vendor.id), initial + 1n);
      const rollback = new Error("expected-order-generation-rollback");
      try {
        await db.$transaction(async tx => {
          await tx.commerceOrder.update({ where: { id: "metric-order-a-pending" }, data: { status: "pending_payment" } });
          assert.equal(await orderSource(tx, a.vendor.id), initial + 2n);
          throw rollback;
        }, { isolationLevel: "Serializable" });
      } catch (error) { if (error !== rollback) throw error; }
      assert.equal(await orderSource(db, a.vendor.id), initial + 1n);
      await db.$transaction(async tx => {
        await tx.paymentTransaction.update({ where: { id: paymentIds[0] }, data: { metadata: {
          formSubmissionId: a.submission.id, sourceLiveId: b.live.id, billingPurpose: "buyer_order",
        } } });
      }, { isolationLevel: "Serializable" });
      assert.equal(await orderSource(db, a.vendor.id), initial + 2n);

      checkStage = "order-reader:stale-generation";
      const aggregate = { registrationRate: { status: "unavailable", reason: "missing_data" },
        attendanceRate: { status: "unavailable", reason: "missing_data" }, completionRate: { status: "unavailable", reason: "missing_data" },
        averageViewingSeconds: { status: "unavailable", reason: "missing_data" }, postCompletionOrderRate: { status: "unavailable", reason: "missing_data" },
        unattributedRegistrations: null, provisionalConversions: null };
      assert.equal((await compiledModule.exports.loadMetricViewingSnapshot(db, lease)).status, "unavailable");
      assert.equal(await compiledModule.exports.finishMetricReport(db, lease, aggregate), false);
      const fresh = { ...lease, reportId: "order-reader-current" };
      await insert(db, "LiveMetricReport", { id: fresh.reportId, vendorId: lease.vendorId, liveId: lease.liveId, versionId: version.id,
        windowStartAt: new Date(+now - 17000), windowEndAt: new Date(+now - 5000), inputRevision: await revision(db, version.id), expiresAt: version.expiresAt });
      assert.equal(await compiledModule.exports.claimMetricReport(db, fresh), true);
      assert.equal(await compiledModule.exports.finishMetricReport(db, fresh, aggregate), true);
      const readScope = { vendorId: fresh.vendorId, liveId: fresh.liveId, versionId: fresh.versionId, reportId: fresh.reportId };
      assert.equal((await compiledModule.exports.readMetricReadyReport(db, readScope)).status, "available");
      assert.equal((await compiledModule.exports.readMetricReadyReport(db, { ...readScope, vendorId: b.vendor.id })).status, "unavailable");
      checkStage = "order-reader:unrelated-live";
      const beforeOther = await orderSource(db, a.vendor.id, otherLive.id);
      await db.$transaction(async holding => {
        // Keep this live's generation locked while another connection commits
        // another live's order. A merchant-wide generation would time out.
        await holding.$queryRawUnsafe('SELECT id FROM "LiveMetricOrderSource" WHERE "vendorId"=$1 AND "liveId"=$2 FOR SHARE', a.vendor.id, a.live.id);
        await db.$transaction(async tx => {
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout='1000ms'");
          await tx.commerceOrder.update({ where: { id: "metric-order-d-other-live" }, data: { status: "cancelled" } });
        }, { isolationLevel: "Serializable", timeout: 5000 });
      }, { timeout: 10000 });
      assert.equal(await orderSource(db, a.vendor.id, otherLive.id), beforeOther + 1n);
      // The window inventory audits every tenant order, including positively
      // excluded other-live orders. A change inside this window invalidates it.
      assert.equal((await compiledModule.exports.readMetricReadyReport(db, readScope)).status, "unavailable");
      // Rebuild before testing the next mutation so its invalidation remains
      // independently observable rather than reusing an already stale report.
      fresh.reportId="order-reader-after-other-live";
      await insert(db,"LiveMetricReport",{id:fresh.reportId,vendorId:fresh.vendorId,liveId:fresh.liveId,versionId:fresh.versionId,
        windowStartAt:new Date(+now-16999),windowEndAt:new Date(+now-5000),inputRevision:await revision(db,version.id),expiresAt:version.expiresAt});
      assert.equal(await compiledModule.exports.claimMetricReport(db,fresh),true);
      assert.equal(await compiledModule.exports.finishMetricReport(db,fresh,aggregate),true);
      readScope.reportId=fresh.reportId;
      assert.equal((await compiledModule.exports.readMetricReadyReport(db,readScope)).status,"available");
      checkStage = "order-reader:ready-generation";
      await db.$transaction(async tx => {
        await tx.commerceOrder.update({ where: { id: "metric-order-b-cancelled" }, data: { status: "pending_payment" } });
      }, { isolationLevel: "Serializable" });
      assert.equal((await compiledModule.exports.readMetricReadyReport(db, readScope)).status, "unavailable");
      assert.equal(await compiledModule.exports.claimMetricReport(db, fresh), false);
      checkStage = "order-reader:failed-diagnosis";
      await db.$executeRawUnsafe(`UPDATE "LiveMetricReport" SET status='failed',"errorCode"='attempt_limit',attempts=5 WHERE id=$1`, fresh.reportId);
      assert.equal(await compiledModule.exports.claimMetricReport(db, fresh), false);
      const [failed] = await db.$queryRawUnsafe('SELECT status,"errorCode",attempts FROM "LiveMetricReport" WHERE id=$1', fresh.reportId);
      assert.deepEqual(failed, { status: "failed", errorCode: "attempt_limit", attempts: 5 });
      checkStage = "order-reader:same-live-serialization";
      const beforeRace = await orderSource(db, a.vendor.id);
      // Distinct order transactions must not conflict merely because they
      // append invalidations for the same live. No synthetic ledger read is added.
      let firstError = null;
      try {
      await db.$transaction(async first => {
        assert.equal((await first.commerceOrder.findUniqueOrThrow({ where: { id: "metric-order-e-other-person" }, select: { status: true } })).status, "paid");
        await db.$transaction(async second => {
          await second.commerceOrder.update({ where: { id: "metric-order-b-cancelled" }, data: { status: "cancelled" } });
        }, { isolationLevel: "Serializable" });
        await first.commerceOrder.update({ where: { id: "metric-order-e-other-person" }, data: { status: "cancelled" } });
      }, { isolationLevel: "Serializable" });
      } catch (error) { firstError = error; }
      if (firstError) {
        assert.equal(diagnostic(firstError), "P2034");
        // Preserve the existing two-attempt payment policy even when PostgreSQL
        // detects a dependency outside the removed counter update.
        await db.$transaction(async retry => {
          await retry.commerceOrder.update({ where: { id: "metric-order-e-other-person" }, data: { status: "cancelled" } });
        }, { isolationLevel: "Serializable" });
      }
      assert.equal(await orderSource(db, a.vendor.id), beforeRace + 2n);
      checkStage = "order-reader:nonowner-writer";
      const roleRollback = new Error("expected-writer-role-rollback");
      try {
        await db.$transaction(async tx => {
          await tx.$executeRawUnsafe('CREATE ROLE wp20_order_writer_probe NOLOGIN');
          await tx.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO wp20_order_writer_probe');
          await tx.$executeRawUnsafe('GRANT SELECT (id,"vendorId",status),UPDATE (status) ON "CommerceOrder" TO wp20_order_writer_probe');
          await tx.$executeRawUnsafe(`CREATE POLICY wp20_order_writer_probe_policy ON "CommerceOrder" TO wp20_order_writer_probe USING (id='metric-order-e-other-person') WITH CHECK (id='metric-order-e-other-person')`);
          await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_order_writer_probe');
          const [rights] = await tx.$queryRawUnsafe(`SELECT has_table_privilege(current_user,'public."LiveMetricOrderSource"','SELECT,INSERT,UPDATE,DELETE') AS direct_access`);
          assert.equal(rights.direct_access, false);
          assert.equal(await tx.$executeRawUnsafe(`UPDATE "CommerceOrder" SET status='pending_payment' WHERE id=$1`, "metric-order-e-other-person"), 1);
          await tx.$executeRawUnsafe('RESET ROLE');
          assert.equal(await orderSource(tx, a.vendor.id), beforeRace + 3n);
          throw roleRollback;
        });
      } catch (error) { if (error !== roleRollback) throw error; }
      assert.equal(await orderSource(db, a.vendor.id), beforeRace + 2n);

      checkStage = "order-reader:twenty-writers";
      const stressIds = [];
      for (let i = 0; i < 20; i += 1) {
        const payment = await db.paymentTransaction.create({ data: { vendorId: a.vendor.id, providerName: "synthetic-metric", status: "pending",
          metadata: { formSubmissionId: a.submission.id, sourceLiveId: a.live.id, billingPurpose: "buyer_order" } } });
        paymentIds.push(payment.id);
        const id = `metric-contention-order-${i}`;
        await db.commerceOrder.create({ data: { id, vendorId: a.vendor.id, primaryPaymentTransactionId: payment.id, orderNumber: id,
          checkoutIdempotencyKey: id, checkoutIdentityHash: "a".repeat(43), status: "pending_payment", subtotalAmountCents: 100, totalAmountCents: 100,
          buyerEncryptedEnvelope: "synthetic-unused-envelope", buyerMaskedName: "Synthetic", buyerMaskedEmail: "synthetic@example.test",
          isTestOrder: true, createdAt: new Date(+now - 10000) } });
        orderIds.push(id); stressIds.push(id);
      }
      const stressLease = { ...lease, reportId: "order-contention-report" };
      await insert(db, "LiveMetricReport", { id: stressLease.reportId, vendorId: lease.vendorId, liveId: lease.liveId, versionId: version.id,
        windowStartAt: new Date(+now - 17000), windowEndAt: new Date(+now - 5000), inputRevision: await revision(db, version.id), expiresAt: version.expiresAt });
      const beforeBurst = await orderSource(db, a.vendor.id);
      const readPlan = await db.$queryRawUnsafe('EXPLAIN (FORMAT JSON) SELECT status FROM "CommerceOrder" WHERE id=$1', stressIds[0]);
      const writePlan = await db.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) UPDATE "CommerceOrder" SET status='cancelled' WHERE id=$1`, stressIds[0]);
      const planNodes = plan => [{ node: plan["Node Type"], relation: plan["Relation Name"] ?? null, index: plan["Index Name"] ?? null }, ...(plan.Plans ?? []).flatMap(planNodes)];
      const contentionPlans = { read: planNodes(readPlan[0]["QUERY PLAN"][0].Plan), write: planNodes(writePlan[0]["QUERY PLAN"][0].Plan) };

      let arrived = 0, releaseBarrier;
      let predicateLocks = [];
      const barrier = new Promise(resolve => { releaseBarrier = resolve; });
      // The timeout releases resources but cannot make this test pass: all 20
      // first snapshots must have reached the barrier before any update.
      const barrierTimer = setTimeout(() => releaseBarrier(), 10000);
      const started = performance.now();
      const writers = stressIds.map(async id => {
        const conflicts = [];
        let phase = "begin";
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await db.$transaction(async tx => {
              if (attempt === 0) {
                // Establish the actual payment-like snapshot from its own
                // order, without adding an artificial read of the shared ledger.
                assert.equal((await tx.commerceOrder.findUniqueOrThrow({ where: { id }, select: { status: true } })).status, "pending_payment");
                arrived += 1;
                if (arrived === 20) {
                  // Catalog-only diagnostic: no query texts, parameters or row data.
                  predicateLocks = await db.$queryRawUnsafe(`SELECT c.relname AS relation,l.locktype,count(*)::int AS count
                    FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
                    WHERE l.mode='SIReadLock' AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
                    GROUP BY c.relname,l.locktype ORDER BY c.relname,l.locktype`);
                  clearTimeout(barrierTimer); releaseBarrier();
                }
                await barrier;
              }
              phase = "update";
              await tx.commerceOrder.update({ where: { id }, data: { status: "cancelled" } });
              phase = "commit";
            }, { isolationLevel: "Serializable", timeout: 15000, maxWait: 15000 });
            return { committed: true, conflicts };
          } catch (error) {
            recordSerialization(error, attempt, phase);
            const code = diagnostic(error); conflicts.push(code);
            if (!["P2034", "P2002"].includes(code)) return { committed: false, conflicts };
          }
        }
        return { committed: false, conflicts };
      });
      const reportLoop = (async () => {
        await barrier;
        for (let i = 0; i < 5; i += 1) {
          await compiledModule.exports.claimMetricReport(db, stressLease);
          await compiledModule.exports.finishMetricReport(db, stressLease, aggregate);
        }
      })();
      const settled = await Promise.allSettled([...writers, reportLoop]);
      clearTimeout(barrierTimer);
      const outcomes = settled.slice(0, 20).map(item => item.status === "fulfilled" ? item.value : { committed: false, conflicts: [diagnostic(item.reason)] });
      orderContentionMetrics = { predicateLocks, plans: contentionPlans, writers: 20, synchronizedSnapshots: arrived, retryAttempts: 2,
        committed: outcomes.filter(item => item.committed).length, exhausted: outcomes.filter(item => !item.committed).length,
        conflicts: outcomes.flatMap(item => item.conflicts).length, errorCodes: [...new Set(outcomes.flatMap(item => item.conflicts))],
        reportLoop: settled[20].status, elapsedMs: Math.round(performance.now() - started),
        sourceDelta: Number(await orderSource(db, a.vendor.id) - beforeBurst) };
      if (orderContentionMetrics.committed < 20) {
        // Diagnostic control only. Acceptance below still checks the enabled
        // trigger run and MUST fail; this cannot qualify a passing release.
        await db.commerceOrder.updateMany({ where: { id: { in: stressIds } }, data: { status: "pending_payment" } });
        // Separate raw-SQL diagnostic exposes SQLSTATE detail hidden by ORM P2034.
        // It never substitutes for the original enabled-trigger acceptance result.
        let rawArrived=0, releaseRaw;
        const rawGate=new Promise(resolve=>{releaseRaw=resolve;});
        const rawTimer=setTimeout(()=>releaseRaw(),10000);
        const rawResults=await Promise.all(stressIds.map(async id=>{
          let phase="read";
          try {
            await db.$transaction(async tx=>{
              await tx.$queryRawUnsafe('SELECT status FROM "CommerceOrder" WHERE id=$1',id);
              rawArrived+=1;
              if(rawArrived===20){clearTimeout(rawTimer);releaseRaw();}
              await rawGate;
              phase="update";
              await tx.$executeRawUnsafe(`UPDATE "CommerceOrder" SET status='cancelled',"updatedAt"=CURRENT_TIMESTAMP WHERE id=$1`,id);
              phase="commit";
            },{isolationLevel:"Serializable",timeout:15000,maxWait:15000});
            return {status:"committed"};
          } catch(error) {
            const message=String(error?.meta?.message??"");
            const reason=/pivot.*commit|commit.*pivot/i.test(message)?"pivot_at_commit"
              :/pivot/i.test(message)?"pivot_other"
              :/read.write dependencies/i.test(message)?"read_write_dependency"
              :/concurrent update/i.test(message)?"concurrent_update"
              :/deadlock detected/i.test(message)?"deadlock_detected":"not_exposed";
            return {status:"failed",phase,code:diagnostic(error),reason};
          }
        }));
        clearTimeout(rawTimer);
        orderContentionMetrics.rawSqlDiagnostic={acceptance:"NOT_APPLICABLE",synchronizedSnapshots:rawArrived,results:rawResults};
        await db.commerceOrder.updateMany({where:{id:{in:stressIds}},data:{status:"pending_payment"}});
        await db.$executeRawUnsafe('ALTER TABLE "CommerceOrder" DISABLE TRIGGER "CommerceOrder_metric_source"');
        try {
          let controlArrived = 0, releaseControl;
          const controlGate = new Promise(resolve => { releaseControl = resolve; });
          const controlTimer = setTimeout(() => releaseControl(), 10000);
          const controlStarted = performance.now();
          const controlWriters = stressIds.map(async id => {
            const codes = [];
            for (let attempt = 0; attempt < 2; attempt += 1) {
              try {
                await db.$transaction(async tx => {
                  if (attempt === 0) {
                    assert.equal((await tx.commerceOrder.findUniqueOrThrow({ where: { id }, select: { status: true } })).status, "pending_payment");
                    controlArrived += 1;
                    if (controlArrived === 20) { clearTimeout(controlTimer); releaseControl(); }
                    await controlGate;
                  }
                  await tx.commerceOrder.update({ where: { id }, data: { status: "cancelled" } });
                }, { isolationLevel: "Serializable", timeout: 15000, maxWait: 15000 });
                return { committed: true, codes };
              } catch (error) {
                codes.push(diagnostic(error));
                if (!["P2034", "P2002"].includes(diagnostic(error))) break;
              }
            }
            return { committed: false, codes };
          });
          const controlReport = (async () => {
            await controlGate;
            for (let i = 0; i < 5; i += 1) {
              await compiledModule.exports.claimMetricReport(db, stressLease);
              await compiledModule.exports.finishMetricReport(db, stressLease, aggregate);
            }
          })();
          const controlSettled = await Promise.allSettled([...controlWriters, controlReport]);
          clearTimeout(controlTimer);
          const controlOutcomes = controlSettled.slice(0, 20).map(item => item.status === "fulfilled" ? item.value : { committed: false, codes: [diagnostic(item.reason)] });
          orderContentionMetrics.diagnosticControl = { acceptance: "NOT_APPLICABLE", onlyNewMetricTriggerDisabled: true,
            synchronizedSnapshots: controlArrived, committed: controlOutcomes.filter(item => item.committed).length,
            conflicts: controlOutcomes.flatMap(item => item.codes).length, errorCodes: [...new Set(controlOutcomes.flatMap(item => item.codes))],
            reportLoop: controlSettled[20].status, elapsedMs: Math.round(performance.now() - controlStarted) };
        } finally {
          await db.$executeRawUnsafe('ALTER TABLE "CommerceOrder" ENABLE TRIGGER "CommerceOrder_metric_source"');
          const [enabled] = await db.$queryRawUnsafe(`SELECT tgenabled FROM pg_trigger WHERE tgname='CommerceOrder_metric_source' AND tgrelid='public."CommerceOrder"'::regclass`);
          assert.equal(enabled.tgenabled, "O");
          orderContentionMetrics.diagnosticControlRestored = true;
        }
      }
      assert.equal(arrived, 20);
      assert.equal(orderContentionMetrics.committed, 20, "Metric invalidation must not exhaust payment retry budget");
      assert.equal(orderContentionMetrics.sourceDelta, 20);
      assert.equal(orderContentionMetrics.reportLoop, "fulfilled");



    } finally {
      await db.commerceOrder.deleteMany({ where: { id: { in: orderIds } } });
      await db.paymentTransaction.deleteMany({ where: { id: { in: paymentIds } } });
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1', version.id);
      await db.live.delete({ where: { id: otherLive.id } });
    }
  });
  await check("report lease service isolates claim ownership and aggregate completion", async () => {
    const { claimMetricReport, finishMetricReport, readMetricIntervalPage, readMetricRegistrationPage, readMetricSessionPage } = compiledModule.exports;
    const reportId = "worker-service-report";
    const readerSessionId = "reader-populated-session";
    const scope = { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, reportId, workerId: "worker-a" };
      await insert(db, "LiveMetricSession", { ...a.session, id: readerSessionId });
      const readerIdentity = { vendorId: a.vendor.id, liveId: a.live.id, submissionId: a.submission.id, admissionId: a.admission.id };
      const segment = sequence => ({ sequence, startElapsedMs: 1000 + sequence * 1000, endElapsedMs: 2000 + sequence * 1000,
        mediaStartMs: sequence * 1000, mediaEndMs: (sequence + 1) * 1000, rate: 1 });
      await ingestMetricIntervals(db, readerIdentity, { sessionId: readerSessionId, segments: [segment(0), segment(1), segment(2)] });
    await insert(db, "LiveMetricReport", { id: reportId, vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id,
      windowStartAt: a.version.collectionStartedAt, windowEndAt: new Date(+now - 6000), inputRevision: await revision(db, a.version.id), expiresAt: a.version.expiresAt });
    const missing = { status: "unavailable", reason: "missing_data" };
    const result = { registrationRate: missing, attendanceRate: missing, completionRate: missing, averageViewingSeconds: missing,
      postCompletionOrderRate: missing, unattributedRegistrations: null, provisionalConversions: null };
    try {
      assert.equal(await claimMetricReport(db, { ...scope, vendorId: b.vendor.id }), false);
      const claims = await Promise.all([claimMetricReport(db, scope), claimMetricReport(db, { ...scope, workerId: "worker-b" })]);
      assert.equal(claims.filter(Boolean).length, 1);
      const winner = claims[0] ? "worker-a" : "worker-b";
      const readInput = { ...scope, workerId: winner, sessionId: a.session.id, afterSequence: -1, take: 2 };
      await assert.rejects(() => readMetricIntervalPage(db, readInput), /repeatable-read/);
      await db.$transaction(async tx => {
        const cohortInput = { ...scope, workerId: winner, afterId: null, take: 1 };
        const cohort = await readMetricRegistrationPage(tx, cohortInput);
        assert.equal(cohort.status, "available"); assert.equal(cohort.hasMore, false);
        assert.deepEqual(cohort.rows.map(row => ({ id: row.id, visitorId: row.visitorId, identityCurrent: row.identityCurrent })),
          [{ id: a.registration.id, visitorId: a.visitor.id, identityCurrent: true }]);
        assert.equal(+cohort.rows[0].verifiedAt, +a.registration.verifiedAt);
        const nextCohort = await readMetricRegistrationPage(tx, { ...cohortInput, afterId: cohort.nextId });
        assert.deepEqual(nextCohort.rows, []); assert.equal(nextCohort.hasMore, false);
        assert.equal((await readMetricRegistrationPage(tx, { ...cohortInput, vendorId: b.vendor.id })).status, "unavailable");
        const sessionInput = { ...scope, workerId: winner, registrationId: a.registration.id, afterId: null, take: 1 };
        const sessions = await readMetricSessionPage(tx, sessionInput);
        assert.equal(sessions.status, "available"); assert.equal(sessions.hasMore, true);
        assert.equal(sessions.rows[0].id, readerSessionId); assert.equal(sessions.rows[0].complete, false);
        const laterSessions = await readMetricSessionPage(tx, { ...sessionInput, afterId: sessions.nextId });
        assert.deepEqual(laterSessions.rows.map(row => row.id), [a.session.id]); assert.equal(laterSessions.hasMore, false);
        assert.equal((await readMetricSessionPage(tx, { ...sessionInput, registrationId: b.registration.id })).status, "unavailable");
        const page = await readMetricIntervalPage(tx, readInput);
        assert.equal(page.status, "available"); assert.deepEqual(page.rows, []);
        assert.equal(page.hasMore, false); assert.equal(page.deliveryComplete, false);
        assert.equal((await readMetricIntervalPage(tx, { ...readInput, sessionId: b.session.id })).status, "unavailable");
        assert.equal((await readMetricIntervalPage(tx, { ...readInput, workerId: "foreign" })).status, "unavailable");
      }, { isolationLevel: "RepeatableRead" });

      const populatedInput = { ...readInput, sessionId: readerSessionId };
      await db.$transaction(async tx => {
        const first = await readMetricIntervalPage(tx, populatedInput);
        assert.equal(first.status, "available"); assert.deepEqual(first.rows.map(row => row.sequence), [0, 1]);
        assert.equal(first.nextSequence, 1); assert.equal(first.hasMore, true);
        // A separate committed writer must not alter the reader's snapshot.
        await ingestMetricIntervals(db, readerIdentity, { sessionId: readerSessionId, segments: [segment(3)] });
        const second = await readMetricIntervalPage(tx, { ...populatedInput, afterSequence: first.nextSequence });
        assert.deepEqual(second.rows.map(row => row.sequence), [2]); assert.equal(second.hasMore, false);
        assert.equal(second.nextSequence, 2); assert.equal(second.deliveryComplete, false);
        const rows = [...first.rows, ...second.rows];
        assert.equal(new Set(rows.map(row => row.sequence)).size, 3);
        assert.equal(rows.reduce((sum, row) => sum + +row.wallEndAt - +row.wallStartAt, 0), 3000);
      }, { isolationLevel: "RepeatableRead", timeout: 10000 });
      await db.$transaction(async tx => {
        const latest = await readMetricIntervalPage(tx, { ...populatedInput, afterSequence: 2 });
        assert.deepEqual(latest.rows.map(row => row.sequence), [3]); assert.equal(latest.hasMore, false);
      }, { isolationLevel: "RepeatableRead" });

      const { loadMetricViewingSnapshot, MetricReadBudget } = compiledModule.exports;
      const snapshot = await loadMetricViewingSnapshot(db, { ...scope, workerId: winner });
      assert.equal(snapshot.status, "available"); assert.equal(snapshot.data.registrations.length, 1);
      assert.deepEqual(snapshot.data.context, { sourceRevision: await revision(db, a.version.id), windowStartAt: a.version.collectionStartedAt, windowEndAt: new Date(+now - 6000),
        mode: a.version.mode, durationMs: a.version.durationMs, collectionEnabled: true, collectionStartedAt: a.version.collectionStartedAt });
      assert.equal(snapshot.data.sessions.length, 2); assert.equal(snapshot.data.deliveryComplete, false);
      assert.equal(snapshot.data.sessions.flatMap(item => item.intervals).length, 4);
      assert.deepEqual(await loadMetricViewingSnapshot(db, { ...scope, workerId: winner }, new MetricReadBudget({ rows: 1, pages: 10, milliseconds: 1000 })),
        { status: "unavailable", reason: "limit_exceeded" });
      assert.deepEqual(await loadMetricViewingSnapshot(db, { ...scope, workerId: "foreign" }),
        { status: "unavailable", reason: "lease_or_scope_unavailable" });
      assert.equal(await finishMetricReport(db, { ...scope, workerId: "not-owner" }, result), false);
      assert.equal(await finishMetricReport(db, { ...scope, workerId: winner }, result), true);
      const [stored] = await db.$queryRawUnsafe('SELECT status,result FROM "LiveMetricReport" WHERE id=$1', reportId);
      assert.equal(stored.status, "ready"); assert.deepEqual(stored.result, result);
      assert.equal(await finishMetricReport(db, { ...scope, workerId: winner }, result), false);
    } finally {
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricReport" WHERE id=$1', reportId);
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricSession" WHERE id=$1', readerSessionId);
    }
  });

  await check("lease compare-and-delete preserves renewed and foreign admissions", async () => {
    const { releaseLiveViewer, hashLiveViewerToken } = compiledModule.exports;
    const token = "L".repeat(43);
    const expiresAt = new Date(Date.now() + 90000);
    const owned = await db.liveViewerSession.create({ data: { vendorId: a.vendor.id, liveId: a.live.id, tokenHash: hashLiveViewerToken(token), lastSeenAt: new Date(), expiresAt } });
    const scope = { vendorId: a.vendor.id, liveId: a.live.id, token };
    const lease = { id: owned.id, expiresAtMs: +expiresAt };
    try {
      assert.equal(await releaseLiveViewer(db, scope), 0);
      await db.liveViewerSession.update({ where: { id: owned.id }, data: { expiresAt: new Date(+expiresAt + 1) } });
      assert.equal(await releaseLiveViewer(db, { ...scope, lease }), 0);
      const renewed = { ...lease, expiresAtMs: +expiresAt + 1 };
      assert.equal(await releaseLiveViewer(db, { ...scope, vendorId: b.vendor.id, lease: renewed }), 0);
      assert.equal(await releaseLiveViewer(db, { ...scope, lease: { ...renewed, id: "foreign" } }), 0);
      assert.equal(await db.liveViewerSession.count({ where: { id: owned.id } }), 1);
      assert.equal(await releaseLiveViewer(db, { ...scope, lease: renewed }), 1);
      assert.equal(await releaseLiveViewer(db, { ...scope, lease: renewed }), 0);
    } finally { await db.liveViewerSession.deleteMany({ where: { id: owned.id } }); }
  });

  const identity = { vendorId: a.vendor.id, liveId: a.live.id, submissionId: a.submission.id, admissionId: a.admission.id };
  const serviceSession = { ...a.session, id: "ingestion-service-session" };
  await insert(db, "LiveMetricSession", serviceSession);
  const serviceSegment = { sequence: 0, startElapsedMs: 1000, endElapsedMs: 2000, mediaStartMs: 0, mediaEndMs: 1000, rate: 1 };
  const serviceBatch = { sessionId: serviceSession.id, segments: [serviceSegment] };
  const expectServiceError = async (run, code) => {
    await assert.rejects(run, (error) => error?.name === "MetricIngestError" && error.code === code);
  };
  await check("authorization callback and interval append share one real transaction", async () => {
    const sessionId = "ingestion-callback-commit";
    const receipt = await ingestMetricIntervals(db, async (tx, phase) => {
      assert.equal(typeof tx.$transaction, "undefined");
      const source = await tx.formSubmission.findUnique({ where: { id: identity.submissionId }, select: { verificationStatus: true } });
      assert.equal(source.verificationStatus, "VERIFIED");
      // A separate transaction could not see this uncommitted session.
      if (phase === "resolve") await insert(tx, "LiveMetricSession", { ...a.session, id: sessionId });
      return identity;
    }, { ...serviceBatch, sessionId });
    assert.equal(receipt.accepted, 1);
    assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" WHERE "sessionId"=$1', sessionId))[0].n, 1);
  });
  await check("authorization denial rolls back callback writes and appends nothing", async () => {
    const sessionId = "ingestion-callback-denied";
    const denial = new Error("synthetic-authorization-denial");
    await assert.rejects(() => ingestMetricIntervals(db, async (tx) => {
      await insert(tx, "LiveMetricSession", { ...a.session, id: sessionId });
      throw denial;
    }, { ...serviceBatch, sessionId }), (error) => error === denial);
    assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricSession" WHERE id=$1', sessionId))[0].n, 0);
    assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" WHERE "sessionId"=$1', sessionId))[0].n, 0);
  });
  await check("invalid callback identity rolls back prior callback writes", async () => {
    const sessionId = "ingestion-callback-invalid";
    await expectServiceError(() => ingestMetricIntervals(db, async (tx) => {
      await insert(tx, "LiveMetricSession", { ...a.session, id: sessionId });
      return { ...identity, submissionId: "" };
    }, { ...serviceBatch, sessionId }), "not_authorized");
    assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricSession" WHERE id=$1', sessionId))[0].n, 0);
  });
  await check("blacklist committed on another connection after identity resolution prevents append", async () => {
    const sessionId = "ingestion-blacklist-race";
    await insert(db, "LiveMetricSession", { ...a.session, id: sessionId });
    const phases = [];
    let rule;
    try {
      await expectServiceError(() => ingestMetricIntervals(db, async (tx, phase) => {
        phases.push(phase);
        const blocked = await tx.blacklist.findFirst({ where: { vendorId: a.vendor.id, identifierType: "email", identifier: a.submission.email, isActive: true } });
        if (blocked) throw new MetricIngestError("not_authorized");
        if (phase === "resolve") {
          const [inside] = await tx.$queryRawUnsafe("SELECT pg_backend_pid() AS pid");
          const [outside] = await db.$queryRawUnsafe("SELECT pg_backend_pid() AS pid");
          assert.notEqual(inside.pid, outside.pid);
          rule = await db.blacklist.create({ data: { vendorId: a.vendor.id, identifierType: "email", identifier: a.submission.email, reason: "synthetic race regression", isActive: true } });
        }
        return identity;
      }, { ...serviceBatch, sessionId }), "not_authorized");
      assert.deepEqual(phases, ["resolve", "revalidate"]);
      assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" WHERE "sessionId"=$1', sessionId))[0].n, 0);
    } finally { if (rule) await db.blacklist.delete({ where: { id: rule.id } }); }
  });
  await check("identity changing during locked revalidation cannot append", async () => {
    const sessionId = "ingestion-identity-drift";
    await insert(db, "LiveMetricSession", { ...a.session, id: sessionId });
    await expectServiceError(() => ingestMetricIntervals(db, async (_tx, phase) => phase === "resolve" ? identity : { ...identity, submissionId: b.submission.id }, { ...serviceBatch, sessionId }), "not_authorized");
    assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" WHERE "sessionId"=$1', sessionId))[0].n, 0);
  });
  const { closeMetricSession } = compiledModule.exports;
  const closeAdmission = await db.liveViewerSession.create({ data: { ...a.admission, id: "lifecycle-admission", tokenHash: "4".repeat(64) } });
  const closeIdentity = { ...identity, admissionId: closeAdmission.id };
  const createCloseSession = async (id) => { await insert(db, "LiveMetricSession", { ...a.session, id, admissionSessionId: closeAdmission.id }); return id; };
  const secondSegment = { ...serviceSegment, sequence: 1, startElapsedMs: 2000, endElapsedMs: 3000, mediaStartMs: 1000, mediaEndMs: 2000 };
  await check("close seals a complete delivered sequence and exact retries preserve the close timestamp", async () => {
    const sessionId = await createCloseSession("close-complete");
    await ingestMetricIntervals(db, closeIdentity, { sessionId, segments: [serviceSegment, secondSegment] });
    const receipt = await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 1 });
    assert.equal(receipt.deliveryComplete, true); assert.equal(receipt.lastSequence, 1);
    assert.deepEqual(await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 1 }), receipt);
    await expectServiceError(() => closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 2 }), "sequence_conflict");
    await expectServiceError(() => ingestMetricIntervals(db, closeIdentity, { sessionId, segments: [{ ...secondSegment, sequence: 2, startElapsedMs: 3000, endElapsedMs: 4000, mediaStartMs: 2000, mediaEndMs: 3000 }] }), "session_closed");
  });
  await check("pending close allows missing sequences but cannot claim delivery completion early", async () => {
    const sessionId = await createCloseSession("close-pending");
    assert.equal((await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 1 })).deliveryComplete, false);
    await ingestMetricIntervals(db, closeIdentity, { sessionId, segments: [serviceSegment] });
    assert.equal((await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 1 })).deliveryComplete, false);
    await ingestMetricIntervals(db, closeIdentity, { sessionId, segments: [secondSegment] });
    assert.equal((await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 1 })).deliveryComplete, true);
  });
  await check("declared final sequence cannot grow and a batch beyond it rolls back atomically", async () => {
    const sessionId = await createCloseSession("close-bounded");
    await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 0 });
    await expectServiceError(() => closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 1 }), "sequence_conflict");
    await expectServiceError(() => ingestMetricIntervals(db, closeIdentity, { sessionId, segments: [serviceSegment, secondSegment] }), "evidence_rejected");
    assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" WHERE "sessionId"=$1', sessionId))[0].n, 0);
    await ingestMetricIntervals(db, closeIdentity, { sessionId, segments: [serviceSegment] });
    assert.equal((await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 0 })).deliveryComplete, true);
  });
  await check("close refuses another tenant or registration and permits an explicit empty stream", async () => {
    const sessionId = await createCloseSession("close-empty");
    await expectServiceError(() => closeMetricSession(db, { ...closeIdentity, vendorId: b.vendor.id }, { sessionId, finalSequence: -1 }), "not_authorized");
    await expectServiceError(() => closeMetricSession(db, { ...closeIdentity, submissionId: b.submission.id }, { sessionId, finalSequence: -1 }), "not_authorized");
    assert.equal((await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: -1 })).deliveryComplete, true);
  });
  await check("expired metric sessions can acknowledge stored history but cannot append", async () => {
    const sessionId = await createCloseSession("close-expired");
    await ingestMetricIntervals(db, closeIdentity, { sessionId, segments: [serviceSegment] });
    await db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "expiresAt"=$1 WHERE id=$2', new Date(+now - 5000), sessionId);
    await expectServiceError(() => ingestMetricIntervals(db, closeIdentity, { sessionId, segments: [secondSegment] }), "not_authorized");
    const receipt = await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 0 });
    assert.equal(receipt.deliveryComplete, true); assert.equal(receipt.closedAtMs, +now - 5000);
  });
  await check("racing append and close never skip or duplicate the final event", async () => {
    const sessionId = await createCloseSession("close-race");
    await Promise.all([closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 0 }), ingestMetricIntervals(db, closeIdentity, { sessionId, segments: [serviceSegment] })]);
    assert.equal((await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 0 })).deliveryComplete, true);
    assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" WHERE "sessionId"=$1', sessionId))[0].n, 1);
  });
  await check("released admission cannot close or read historical delivery receipts", async () => {
    const admission = await db.liveViewerSession.create({ data: { ...a.admission, id: "close-released-admission", tokenHash: "5".repeat(64) } });
    const sessionId = "close-released";
    await insert(db, "LiveMetricSession", { ...a.session, id: sessionId, admissionSessionId: admission.id });
    await db.liveViewerSession.delete({ where: { id: admission.id } });
    await expectServiceError(() => closeMetricSession(db, { ...identity, admissionId: admission.id }, { sessionId, finalSequence: -1 }), "not_authorized");
  });
  await check("a changed version after lock acquisition aborts interval ingestion", async () => {
    const sessionId = await createCloseSession("interval-version-race");
    let resolutions = 0;
    await expectServiceError(() => ingestMetricIntervals(db, closeIdentity, { sessionId, segments: [serviceSegment] }, async () => ({ versionId: ++resolutions === 1 ? a.version.id : b.version.id, expiresAt: a.version.expiresAt })), "not_authorized");
    assert.equal(resolutions, 2);
    assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" WHERE "sessionId"=$1', sessionId))[0].n, 0);
  });
  await check("expired pending close becomes terminal unknown and exact retries remain idempotent", async () => {
    const sessionId = await createCloseSession("close-expired-gap");
    const pending = await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 1 });
    assert.equal(pending.appendOpen, true); assert.equal(pending.deliveryComplete, false);
    await db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "expiresAt"=$1 WHERE id=$2', new Date(+now - 5000), sessionId);
    const terminal = await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 1 });
    assert.equal(terminal.appendOpen, false); assert.equal(terminal.deliveryComplete, false); assert.equal(terminal.closedAtMs, +now - 5000);
    assert.deepEqual(await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 1 }), terminal);
    await expectServiceError(() => ingestMetricIntervals(db, closeIdentity, { sessionId, segments: [serviceSegment] }), "not_authorized");
  });
  await check("unavailable current content terminates pending old delivery without fabricating completion", async () => {
    const sessionId = await createCloseSession("close-unavailable-gap");
    const unavailable = async () => { throw new MetricIngestError("not_authorized"); };
    const receipt = await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 0 }, unavailable);
    assert.equal(receipt.appendOpen, false); assert.equal(receipt.deliveryComplete, false); assert.notEqual(receipt.closedAtMs, null);
    assert.deepEqual(await closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 0 }, unavailable), receipt);
    await expectServiceError(() => ingestMetricIntervals(db, closeIdentity, { sessionId, segments: [serviceSegment] }), "session_closed");
  });
  await check("resolver infrastructure failure never turns missing evidence into a terminal receipt", async () => {
    const sessionId = await createCloseSession("close-provider-failure");
    const failure = new Error("synthetic-resolver-failure");
    await assert.rejects(() => closeMetricSession(db, closeIdentity, { sessionId, finalSequence: 0 }, async () => { throw failure; }), (error) => error === failure);
    const [stored] = await db.$queryRawUnsafe('SELECT "finalSequence","closedAt" FROM "LiveMetricSession" WHERE id=$1', sessionId);
    assert.equal(stored.finalSequence, null); assert.equal(stored.closedAt, null);
  });
  for (const zone of ["UTC", "America/Los_Angeles"]) await check(`append expiry and historical close remain exact in ${zone}`, async () => {
    const sessionId = await createCloseSession(`close-zone-${zone.replaceAll("/", "-")}`);
    const authorize = async (tx) => {
      await tx.$executeRawUnsafe(zone === "UTC" ? "SET LOCAL TIME ZONE 'UTC'" : "SET LOCAL TIME ZONE 'America/Los_Angeles'");
      return closeIdentity;
    };
    await ingestMetricIntervals(db, authorize, { sessionId, segments: [serviceSegment] });
    await db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "expiresAt"=$1 WHERE id=$2', new Date(+now - 5000), sessionId);
    await expectServiceError(() => ingestMetricIntervals(db, authorize, { sessionId, segments: [secondSegment] }), "not_authorized");
    const receipt = await closeMetricSession(db, authorize, { sessionId, finalSequence: 0 });
    assert.equal(receipt.deliveryComplete, true); assert.equal(receipt.closedAtMs, +now - 5000);
  });
  const { issueMetricSession, METRIC_SESSION_LIMITS } = compiledModule.exports;
  const issuanceContext = { versionId: a.version.id, expiresAt: new Date(+now + 1800000), visitorId: a.visitor.id };
  const issuanceRequest = { requestId: "de305d54-75b4-431b-adb2-eb6b9e546014" };
  const authorizeIssuance = async () => identity;
  let issued;
  await check("concurrent session issuance and replay return one stable server-anchored session", async () => {
    const [first, second] = await Promise.all([issueMetricSession(db, authorizeIssuance, issuanceContext, issuanceRequest), issueMetricSession(db, authorizeIssuance, issuanceContext, issuanceRequest)]);
    assert.deepEqual(first, second);
    issued = first;
    assert.deepEqual(await issueMetricSession(db, authorizeIssuance, issuanceContext, issuanceRequest), first);
    const [stored] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricSession" WHERE id=$1', first.sessionId);
    assert.equal(stored.n, 1); assert.equal(first.lastSequence, -1); assert.equal(first.lastElapsedMs, 0);
    assert.equal(first.expiresAtMs, +issuanceContext.expiresAt); assert.equal(first.durationMs, 100000);
    assert.ok(first.anchorAtMs >= +a.registration.verifiedAt);
  });
  await check("session issuance rejects other tenant version and forged identity scope", async () => {
    await expectServiceError(() => issueMetricSession(db, authorizeIssuance, { ...issuanceContext, versionId: b.version.id }, issuanceRequest), "not_authorized");
    await expectServiceError(() => issueMetricSession(db, async () => ({ ...identity, submissionId: b.submission.id }), issuanceContext, issuanceRequest), "not_authorized");
    await expectServiceError(() => issueMetricSession(db, authorizeIssuance, { ...issuanceContext, visitorId: b.visitor.id }, issuanceRequest), "not_authorized");
  });
  await check("session issuance refuses disabled collection without enabling it", async () => {
    await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=false WHERE id=$1', a.version.id);
    try { await expectServiceError(() => issueMetricSession(db, authorizeIssuance, issuanceContext, issuanceRequest), "not_authorized"); }
    finally { await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=true WHERE id=$1', a.version.id); }
  });
  await check("session issuance refuses revoked verification and expired provisioning", async () => {
    await db.formSubmission.update({ where: { id: a.submission.id }, data: { verificationStatus: "UNVERIFIED" } });
    try { await expectServiceError(() => issueMetricSession(db, authorizeIssuance, issuanceContext, issuanceRequest), "not_authorized"); }
    finally { await db.formSubmission.update({ where: { id: a.submission.id }, data: { verificationStatus: "VERIFIED" } }); }
    await expectServiceError(() => issueMetricSession(db, authorizeIssuance, { ...issuanceContext, expiresAt: new Date(+now - 10000) }, issuanceRequest), "not_authorized");
  });
  await check("session issuance creates verified registration but rolls it back on revalidation denial", async () => {
    const submission = await db.formSubmission.create({ data: { formId: a.form.id, liveId: a.live.id, name: "Synthetic", email: "issuance@example.test", verificationStatus: "VERIFIED", verifiedAt: a.registration.verifiedAt } });
    const auth = { ...identity, submissionId: submission.id };
    const ctx = { ...issuanceContext, visitorId: null };
    await expectServiceError(() => issueMetricSession(db, async (_tx, phase) => {
      if (phase === "revalidate") throw new MetricIngestError("not_authorized");
      return auth;
    }, ctx, issuanceRequest), "not_authorized");
    assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricRegistration" WHERE "submissionId"=$1', submission.id))[0].n, 0);
    const receipt = await issueMetricSession(db, async () => auth, ctx, issuanceRequest);
    const [registration] = await db.$queryRawUnsafe('SELECT "verifiedAt","visitorId" FROM "LiveMetricRegistration" WHERE "submissionId"=$1', submission.id);
    assert.equal(+registration.verifiedAt, +submission.verifiedAt); assert.equal(registration.visitorId, null);
    assert.notEqual(receipt.sessionId, issued.sessionId);
    assert.deepEqual(await issueMetricSession(db, async () => auth, { ...ctx, visitorId: a.visitor.id }, issuanceRequest), receipt);
    const [unchanged] = await db.$queryRawUnsafe('SELECT "visitorId" FROM "LiveMetricRegistration" WHERE "submissionId"=$1', submission.id);
    assert.equal(unchanged.visitorId, null);
  });
  await check("a different proven browser permits issuance without rewriting first registration attribution", async () => {
    const visitor = { ...a.visitor, id: "issuance-second-browser", browserHash: "d".repeat(64) };
    await insert(db, "LiveMetricVisitor", visitor);
    assert.deepEqual(await issueMetricSession(db, authorizeIssuance, { ...issuanceContext, visitorId: visitor.id }, issuanceRequest), issued);
    const [registration] = await db.$queryRawUnsafe('SELECT "visitorId" FROM "LiveMetricRegistration" WHERE id=$1', a.registration.id);
    assert.equal(registration.visitorId, a.visitor.id);
  });
  await check("session issuance rejects identity drift after locks", async () => {
    await expectServiceError(() => issueMetricSession(db, async (_tx, phase) => phase === "resolve" ? identity : { ...identity, admissionId: b.admission.id }, issuanceContext, issuanceRequest), "not_authorized");
  });
  await check("session lifetime cannot exceed version or active admission", async () => {
    const receipt = await issueMetricSession(db, authorizeIssuance, { ...issuanceContext, expiresAt: new Date(+now + 7200000) }, { requestId: "de305d54-75b4-431b-adb2-eb6b9e546015" });
    assert.equal(receipt.expiresAtMs, Math.min(+a.version.expiresAt, +a.admission.expiresAt));
  });
  await check("session replay cannot exceed a shortened server lifetime", async () => {
    await expectServiceError(() => issueMetricSession(db, authorizeIssuance, { ...issuanceContext, expiresAt: new Date(+now + 600000) }, issuanceRequest), "not_authorized");
  });
  await check("issued sessions accept ingestion and closed keys cannot restart", async () => {
    const deadline = performance.now() + 10000;
    while (true) {
      const [clock] = await db.$queryRawUnsafe('SELECT clock_timestamp() AS now');
      if (+clock.now > issued.anchorAtMs + 100) break;
      assert.ok(performance.now() < deadline, "Disposable DB clock did not advance");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const receipt = await ingestMetricIntervals(db, identity, { sessionId: issued.sessionId, segments: [{ sequence: 0, startElapsedMs: 0, endElapsedMs: 1, mediaStartMs: 0, mediaEndMs: 1, rate: 1 }] });
    assert.equal(receipt.accepted, 1);
    await db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "closedAt"=date_trunc(\'milliseconds\',clock_timestamp()),"finalSequence"=0,complete=true WHERE id=$1', issued.sessionId);
    await expectServiceError(() => issueMetricSession(db, authorizeIssuance, issuanceContext, issuanceRequest), "session_closed");
  });
  await check("admission open-session quota rejects N plus one while preserving idempotent retries", async () => {
    const admission = await db.liveViewerSession.create({ data: { ...a.admission, id: "issuance-quota-admission", tokenHash: "e".repeat(64) } });
    const auth = { ...identity, admissionId: admission.id };
    const keys = Array.from({ length: METRIC_SESSION_LIMITS.openPerAdmission + 1 }, () => ({ requestId: require("node:crypto").randomUUID() }));
    let first;
    for (const [index, key] of keys.slice(0, -2).entries()) {
      const receipt = await issueMetricSession(db, async () => auth, issuanceContext, key);
      if (index === 0) first = receipt;
    }
    const contenders = await Promise.allSettled(keys.slice(-2).map((key) => issueMetricSession(db, async () => auth, issuanceContext, key)));
    assert.equal(contenders.filter((result) => result.status === "fulfilled").length, 1);
    const denied = contenders.filter((result) => result.status === "rejected");
    assert.equal(denied.length, 1); assert.equal(denied[0].reason.name, "MetricSessionLimitError");
    assert.deepEqual(await issueMetricSession(db, async () => auth, issuanceContext, keys[0]), first);
    const [stored] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricSession" WHERE "admissionSessionId"=$1', admission.id);
    assert.equal(stored.n, METRIC_SESSION_LIMITS.openPerAdmission);
  });
  await check("admission lifetime session quota also bounds already-closed session history", async () => {
    const admission = await db.liveViewerSession.create({ data: { ...a.admission, id: "issuance-history-admission", tokenHash: "f".repeat(64) } });
    for (let index = 0; index < METRIC_SESSION_LIMITS.totalPerAdmission; index++) {
      const session = { ...a.session, id: `issuance-history-${index}`, admissionSessionId: admission.id };
      await insert(db, "LiveMetricSession", session);
      await db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "closedAt"="anchorAt" WHERE id=$1', session.id);
    }
    await assert.rejects(() => issueMetricSession(db, async () => ({ ...identity, admissionId: admission.id }), issuanceContext, issuanceRequest), (error) => error?.name === "MetricSessionLimitError");
  });
  await check("legacy verification timestamps normalize SQL microseconds to the schema millisecond precision", async () => {
    const columns = await db.$queryRawUnsafe(`SELECT table_name,datetime_precision FROM information_schema.columns WHERE table_schema='public' AND column_name='verifiedAt' AND table_name IN ('FormSubmission','LiveMetricRegistration')`);
    assert.equal(columns.length, 2); assert.ok(columns.every((column) => column.datetime_precision === 3));
    const submission = await db.formSubmission.create({ data: { formId: a.form.id, liveId: a.live.id, name: "Synthetic", email: "precision@example.test", verificationStatus: "VERIFIED", verifiedAt: a.registration.verifiedAt } });
    await db.$executeRawUnsafe(`UPDATE "FormSubmission" SET "verifiedAt"=date_trunc('second',clock_timestamp() AT TIME ZONE 'UTC')-INTERVAL '30 seconds'+INTERVAL '123456 microseconds' WHERE id=$1`, submission.id);
    const authorize = async () => ({ ...identity, submissionId: submission.id });
    const receipt = await issueMetricSession(db, authorize, { ...issuanceContext, visitorId: null }, issuanceRequest);
    assert.deepEqual(await issueMetricSession(db, authorize, { ...issuanceContext, visitorId: null }, issuanceRequest), receipt);
  });
  await check("registration lifetime quota survives renewal of the admission credential", async () => {
    const submission = await db.formSubmission.create({ data: { formId: a.form.id, liveId: a.live.id, name: "Synthetic", email: "quota-registration@example.test", verificationStatus: "VERIFIED", verifiedAt: a.registration.verifiedAt } });
    const admission = await db.liveViewerSession.create({ data: { ...a.admission, id: "registration-quota-old", tokenHash: "1".repeat(64) } });
    const renewed = await db.liveViewerSession.create({ data: { ...a.admission, id: "registration-quota-new", tokenHash: "2".repeat(64) } });
    const auth = { ...identity, submissionId: submission.id, admissionId: admission.id };
    await issueMetricSession(db, async () => auth, { ...issuanceContext, visitorId: null }, issuanceRequest);
    const [registration] = await db.$queryRawUnsafe('SELECT id FROM "LiveMetricRegistration" WHERE "submissionId"=$1', submission.id);
    for (let index = 1; index < METRIC_SESSION_LIMITS.totalPerRegistration; index++) {
      const session = { ...a.session, id: `registration-history-${index}`, registrationId: registration.id, admissionSessionId: admission.id };
      await insert(db, "LiveMetricSession", session);
      await db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "closedAt"="anchorAt" WHERE id=$1', session.id);
    }
    await assert.rejects(() => issueMetricSession(db, async () => ({ ...auth, admissionId: renewed.id }), { ...issuanceContext, visitorId: null }, issuanceRequest), (error) => error?.name === "MetricSessionLimitError" && error.reason === "registration_total");
    assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricSession" WHERE "admissionSessionId"=$1', renewed.id))[0].n, 0);
  });
  await check("actual issuance locks allow concurrent foreign-key-style key-share reads", async () => {
    const admission = await db.liveViewerSession.create({ data: { ...a.admission, id: "issuance-compatible-lock", tokenHash: "3".repeat(64) } });
    const auth = { ...identity, admissionId: admission.id };
    let observed = false;
    await issueMetricSession(db, async (tx, phase) => {
      if (phase === "revalidate") {
        const [inside] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
        await db.$transaction(async (other) => {
          await other.$executeRawUnsafe("SET LOCAL lock_timeout='1000ms'");
          const [outside] = await other.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
          assert.notEqual(inside.pid, outside.pid);
          await other.$queryRawUnsafe('SELECT id FROM "FormSubmission" WHERE id=$1 FOR KEY SHARE', auth.submissionId);
          await other.$queryRawUnsafe('SELECT id FROM "LiveViewerSession" WHERE id=$1 FOR KEY SHARE', auth.admissionId);
          observed = true;
        });
      }
      return auth;
    }, issuanceContext, issuanceRequest);
    assert.equal(observed, true);
  });
  await check("issuance transaction timeout under a second backend lock is retryable and leaves no rows", async () => {
    let locked, release;
    const ready = new Promise((resolve) => { locked = resolve; });
    const unlocked = new Promise((resolve) => { release = resolve; });
    const [before] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricSession" WHERE "admissionSessionId"=$1', identity.admissionId);
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "FormSubmission" WHERE id=$1 FOR UPDATE', identity.submissionId);
      locked(); await unlocked;
    }, { timeout: 20000 });
    await ready;
    const timer = setTimeout(() => release(), 12000);
    try {
      await expectServiceError(() => issueMetricSession(db, authorizeIssuance, issuanceContext, { requestId: "de305d54-75b4-431b-adb2-eb6b9e546017" }), "retryable_conflict");
    } finally { clearTimeout(timer); release(); await blocker; }
    const [after] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricSession" WHERE "admissionSessionId"=$1', identity.admissionId);
    assert.equal(after.n, before.n);
  });
  const { resolveMetricSessionContext, metricVideoFingerprint } = compiledModule.exports;
  const runtimeVersionIds = ["runtime-live-version", "runtime-replay-version", "runtime-bad-duration"];
  await db.video.update({ where: { id: a.video.id }, data: { sourceType: "url" } });
  await db.live.update({ where: { id: a.live.id }, data: { status: "scheduled", scheduledAt: new Date(+now - 20000) } });
  const content = await db.video.findUnique({ where: { id: a.video.id }, select: { id: true, vendorId: true, sourceType: true, videoUrl: true, durationSec: true, cloudflareStreamUid: true, cloudflareLiveInputUid: true, cloudflarePlaybackId: true } });
  const runtimeVersion = { ...a.version, id: runtimeVersionIds[0], mode: "live", fingerprint: metricVideoFingerprint(content) };
  await insert(db, "LiveMetricVersion", runtimeVersion);
  await insert(db, "LiveMetricVersion", { ...runtimeVersion, id: runtimeVersionIds[1], mode: "replay" });
  let runtimeIssued;
  try {
    await check("HTTP context resolver chooses an enabled matching live content version inside issuance", async () => {
      const receipt = await issueMetricSession(db, authorizeIssuance, resolveMetricSessionContext, issuanceRequest);
      runtimeIssued = receipt;
      assert.equal(receipt.versionId, runtimeVersionIds[0]); assert.equal(receipt.durationMs, 100000);
      assert.equal(receipt.expiresAtMs, +now + 80000);
    });
    await check("HTTP interval ingestion accepts the current content version with server-bound time", async () => {
      const deadline = performance.now() + 10000;
      while (true) {
        const [clock] = await db.$queryRawUnsafe('SELECT clock_timestamp() AS now');
        if (+clock.now > runtimeIssued.anchorAtMs + 2000) break;
        assert.ok(performance.now() < deadline, "Disposable DB clock did not advance");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const receipt = await ingestMetricIntervals(db, identity, { sessionId: runtimeIssued.sessionId, segments: [{ ...serviceSegment, startElapsedMs: 0, endElapsedMs: 1, mediaEndMs: 1 }] }, resolveMetricSessionContext);
      assert.equal(receipt.accepted, 1);
    });
    await check("issuance rolls back when runtime context changes before final authorization", async () => {
      const [before] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricSession" WHERE "versionId"=$1', runtimeVersionIds[0]);
      let resolutions = 0;
      await expectServiceError(() => issueMetricSession(db, authorizeIssuance, async (tx, auth) => {
        const ctx = await resolveMetricSessionContext(tx, auth);
        resolutions++;
        // Controlled server context change models a boundary crossed while waiting.
        return resolutions === 1 ? ctx : { ...ctx, versionId: runtimeVersionIds[1] };
      }, { requestId: "de305d54-75b4-431b-adb2-eb6b9e546016" }), "not_authorized");
      assert.equal(resolutions, 2);
      const [after] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricSession" WHERE "versionId"=$1', runtimeVersionIds[0]);
      assert.equal(after.n, before.n);
    });
    await check("canonical runtime selects replay independently of browser input", async () => {
      await db.live.update({ where: { id: a.live.id }, data: { scheduledAt: new Date(+now - 200000), replayAvailableUntil: new Date(+now + 500000) } });
      const receipt = await issueMetricSession(db, authorizeIssuance, resolveMetricSessionContext, issuanceRequest);
      assert.equal(receipt.versionId, runtimeVersionIds[1]); assert.equal(receipt.expiresAtMs, +now + 500000);
      await expectServiceError(() => ingestMetricIntervals(db, identity, { sessionId: runtimeIssued.sessionId, segments: [serviceSegment] }, resolveMetricSessionContext), "not_authorized");
      await db.live.update({ where: { id: a.live.id }, data: { scheduledAt: new Date(+now - 20000) } });
    });
    await check("waiting and unavailable runtimes refuse metric sessions", async () => {
      await db.live.update({ where: { id: a.live.id }, data: { scheduledAt: new Date(+now + 3600000) } });
      await expectServiceError(() => issueMetricSession(db, authorizeIssuance, resolveMetricSessionContext, issuanceRequest), "not_authorized");
      await db.live.update({ where: { id: a.live.id }, data: { status: "draft", scheduledAt: new Date(+now - 20000) } });
      await expectServiceError(() => issueMetricSession(db, authorizeIssuance, resolveMetricSessionContext, issuanceRequest), "not_authorized");
      await db.live.update({ where: { id: a.live.id }, data: { status: "scheduled" } });
    });
    await check("disabled version is neither enabled nor bypassed by the context resolver", async () => {
      await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=false WHERE id=$1', runtimeVersionIds[0]);
      await expectServiceError(() => issueMetricSession(db, authorizeIssuance, resolveMetricSessionContext, issuanceRequest), "not_authorized");
      const [stored] = await db.$queryRawUnsafe('SELECT "collectionEnabled" FROM "LiveMetricVersion" WHERE id=$1', runtimeVersionIds[0]);
      assert.equal(stored.collectionEnabled, false);
      await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=true WHERE id=$1', runtimeVersionIds[0]);
    });
    await check("same video ID with replaced content cannot reuse the old fingerprint", async () => {
      await db.video.update({ where: { id: a.video.id }, data: { videoUrl: "https://example.test/replaced.mp4" } });
      await expectServiceError(() => issueMetricSession(db, authorizeIssuance, resolveMetricSessionContext, issuanceRequest), "not_authorized");
      await expectServiceError(() => ingestMetricIntervals(db, identity, { sessionId: runtimeIssued.sessionId, segments: [serviceSegment] }, resolveMetricSessionContext), "not_authorized");
      const close = await closeMetricSession(db, identity, { sessionId: runtimeIssued.sessionId, finalSequence: 0 }, resolveMetricSessionContext);
      assert.equal(close.deliveryComplete, true);
      await db.video.update({ where: { id: a.video.id }, data: { videoUrl: a.video.videoUrl } });
    });
    await check("version duration must agree with current stored video configuration", async () => {
      await db.video.update({ where: { id: a.video.id }, data: { durationSec: 101 } });
      await insert(db, "LiveMetricVersion", { ...runtimeVersion, id: runtimeVersionIds[2], fingerprint: metricVideoFingerprint({ ...content, durationSec: 101 }), durationMs: 100000 });
      await expectServiceError(() => issueMetricSession(db, authorizeIssuance, resolveMetricSessionContext, issuanceRequest), "not_authorized");
    });
  } finally {
    for (const id of runtimeVersionIds) await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1 AND "vendorId"=$2', id, a.vendor.id);
    await db.video.update({ where: { id: a.video.id }, data: { sourceType: a.video.sourceType, videoUrl: a.video.videoUrl, durationSec: a.video.durationSec } });
    await db.live.update({ where: { id: a.live.id }, data: { status: a.live.status, scheduledAt: a.live.scheduledAt, replayAvailableUntil: a.live.replayAvailableUntil } });
  }
  await check("ingestion service persists and acknowledges an exact replay", async () => {
    assert.deepEqual(await ingestMetricIntervals(db, identity, serviceBatch), { accepted: 1, replayed: 0, lastSequence: 0 });
    assert.deepEqual(await ingestMetricIntervals(db, identity, serviceBatch), { accepted: 0, replayed: 1, lastSequence: 0 });
  });
  await check("ingestion service rejects conflicting retry payload", () => expectServiceError(() => ingestMetricIntervals(db, identity, { ...serviceBatch, segments: [{ ...serviceSegment, mediaEndMs: 1001 }] }), "sequence_conflict"));
  await check("ingestion service refuses another tenant or another registration", async () => {
    await expectServiceError(() => ingestMetricIntervals(db, { ...identity, vendorId: b.vendor.id }, serviceBatch), "not_authorized");
    await expectServiceError(() => ingestMetricIntervals(db, { ...identity, submissionId: b.submission.id }, serviceBatch), "not_authorized");
  });
  await check("ingestion service accepts a replay prefix and new suffix atomically", async () => {
    const next = { ...serviceSegment, sequence: 1, startElapsedMs: 2000, endElapsedMs: 3000, mediaStartMs: 1000, mediaEndMs: 2000 };
    assert.deepEqual(await ingestMetricIntervals(db, identity, { ...serviceBatch, segments: [serviceSegment, next] }), { accepted: 1, replayed: 1, lastSequence: 1 });
  });
  await check("concurrent ingestion retries append once and acknowledge once", async () => {
    const next = { ...serviceBatch, segments: [{ ...serviceSegment, sequence: 2, startElapsedMs: 3000, endElapsedMs: 4000, mediaStartMs: 2000, mediaEndMs: 3000 }] };
    const receipts = await Promise.all([ingestMetricIntervals(db, identity, next), ingestMetricIntervals(db, identity, next)]);
    assert.equal(receipts.reduce((sum, receipt) => sum + receipt.accepted, 0), 1);
    assert.equal(receipts.reduce((sum, receipt) => sum + receipt.replayed, 0), 1);
    const [stored] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" WHERE "sessionId"=$1', serviceSession.id);
    assert.equal(stored.n, 3);
  });
  await check("ingestion batch rejects gaps without partial persistence", async () => {
    const first = { ...serviceSegment, sequence: 3, startElapsedMs: 4000, endElapsedMs: 5000, mediaStartMs: 3000, mediaEndMs: 4000 };
    await expectServiceError(() => ingestMetricIntervals(db, identity, { ...serviceBatch, segments: [first, { ...first, sequence: 5, startElapsedMs: 5000, endElapsedMs: 6000 }] }), "invalid_segment");
    const [stored] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" WHERE "sessionId"=$1', serviceSession.id);
    assert.equal(stored.n, 3);
  });

  await check("different ingestion sessions on one version commit without upgrading its revision lock", async () => {
    const ids = ["ingestion-parallel-a", "ingestion-parallel-b"];
    for (const sessionId of ids) await insert(db, "LiveMetricSession", { ...a.session, id: sessionId });
    const before = await revision(db, a.version.id);
    const receipts = await Promise.all(ids.map((sessionId) => ingestMetricIntervals(db, identity, { ...serviceBatch, sessionId })));
    assert.ok(receipts.every((receipt) => receipt.accepted === 1));
    assert.equal(await revision(db, a.version.id), before);
  });
  await check("released admission cannot replay but historical service evidence survives", async () => {
    const admission = { ...a.admission, id: "ingestion-release-admission", tokenHash: "c".repeat(64) };
    await db.liveViewerSession.create({ data: admission });
    await insert(db, "LiveMetricSession", { ...a.session, id: "ingestion-release-session", admissionSessionId: admission.id });
    const auth = { ...identity, admissionId: admission.id };
    const payload = { ...serviceBatch, sessionId: "ingestion-release-session" };
    assert.equal((await ingestMetricIntervals(db, auth, payload)).accepted, 1);
    await db.liveViewerSession.delete({ where: { id: admission.id } });
    await expectServiceError(() => ingestMetricIntervals(db, auth, payload), "not_authorized");
    const [stored] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" WHERE "sessionId"=$1', payload.sessionId);
    assert.equal(stored.n, 1);
  });
  await check("database guard rejection becomes a typed ingestion error", async () => {
    await db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "finalSequence"=2 WHERE id=$1', serviceSession.id);
    const payload = { ...serviceBatch, segments: [{ ...serviceSegment, sequence: 3, startElapsedMs: 4000, endElapsedMs: 5000, mediaStartMs: 3000, mediaEndMs: 4000 }] };
    await expectServiceError(() => ingestMetricIntervals(db, identity, payload), "evidence_rejected");
    const [stored] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" WHERE "sessionId"=$1', serviceSession.id);
    assert.equal(stored.n, 3);
  });
  await check("visit facts count revisits in selected windows and invalidate overlapping reports", async () => {
    const scope = { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, visitorId: a.visitor.id };
    const first = { ...scope, id: "10000000-0000-4000-8000-000000000001", visitedAt: a.visitor.firstVisitedAt };
    const revisit = { ...scope, id: "10000000-0000-4000-8000-000000000002", visitedAt: new Date(+now - 17000) };
    const atEnd = { ...scope, id: "10000000-0000-4000-8000-000000000003", visitedAt: new Date(+now - 10000) };
    const report = { id: "visit-window-report", vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id,
      windowStartAt: revisit.visitedAt, windowEndAt: atEnd.visitedAt, inputRevision: await revision(db, a.version.id), expiresAt: a.version.expiresAt };
    try {
      await insert(db, "LiveMetricVisit", first);
      await insert(db, "LiveMetricReport", report);
      await insert(db, "LiveMetricVisit", atEnd);
      const status = async () => (await db.$queryRawUnsafe('SELECT status FROM "LiveMetricReport" WHERE id=$1', report.id))[0].status;
      assert.equal(await status(), "queued");
      await insert(db, "LiveMetricVisit", revisit);
      assert.equal(await status(), "stale");
      const [counts] = await db.$queryRawUnsafe('SELECT count(DISTINCT "visitorId")::int AS n FROM "LiveMetricVisit" WHERE "vendorId"=$1 AND "liveId"=$2 AND "versionId"=$3 AND "visitedAt">=$4 AND "visitedAt"<$5', a.vendor.id, a.live.id, a.version.id, report.windowStartAt, report.windowEndAt);
      assert.equal(counts.n, 1);
      await rejected(() => insert(db, "LiveMetricVisit", revisit), ["23505"]);
      await rejected(() => insert(db, "LiveMetricVisit", { ...revisit, id: "10000000-0000-4000-8000-000000000004", visitorId: b.visitor.id }));
      await rejected(() => insert(db, "LiveMetricVisit", { ...revisit, id: "10000000-0000-4000-8000-000000000004", visitedAt: new Date(+now + 60000) }));
      await rejected(() => insert(db, "LiveMetricVisit", { ...revisit, id: "10000000-0000-4000-8000-000000000004", visitedAt: new Date(+a.visitor.firstVisitedAt - 1) }));
      await rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricVisit" SET "visitedAt"=$1 WHERE id=$2', atEnd.visitedAt, revisit.id));
      await rejected(() => db.$transaction(tx => insert(tx, "LiveMetricVisit", { ...revisit, id: "10000000-0000-4000-8000-000000000004" }), { isolationLevel: "RepeatableRead" }));
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricReport" WHERE id=$1', report.id);
      const second = { ...revisit, id: "10000000-0000-4000-8000-000000000005" };
      await insert(db, "LiveMetricVisit", second);
      await insert(db, "LiveMetricReport", report);
      const { claimMetricReport, readMetricVisitPage, loadMetricViewingSnapshot } = compiledModule.exports;
      const lease = { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, reportId: report.id, workerId: "visit-reader" };
      assert.equal(await claimMetricReport(db, lease), true);
      await db.$transaction(async tx => {
        const firstPage = await readMetricVisitPage(tx, { ...lease, after: null, take: 1 });
        assert.equal(firstPage.hasMore, true); assert.deepEqual(firstPage.rows, [ { id: revisit.id, visitorId: a.visitor.id, visitedAt: revisit.visitedAt } ]);
        const secondPage = await readMetricVisitPage(tx, { ...lease, after: firstPage.next, take: 1 });
        assert.equal(secondPage.hasMore, false); assert.equal(secondPage.rows[0].id, second.id);
        assert.equal((await readMetricVisitPage(tx, { ...lease, vendorId: b.vendor.id, after: null, take: 1 })).status, "unavailable");
      }, { isolationLevel: "RepeatableRead" });
      const visitSnapshot = await loadMetricViewingSnapshot(db, lease);
      assert.equal(visitSnapshot.status, "available");
      assert.deepEqual(visitSnapshot.data.visitCoverage, { status: "unavailable", reason: "unknown_history" });
      assert.deepEqual(visitSnapshot.data.visits.map(row => row.id), [revisit.id, second.id]);
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVisit" WHERE id=$1', revisit.id);
      assert.equal(await status(), "stale");
    } finally {
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricReport" WHERE id=$1', report.id);
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVisit" WHERE "visitorId"=$1', a.visitor.id);
    }
  });
  await check("visit insertion and report finish cannot leave stale ready output in either lock order", async () => {
    const { claimMetricReport, finishMetricReport } = compiledModule.exports;
    const missing = { status: "unavailable", reason: "missing_data" };
    const aggregate = { registrationRate: missing, attendanceRate: missing, completionRate: missing,
      averageViewingSeconds: missing, postCompletionOrderRate: missing, unattributedRegistrations: null, provisionalConversions: null };
    for (const visitFirst of [true, false]) {
      const reportId = `visit-finish-race-${visitFirst}`;
      const visitId = visitFirst ? "30000000-0000-4000-8000-000000000001" : "30000000-0000-4000-8000-000000000002";
      const lease = { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, reportId, workerId: "race-worker" };
      const visit = { id: visitId, vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id,
        visitorId: a.visitor.id, visitedAt: new Date(+now - 10000) };
      await insert(db, "LiveMetricReport", { id: reportId, vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id,
        windowStartAt: a.version.collectionStartedAt, windowEndAt: new Date(+now - 5000),
        inputRevision: await revision(db, a.version.id), expiresAt: a.version.expiresAt });
      assert.equal(await claimMetricReport(db, lease), true);
      let signalReady, release, signalStarted;
      const ready = new Promise(resolve => { signalReady = resolve; });
      const unlocked = new Promise(resolve => { release = resolve; });
      const started = new Promise(resolve => { signalStarted = resolve; });
      let holderPid, waitingPid, second;
      const first = db.$transaction(async tx => {
        [{ pid: holderPid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
        const value = visitFirst ? await insert(tx, "LiveMetricVisit", visit) : await finishMetricReport(tx, lease, aggregate);
        signalReady(); await unlocked; return value;
      }, { timeout: 20000 });
      // Prevent an early transaction failure from leaving the barrier unresolved.
      void first.catch(() => signalReady());
      const timer = setTimeout(() => release(), 12000);
      try {
        await ready;
        second = db.$transaction(async tx => {
          [{ pid: waitingPid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
          signalStarted();
          return visitFirst ? finishMetricReport(tx, lease, aggregate) : insert(tx, "LiveMetricVisit", visit);
        }, { timeout: 20000 });
        void second.catch(() => signalStarted());
        await started;
        assert.notEqual(holderPid, waitingPid);
        let blocked = false;
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
          const [{ blockers }] = await db.$queryRawUnsafe('SELECT pg_blocking_pids($1::int) AS blockers', waitingPid);
          if (blockers.includes(holderPid)) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(blocked, true);
        release();
        const [firstResult, secondResult] = await Promise.all([first, second]);
        assert.equal(visitFirst ? secondResult : firstResult, !visitFirst);
        const [stored] = await db.$queryRawUnsafe('SELECT status,result,"leaseOwner","leaseExpiresAt" FROM "LiveMetricReport" WHERE id=$1', reportId);
        assert.deepEqual(stored, { status: "stale", result: null, leaseOwner: null, leaseExpiresAt: null });
      } finally {
        clearTimeout(timer); release();
        await Promise.allSettled([first, ...(second ? [second] : [])]);
        await db.$executeRawUnsafe('DELETE FROM "LiveMetricReport" WHERE id=$1', reportId);
        await db.$executeRawUnsafe('DELETE FROM "LiveMetricVisit" WHERE id=$1', visitId);
      }
    }
  });
  await check("complete visit collection commits once and final-write failure rolls back new identity", async () => {
    const { collectMetricVisit, collectPreparedMetricVisit, prepareMetricVisit, createMetricVisitorProofService, metricVideoFingerprint } = compiledModule.exports;
    const [{ clock }] = await db.$queryRawUnsafe('SELECT clock_timestamp() AS clock');
    const c = await fixture(db, "c", clock);
    const scope = { vendorId: c.vendor.id, liveId: c.live.id };
    const proofs = createMetricVisitorProofService(new Uint8Array(32).fill(7));
    const event = { eventId: "80000000-0000-4000-8000-000000000001" };
    try {
      const video = await db.video.update({ where: { id: c.video.id }, data: { sourceType: "url", status: "ready" } });
      await db.registrationForm.update({ where: { id: c.form.id }, data: { fields: [
        { key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }], isActive: true } });
      const template = await db.messageTemplate.create({ data: { vendorId: c.vendor.id, name: "Synthetic collection", subject: "Synthetic confirmation", body: "Synthetic content", channel: "email", trigger: "registration_confirmed", isActive: true } });
      await db.live.update({ where: { id: c.live.id }, data: { status: "scheduled", streamMode: "vod", scheduledAt: new Date(+clock + 3600000), messageTemplateId: template.id } });
      const versionId = "collection-live-version";
      await insert(db, "LiveMetricVersion", { ...c.version, id: versionId, mode: "live", fingerprint: metricVideoFingerprint(video) });
      // Simulate a lost preparation response: no event is submitted for it.
      await prepareMetricVisit(db, proofs, scope);
      const prepared = await prepareMetricVisit(db, proofs, scope);
      // The public capture resolver, real verification domain and projection
      // share one persisted identity; no viewing session is needed to count R.
      const { capturePublicMetricRegistration, verifyFormSubmission, createFormSubmissionVerificationToken, materializeMetricRegistration } = compiledModule.exports;
      const initial = await db.$transaction(async tx => {
        const submission = await tx.formSubmission.create({ data: { formId: c.form.id, liveId: c.live.id, name: "Synthetic public capture", email: "public-capture@example.test", verificationExpiresAt: c.version.expiresAt } });
        const result = await capturePublicMetricRegistration(tx, { ...scope, submissionId: submission.id }, proofs, prepared.proof);
        assert.equal(result.status, "captured"); assert.equal(result.visitorId, prepared.visitorId);
        return submission;
      });
      try {
        const token = createFormSubmissionVerificationToken({ submissionId: initial.id, version: initial.verificationVersion, expiresAt: initial.verificationExpiresAt });
        assert.equal((await verifyFormSubmission(db, token)).status, "verified");
        const automatic = await db.$queryRawUnsafe('SELECT id,"visitorId" FROM "LiveMetricRegistration" WHERE "submissionId"=$1', initial.id);
        assert.equal(automatic.length, 1); assert.equal(automatic[0].visitorId, prepared.visitorId);
        const projection = await materializeMetricRegistration(db, { ...scope, submissionId: initial.id });
        assert.equal(projection.status, "recorded"); assert.equal(projection.versionId, versionId);
        const [stored] = await db.$queryRawUnsafe('SELECT "visitorId" FROM "LiveMetricRegistration" WHERE id=$1', projection.registrationId);
        assert.equal(stored.visitorId, prepared.visitorId);
      } finally { await db.formSubmission.delete({ where: { id: initial.id } }); }
      const [before] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricVisit" WHERE "versionId"=$1', versionId);
      assert.equal(before.n, 0);
      await assert.rejects(() => collectPreparedMetricVisit(db, proofs, scope, event, null), error => error.code === "PROOF_INVALID");
      const issued = await collectPreparedMetricVisit(db, proofs, scope, event, prepared.proof);
      assert.equal(issued.visitorId, prepared.visitorId);
      assert.equal(issued.created, false); assert.equal(issued.replayed, false); assert.equal(issued.versionId, versionId);
      const retries = await Promise.all([collectMetricVisit(db, proofs, scope, event, issued.proof), collectMetricVisit(db, proofs, scope, event, issued.proof)]);
      for (const retry of retries) assert.deepEqual(retry, { ...issued, created: false, replayed: true });
      const counts = async () => (await db.$queryRawUnsafe('SELECT (SELECT count(*)::int FROM "LiveMetricVisitor" WHERE "versionId"=$1) AS visitors, (SELECT count(*)::int FROM "LiveMetricVisit" WHERE "versionId"=$1) AS visits', versionId))[0];
      assert.deepEqual(await counts(), { visitors: 2, visits: 1 });
      let forcedFinalWrite = false;
      const failing = { $transaction: (callback, options) => db.$transaction(async tx => {
        const wrapped = new Proxy(tx, { get(target, prop) {
          if (prop === "$queryRaw") return async query => {
            if (query.sql.includes('INSERT INTO "LiveMetricVisit"')) {
              forcedFinalWrite = true;
              return tx.$queryRawUnsafe('SELECT 1/0');
            }
            return tx.$queryRaw(query);
          };
          const value = Reflect.get(target, prop); return typeof value === "function" ? value.bind(target) : value;
        } });
        return callback(wrapped);
      }, options) };
      await assert.rejects(() => collectMetricVisit(failing, proofs, scope, { eventId: "80000000-0000-4000-8000-000000000002" }), error => error.code === "PERSISTENCE_UNAVAILABLE");
      assert.equal(forcedFinalWrite, true);
      assert.deepEqual(await counts(), { visitors: 2, visits: 1 });
      // Switch actual public runtime to replay without modifying old facts.
      const replayVersionId = "collection-replay-version";
      await db.live.update({ where: { id: c.live.id }, data: { status: "ended", scheduledAt: new Date(+clock - 200000), endedAt: new Date(+clock - 1000), replayEnabled: true, replayAvailableUntil: new Date(+clock + 3600000) } });
      await insert(db, "LiveMetricVersion", { ...c.version, id: replayVersionId, mode: "replay", fingerprint: metricVideoFingerprint(video) });
      await assert.rejects(() => collectPreparedMetricVisit(db, proofs, scope, event, issued.proof), error => error.code === "PROOF_INVALID");
      const replayPrepared = await prepareMetricVisit(db, proofs, scope, issued.proof);
      assert.equal(replayPrepared.versionId, replayVersionId); assert.notEqual(replayPrepared.visitorId, issued.visitorId);
      const replayEvent = { eventId: "80000000-0000-4000-8000-000000000003" };
      const replayVisit = await collectPreparedMetricVisit(db, proofs, scope, replayEvent, replayPrepared.proof);
      assert.equal(replayVisit.versionId, replayVersionId);
      assert.deepEqual(await counts(), { visitors: 2, visits: 1 });
      const [replayCounts] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricVisit" WHERE "versionId"=$1', replayVersionId);
      assert.equal(replayCounts.n, 1);
      await verifyIntegratedVisitBrowser(db, scope, replayVersionId, proofs);
      await assert.rejects(() => prepareMetricVisit(db, proofs, { ...scope, vendorId: b.vendor.id }, issued.proof), error => error.code === "SCOPE_UNAVAILABLE");
      await db.registrationForm.update({ where: { id: c.form.id }, data: { isActive: false } });
      await assert.rejects(() => collectMetricVisit(db, proofs, scope, event, issued.proof), error => error.code === "SCOPE_UNAVAILABLE");
      assert.deepEqual(await counts(), { visitors: 2, visits: 1 });
    } finally {
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE "vendorId"=$1', c.vendor.id);
      await db.vendor.delete({ where: { id: c.vendor.id } });
    }
  });
  await check("visitor provisioning persists identity, reuses proof and rejects disabled or deleted scopes", async () => {
    const { provisionMetricVisitor, createMetricVisitorProofService } = compiledModule.exports;
    const proofs = createMetricVisitorProofService(new Uint8Array(32).fill(7));
    const context = { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, expiresAt: a.version.expiresAt };
    let visitorId;
    try {
      const issued = await provisionMetricVisitor(db, proofs, context);
      visitorId = issued.visitorId;
      assert.equal(issued.created, true);
      const [stored] = await db.$queryRawUnsafe('SELECT "vendorId","liveId","versionId","browserHash","firstVisitedAt" FROM "LiveMetricVisitor" WHERE id=$1', visitorId);
      assert.equal(stored.vendorId, context.vendorId); assert.equal(stored.liveId, context.liveId); assert.equal(stored.versionId, context.versionId);
      assert.match(stored.browserHash, /^[0-9a-f]{64}$/u);
      assert.equal(proofs.verify(issued.proof, { vendorId: context.vendorId, liveId: context.liveId, versionId: context.versionId }, +stored.firstVisitedAt), visitorId);
      const retries = await Promise.all([provisionMetricVisitor(db, proofs, context, issued.proof), provisionMetricVisitor(db, proofs, context, issued.proof)]);
      for (const receipt of retries) assert.deepEqual(receipt, { ...issued, created: false });
      const [count] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricVisitor" WHERE id=$1', visitorId);
      assert.equal(count.n, 1);
      await assert.rejects(() => provisionMetricVisitor(db, proofs, { ...context, vendorId: b.vendor.id }, issued.proof), /scope unavailable/);
      await assert.rejects(() => provisionMetricVisitor(db, proofs, context, "invalid-synthetic-proof"), /proof unavailable/);
      await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=false WHERE id=$1', a.version.id);
      await assert.rejects(() => provisionMetricVisitor(db, proofs, context, issued.proof), /scope unavailable/);
      await assert.rejects(() => provisionMetricVisitor(db, proofs, context), /scope unavailable/);
      await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=true WHERE id=$1', a.version.id);
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVisitor" WHERE id=$1', visitorId);
      await assert.rejects(() => provisionMetricVisitor(db, proofs, context, issued.proof), /scope unavailable/);
    } finally {
      await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=true WHERE id=$1', a.version.id);
      if (visitorId) await db.$executeRawUnsafe('DELETE FROM "LiveMetricVisitor" WHERE id=$1', visitorId);
    }
  });
  await check("authentic expired visitor proof recovers the same persisted identity in nonUTC sessions", async () => {
    const { provisionMetricVisitor, createMetricVisitorProofService } = compiledModule.exports;
    const proofs = createMetricVisitorProofService(new Uint8Array(32).fill(7));
    const scope = { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id };
    const [{ clock }] = await db.$queryRawUnsafe('SELECT clock_timestamp() AS clock');
    const expired = proofs.issue(scope, +clock - 5000, +clock - 4000);
    await insert(db, "LiveMetricVisitor", { ...scope, id: expired.visitorId,
      browserHash: require("node:crypto").createHash("sha256").update(expired.visitorId).digest("hex"), firstVisitedAt: new Date(+clock - 5000) });
    try {
      for (const timezone of ["Asia/Tokyo", "America/Los_Angeles"]) {
        const scopedDb = { $transaction: (callback, options) => db.$transaction(async tx => {
          await tx.$queryRawUnsafe("SELECT set_config('TimeZone',$1,true)", timezone);
          return callback(tx);
        }, options) };
        const recovered = await provisionMetricVisitor(scopedDb, proofs, { ...scope, expiresAt: a.version.expiresAt }, expired.proof);
        assert.equal(recovered.visitorId, expired.visitorId); assert.equal(recovered.created, false);
        const [{ clock: after }] = await db.$queryRawUnsafe('SELECT clock_timestamp() AS clock');
        assert.equal(proofs.verify(recovered.proof, scope, +after), expired.visitorId);
        assert.equal(recovered.expiresAtMs, +a.version.expiresAt);
      }
      const [count] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricVisitor" WHERE id=$1', expired.visitorId);
      assert.equal(count.n, 1);
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVisitor" WHERE id=$1', expired.visitorId);
      await assert.rejects(() => provisionMetricVisitor(db, proofs, { ...scope, expiresAt: a.version.expiresAt }, expired.proof), error => error.code === "VISITOR_MISSING");
    } finally {
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVisitor" WHERE id=$1', expired.visitorId);
    }
  });
  await check("server visit writer serializes retries and preserves the original timestamp", async () => {
    const { recordMetricVisit } = compiledModule.exports;
    const scope = { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, visitorId: a.visitor.id };
    const eventId = "20000000-0000-4000-8000-000000000001";
    try {
      const receipts = await Promise.all([recordMetricVisit(db, scope, { eventId }), recordMetricVisit(db, scope, { eventId })]);
      assert.equal(receipts.filter(row => !row.replayed).length, 1);
      assert.equal(receipts[0].visitedAtMs, receipts[1].visitedAtMs);
      const retry = await recordMetricVisit(db, scope, { eventId });
      assert.equal(retry.replayed, true); assert.equal(retry.visitedAtMs, receipts[0].visitedAtMs);
      const otherScope = { vendorId: b.vendor.id, liveId: b.live.id, versionId: b.version.id, visitorId: b.visitor.id };
      const other = await recordMetricVisit(db, otherScope, { eventId });
      assert.equal(other.replayed, false);
      assert.deepEqual(await recordMetricVisit(db, otherScope, { eventId }), { ...other, replayed: true });
      await assert.rejects(() => recordMetricVisit(db, { ...scope, visitorId: b.visitor.id }, { eventId }), /scope unavailable/);
      await assert.rejects(() => recordMetricVisit(db, scope, { eventId, visitedAtMs: 0 }));
      const [row] = await db.$queryRawUnsafe('SELECT count(*)::int AS n,min("visitedAt") AS first FROM "LiveMetricVisit" WHERE "eventId"=$1 AND "vendorId"=$2', eventId, a.vendor.id);
      assert.equal(row.n, 1); assert.equal(+row.first, receipts[0].visitedAtMs);
      const [all] = await db.$queryRawUnsafe('SELECT count(*)::int AS n,count(DISTINCT id)::int AS ids FROM "LiveMetricVisit" WHERE "eventId"=$1', eventId);
      assert.deepEqual(all, { n: 2, ids: 2 });
      await rejected(() => db.$executeRawUnsafe('TRUNCATE "LiveMetricVisit"'));
      const [afterTruncate] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricVisit" WHERE "eventId"=$1', eventId);
      assert.equal(afterTruncate.n, 2);
    } finally { await db.$executeRawUnsafe('DELETE FROM "LiveMetricVisit" WHERE "eventId"=$1', eventId); }
  });
  await check("visit writer visitor lock does not block unrelated FK inserts", async () => {
    const { recordMetricVisit } = compiledModule.exports;
    const scope = { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, visitorId: a.visitor.id };
    const eventId = "40000000-0000-4000-8000-000000000001";
    const foreignKeyVisitId = "40000000-0000-4000-8000-000000000002";
    let signalLocked, release, holderPid;
    const locked = new Promise(resolve => { signalLocked = resolve; });
    const released = new Promise(resolve => { release = resolve; });
    const instrumented = { $transaction: (callback, options) => db.$transaction(async tx => {
      [{ pid: holderPid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
      return callback({ $queryRaw: async query => {
        const rows = await tx.$queryRaw(query);
        if (query.strings.join("").includes('FROM "LiveMetricVisitor"')) {
          signalLocked(); await released;
        }
        return rows;
      } });
    }, options) };
    const writer = recordMetricVisit(instrumented, scope, { eventId });
    void writer.catch(() => signalLocked());
    const timer = setTimeout(() => release(), 8000);
    try {
      await locked;
      // Must finish before releasing the actual writer's visitor lock. A FOR
      // UPDATE regression conflicts with the FK's KEY SHARE and times out.
      await db.$transaction(async tx => {
        const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
        assert.notEqual(pid, holderPid);
        await tx.$queryRawUnsafe("SELECT set_config('statement_timeout','2000',true)");
        await insert(tx, "LiveMetricVisit", { ...scope, id: foreignKeyVisitId, visitedAt: new Date(+now - 10000) });
      }, { timeout: 5000 });
      release();
      assert.equal((await writer).replayed, false);
    } finally {
      clearTimeout(timer); release(); await Promise.allSettled([writer]);
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVisit" WHERE "eventId" IN ($1,$2)', eventId, foreignKeyVisitId);
    }
  });
  await check("closed collection replays existing receipts but never creates or resurrects events", async () => {
    const { recordMetricVisit } = compiledModule.exports;
    const version = { ...a.version, id: "visit-replay-lifecycle", fingerprint: "f".repeat(64), createdAt: new Date(+now - 30000) };
    const visitor = { ...a.visitor, id: "visit-replay-visitor", versionId: version.id };
    const scope = { vendorId: a.vendor.id, liveId: a.live.id, versionId: version.id, visitorId: visitor.id };
    const eventId = "50000000-0000-4000-8000-000000000001";
    const newEventId = "50000000-0000-4000-8000-000000000002";
    try {
      await insert(db, "LiveMetricVersion", version); await insert(db, "LiveMetricVisitor", visitor);
      const original = await recordMetricVisit(db, scope, { eventId });
      assert.equal(original.replayed, false);
      await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=false WHERE id=$1', version.id);
      assert.deepEqual(await recordMetricVisit(db, scope, { eventId }), { ...original, replayed: true });
      await rejected(() => recordMetricVisit(db, scope, { eventId: newEventId }));
      await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=true,"expiresAt"=$1 WHERE id=$2', new Date(+now - 5000), version.id);
      assert.deepEqual(await recordMetricVisit(db, scope, { eventId }), { ...original, replayed: true });
      await rejected(() => recordMetricVisit(db, scope, { eventId: newEventId }));
      const [count] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricVisit" WHERE "versionId"=$1', version.id);
      assert.equal(count.n, 1);
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVisit" WHERE "versionId"=$1', version.id);
      await rejected(() => recordMetricVisit(db, scope, { eventId }));
      const [afterDelete] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricVisit" WHERE "versionId"=$1', version.id);
      assert.equal(afterDelete.n, 0);
    } finally { await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1', version.id); }
  });
  await check("server visit precision agrees with rounded visitor timestamps at submillisecond boundaries", async () => {
    const { recordMetricVisit } = compiledModule.exports;
    const base = new Date(+now - 10000);
    for (const [index, fraction] of [100, 499, 500, 600, 999].entries()) {
      const visitorId = `precision-visitor-${index}`;
      const eventId = `60000000-0000-4000-8000-00000000000${index}`;
      const clock = base.toISOString().replace('Z', `${fraction.toString().padStart(3, '0')}Z`);
      try {
        await db.$executeRawUnsafe('INSERT INTO "LiveMetricVisitor" (id,"vendorId","liveId","versionId","browserHash","firstVisitedAt") VALUES ($1,$2,$3,$4,$5,$6::timestamptz)',
          visitorId, a.vendor.id, a.live.id, a.version.id, "a".repeat(63) + index, clock);
        // Keep the actual writer SQL and database guards; substitute only its
        // clock with a parameterized synthetic sub-millisecond instant. This
        // makes the former truncation/rounding rejection deterministic.
        let sampled = 0;
        const controlledClock = { $transaction: (callback, options) => db.$transaction(tx => callback({
          $queryRaw: query => {
            if (!query.text.includes('INSERT INTO "LiveMetricVisit"')) return tx.$queryRaw(query);
            assert.equal(query.text.split('clock_timestamp()').length, 2); sampled++;
            return tx.$queryRawUnsafe(query.text.replace('clock_timestamp()', `$${query.values.length + 1}::timestamptz`), ...query.values, clock);
          },
        }), options) };
        const receipt = await recordMetricVisit(controlledClock, { vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, visitorId }, { eventId });
        assert.equal(sampled, 1);
        assert.equal(receipt.visitedAtMs, +base + (fraction >= 500 ? 1 : 0));
        const [visitor] = await db.$queryRawUnsafe('SELECT "firstVisitedAt" FROM "LiveMetricVisitor" WHERE id=$1', visitorId);
        assert.equal(receipt.visitedAtMs, +visitor.firstVisitedAt);
      } finally { await db.$executeRawUnsafe('DELETE FROM "LiveMetricVisitor" WHERE id=$1', visitorId); }
    }
  });
  await check("bulk visit deletion invalidates overlapping reports within a bounded statement", async () => {
    const visitorId = "bulk-delete-visitor";
    const impacted = "bulk-visit-impacted", unaffected = "bulk-visit-unaffected";
    try {
      await insert(db, "LiveMetricVisitor", { ...a.visitor, id: visitorId, browserHash: "0123456789abcdef".repeat(4) });
      await db.$executeRawUnsafe('INSERT INTO "LiveMetricVisit" (id,"eventId","vendorId","liveId","versionId","visitorId","visitedAt") SELECT md5(\'bulk-visit-\'||n::text)::uuid::text,md5(\'bulk-event-\'||n::text)::uuid::text,$1,$2,$3,$4,$5::timestamptz FROM generate_series(1,10000) n',
        a.vendor.id, a.live.id, a.version.id, visitorId, new Date(+now - 10000));
      for (const [reportId, start] of [[impacted, a.version.collectionStartedAt], [unaffected, new Date(+now - 9000)]]) {
        await insert(db, "LiveMetricReport", { id: reportId, vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id,
          windowStartAt: start, windowEndAt: new Date(+now - 5000), inputRevision: await revision(db, a.version.id), expiresAt: a.version.expiresAt });
      }
      const started = performance.now();
      const deleted = await db.$transaction(async tx => {
        await tx.$queryRawUnsafe("SELECT set_config('statement_timeout','5000',true)");
        await tx.$queryRawUnsafe('SELECT id FROM "LiveMetricVersion" WHERE id=$1 FOR SHARE', a.version.id);
        return tx.$executeRawUnsafe('DELETE FROM "LiveMetricVisit" WHERE "vendorId"=$1 AND "liveId"=$2 AND "versionId"=$3 AND "visitorId"=$4', a.vendor.id, a.live.id, a.version.id, visitorId);
      }, { timeout: 10000 });
      visitDeletionMetrics = { rows: deleted, elapsedMs: Math.round(performance.now() - started) };
      assert.equal(deleted, 10000);
      const rows = await db.$queryRawUnsafe('SELECT id,status,result FROM "LiveMetricReport" WHERE id IN ($1,$2) ORDER BY id', impacted, unaffected);
      assert.deepEqual(rows, [{ id: impacted, status: "stale", result: null }, { id: unaffected, status: "queued", result: null }]);
      const [trigger] = await db.$queryRawUnsafe("SELECT (tgtype::int & 1)=0 AS statement_level FROM pg_trigger WHERE tgname='LiveMetricVisit_deleted'");
      assert.equal(trigger.statement_level, true);
    } finally {
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricReport" WHERE id IN ($1,$2)', impacted, unaffected);
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVisitor" WHERE id=$1', visitorId);
    }
  });
  await check("bounded visit cleanup serializes with writer without deleting outside cutoff", async () => {
    const { deleteMetricVisitBatch, recordMetricVisit } = compiledModule.exports;
    const version = { ...a.version, id: "cleanup-version", fingerprint: "abcdef01".repeat(8) };
    const visitor = { ...a.visitor, id: "cleanup-visitor", versionId: version.id };
    const scope = { vendorId: a.vendor.id, liveId: a.live.id, versionId: version.id, visitorId: visitor.id };
    const input = { ...scope, before: new Date(+now - 8500), take: 1 };
    const keys = [1, 2, 3].map(n => `70000000-0000-4000-8000-00000000000${n}`);
    let release, signalLocked, holderPid, cleanup, writer;
    const locked = new Promise(resolve => { signalLocked = resolve; });
    const unlocked = new Promise(resolve => { release = resolve; });
    let timer;
    try {
      await insert(db, "LiveMetricVersion", version); await insert(db, "LiveMetricVisitor", visitor);
      for (const [i, id] of keys.entries()) await insert(db, "LiveMetricVisit", { ...scope, id, visitedAt: new Date(+now - 10000 + i * 1000) });
      await assert.rejects(() => deleteMetricVisitBatch(db, input), /must be closed/);
      await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=false WHERE id=$1', version.id);
      await assert.rejects(() => deleteMetricVisitBatch(db, { ...input, vendorId: b.vendor.id }), /scope unavailable/);
      await assert.rejects(() => deleteMetricVisitBatch(db, { ...input, before: new Date(+now + 3600000) }), /future/);
      const held = { $transaction: (callback, options) => db.$transaction(async tx => {
        [{ pid: holderPid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
        return callback({ $queryRaw: async query => {
          const rows = await tx.$queryRaw(query);
          if (query.text.includes('FROM "LiveMetricVersion"')) { signalLocked(); await unlocked; }
          return rows;
        } });
      }, options) };
      cleanup = deleteMetricVisitBatch(held, input);
      void cleanup.catch(() => signalLocked());
      timer = setTimeout(() => release(), 8000);
      await locked;
      let waitingPid, signalStarted;
      const started = new Promise(resolve => { signalStarted = resolve; });
      writer = db.$transaction(async tx => {
        [{ pid: waitingPid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid'); signalStarted();
        return recordMetricVisit({ $transaction: callback => callback(tx) }, scope, { eventId: keys[2] });
      }, { timeout: 10000 });
      void writer.catch(() => signalStarted()); await started;
      let blocked = false; const deadline = performance.now() + 4000;
      while (performance.now() < deadline) {
        const [{ blockers }] = await db.$queryRawUnsafe('SELECT pg_blocking_pids($1::int) AS blockers', waitingPid);
        if (blockers.includes(holderPid)) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(blocked, true); release();
      assert.deepEqual(await cleanup, { deleted: 1, hasMore: true });
      assert.equal((await writer).visitedAtMs, +now - 8000);
      assert.deepEqual(await deleteMetricVisitBatch(db, input), { deleted: 1, hasMore: false });
      assert.deepEqual(await deleteMetricVisitBatch(db, input), { deleted: 0, hasMore: false });
      const rows = await db.$queryRawUnsafe('SELECT id FROM "LiveMetricVisit" WHERE "versionId"=$1', version.id);
      assert.deepEqual(rows, [{ id: keys[2] }]);
    } finally {
      clearTimeout(timer); release();
      await Promise.allSettled([cleanup, writer].filter(Boolean));
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1', version.id);
    }
  });
  await check("visit loss provenance survives visitor erasure atomically without retaining visitor identity", async () => {
    const version = { ...a.version, id: "loss-version", fingerprint: "1234abcd".repeat(8) };
    const visitor = { ...a.visitor, id: "loss-visitor", versionId: version.id };
    const time = new Date(+now - 10000);
    try {
      await insert(db, "LiveMetricVersion", version); await insert(db, "LiveMetricVisitor", visitor);
      for (const i of [1, 2, 3]) await insert(db, "LiveMetricVisit", { id: `80000000-0000-4000-8000-00000000000${i}`,
        vendorId: a.vendor.id, liveId: a.live.id, versionId: version.id, visitorId: visitor.id, visitedAt: new Date(+time + (i === 3 ? 1 : 0)) });
      const rollback = new Error("synthetic-rollback");
      await assert.rejects(() => db.$transaction(async tx => {
        await tx.$queryRawUnsafe('SELECT id FROM "LiveMetricVersion" WHERE id=$1 FOR UPDATE', version.id);
        await tx.$executeRawUnsafe('DELETE FROM "LiveMetricVisit" WHERE "versionId"=$1', version.id);
        throw rollback;
      }), error => error === rollback);
      const [before] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricVisitLoss" WHERE "versionId"=$1', version.id);
      assert.equal(before.n, 0);
      await db.$transaction(async tx => {
        await tx.$queryRawUnsafe('SELECT id FROM "LiveMetricVersion" WHERE id=$1 FOR UPDATE', version.id);
        await tx.$executeRawUnsafe('DELETE FROM "LiveMetricVisitor" WHERE id=$1', visitor.id);
      });
      const losses = await db.$queryRawUnsafe('SELECT "visitedAt" FROM "LiveMetricVisitLoss" WHERE "versionId"=$1 ORDER BY "visitedAt"', version.id);
      assert.deepEqual(losses, [{ visitedAt: time }, { visitedAt: new Date(+time + 1) }]);
      const { claimMetricReport, readMetricVisitLossPage, loadMetricViewingSnapshot } = compiledModule.exports;
      const lease = { vendorId: a.vendor.id, liveId: a.live.id, versionId: version.id, reportId: "loss-reader-report", workerId: "loss-reader" };
      await insert(db, "LiveMetricReport", { id: lease.reportId, vendorId: a.vendor.id, liveId: a.live.id, versionId: version.id,
        windowStartAt: time, windowEndAt: new Date(+time + 2), inputRevision: await revision(db, version.id), expiresAt: version.expiresAt });
      assert.equal(await claimMetricReport(db, lease), true);
      await db.$transaction(async tx => {
        const first = await readMetricVisitLossPage(tx, { ...lease, after: null, take: 1 });
        assert.equal(first.hasMore, true); assert.deepEqual(first.rows, [{ visitedAt: time }]);
        const second = await readMetricVisitLossPage(tx, { ...lease, after: first.next, take: 1 });
        assert.equal(second.hasMore, false); assert.deepEqual(second.rows, [{ visitedAt: new Date(+time + 1) }]);
        assert.equal((await readMetricVisitLossPage(tx, { ...lease, vendorId: b.vendor.id, after: null, take: 1 })).status, "unavailable");
      }, { isolationLevel: "RepeatableRead" });
      const lossSnapshot = await loadMetricViewingSnapshot(db, lease);
      assert.equal(lossSnapshot.status, "available"); assert.deepEqual(lossSnapshot.data.visits, []);
      assert.deepEqual(lossSnapshot.data.visitLosses, losses);
      assert.deepEqual(lossSnapshot.data.visitCoverage, { status: "unavailable", reason: "evidence_gap" });
      const [remaining] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricVisit" WHERE "versionId"=$1', version.id);
      assert.equal(remaining.n, 0);
      await rejected(() => db.$executeRawUnsafe('DELETE FROM "LiveMetricVisitLoss" WHERE "versionId"=$1', version.id));
      await rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricVisitLoss" SET "visitedAt"="visitedAt" WHERE "versionId"=$1', version.id));
      await rejected(() => db.$executeRawUnsafe('TRUNCATE "LiveMetricVisitLoss"'));
      await rejected(() => insert(db, "LiveMetricVisitLoss", { vendorId: b.vendor.id, liveId: a.live.id, versionId: version.id, visitedAt: time }));
      const columns = await db.$queryRawUnsafe("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='LiveMetricVisitLoss' ORDER BY ordinal_position");
      assert.deepEqual(columns.map(row => row.column_name), ["vendorId", "liveId", "versionId", "visitedAt"]);
    } finally { await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1', version.id); }
    const [after] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricVisitLoss" WHERE "versionId"=$1', version.id);
    assert.equal(after.n, 0);
  });
  await check("coverage reader respects current certificates historical gaps and tenant leases", async () => {
    const version = { ...a.version, id: "coverage-reader-version", fingerprint: "cefa1234".repeat(8) };
    await insert(db, "LiveMetricVersion", version);
    try {
      const audit = { vendorId: a.vendor.id, liveId: a.live.id, versionId: version.id, kind: "visits", status: "covered",
        sourceRevision: await revision(db, version.id), auditDigest: "c".repeat(64) };
      await insert(db, "LiveMetricCoverageAudit", { ...audit, id: "reader-covered-a", startAt: new Date(+now - 17000), endAt: new Date(+now - 16000) });
      await insert(db, "LiveMetricCoverageAudit", { ...audit, id: "reader-covered-b", startAt: new Date(+now - 16000), endAt: new Date(+now - 15000) });
      await insert(db, "LiveMetricCoverageAudit", { ...audit, id: "reader-gap", kind: "viewing", status: "gap", startAt: new Date(+now - 16500), endAt: new Date(+now - 16499) });
      const lease = { vendorId: a.vendor.id, liveId: a.live.id, versionId: version.id, reportId: "coverage-reader-report", workerId: "coverage-reader" };
      await insert(db, "LiveMetricReport", { id: lease.reportId, vendorId: lease.vendorId, liveId: lease.liveId, versionId: version.id,
        windowStartAt: new Date(+now - 17000), windowEndAt: new Date(+now - 15000), inputRevision: await revision(db, version.id), expiresAt: version.expiresAt });
      assert.equal(await compiledModule.exports.claimMetricReport(db, lease), true);
      const read = (current, kind) => db.$transaction(tx => compiledModule.exports.readMetricCoverage(tx, current, kind), { isolationLevel: "RepeatableRead" });
      assert.deepEqual((await read(lease, "visits")).coverage, { status: "complete" });
      assert.deepEqual((await read(lease, "viewing")).coverage, { status: "unavailable", reason: "evidence_gap" });
      assert.deepEqual((await read(lease, "registrations")).coverage, { status: "unavailable", reason: "unknown_history" });
      assert.equal((await read({ ...lease, vendorId: b.vendor.id }, "visits")).status, "unavailable");
      assert.deepEqual((await compiledModule.exports.loadMetricViewingSnapshot(db, lease)).data.visitCoverage, { status: "complete" });
      await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=false WHERE id=$1', version.id);
      assert.equal((await read(lease, "visits")).status, "unavailable");
      const next = { ...lease, reportId: "coverage-reader-new-revision" };
      await insert(db, "LiveMetricReport", { id: next.reportId, vendorId: next.vendorId, liveId: next.liveId, versionId: version.id,
        windowStartAt: new Date(+now - 16999), windowEndAt: new Date(+now - 15000), inputRevision: await revision(db, version.id), expiresAt: version.expiresAt });
      assert.equal(await compiledModule.exports.claimMetricReport(db, next), true);
      assert.deepEqual((await read(next, "visits")).coverage, { status: "unavailable", reason: "unknown_history" });
      assert.deepEqual((await read(next, "viewing")).coverage, { status: "unavailable", reason: "evidence_gap" });
    } finally { await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1', version.id); }
  });
  await check("coverage audit invalidates only overlapping reports and cascades with its version", async () => {
    const version = { ...a.version, id: "coverage-lifecycle-version", fingerprint: "deadbeef".repeat(8) };
    await insert(db, "LiveMetricVersion", version);
    try {
      for (const [id, start, end] of [["coverage-overlap", -17000, -15000], ["coverage-outside", -14000, -13000]]) {
        await insert(db, "LiveMetricReport", { id, vendorId: a.vendor.id, liveId: a.live.id, versionId: version.id,
          windowStartAt: new Date(+now + start), windowEndAt: new Date(+now + end), inputRevision: await revision(db, version.id), expiresAt: version.expiresAt });
        assert.equal(await compiledModule.exports.claimMetricReport(db, { vendorId: a.vendor.id, liveId: a.live.id,
          versionId: version.id, reportId: id, workerId: "coverage-worker" }), true);
      }
      await insert(db, "LiveMetricCoverageAudit", { id: "coverage-lifecycle-audit", vendorId: a.vendor.id,
        liveId: a.live.id, versionId: version.id, kind: "visits", status: "gap", startAt: new Date(+now - 16000),
        endAt: new Date(+now - 15000), sourceRevision: await revision(db, version.id), auditDigest: "b".repeat(64) });
      const reports = await db.$queryRawUnsafe('SELECT id,status,"leaseOwner" FROM "LiveMetricReport" WHERE "versionId"=$1 ORDER BY id', version.id);
      assert.deepEqual(reports, [
        { id: "coverage-outside", status: "running", leaseOwner: "coverage-worker" },
        { id: "coverage-overlap", status: "stale", leaseOwner: null },
      ]);
    } finally { await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1', version.id); }
    const [remaining] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricCoverageAudit" WHERE "versionId"=$1', version.id);
    assert.equal(remaining.n, 0);
  });
  await check("coverage audit migration revokes API table and function privileges", async () => {
    const sql = fs.readFileSync(path.join(root, "prisma/migrations/20261015120000_live_metric_coverage_audit/migration.sql"), "utf8");
    const start = sql.indexOf("DO $$ DECLARE api_role"); assert.ok(start >= 0);
    const end = sql.indexOf("END $$;", start); assert.ok(end > start);
    const revoke = sql.slice(start, end + "END $$;".length);
    const rollback = new Error("synthetic-coverage-role-rollback");
    try {
      await db.$transaction(async tx => {
        for (const role of ["anon", "authenticated", "service_role"]) {
          await tx.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
          await tx.$executeRawUnsafe(`GRANT ALL ON TABLE "LiveMetricCoverageAudit" TO ${role}`);
          await tx.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION wp20_metric_coverage_guard(),wp20_metric_coverage_changed() TO ${role}`);
        }
        await tx.$executeRawUnsafe(revoke);
        for (const role of ["anon", "authenticated", "service_role"]) {
          const [access] = await tx.$queryRawUnsafe(`SELECT has_table_privilege($1,'public."LiveMetricCoverageAudit"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS table_access,
            has_function_privilege($1,'public.wp20_metric_coverage_guard()','EXECUTE') AS guard_access,
            has_function_privilege($1,'public.wp20_metric_coverage_changed()','EXECUTE') AS changed_access`, role);
          assert.deepEqual(access, { table_access: false, guard_access: false, changed_access: false });
        }
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });
  await check("coverage audit is scoped immutable bounded and never backfills history", async () => {
    const currentRevision = await revision(db, a.version.id);
    const range = { id: "audit-covered", vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id,
      kind: "visits", status: "covered", startAt: new Date(+now - 17000), endAt: new Date(+now - 16000),
      sourceRevision: currentRevision, auditDigest: "a".repeat(64) };
    await insert(db, "LiveMetricCoverageAudit", range);
    await insert(db, "LiveMetricCoverageAudit", { ...range, id: "audit-gap", status: "gap" });
    await rejected(() => insert(db, "LiveMetricCoverageAudit", { ...range, id: "audit-foreign", vendorId: b.vendor.id }));
    await rejected(() => insert(db, "LiveMetricCoverageAudit", { ...range, id: "audit-old", sourceRevision: currentRevision + 1n }));
    await rejected(() => insert(db, "LiveMetricCoverageAudit", { ...range, id: "audit-prehistory", startAt: new Date(+now - 21000) }));
    await rejected(() => insert(db, "LiveMetricCoverageAudit", { ...range, id: "audit-future", endAt: new Date(Date.now() + 3600000) }));
    await rejected(() => insert(db, "LiveMetricCoverageAudit", { ...range, id: "audit-invalid-kind", kind: "other" }));
    await rejected(() => db.$executeRawUnsafe(`UPDATE "LiveMetricCoverageAudit" SET status='gap' WHERE id=$1`, range.id));
    await rejected(() => db.$executeRawUnsafe('DELETE FROM "LiveMetricCoverageAudit" WHERE id=$1', range.id));
    await rejected(() => db.$executeRawUnsafe('TRUNCATE "LiveMetricCoverageAudit"'));
  });
  await check("capture migration revokes inherited API-role privileges including service_role", async () => {
    const migrationSql = fs.readFileSync(path.join(root, "prisma/migrations/20261015100000_live_metric_registration_capture/migration.sql"), "utf8");
    const revokeBlock = migrationSql.slice(migrationSql.indexOf("DO $$ DECLARE api_role"));
    assert.ok(revokeBlock.startsWith("DO $$ DECLARE api_role"));
    const rollback = new Error("synthetic-role-test-rollback");
    try {
      await db.$transaction(async tx => {
        // Simulate platform default grants before running the actual migration block.
        for (const role of ["anon", "authenticated", "service_role"]) {
          await tx.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
          await tx.$executeRawUnsafe(`GRANT ALL ON TABLE public."LiveMetricRegistrationCapture" TO ${role}`);
          await tx.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION public.wp20_metric_capture_guard(),public.wp20_metric_capture_no_truncate() TO ${role}`);
        }
        await tx.$executeRawUnsafe(revokeBlock);
        for (const role of ["anon", "authenticated", "service_role"]) {
          const [access] = await tx.$queryRawUnsafe(`SELECT has_table_privilege($1,'public."LiveMetricRegistrationCapture"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS table_access,
            has_function_privilege($1,'public.wp20_metric_capture_guard()','EXECUTE') AS guard_access,
            has_function_privilege($1,'public.wp20_metric_capture_no_truncate()','EXECUTE') AS truncate_access`, role);
          assert.deepEqual(access, { table_access: false, guard_access: false, truncate_access: false });
        }
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });
  await check("all metric tables retain default-deny RLS", async () => {
    const rows = await db.$queryRawUnsafe(`SELECT relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname IN (${[...tables].map((name) => `'${name}'`).join(",")})`);
    assert.equal(rows.length, 11); assert.ok(rows.every((row) => row.relrowsecurity));
  });
  await check("ordinary database role cannot read tables or execute trigger functions", async () => {
    await db.$executeRawUnsafe('CREATE ROLE wp20_metric_probe NOLOGIN');
    const rows = await db.$queryRawUnsafe("SELECT has_table_privilege('wp20_metric_probe','public.\"LiveMetricVersion\"','SELECT') AS can_read,has_function_privilege('wp20_metric_probe','public.wp20_metric_interval_guard()','EXECUTE') AS can_execute");
    assert.deepEqual(rows[0], { can_read: false, can_execute: false });
    const [visitAccess] = await db.$queryRawUnsafe("SELECT has_table_privilege('wp20_metric_probe','public.\"LiveMetricVisit\"','SELECT,INSERT,UPDATE,DELETE') AS table_access,has_function_privilege('wp20_metric_probe','public.wp20_metric_visit_guard()','EXECUTE') AS guard_access,has_function_privilege('wp20_metric_probe','public.wp20_metric_visit_changed()','EXECUTE') AS change_access");
    assert.deepEqual(visitAccess, { table_access: false, guard_access: false, change_access: false });
  });
  await check("RLS still denies rows after an accidental table grant", async () => {
    const rollback = new Error("expected-privilege-rollback");
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('GRANT SELECT ON "LiveMetricVersion" TO wp20_metric_probe');
        await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_metric_probe');
        const rows = await tx.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricVersion"');
        assert.equal(rows[0].n, 0);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });
  const interval = { id: "interval-a", vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, sessionId: a.session.id, sequence: 0, payloadHash: "a".repeat(64), wallStartAt: new Date(+now - 9000), wallEndAt: new Date(+now - 8000), mediaStartMs: 0, mediaEndMs: 1000, receivedAt: now };
  const nextInterval = { ...interval, wallStartAt: new Date(+now - 8000), wallEndAt: new Date(+now - 7000) };
  await check("valid interval preserves structural revision", async () => {
    const before = await revision(db, a.version.id);
    await insert(db, "LiveMetricInterval", interval);
    assert.equal(await revision(db, a.version.id), before);
  });
  await check("collection defaults disabled", async () => {
    const row = { ...a.version };
    delete row.collectionEnabled;
    delete row.collectionStartedAt;
    await insert(db, "LiveMetricVersion", { ...row, id: "disabled-version", fingerprint: "c".repeat(64) });
    const stored = await db.$queryRawUnsafe('SELECT "collectionEnabled", "collectionStartedAt" FROM "LiveMetricVersion" WHERE id=$1', "disabled-version");
    assert.equal(stored[0].collectionEnabled, false); assert.equal(stored[0].collectionStartedAt, null);
  });
  await check("disabled version cannot collect browser visits", () => rejected(() => insert(db, "LiveMetricVisitor", { ...a.visitor, id: "disabled-visitor", versionId: "disabled-version" })));
  await check("cross-tenant version/live binding rejected", () => rejected(() => insert(db, "LiveMetricVersion", { ...a.version, id: "bad-version", vendorId: b.vendor.id })));
  await check("cross-tenant video binding rejected", () => rejected(() => insert(db, "LiveMetricVersion", { ...a.version, id: "bad-video", fingerprint: "d".repeat(64), videoId: b.video.id })));
  await check("cross-version visitor binding rejected", async () => {
    const row = await db.formSubmission.create({ data: { formId: a.form.id, liveId: a.live.id, name: "Synthetic", email: "other-verified@example.test", verificationStatus: "VERIFIED", verifiedAt: a.registration.verifiedAt } });
    await rejected(() => insert(db, "LiveMetricRegistration", { ...a.registration, id: "bad-visitor", submissionId: row.id, visitorId: b.visitor.id }), ["23503"]);
  });
  await check("unverified submission cannot be linked", async () => {
    const row = await db.formSubmission.create({ data: { formId: a.form.id, liveId: a.live.id, name: "Synthetic", email: "unverified@example.test" } });
    await rejected(() => insert(db, "LiveMetricRegistration", { ...a.registration, id: "bad-unverified", submissionId: row.id }));
  });
  await check("wrong verified timestamp rejected", () => rejected(() => insert(db, "LiveMetricRegistration", { ...a.registration, id: "bad-time", verifiedAt: now })));
  await check("cross-tenant admission rejected", () => rejected(() => insert(db, "LiveMetricSession", { ...a.session, id: "bad-admission", admissionSessionId: b.admission.id })));
  await check("cross-version interval rejected", () => rejected(() => insert(db, "LiveMetricInterval", { ...nextInterval, id: "bad-interval", versionId: b.version.id, sequence: 1 })));
  await check("same session and sequence cannot duplicate", () => rejected(() => insert(db, "LiveMetricInterval", { ...interval, id: "duplicate" }), ["23514"]));
  for (const [name, patch] of [
    ["negative sequence", { sequence: -1 }],
    ["invalid payload hash", { payloadHash: "invalid" }],
    ["negative media", { mediaStartMs: -1 }],
    ["past content duration", { mediaStartMs: 99500, mediaEndMs: 100500 }],
    ["seek jump", { mediaEndMs: 50000 }],
    ["oversized wall interval", { wallEndAt: new Date(+now - 2000) }],
    ["future exposure", { wallStartAt: new Date(+now + 3600000), wallEndAt: new Date(+now + 3601000), receivedAt: new Date(+now + 3602000) }],
  ]) await check(name, () => rejected(() => insert(db, "LiveMetricInterval", { ...nextInterval, id: `bad-${name}`, sequence: 1, ...patch })));
  await check("sequence gaps cannot be stored", () => rejected(() => insert(db, "LiveMetricInterval", { ...interval, id: "gap", sequence: 2, wallStartAt: new Date(+now - 8000), wallEndAt: new Date(+now - 7000) })));
  await check("new sequence cannot repeat an overlapping wall interval", () => rejected(() => insert(db, "LiveMetricInterval", { ...interval, id: "overlap", sequence: 1 })));
  await check("complete session must declare its final contiguous sequence", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "closedAt"=$1,complete=true WHERE id=$2', now, a.session.id)));
  await check("intervals are append-only", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricInterval" SET "mediaEndMs"=999 WHERE id=$1', interval.id)));
  await check("version identity is immutable", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "durationMs"=99999 WHERE id=$1', a.version.id)));
  await check("evidence cannot move scopes", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricVisitor" SET "versionId"=$1 WHERE id=$2', b.version.id, a.visitor.id)));
  await check("session progress cannot be forged without evidence", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "lastSequence"=99,"lastElapsedMs"=99999 WHERE id=$1', a.session.id)));
  await check("new session cannot claim preexisting progress", () => rejected(() => insert(db, "LiveMetricSession", { ...a.session, id: "forged-progress", lastSequence: 2 })));
  await check("session completion requires an explicit close", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET complete=true WHERE id=$1', a.session.id)));
  await check("session admission identity cannot be reassigned", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "admissionSessionId"=$1 WHERE id=$2', b.admission.id, a.session.id)));
  for (const kind of ["verification", "admission", "video"]) await check(`in-flight ${kind} revocation blocks and rejects interval insertion`, async () => {
    const sourceReport = { id: `source-report-${kind}`, vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, windowStartAt: new Date(+now - 20000 + ["verification", "admission", "video"].indexOf(kind)), windowEndAt: new Date(+now - 5000), inputRevision: await revision(db, a.version.id), expiresAt: new Date(+now + 3600000) };
    await insert(db, "LiveMetricReport", sourceReport);
    await db.$queryRawUnsafe('SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,$6::timestamp)', a.vendor.id, a.live.id, a.version.id, sourceReport.id, "source-worker", new Date(+now + 60000));
    await db.$queryRawUnsafe('SELECT public.wp20_metric_report_finish($1,$2,$3,$4,$5,$6::jsonb)', a.vendor.id, a.live.id, a.version.id, sourceReport.id, "source-worker", '{"synthetic":true}');
    const beforeSourceRevision = await revision(db, a.version.id);
    if (kind === "verification") {
      await insert(db, "LiveMetricReport", { ...sourceReport, id: "unrelated-cohort", windowStartAt: new Date(+now - 40000), windowEndAt: new Date(+now - 30000) });
      await db.$queryRawUnsafe('SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,$6::timestamptz)', a.vendor.id, a.live.id, a.version.id, "unrelated-cohort", "source-worker", new Date(+now + 60000));
      await db.$queryRawUnsafe('SELECT public.wp20_metric_report_finish($1,$2,$3,$4,$5,$6::jsonb)', a.vendor.id, a.live.id, a.version.id, "unrelated-cohort", "source-worker", '{"synthetic":true}');
    }
    let sourceLocked, releaseSource, insertStarted;
    const locked = new Promise((resolve) => { sourceLocked = resolve; });
    const release = new Promise((resolve) => { releaseSource = resolve; });
    const started = new Promise((resolve) => { insertStarted = resolve; });
    let blockerPid, waitingPid;
    const mutation = db.$transaction(async (tx) => {
      [{ pid: blockerPid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
      if (kind === "verification") await tx.formSubmission.update({ where: { id: a.submission.id }, data: { verificationStatus: "UNVERIFIED" } });
      if (kind === "admission") await tx.liveViewerSession.delete({ where: { id: a.admission.id } });
      if (kind === "video") await tx.live.update({ where: { id: a.live.id }, data: { videoId: null } });
      sourceLocked(); await release;
    }, { timeout: 15000 });
    await locked;
    const insertion = db.$transaction(async (tx) => {
      [{ pid: waitingPid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
      insertStarted();
      await insert(tx, "LiveMetricInterval", { ...nextInterval, id: `race-${kind}`, sequence: 1 });
    }, { timeout: 15000 }).then(() => ({ accepted: true }), (error) => ({ accepted: false, code: diagnostic(error) }));
    try {
      await started;
      let observed = false;
      for (let poll = 0; poll < 100; poll++) {
        const [{ blockers }] = await db.$queryRawUnsafe('SELECT pg_blocking_pids($1::int) AS blockers', waitingPid);
        if (blockers.includes(blockerPid)) { observed = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(observed, true, "insert did not wait for the source transaction");
    } finally { releaseSource(); }
    await mutation;
    assert.deepEqual(await insertion, { accepted: false, code: "23514" });
    const [invalidated] = await db.$queryRawUnsafe('SELECT status,result FROM "LiveMetricReport" WHERE id=$1', sourceReport.id);
    assert.deepEqual(invalidated, kind === "admission" ? { status: "ready", result: { synthetic: true } } : { status: "stale", result: null });
    if (kind === "verification") {
      const [unrelated] = await db.$queryRawUnsafe('SELECT status FROM "LiveMetricReport" WHERE id=$1', "unrelated-cohort");
      assert.equal(unrelated.status, "ready");
      assert.equal(await revision(db, a.version.id), beforeSourceRevision);
    }
    if (kind === "verification") await db.formSubmission.update({ where: { id: a.submission.id }, data: { verificationStatus: "VERIFIED" } });
    if (kind === "admission") await db.liveViewerSession.create({ data: a.admission });
    if (kind === "video") await db.live.update({ where: { id: a.live.id }, data: { videoId: a.video.id } });
  });
  await check("expired admission cannot supply viewing evidence", async () => {
    await db.liveViewerSession.update({ where: { id: a.admission.id }, data: { expiresAt: new Date(+now - 5000) } });
    await rejected(() => insert(db, "LiveMetricInterval", { ...nextInterval, id: "expired-admission", sequence: 1 }));
    await db.liveViewerSession.update({ where: { id: a.admission.id }, data: { expiresAt: new Date(+now + 3600000) } });
  });
  await check("backdated receipt cannot bypass expired admission", async () => {
    await db.liveViewerSession.update({ where: { id: a.admission.id }, data: { expiresAt: new Date(+now - 5000) } });
    await rejected(() => insert(db, "LiveMetricInterval", { ...nextInterval, id: "backdated-admission", sequence: 1, receivedAt: new Date(+now - 7000) }));
    await rejected(() => insert(db, "LiveMetricSession", { ...a.session, id: "backdated-session", createdAt: new Date(+now - 10000) }));
    await db.liveViewerSession.update({ where: { id: a.admission.id }, data: { expiresAt: new Date(+now + 3600000) } });
  });
  await check("new session cannot start already expired", () => rejected(() => insert(db, "LiveMetricSession", { ...a.session, id: "expired-session", expiresAt: new Date(+now - 5000) })));
  await check("changed live video rejects old-version evidence", async () => {
    await db.live.update({ where: { id: a.live.id }, data: { videoId: null } });
    await rejected(() => insert(db, "LiveMetricInterval", { ...nextInterval, id: "old-video", sequence: 1 }));
    await rejected(() => insert(db, "LiveMetricSession", { ...a.session, id: "old-video-session" }));
    await db.live.update({ where: { id: a.live.id }, data: { videoId: a.video.id } });
  });
  await check("revoked verification cannot supply viewing evidence", async () => {
    await db.formSubmission.update({ where: { id: a.submission.id }, data: { verificationStatus: "UNVERIFIED" } });
    await rejected(() => insert(db, "LiveMetricInterval", { ...nextInterval, id: "revoked-verification", sequence: 1 }));
    await rejected(() => insert(db, "LiveMetricSession", { ...a.session, id: "revoked-new-session" }));
    await db.formSubmission.update({ where: { id: a.submission.id }, data: { verificationStatus: "VERIFIED" } });
  });
  // Use an already-ended window, preserving every asserted historical interval
  // while tolerating the disposable VM clock correction observed in prior runs.
  const report = { id: "report-a", vendorId: a.vendor.id, liveId: a.live.id, versionId: a.version.id, windowStartAt: new Date(+now - 20000), windowEndAt: new Date(+now - 5000), inputRevision: await revision(db, a.version.id), expiresAt: new Date(+now + 3600000) };
  await check("queued report stores its exact input revision", async () => { await insert(db, "LiveMetricReport", report); });
  await check("queued report cannot acquire reverse-order locks through raw updates", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricReport" SET cursor=$1 WHERE id=$2', "unsafe-cursor", report.id)));
  await check("report cannot be ready without a result", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricReport" SET status=$1 WHERE id=$2', "ready", report.id)));
  await check("report cannot run without a lease", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricReport" SET status=$1 WHERE id=$2', "running", report.id)));
  await check("source changes invalidate report and its lease", async () => {
    await db.$queryRawUnsafe('SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,$6::timestamp)', a.vendor.id, a.live.id, a.version.id, report.id, "synthetic-worker", new Date(+now + 60000));
    await insert(db, "LiveMetricInterval", { ...interval, id: "interval-second", sequence: 1, wallStartAt: new Date(+now - 8000), wallEndAt: new Date(+now - 7000) });
    const rows = await db.$queryRawUnsafe('SELECT status,"leaseOwner","leaseExpiresAt",result FROM "LiveMetricReport" WHERE id=$1', report.id);
    assert.deepEqual(rows[0], { status: "stale", leaseOwner: null, leaseExpiresAt: null, result: null });
  });
  await check("stale report cannot be resurrected as ready", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricReport" SET status=$1,result=$2::jsonb,"finishedAt"=$3 WHERE id=$4', "ready", '{"synthetic":true}', now, report.id)));
  await check("concurrent duplicate sequence stores exactly one row", async () => {
    const results = await Promise.allSettled([insert(db, "LiveMetricInterval", { ...interval, id: "race-a", sequence: 2, wallStartAt: new Date(+now - 7000), wallEndAt: new Date(+now - 6000) }), insert(db, "LiveMetricInterval", { ...interval, id: "race-b", sequence: 2, wallStartAt: new Date(+now - 7000), wallEndAt: new Date(+now - 6000) })]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rows = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" WHERE "sessionId"=$1 AND sequence=2', a.session.id);
    assert.equal(rows[0].n, 1);
  });
  await check("disabled collection rejects new intervals", async () => {
    await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=false WHERE id=$1', a.version.id);
    await rejected(() => insert(db, "LiveMetricInterval", { ...interval, id: "disabled-interval", sequence: 3, wallStartAt: new Date(+now - 6000), wallEndAt: new Date(+now - 5000) }));
    await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=true WHERE id=$1', a.version.id);
  });
  await check("closed session rejects new intervals", async () => {
    await db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "closedAt"=date_trunc(\'milliseconds\',clock_timestamp()),complete=true,"finalSequence"="lastSequence" WHERE id=$1', a.session.id);
    await rejected(() => insert(db, "LiveMetricInterval", { ...interval, id: "closed-interval", sequence: 3, wallStartAt: new Date(+now - 6000), wallEndAt: new Date(+now - 5000) }));
  });
  await check("final sequence cannot change after it is declared", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "finalSequence"=99 WHERE id=$1', a.session.id)));
  await check("closed metric session cannot be reopened", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "closedAt"=NULL,complete=false WHERE id=$1', a.session.id)));
  await check("individual deletion cannot invalidate a completed session", async () => {
    const before = await revision(db, a.version.id);
    await rejected(() => db.$executeRawUnsafe('DELETE FROM "LiveMetricInterval" WHERE id=$1', interval.id));
    assert.equal(await revision(db, a.version.id), before);
  });
  await check("current report claim has one winner under concurrency", async () => {
    await insert(db, "LiveMetricReport", { ...report, id: "report-current", inputRevision: await revision(db, a.version.id) });
    const claim = async (owner) => (await db.$queryRawUnsafe('SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,$6::timestamp) AS n', a.vendor.id, a.live.id, a.version.id, "report-current", owner, new Date(+now + 60000)))[0].n;
    const results = await Promise.all([claim("synthetic-a"), claim("synthetic-b")]);
    assert.deepEqual(results.sort(), [0, 1]);
  });
  await check("only the active report worker can finalize", async () => {
    const finish = async (owner) => (await db.$queryRawUnsafe('SELECT public.wp20_metric_report_finish($1,$2,$3,$4,$5,$6::jsonb) AS n', a.vendor.id, a.live.id, a.version.id, "report-current", owner, '{"synthetic":true}'))[0].n;
    assert.equal(await finish("wrong-worker"), 0);
    const [row] = await db.$queryRawUnsafe('SELECT "leaseOwner" FROM "LiveMetricReport" WHERE id=$1', "report-current");
    assert.equal(await finish(row.leaseOwner), 1);
    assert.equal(await finish(row.leaseOwner), 0);
  });
  await check("concurrent ingestion and report work preserve current revision without deadlock", async () => {
    const sessions = Array.from({ length: 12 }, (_, i) => ({ ...a.session, id: `parallel-session-${i}` }));
    await Promise.all(sessions.map((session) => insert(db, "LiveMetricSession", session)));
    const before = await revision(db, a.version.id);
    await insert(db, "LiveMetricReport", { ...report, id: "parallel-report", windowStartAt: new Date(+report.windowStartAt + 1), inputRevision: before });
    const worker = async () => {
      const [{ n }] = await db.$queryRawUnsafe('SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,$6::timestamp) AS n', a.vendor.id, a.live.id, a.version.id, "parallel-report", "parallel-worker", new Date(+now + 60000));
      assert.ok(n === 0 || n === 1);
      const [finished] = await db.$queryRawUnsafe('SELECT public.wp20_metric_report_finish($1,$2,$3,$4,$5,$6::jsonb) AS n', a.vendor.id, a.live.id, a.version.id, "parallel-report", "parallel-worker", '{"synthetic":true}');
      assert.ok(finished.n === 0 || finished.n === 1);
    };
    await Promise.all([worker(), ...sessions.map((session, i) => insert(db, "LiveMetricInterval", { ...interval, id: `parallel-interval-${i}`, sessionId: session.id }))]);
    assert.equal(await revision(db, a.version.id), before);
    const [stored] = await db.$queryRawUnsafe('SELECT status,result,"leaseOwner" FROM "LiveMetricReport" WHERE id=$1', "parallel-report");
    assert.deepEqual(stored, { status: "stale", result: null, leaseOwner: null });
  });
  await check("closed-window report finishes while later viewing continues", async () => {
    const session = { ...a.session, id: "later-session" };
    await insert(db, "LiveMetricSession", session);
    await insert(db, "LiveMetricSession", { ...a.session, id: "late-evidence-session" });
    await insert(db, "LiveMetricReport", { ...report, id: "closed-window-report", windowEndAt: new Date(+now - 9500), inputRevision: await revision(db, a.version.id) });
    await db.$queryRawUnsafe('SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,$6::timestamp)', a.vendor.id, a.live.id, a.version.id, "closed-window-report", "closed-window-worker", new Date(+now + 60000));
    await Promise.all([
      insert(db, "LiveMetricInterval", { ...interval, id: "later-interval", sessionId: session.id }),
      db.$queryRawUnsafe('SELECT public.wp20_metric_report_finish($1,$2,$3,$4,$5,$6::jsonb)', a.vendor.id, a.live.id, a.version.id, "closed-window-report", "closed-window-worker", '{"synthetic":true}'),
    ]);
    const [row] = await db.$queryRawUnsafe('SELECT status,result FROM "LiveMetricReport" WHERE id=$1', "closed-window-report");
    assert.deepEqual(row, { status: "ready", result: { synthetic: true } });
    await insert(db, "LiveMetricInterval", { ...interval, id: "late-evidence", sessionId: "late-evidence-session", wallStartAt: new Date(+now - 9900), wallEndAt: new Date(+now - 9800), mediaEndMs: 100 });
    const [stale] = await db.$queryRawUnsafe('SELECT status,result FROM "LiveMetricReport" WHERE id=$1', "closed-window-report");
    assert.deepEqual(stale, { status: "stale", result: null });
  });
  await check("raw report claim is rejected even with a valid lease", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricReport" SET status=$1,"leaseOwner"=$2,"leaseExpiresAt"=$3 WHERE id=$4', "running", "raw-worker", new Date(+now + 60000), "closed-window-report")));
  await check("expired worker leases recover and stop after five attempts", async () => {
    await insert(db, "LiveMetricReport", { ...report, id: "lease-recovery", windowStartAt: new Date(+report.windowStartAt + 2), inputRevision: await revision(db, a.version.id) });
    for (let attempt = 1; attempt <= 5; attempt++) {
      const [claimed] = await db.$queryRawUnsafe("SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,(clock_timestamp()+INTERVAL '50 milliseconds')::timestamp) AS n", a.vendor.id, a.live.id, a.version.id, "lease-recovery", `worker-${attempt}`);
      assert.equal(claimed.n, 1);
      if (attempt > 1) {
        const [old] = await db.$queryRawUnsafe('SELECT public.wp20_metric_report_finish($1,$2,$3,$4,$5,$6::jsonb) AS n', a.vendor.id, a.live.id, a.version.id, "lease-recovery", `worker-${attempt - 1}`, '{"synthetic":true}');
        assert.equal(old.n, 0);
      }
      await db.$executeRawUnsafe('SELECT pg_sleep(0.06)');
    }
    const [exhausted] = await db.$queryRawUnsafe("SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,(clock_timestamp()+INTERVAL '1 second')::timestamp) AS n", a.vendor.id, a.live.id, a.version.id, "lease-recovery", "worker-6");
    assert.equal(exhausted.n, 0);
    const [row] = await db.$queryRawUnsafe('SELECT status,attempts,"errorCode","leaseOwner" FROM "LiveMetricReport" WHERE id=$1', "lease-recovery");
    assert.deepEqual(row, { status: "failed", attempts: 5, errorCode: "attempt_limit", leaseOwner: null });
  });
  await check("registration verification identity cannot be rewritten", () => rejected(() => db.$executeRawUnsafe('UPDATE "LiveMetricRegistration" SET "verifiedAt"=$1 WHERE id=$2', now, a.registration.id)));
  await check("normal admission release preserves historical viewing evidence", async () => {
    await insert(db, "LiveMetricInterval", { ...interval, id: "interval-b", vendorId: b.vendor.id, liveId: b.live.id, versionId: b.version.id, sessionId: b.session.id });
    await db.liveViewerSession.delete({ where: { id: b.admission.id } });
    const rows = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" i JOIN "LiveMetricSession" s ON s.id=i."sessionId" WHERE s.id=$1', b.session.id);
    assert.equal(rows[0].n, 1);
  });
  await check("released admission cannot append viewing evidence", () => rejected(() => insert(db, "LiveMetricInterval", { ...nextInterval, id: "released-b", vendorId: b.vendor.id, liveId: b.live.id, versionId: b.version.id, sessionId: b.session.id, sequence: 1 })));
  await check("deleting a live preserves the other tenant and removes metric children", async () => {
    const rollback = new Error("expected-live-delete-rollback");
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('DELETE FROM "Live" WHERE id=$1', a.live.id);
        const rows = await tx.$queryRawUnsafe('SELECT "vendorId" FROM "LiveMetricVersion"');
        assert.equal(rows.length, 1); assert.equal(rows[0].vendorId, b.vendor.id);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });
  for (const [label, sql, id, expected] of [
    ["vendor", 'DELETE FROM "Vendor" WHERE id=$1', a.vendor.id, 1],
    ["version", 'DELETE FROM "LiveMetricVersion" WHERE id=$1', a.version.id, 2],
  ]) await check(`deleting a ${label} preserves the other tenant`, async () => {
    const rollback = new Error("expected-lifecycle-rollback");
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(sql, id);
        const rows = await tx.$queryRawUnsafe('SELECT "vendorId" FROM "LiveMetricVersion"');
        assert.equal(rows.length, expected); assert.ok(rows.some((row) => row.vendorId === b.vendor.id));
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });
  if (process.argv.includes("--load")) await check("500 sessions sustain a minute of ingestion while a closed-window report completes", async () => {
    loadMetrics = { stage: "setup" };
    const [{ now: loadStart }] = await db.$queryRawUnsafe('SELECT clock_timestamp() AS now');
    await db.liveViewerSession.createMany({ data: Array.from({ length: 500 }, (_, i) => ({ id: `load-admission-${i}`, vendorId: a.vendor.id, liveId: a.live.id, tokenHash: i.toString(16).padStart(64, "0"), createdAt: loadStart, lastSeenAt: loadStart, expiresAt: a.admission.expiresAt })) });
    const sessions = Array.from({ length: 500 }, (_, i) => ({ ...a.session, id: `load-session-${i}`, admissionSessionId: `load-admission-${i}`, anchorAt: loadStart }));
    await Promise.all(sessions.map((session) => insert(db, "LiveMetricSession", session)));
    await insert(db, "LiveMetricSession", { ...a.session, id: "release-concurrent-session", anchorAt: loadStart });
    loadMetrics.stage = "create-report";
    const inputRevision = await revision(db, a.version.id);
    await insert(db, "LiveMetricReport", { ...report, id: "load-report", windowEndAt: new Date(+loadStart - 1), inputRevision });
    const latencies = [];
    const started = performance.now();
    for (let sample = 0; sample < 12; sample++) {
      loadMetrics.stage = `sample-${sample}`;
      const wallStartAt = new Date(+loadStart + sample * 5000);
      const wallEndAt = new Date(+wallStartAt + 5000);
      // Docker's wall clock can lag the host timer. Do not fabricate future
      // samples: wait against the same database clock that validates receipts.
      // Deliver completed batches five seconds later, tolerating observed Docker
      // clock corrections during the 500-write wave without weakening the guard.
      const deliveryAt = new Date(+wallEndAt + 5000);
      let dispatchTime;
      for (let wait = 0; wait < 30; wait++) {
        [{ now: dispatchTime }] = await db.$queryRawUnsafe('SELECT clock_timestamp() AS now');
        if (+dispatchTime >= +deliveryAt + 50) break;
        await db.$executeRawUnsafe("SELECT pg_sleep(LEAST(2,GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamp-clock_timestamp()))))+0.05)", deliveryAt);
      }
      assert.ok(+dispatchTime >= +deliveryAt + 50, "database clock did not reach synthetic exposure end");
      loadMetrics.serverClockSlackMs = +dispatchTime - +wallEndAt;
      const operations = sessions.map(async (session, i) => {
        const before = performance.now();
        await insert(db, "LiveMetricInterval", { ...interval, id: `load-${sample}-${i}`, sessionId: session.id, sequence: sample, wallStartAt, wallEndAt, mediaStartMs: sample * 5000, mediaEndMs: (sample + 1) * 5000 });
        latencies.push(performance.now() - before);
      });
      if (sample === 0) operations.push(db.$queryRawUnsafe('SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,$6::timestamp)', a.vendor.id, a.live.id, a.version.id, "load-report", "load-worker", new Date(+loadStart + 120000)));
      if (sample === 1) operations.push(db.$queryRawUnsafe('SELECT public.wp20_metric_report_finish($1,$2,$3,$4,$5,$6::jsonb)', a.vendor.id, a.live.id, a.version.id, "load-report", "load-worker", '{"synthetic":true}'));
      await Promise.all(operations);
    }
    const releaseStarted = performance.now();
    await Promise.all([
      ...sessions.map((session) => db.liveViewerSession.delete({ where: { id: session.admissionSessionId } })),
      insert(db, "LiveMetricInterval", { ...interval, id: "release-concurrent-interval", sessionId: "release-concurrent-session", wallStartAt: loadStart, wallEndAt: new Date(+loadStart + 1000) }),
    ]);
    const releaseElapsedMs = Math.round(performance.now() - releaseStarted);
    latencies.sort((x, y) => x - y);
    const [stored] = await db.$queryRawUnsafe('SELECT status,result FROM "LiveMetricReport" WHERE id=$1', "load-report");
    const [count] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricInterval" WHERE id LIKE $1', 'load-%');
    loadMetrics = { sessions: sessions.length, samplesPerSession: 12, deliveryLagMs: 5000, releasedAdmissions: 500, releaseElapsedMs, stored: count.n, elapsedMs: Math.round(performance.now() - started), p50Ms: Math.round(latencies[Math.floor(latencies.length * 0.50)]), p95Ms: Math.round(latencies[Math.floor(latencies.length * 0.95)]), maxMs: Math.round(latencies.at(-1)), reportStatus: stored.status, sourceRevisionUnchanged: await revision(db, a.version.id) === inputRevision };
    assert.equal(count.n, 6000);
    assert.deepEqual(stored, { status: "ready", result: { synthetic: true } });
    assert.equal(loadMetrics.sourceRevisionUnchanged, true);
    // A five-second heartbeat must not accumulate a p95 write backlog beyond its period.
    assert.ok(loadMetrics.p95Ms < 5000, "p95 write latency exceeds heartbeat period");
  });
  await check("session and receipt lifetime remain valid under Asia/Taipei", async () => {
    const rollback = new Error("expected-timezone-rollback");
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Taipei'");
        await insert(tx, "LiveMetricSession", { ...a.session, id: "timezone-session" });
        await insert(tx, "LiveMetricInterval", { ...interval, id: "timezone-interval", sessionId: "timezone-session" });
        const [row] = await tx.$queryRawUnsafe('SELECT "receivedAt" FROM "LiveMetricInterval" WHERE id=$1', "timezone-interval");
        const [{ now: serverNow }] = await tx.$queryRawUnsafe('SELECT clock_timestamp() AS now');
        assert.ok(Math.abs(+row.receivedAt - +serverNow) < 5000);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });
  for (const zone of ["UTC", "Asia/Taipei"]) await check(`report windows and worker expiry remain exact in ${zone}`, async () => {
    const rollback = new Error("expected-report-timezone-rollback");
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(zone === "UTC" ? "SET LOCAL TIME ZONE 'UTC'" : "SET LOCAL TIME ZONE 'Asia/Taipei'");
        const row = { ...report, id: "timezone-report", windowStartAt: new Date(+now - 19999), inputRevision: await revision(tx, a.version.id) };
        await insert(tx, "LiveMetricReport", row);
        const [stored] = await tx.$queryRawUnsafe('SELECT "windowStartAt","windowEndAt","expiresAt" FROM "LiveMetricReport" WHERE id=$1', row.id);
        assert.equal(+stored.windowStartAt, +row.windowStartAt); assert.equal(+stored.windowEndAt, +row.windowEndAt); assert.equal(+stored.expiresAt, +row.expiresAt);
        const args = [a.vendor.id, a.live.id, a.version.id, row.id, "timezone-worker"];
        const [claimed] = await tx.$queryRawUnsafe("SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,clock_timestamp()+INTERVAL '30 seconds') AS n", ...args);
        assert.equal(claimed.n, 1);
        const [finished] = await tx.$queryRawUnsafe('SELECT public.wp20_metric_report_finish($1,$2,$3,$4,$5,$6::jsonb) AS n', ...args, '{"synthetic":true}');
        assert.equal(finished.n, 1);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(zone === "UTC" ? "SET LOCAL TIME ZONE 'UTC'" : "SET LOCAL TIME ZONE 'Asia/Taipei'");
      await rejected(() => tx.$queryRawUnsafe("SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,clock_timestamp()-INTERVAL '1 second')", a.vendor.id, a.live.id, a.version.id, "no-report", "expired-worker"));
    });
  });
  await check("repeatable-read metric writes fail closed before stale snapshots are accepted", async () => {
    await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT count(*) FROM "LiveMetricVersion"');
      await rejected(() => insert(tx, "LiveMetricSession", { ...a.session, id: "rr-session" }));
    }, { isolationLevel: "RepeatableRead" });
  });
  await check("metric guard functions pin UTC and source lookup indexes exist", async () => {
    const functions = await db.$queryRawUnsafe("SELECT proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'wp20_metric_%'");
    assert.ok(functions.length >= 12); assert.ok(functions.every((row) => row.proconfig?.includes("TimeZone=UTC")));
    const indexes = await db.$queryRawUnsafe("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN ('LiveMetricRegistration_submissionId_idx','LiveMetricSession_admissionSessionId_idx')");
    assert.equal(indexes.length, 2);
  });
  if (process.argv.includes("--indexes")) await check("source lookups use indexes over 100001 validated evidence rows", async () => {
    const rollback = new Error("expected-index-volume-rollback");
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO "FormSubmission" (id,"formId","liveId",name,email,"verificationStatus","verifiedAt") SELECT 'index-submission-'||n,$1,$2,'Synthetic','index-'||n||'@example.test','VERIFIED',$3 FROM generate_series(1,100001) n`, a.form.id, a.live.id, a.registration.verifiedAt);
        await tx.$executeRawUnsafe(`INSERT INTO "LiveViewerSession" (id,"vendorId","liveId","tokenHash","lastSeenAt","expiresAt","createdAt") SELECT 'index-admission-'||n,$1,$2,lpad(to_hex(n+1000000),64,'0'),$3,$4,$5 FROM generate_series(1,100001) n`, a.vendor.id, a.live.id, now, a.admission.expiresAt, a.admission.createdAt);
        // The large fixture is uncommitted, so autovacuum cannot update these
        // statistics. Replan trigger joins after replacing the tiny test cohort.
        await tx.$executeRawUnsafe('ANALYZE "FormSubmission"');
        await tx.$executeRawUnsafe('ANALYZE "LiveViewerSession"');
        await tx.$executeRawUnsafe(`INSERT INTO "LiveMetricRegistration" (id,"vendorId","liveId","versionId","submissionId","verifiedAt") SELECT 'index-registration-'||n,$1,$2,$3,'index-submission-'||n,$4 FROM generate_series(1,100001) n`, a.vendor.id, a.live.id, a.version.id, a.registration.verifiedAt);
        await tx.$executeRawUnsafe('ANALYZE "LiveMetricRegistration"');
        await tx.$executeRawUnsafe(`INSERT INTO "LiveMetricSession" (id,"vendorId","liveId","versionId","registrationId","admissionSessionId","anchorAt","expiresAt") SELECT 'index-session-'||n,$1,$2,$3,'index-registration-'||n,'index-admission-'||n,$4,$5 FROM generate_series(1,100001) n`, a.vendor.id, a.live.id, a.version.id, a.session.anchorAt, a.session.expiresAt);
        await tx.$executeRawUnsafe('ANALYZE "LiveMetricRegistration"');
        await tx.$executeRawUnsafe('ANALYZE "LiveMetricSession"');
        const plans = [];
        for (const [table, field, value, expectedIndex] of [
          ["LiveMetricRegistration", "submissionId", "index-submission-50000", "LiveMetricRegistration_submissionId_idx"],
          ["LiveMetricSession", "admissionSessionId", "index-admission-50000", "LiveMetricSession_admissionSessionId_idx"],
        ]) {
          const [row] = await tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, FORMAT JSON) SELECT DISTINCT "versionId" FROM "${table}" WHERE "${field}"=$1`, value);
          const plan = row["QUERY PLAN"][0];
          const indexes = [];
          const collect = (node) => { if (node["Index Name"]) indexes.push(node["Index Name"]); for (const child of node.Plans ?? []) collect(child); };
          collect(plan.Plan);
          assert.ok(indexes.includes(expectedIndex), "source lookup did not choose its dedicated index");
          assert.equal(plan.Plan["Actual Rows"], 1);
          plans.push({ table, indexes, actualRows: plan.Plan["Actual Rows"], executionMs: plan["Execution Time"] });
        }
        indexMetrics = { validatedRowsPerTable: 100001, plans, constraintsAndTriggersEnabled: true };
        throw rollback;
      }, { timeout: 300000, maxWait: 10000 });
    } catch (error) { if (error !== rollback) throw error; }
    const [remaining] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricSession" WHERE id LIKE $1', 'index-session-%');
    assert.equal(remaining.n, 0);
  });
  await check("scoped DDL rollback preserves existing product tables", async () => {
    const rollback = new Error("expected-disposable-rollback");
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('DROP FUNCTION public.wp20_metric_source_changed() CASCADE');
        await tx.$executeRawUnsafe('DROP TABLE "LiveMetricOrderSource","LiveMetricCoverageAudit","LiveMetricRegistrationCapture","LiveMetricVisitLoss","LiveMetricVisit","LiveMetricReport","LiveMetricInterval","LiveMetricSession","LiveMetricRegistration","LiveMetricVisitor","LiveMetricVersion" CASCADE');
        const rows = await tx.$queryRawUnsafe('SELECT to_regclass(\'public."LiveMetricVersion"\')::text AS metric, count(*)::int AS vendors FROM "Vendor"');
        assert.equal(rows[0].metric, null); assert.equal(rows[0].vendors, 2);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    const rows = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "LiveMetricVersion"');
    assert.equal(rows[0].n, 3);
  });
}

let migration;
try {
  // The generated client has no dotenv paths; reject before importing it if
  // a later generate command reintroduces a source-worktree dotenv binding.
  const clientSource = fs.readFileSync(path.join(root, "node_modules/.prisma/client/index.js"), "utf8");
  const envPaths = JSON.parse(clientSource.match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1] ?? "null");
  assert.ok(envPaths && Object.values(envPaths).every((value) => value === null));
  const { PrismaClient } = require("@prisma/client");
  migration = await main({ afterMigrate: async ({ databaseUrl }) => {
    const target = new URL(databaseUrl);
    assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.pathname, "/celebratedeal_test");
    target.searchParams.set("connection_limit", "24");
    const db = new PrismaClient({ datasourceUrl: target.toString() });
    try {
      const marker = await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
      assert.match(marker[0].marker, /^prisma-no-dotenv:[a-f0-9]{16}$/u);
      await exercise(db);
    } finally { await db.$disconnect(); }
  } });
} catch (error) {
  migration = { status: "FAIL", failure: { category: diagnostic(error) }, cleanup: { status: "NOT_STARTED_OR_UNKNOWN" } };
}
const receipt = { status: migration.status === "PASS" && checks.length >= 122 && checks.every((item) => item.status === "PASS") ? "PASS" : "FAIL", checks, loadMetrics, indexMetrics, visitDeletionMetrics, orderContentionMetrics, registrationClockDiagnostics, serializationDiagnostics, passed: checks.filter((item) => item.status === "PASS").length, migration: { status: migration.status, count: migration.migrationNames?.length, failure: migration.failure }, cleanup: migration.cleanup, scope: "Owned loopback disposable PostgreSQL, synthetic data, no raw output or source dotenv files" };
fs.writeFileSync(path.join(output, "disposable-db-result.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ status: receipt.status, passed: receipt.passed, loadMetrics, indexMetrics, visitDeletionMetrics, orderContentionMetrics, failed: checks.filter((item) => item.status === "FAIL"), migration: receipt.migration, cleanup: receipt.cleanup }));
process.exitCode = receipt.status === "PASS" ? 0 : 1;
