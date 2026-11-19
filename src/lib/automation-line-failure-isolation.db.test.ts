import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A2-09: a LINE action that can never be sent (no HTTPS link in an http
// deployment, no LINE Official Account, no linked LINE identity) is recorded
// as `skipped` with a fixed reason code and never fails the rule or the
// delayed step, so the step's e-mail, voucher and tag still complete and the
// run moves on. A transient failure (the LINE outbox write, the LINE API
// itself) keeps the retry it had, and a retry never repeats an action that
// already succeeded. The automation engine, the delayed-step worker and the
// LINE outbox worker run for real on the disposable PostgreSQL database; the
// LINE Messaging API client is a fake (no real LINE call), monitoring and the
// immediate e-mail hook are synthetic.
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: monitoring.captureOperationalError }));
vi.mock("@/lib/email-delivery-immediate", () => ({ scheduleImmediateEmailDispatch: vi.fn() }));

import { runDelayedStepWorker } from "@/lib/automation-delayed-steps";
import { AUTOMATION_EMAIL_TRIGGER, AUTOMATION_STEP_EMAIL_TRIGGER } from "@/lib/automation-email-trigger";
import {
  automationCustomerKeyHash,
  automationExecutionNotes,
  automationStepExecutionLogId,
  dispatchAutomationEvent,
} from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
import { DELAYED_STEP_LEASE_MS } from "@/lib/delayed-step-runs";
import { LineMessagingError, type LineMessagingClient } from "@/lib/line-client";
import { lineUserIdHash, protectLineOfficialAccountCredentials, protectLineProfileValue } from "@/lib/line-credentials";
import { processDueLineDeliveries, stableLineIdempotencyKey } from "@/lib/line-notification";

const db = getDb();
const MINUTE = 60_000;
const HTTP_APP_URL = "http://localhost:31023";
const HTTPS_APP_URL = "https://line-isolation.example.test";
const createdVendorIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "line-isolation-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", HTTPS_APP_URL);
  // Synthetic provider settings: the delayed-step worker only checks that they exist.
  vi.stubEnv("RESEND_API_KEY", "re_synthetic_line_isolation");
  vi.stubEnv("EMAIL_FROM", "CelebrateDeal <no-reply@example.test>");
  monitoring.captureOperationalError.mockClear();
});

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function tenant(options: { lineAccount?: boolean } = {}) {
  const suffix = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: {
      name: `LINE 隔離商家 ${suffix}`,
      slug: `line-isolation-${suffix}`,
      email: `merchant-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
      betaFeatureGrants: ["automation_delayed_steps"],
    },
  });
  createdVendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "報名表", slug: `line-isolation-form-${suffix}`, headline: "報名", fields: [{ key: "email", label: "Email", type: "email", required: true }] },
  });
  const product = await db.product.create({
    data: { vendorId: vendor.id, name: "回購商品", slug: `line-isolation-product-${suffix}`, priceCents: 100_000, isActive: true },
  });
  const account = options.lineAccount === false ? null : await db.lineOfficialAccount.create({
    data: {
      vendorId: vendor.id,
      ...protectLineOfficialAccountCredentials(vendor.id, {
        messagingChannelId: "2000123456",
        messagingChannelSecret: "synthetic-messaging-secret-1234567890",
        messagingAccessToken: "synthetic-access-token-with-at-least-thirty-two-chars",
        loginChannelId: null,
        loginChannelSecret: null,
      }),
    },
    select: { id: true },
  });
  return { vendor, form, product, account };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

/** A LINE identity of `vendorId` bound to a registration id (another tenant's id in the cross-tenant cases). */
async function linkLine(vendorId: string, subjectId: string, options: { revoked?: boolean } = {}) {
  const lineUserId = `U${randomUUID().replaceAll("-", "")}`;
  return db.lineUserIdentity.create({
    data: {
      vendorId,
      subjectType: "buyer_registration",
      subjectId,
      lineUserIdHash: lineUserIdHash(vendorId, lineUserId),
      lineUserIdEncrypted: protectLineProfileValue(vendorId, "userId", lineUserId),
      revokedAt: options.revoked ? new Date() : null,
    },
    select: { id: true },
  });
}

/** A verified registration (so a delayed step mails it), optionally with a linked LINE identity. */
async function lead(t: Tenant, options: { linked?: boolean } = {}) {
  const submission = await db.formSubmission.create({
    data: { formId: t.form.id, name: "王小明", email: `lead-${randomUUID().slice(0, 8)}@example.test`, verificationStatus: "VERIFIED", verifiedAt: new Date() },
  });
  const identity = options.linked === false ? null : await linkLine(t.vendor.id, submission.id);
  return { ...submission, identity };
}

const TAG = { type: "add_customer_tag", tag: "line-isolation" };
const EMAIL = { type: "send_email_notification", template: "repurchase_followup" };
const LINE_PUSH = { type: "line_push", message: "專屬優惠 {{voucher_url}}", buttonLabel: "立即使用", buttonUrl: "{{voucher_url}}" };
function voucher(t: Tenant, lineNotification: boolean) {
  return { type: "issue_repurchase_voucher", productId: t.product.id, discountType: "fixed", discountValue: 10_000, expiresInDays: 7, lineNotification };
}

/**
 * The two LINE actions of a rule or step: the voucher's fixed-text LINE
 * notification (sent after every other action) and a custom LINE push whose
 * button links the voucher (sent in its own position, here before the e-mail
 * and the tag, so a throw there used to stop them).
 */
const LINE_KINDS = [
  ["the voucher's LINE notification", (t: Tenant) => [EMAIL, TAG, voucher(t, true)], { source: "voucher_delivery" }],
  ["a LINE push linking the voucher", (t: Tenant) => [voucher(t, false), LINE_PUSH, EMAIL, TAG], {}],
] as const;

async function rule(t: Tenant, actions: unknown[]) {
  return db.automationRule.create({
    data: {
      vendorId: t.vendor.id,
      name: `規則 ${randomUUID().slice(0, 6)}`,
      trigger: "form_registered",
      condition: { type: "always" } as Prisma.InputJsonValue,
      actions: actions as Prisma.InputJsonArray,
      isActive: true,
    },
  });
}

async function step(t: Tenant, ruleId: string, delayMinutes: number, actions: unknown[]) {
  return db.automationRuleStep.create({
    data: { vendorId: t.vendor.id, ruleId, delayMinutes, condition: { type: "always" } as Prisma.InputJsonValue, actions: actions as Prisma.InputJsonArray, isActive: true },
  });
}

function registered(t: Tenant, submission: { id: string; email: string }, client: Parameters<typeof dispatchAutomationEvent>[0] = db) {
  return dispatchAutomationEvent(client, {
    vendorId: t.vendor.id,
    eventId: `form-registered:${submission.id}`,
    trigger: "form_registered",
    subjectType: "buyer_registration",
    subjectId: submission.id,
    subjectKeyHash: automationCustomerKeyHash(t.vendor.id, submission.email),
    recipientEmail: submission.email,
  });
}

/** What the tenant's actions produced: vouchers, e-mails, tags and LINE outbox rows. */
async function outputs(t: Tenant) {
  const [vouchers, emails, tags, lines] = await Promise.all([
    db.automationVoucherGrant.findMany({ where: { vendorId: t.vendor.id }, select: { id: true, claimTokenHash: true } }),
    db.emailDelivery.findMany({ where: { vendorId: t.vendor.id }, select: { id: true, trigger: true, status: true } }),
    db.customerTagAssignment.findMany({ where: { vendorId: t.vendor.id }, select: { tag: true } }),
    db.lineDelivery.findMany({ where: { vendorId: t.vendor.id }, select: { id: true, idempotencyKey: true, lineOfficialAccountId: true, lineUserIdentityId: true, status: true, attemptCount: true } }),
  ]);
  return { vouchers, emails, tags: tags.map((row) => row.tag).sort(), lines };
}

function resultsOf(actionResults: unknown) {
  return (actionResults as { results: Array<Record<string, unknown>> }).results;
}

function lineResults(results: Array<Record<string, unknown>>) {
  return results.filter((result) => result.type === "line_push");
}

/** The single run of the tenant, due for its first (60-minute) step at the returned instant. */
async function dueRun(t: Tenant) {
  const run = await db.delayedStepRun.findFirstOrThrow({ where: { vendorId: t.vendor.id } });
  return { run, due: new Date(run.anchorAt.getTime() + 61 * MINUTE) };
}

/**
 * A client whose LINE outbox write fails while `failing` is set: a transient
 * error (a dropped connection, a database fail-over) of the one write a LINE
 * action makes. Every other query is the real one.
 */
function flakyLineOutbox() {
  const state = { failing: true, failures: 0 };
  const client = db.$extends({
    query: {
      lineDelivery: {
        async create({ args, query }) {
          if (state.failing) {
            state.failures += 1;
            throw new Prisma.PrismaClientKnownRequestError("Synthetic dropped connection.", { code: "P1017", clientVersion: Prisma.prismaVersion.client });
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
  return { client, state };
}

describe("an http deployment: the LINE button cannot be HTTPS", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", HTTP_APP_URL);
  });

  it.each(LINE_KINDS)("skips %s in a delayed step; the e-mail, voucher and tag complete, the step is completed and the next step runs", async (_label, actions, source) => {
    const t = await tenant();
    const submission = await lead(t);
    const r = await rule(t, [{ type: "add_customer_tag", tag: "報名" }]);
    const first = await step(t, r.id, 60, actions(t));
    await step(t, r.id, 120, [{ type: "add_customer_tag", tag: "第二步" }]);
    await registered(t, submission);
    const { run, due } = await dueRun(t);

    await expect(runDelayedStepWorker({ now: due, vendorId: t.vendor.id })).resolves.toEqual([{ runId: run.id, status: "executed", emailsQueued: 1 }]);
    const logId = automationStepExecutionLogId(t.vendor.id, run.id, first.id);
    const log = await db.automationExecutionLog.findUniqueOrThrow({ where: { id: logId } });
    expect(log).toMatchObject({ status: "completed", errorCode: null });
    // A fixed code only: no URL, address or LINE id in the record.
    expect(lineResults(resultsOf(log.actionResults))).toEqual([{ type: "line_push", status: "skipped", reason: "line_button_url_not_https", ...source }]);
    expect(automationExecutionNotes(log.actionResults)).toEqual(["LINE 未發送：按鈕連結不是 HTTPS 網址（例如測試環境用 http）"]);
    const produced = await outputs(t);
    expect(produced).toMatchObject({ vouchers: [expect.anything()], emails: [{ trigger: AUTOMATION_STEP_EMAIL_TRIGGER, status: "queued" }], tags: ["line-isolation", "報名"], lines: [] });
    // The run is not held for a retry: it moved on to the next step, which runs when due.
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "active", cursorDelayMinutes: 60, claimedAt: null, attemptCount: 0 });
    await expect(runDelayedStepWorker({ now: new Date(run.anchorAt.getTime() + 121 * MINUTE), vendorId: t.vendor.id })).resolves.toEqual([{ runId: run.id, status: "executed" }]);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "completed" });
    expect((await outputs(t)).tags).toEqual(["line-isolation", "報名", "第二步"]);
    // Nothing of the first step was produced twice.
    expect((await outputs(t)).vouchers).toEqual(produced.vouchers);
    expect((await outputs(t)).emails).toHaveLength(1);
    expect(monitoring.captureOperationalError).not.toHaveBeenCalled();
  });

  it.each(LINE_KINDS)("skips %s in an immediate rule, which completes with its other actions", async (_label, actions, source) => {
    const t = await tenant();
    const submission = await lead(t);
    const r = await rule(t, actions(t));
    await expect(registered(t, submission)).resolves.toEqual([{ ruleId: r.id, status: "completed" }]);
    const log = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, ruleId: r.id } });
    expect(log).toMatchObject({ status: "completed", errorCode: null });
    expect(lineResults(log.actionResults as Array<Record<string, unknown>>)).toEqual([{ type: "line_push", status: "skipped", reason: "line_button_url_not_https", ...source }]);
    await expect(outputs(t)).resolves.toMatchObject({ vouchers: [expect.anything()], emails: [{ trigger: AUTOMATION_EMAIL_TRIGGER, status: "queued" }], tags: ["line-isolation"], lines: [] });
    // A replay of the event is a duplicate: the completed execution is never reclaimed.
    await expect(registered(t, submission)).resolves.toEqual([{ ruleId: r.id, status: "duplicate" }]);
  });
});

describe("LINE not set up: no Official Account, or no linked identity", () => {
  it.each([
    ["the vendor has no LINE Official Account", { lineAccount: false }, { linked: true }, "line_account_unavailable", "LINE 未發送：商家尚未連結 LINE 官方帳號"],
    ["the registrant has not linked LINE", {}, { linked: false }, "line_recipient_not_linked", "LINE 未發送：收件人尚未綁定 LINE"],
  ] as const)("records the LINE action skipped when %s; the step completes", async (_label, tenantOptions, leadOptions, reason, note) => {
    const t = await tenant(tenantOptions);
    const submission = await lead(t, leadOptions);
    const r = await rule(t, [{ type: "add_customer_tag", tag: "報名" }]);
    const first = await step(t, r.id, 60, [voucher(t, false), LINE_PUSH, EMAIL, TAG]);
    await registered(t, submission);
    const { run, due } = await dueRun(t);
    await expect(runDelayedStepWorker({ now: due, vendorId: t.vendor.id })).resolves.toEqual([{ runId: run.id, status: "executed", emailsQueued: 1 }]);
    const log = await db.automationExecutionLog.findUniqueOrThrow({ where: { id: automationStepExecutionLogId(t.vendor.id, run.id, first.id) } });
    expect(log.status).toBe("completed");
    expect(lineResults(resultsOf(log.actionResults))).toEqual([{ type: "line_push", status: "skipped", reason }]);
    expect(automationExecutionNotes(log.actionResults)).toEqual([note]);
    await expect(outputs(t)).resolves.toMatchObject({ vouchers: [expect.anything()], emails: [expect.anything()], lines: [] });
  });

  it("treats a revoked LINE identity as not linked", async () => {
    const t = await tenant();
    const submission = await lead(t, { linked: false });
    await linkLine(t.vendor.id, submission.id, { revoked: true });
    const r = await rule(t, [EMAIL, TAG, voucher(t, true)]);
    await expect(registered(t, submission)).resolves.toEqual([{ ruleId: r.id, status: "completed" }]);
    const log = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, ruleId: r.id } });
    expect(lineResults(log.actionResults as Array<Record<string, unknown>>)).toEqual([{ type: "line_push", status: "skipped", reason: "line_recipient_not_linked", source: "voucher_delivery" }]);
  });
});

describe("a transient LINE failure keeps the retry, and the retry repeats nothing", () => {
  it("retries a delayed step whose LINE outbox write failed; the retry reuses the voucher and the e-mail and queues LINE once", async () => {
    const t = await tenant();
    const submission = await lead(t);
    const r = await rule(t, [{ type: "add_customer_tag", tag: "報名" }]);
    // The voucher's LINE notification runs last: the e-mail and the tag succeed before the failure.
    const first = await step(t, r.id, 60, [EMAIL, TAG, voucher(t, true)]);
    await registered(t, submission);
    const { run, due } = await dueRun(t);
    const flaky = flakyLineOutbox();

    await expect(runDelayedStepWorker({ now: due, vendorId: t.vendor.id }, flaky.client)).resolves.toEqual([{ runId: run.id, status: "failed", emailsQueued: 1 }]);
    const logId = automationStepExecutionLogId(t.vendor.id, run.id, first.id);
    await expect(db.automationExecutionLog.findUniqueOrThrow({ where: { id: logId } })).resolves.toMatchObject({ status: "failed", errorCode: "action_failed" });
    const afterFailure = await outputs(t);
    expect(afterFailure).toMatchObject({ vouchers: [expect.anything()], emails: [expect.anything()], tags: ["line-isolation", "報名"], lines: [] });
    // The lease is kept for the retry.
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "active", cursorDelayMinutes: -1, attemptCount: 1 });
    await expect(runDelayedStepWorker({ now: new Date(due.getTime() + DELAYED_STEP_LEASE_MS - MINUTE), vendorId: t.vendor.id }, flaky.client)).resolves.toEqual([]);

    flaky.state.failing = false;
    await expect(runDelayedStepWorker({ now: new Date(due.getTime() + DELAYED_STEP_LEASE_MS + MINUTE), vendorId: t.vendor.id }, flaky.client)).resolves.toEqual([{ runId: run.id, status: "executed" }]);
    expect(flaky.state.failures).toBe(1);
    const log = await db.automationExecutionLog.findUniqueOrThrow({ where: { id: logId } });
    expect(log).toMatchObject({ status: "completed", errorCode: null });
    // The same voucher (same id and bearer), the same e-mail row, one LINE row bound to this execution.
    expect(resultsOf(log.actionResults).map((result) => [result.type, result.status])).toEqual([
      ["issue_repurchase_voucher", "already_issued"],
      ["send_email_notification", "duplicate"],
      ["add_customer_tag", "tagged"],
      ["line_push", "queued"],
    ]);
    const afterRetry = await outputs(t);
    expect(afterRetry.vouchers).toEqual(afterFailure.vouchers);
    expect(afterRetry.emails).toEqual(afterFailure.emails);
    expect(afterRetry.tags).toEqual(afterFailure.tags);
    expect(afterRetry.lines).toMatchObject([{ idempotencyKey: stableLineIdempotencyKey(["automation-voucher", logId]) }]);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "completed" });
  });

  it("retries an immediate rule whose LINE outbox write failed when its event comes again; nothing is issued or queued twice", async () => {
    const t = await tenant();
    const submission = await lead(t);
    const r = await rule(t, [voucher(t, false), LINE_PUSH, EMAIL, TAG]);
    const flaky = flakyLineOutbox();
    await expect(registered(t, submission, flaky.client)).resolves.toEqual([{ ruleId: r.id, status: "failed" }]);
    const afterFailure = await outputs(t);
    // The LINE push threw before the e-mail and the tag (as before A2-09: a transient error stops the rule).
    expect(afterFailure).toMatchObject({ vouchers: [expect.anything()], emails: [], tags: [], lines: [] });
    flaky.state.failing = false;
    await expect(registered(t, submission, flaky.client)).resolves.toEqual([{ ruleId: r.id, status: "completed" }]);
    const afterRetry = await outputs(t);
    expect(afterRetry.vouchers).toEqual(afterFailure.vouchers);
    expect(afterRetry).toMatchObject({ emails: [expect.anything()], tags: ["line-isolation"], lines: [expect.anything()] });
    await expect(registered(t, submission, flaky.client)).resolves.toEqual([{ ruleId: r.id, status: "duplicate" }]);
    expect(await outputs(t)).toEqual(afterRetry);
  });

  it.each([
    ["a LINE API 5xx", () => new LineMessagingError("LINE push failed with HTTP 500", 500)],
    ["a network error", () => new TypeError("fetch failed")],
  ] as const)("retries %s in the LINE outbox only: the completed step is never run again", async (_label, failure) => {
    const t = await tenant();
    const submission = await lead(t);
    const r = await rule(t, [{ type: "add_customer_tag", tag: "報名" }]);
    const first = await step(t, r.id, 60, [EMAIL, TAG, voucher(t, true)]);
    await registered(t, submission);
    const { run, due } = await dueRun(t);
    await runDelayedStepWorker({ now: due, vendorId: t.vendor.id });
    const logId = automationStepExecutionLogId(t.vendor.id, run.id, first.id);
    const completed = await db.automationExecutionLog.findUniqueOrThrow({ where: { id: logId } });
    expect(completed.status).toBe("completed");
    const produced = await outputs(t);
    expect(produced.lines).toMatchObject([{ status: "queued" }]);

    const pushes: Array<{ to: string; retryKey: string | undefined }> = [];
    const client = (fail: boolean) => (): LineMessagingClient => ({
      async push(to, _messages, options) {
        pushes.push({ to, retryKey: options?.retryKey });
        if (fail) throw failure();
      },
      pushText: async () => { throw new Error("unused"); },
      pushFlex: async () => { throw new Error("unused"); },
    });
    const sendAt = new Date(due.getTime() + MINUTE);
    await expect(processDueLineDeliveries(db, client(true), sendAt, { vendorId: t.vendor.id })).resolves.toEqual([{ id: produced.lines[0]!.id, status: "failed" }]);
    await expect(db.lineDelivery.findUniqueOrThrow({ where: { id: produced.lines[0]!.id } })).resolves.toMatchObject({ status: "failed", attemptCount: 1, lastErrorCode: "provider_failed" });
    // The step is not involved in the LINE retry: no new run of it, the run already moved on.
    await expect(runDelayedStepWorker({ now: new Date(due.getTime() + DELAYED_STEP_LEASE_MS + MINUTE), vendorId: t.vendor.id })).resolves.toEqual([]);
    await expect(processDueLineDeliveries(db, client(false), new Date(sendAt.getTime() + 2 * MINUTE), { vendorId: t.vendor.id })).resolves.toEqual([{ id: produced.lines[0]!.id, status: "sent" }]);
    // Both attempts pushed the same outbox row with the same X-Line-Retry-Key.
    expect(pushes).toHaveLength(2);
    expect(new Set(pushes.map((push) => push.retryKey))).toEqual(new Set([produced.lines[0]!.id]));
    expect(new Set(pushes.map((push) => push.to)).size).toBe(1);
    const after = await outputs(t);
    expect(after.vouchers).toEqual(produced.vouchers);
    expect(after.emails).toEqual(produced.emails);
    expect(after.lines).toMatchObject([{ id: produced.lines[0]!.id, status: "sent", attemptCount: 2 }]);
    await expect(db.automationExecutionLog.findUniqueOrThrow({ where: { id: logId } })).resolves.toMatchObject({ status: "completed", completedAt: completed.completedAt, actionResults: completed.actionResults });
  });
});

describe("tenant boundary", () => {
  it("uses only the vendor's own LINE account and identity, never another tenant's identity bound to the same registration id", async () => {
    const a = await tenant();
    const b = await tenant();
    const submission = await lead(a);
    // B holds an identity whose subject id is A's registration (a forged or colliding binding).
    await linkLine(b.vendor.id, submission.id);
    const r = await rule(a, [EMAIL, TAG, voucher(a, true)]);
    await expect(registered(a, submission)).resolves.toEqual([{ ruleId: r.id, status: "completed" }]);
    const log = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: a.vendor.id, ruleId: r.id } });
    await expect(outputs(a)).resolves.toMatchObject({
      lines: [{ idempotencyKey: stableLineIdempotencyKey(["automation-voucher", log.id]), lineOfficialAccountId: a.account!.id, lineUserIdentityId: submission.identity!.id }],
    });
    await expect(db.lineDelivery.count({ where: { vendorId: b.vendor.id } })).resolves.toBe(0);
  });

  it.each([
    ["A has no LINE account while B has one and an identity for A's registration", { lineAccount: false }, false, "line_account_unavailable"],
    ["A's registrant is not linked while B has an identity for A's registration", {}, false, "line_recipient_not_linked"],
  ] as const)("skips the LINE action when %s, and writes nothing at B", async (_label, tenantOptions, linked, reason) => {
    const a = await tenant(tenantOptions);
    const b = await tenant();
    const submission = await lead(a, { linked });
    await linkLine(b.vendor.id, submission.id);
    const ra = await rule(a, [{ type: "add_customer_tag", tag: "報名" }]);
    const first = await step(a, ra.id, 60, [voucher(a, false), LINE_PUSH, EMAIL, TAG]);
    // B's own run of the same shape stays untouched by A's worker round.
    const bLead = await lead(b);
    const rb = await rule(b, [{ type: "add_customer_tag", tag: "報名" }]);
    await step(b, rb.id, 60, [voucher(b, false), LINE_PUSH, EMAIL, TAG]);
    await registered(a, submission);
    await registered(b, bLead);
    const { run, due } = await dueRun(a);
    const bRunBefore = await db.delayedStepRun.findFirstOrThrow({ where: { vendorId: b.vendor.id } });

    await expect(runDelayedStepWorker({ now: due, vendorId: a.vendor.id })).resolves.toEqual([{ runId: run.id, status: "executed", emailsQueued: 1 }]);
    const log = await db.automationExecutionLog.findUniqueOrThrow({ where: { id: automationStepExecutionLogId(a.vendor.id, run.id, first.id) } });
    expect(log.status).toBe("completed");
    expect(lineResults(resultsOf(log.actionResults))).toEqual([{ type: "line_push", status: "skipped", reason }]);
    await expect(db.lineDelivery.count({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } } })).resolves.toBe(0);
    await expect(db.delayedStepRun.findFirstOrThrow({ where: { vendorId: b.vendor.id } })).resolves.toEqual(bRunBefore);
    await expect(outputs(b)).resolves.toMatchObject({ vouchers: [], emails: [], lines: [] });
  });

  it("keeps one tenant's transient LINE failure from holding another tenant's step", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", HTTPS_APP_URL);
    const a = await tenant();
    const b = await tenant();
    const aLead = await lead(a);
    const bLead = await lead(b);
    for (const t of [a, b]) {
      const r = await rule(t, [{ type: "add_customer_tag", tag: "報名" }]);
      await step(t, r.id, 60, [EMAIL, TAG, voucher(t, true)]);
    }
    await registered(a, aLead);
    await registered(b, bLead);
    const flaky = flakyLineOutbox();
    const { run: aRun, due } = await dueRun(a);
    await expect(runDelayedStepWorker({ now: due, vendorId: a.vendor.id }, flaky.client)).resolves.toEqual([{ runId: aRun.id, status: "failed", emailsQueued: 1 }]);
    flaky.state.failing = false;
    const { run: bRun, due: bDue } = await dueRun(b);
    await expect(runDelayedStepWorker({ now: bDue, vendorId: b.vendor.id }, flaky.client)).resolves.toEqual([{ runId: bRun.id, status: "executed", emailsQueued: 1 }]);
    await expect(outputs(b)).resolves.toMatchObject({ vouchers: [expect.anything()], emails: [expect.anything()], lines: [{ lineOfficialAccountId: b.account!.id }] });
    await expect(outputs(a)).resolves.toMatchObject({ lines: [] });
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: aRun.id } })).resolves.toMatchObject({ status: "active", attemptCount: 1 });
  });
});
