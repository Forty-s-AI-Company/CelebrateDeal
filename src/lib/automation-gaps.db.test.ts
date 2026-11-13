import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F-4 第一個 PR（docs/product/delayed-steps-design.md §8「一併要修的既有缺口」）
// on the disposable PostgreSQL database: automation e-mails honour this
// vendor's unsubscribes and Email blacklist at creation and at send time and
// carry a working unsubscribe link; hidden triggers cannot be created or
// switched on but existing rules stay listable, can be switched off and
// deleted. Only the session, CSRF, Next.js and e-mail provider boundaries are
// synthetic.
const runtime = vi.hoisted(() => ({ actor: null as null | { user: { id: string }; vendor: { id: string }; member: { role: string } } }));
const provider = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/email-delivery-immediate", () => ({ scheduleImmediateEmailDispatch: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/email")>()), sendTransactionalEmail: provider.send }));
vi.mock("next/navigation", () => ({ redirect: (url: string): never => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", () => ({
  requireVendorManagerMember: async () => {
    if (!runtime.actor) throw new Error("redirect:/login");
    return { auth: {}, ...runtime.actor };
  },
}));

import { POST as unsubscribe } from "@/app/api/email/unsubscribe/route";
import { createAutomationRuleAction, deleteAutomationRuleAction, toggleAutomationRuleAction } from "@/app/actions/automation-actions";
import { automationCustomerKeyHash, dispatchAutomationEvent } from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
import { dispatchEmailDelivery } from "@/lib/email-delivery";
import { createEmailRecipientHash, revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";

const db = getDb();
const APP_URL = "https://automation-gaps.example.test";
const createdVendorIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "automation-gaps-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  provider.send.mockReset();
  provider.send.mockResolvedValue({ id: "synthetic-provider-message" });
  runtime.actor = null;
});

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function tenant() {
  const suffix = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: { name: `自動化商家 ${suffix}`, slug: `automation-gaps-${suffix}`, email: `merchant-${suffix}@example.test`, passwordHash: "disposable-test-only" },
  });
  createdVendorIds.push(vendor.id);
  const rule = await db.automationRule.create({
    data: {
      vendorId: vendor.id,
      name: "諮詢確認",
      trigger: "consultation_booked",
      condition: { type: "always" } as Prisma.InputJsonValue,
      actions: [{ type: "send_email_notification", template: "consultation_confirmation" }, { type: "add_customer_tag", tag: "諮詢學員" }] as Prisma.InputJsonArray,
    },
  });
  return { vendor, rule };
}

function booked(vendorId: string, email: string, bookingId = `booking-${randomUUID()}`) {
  return dispatchAutomationEvent(db, {
    vendorId,
    eventId: `consultation-booked:${bookingId}`,
    trigger: "consultation_booked",
    subjectType: "buyer_registration",
    subjectId: bookingId,
    subjectKeyHash: automationCustomerKeyHash(vendorId, email),
    recipientEmail: email,
    consultationUrl: "https://meet.example.test/room",
  });
}

async function latestLog(vendorId: string) {
  return db.automationExecutionLog.findFirstOrThrow({ where: { vendorId }, orderBy: { createdAt: "desc" } });
}

function unsubscribeLink(delivery: { id: string; vendorId: string; payloadEncryptedEnvelope: string }) {
  const { body } = revealEmailDeliveryPayload(delivery.payloadEncryptedEnvelope, { vendorId: delivery.vendorId, deliveryId: delivery.id });
  const link = body.match(/退訂：(\S+)/u)?.[1];
  if (!link) throw new Error("missing unsubscribe link");
  return new URL(link);
}

describe("automation e-mail unsubscribe and blacklist (F-4 gap 1)", () => {
  it("skips at creation for this vendor's blacklist and unsubscribes only, never another vendor's", async () => {
    const a = await tenant();
    const b = await tenant();
    await db.blacklist.create({ data: { vendorId: a.vendor.id, identifier: "lead@example.test", identifierType: "email", reason: "合成" } });
    await db.emailSuppression.create({
      data: { vendorId: a.vendor.id, recipientHash: createEmailRecipientHash("gone@example.test", a.vendor.id), recipientMaskedEmail: "g***@example.test", reason: "recipient_request", source: "unsubscribe_link" },
    });

    await expect(booked(a.vendor.id, " Lead@Example.test ")).resolves.toEqual([{ ruleId: a.rule.id, status: "completed" }]);
    expect((await latestLog(a.vendor.id)).actionResults).toEqual(expect.arrayContaining([
      { type: "send_email_notification", status: "skipped", reason: "recipient_blacklisted", template: "consultation_confirmation" },
      { type: "add_customer_tag", status: "tagged", tag: "諮詢學員" },
    ]));
    await expect(booked(a.vendor.id, "gone@example.test")).resolves.toEqual([{ ruleId: a.rule.id, status: "completed" }]);
    expect(await latestLog(a.vendor.id)).toMatchObject({ status: "completed", errorCode: null });
    expect((await latestLog(a.vendor.id)).actionResults).toContainEqual({ type: "send_email_notification", status: "skipped", reason: "recipient_suppressed", template: "consultation_confirmation" });
    expect(await db.emailDelivery.count({ where: { vendorId: a.vendor.id } })).toBe(0);
    expect(await db.customerTagAssignment.count({ where: { vendorId: a.vendor.id } })).toBe(2);

    // The same addresses at vendor B are queued: A's lists do not apply.
    await booked(b.vendor.id, "lead@example.test");
    await booked(b.vendor.id, "gone@example.test");
    const queued = await db.emailDelivery.findMany({ where: { vendorId: b.vendor.id } });
    expect(queued).toHaveLength(2);
    expect(queued.every((row) => row.trigger === "automation" && row.status === "queued")).toBe(true);
    // ...and sent: the send-time check reads B's blacklist only.
    for (const row of queued) await expect(dispatchEmailDelivery(row.id)).resolves.toEqual({ status: "sent" });
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it("carries a working unsubscribe link that records the unsubscribe for the sending vendor only", async () => {
    const a = await tenant();
    const b = await tenant();
    await booked(a.vendor.id, "lead@example.test");
    await booked(b.vendor.id, "lead@example.test");
    const delivery = await db.emailDelivery.findFirstOrThrow({ where: { vendorId: b.vendor.id } });
    const link = unsubscribeLink(delivery);
    expect(`${link.origin}${link.pathname}`).toBe(`${APP_URL}/unsubscribe`);

    const response = await unsubscribe(new Request(`${APP_URL}/api/email/unsubscribe`, {
      method: "POST",
      headers: { origin: APP_URL, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: link.searchParams.get("token")! }),
    }));
    expect(response.headers.get("location")).toBe(`${APP_URL}/unsubscribe?status=done`);
    expect(await db.emailSuppression.findMany({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } }, select: { vendorId: true, recipientHash: true, reason: true } }))
      .toEqual([{ vendorId: b.vendor.id, recipientHash: delivery.recipientHash, reason: "recipient_request" }]);
    // B's queued e-mail is stopped by the route; A's is not touched.
    expect(await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: "suppressed", lastErrorCode: "recipient_suppressed" });
    expect(await db.emailDelivery.findFirstOrThrow({ where: { vendorId: a.vendor.id } })).toMatchObject({ status: "queued" });

    // The next automation e-mail to the same person at B is not created.
    await booked(b.vendor.id, "LEAD@example.test");
    expect(await db.emailDelivery.count({ where: { vendorId: b.vendor.id } })).toBe(1);
    expect((await latestLog(b.vendor.id)).actionResults).toContainEqual(expect.objectContaining({ status: "skipped", reason: "recipient_suppressed" }));
  });

  it("suppresses at send time an automation e-mail queued before the recipient was blacklisted", async () => {
    const a = await tenant();
    const b = await tenant();
    await booked(a.vendor.id, "late@example.test");
    await booked(b.vendor.id, "late@example.test");
    await db.blacklist.create({ data: { vendorId: a.vendor.id, identifier: "late@example.test", identifierType: "email", reason: "合成" } });

    const blocked = await db.emailDelivery.findFirstOrThrow({ where: { vendorId: a.vendor.id } });
    await expect(dispatchEmailDelivery(blocked.id)).resolves.toEqual({ status: "suppressed" });
    expect(await db.emailDelivery.findUniqueOrThrow({ where: { id: blocked.id } })).toMatchObject({ status: "suppressed", lastErrorCode: "recipient_blacklisted" });
    expect(provider.send).not.toHaveBeenCalled();

    const other = await db.emailDelivery.findFirstOrThrow({ where: { vendorId: b.vendor.id } });
    await expect(dispatchEmailDelivery(other.id)).resolves.toEqual({ status: "sent" });
    expect(provider.send).toHaveBeenCalledOnce();
  });
});

describe("automation e-mail without an unsubscribe link (review M2)", () => {
  it("never queues the mail, still runs the rule's other actions, and a reclaim of the same event sends it once", async () => {
    const a = await tenant();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    await expect(booked(a.vendor.id, "lead@example.test", "booking-retry")).resolves.toEqual([{ ruleId: a.rule.id, status: "failed" }]);
    expect(await latestLog(a.vendor.id)).toMatchObject({ status: "failed", errorCode: "unsubscribe_url_unavailable" });
    expect(await db.emailDelivery.count({ where: { vendorId: a.vendor.id } })).toBe(0);
    expect(await db.customerTagAssignment.count({ where: { vendorId: a.vendor.id } })).toBe(1);

    // The same event again (same booking) reclaims the failed execution.
    vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
    await expect(booked(a.vendor.id, "lead@example.test", "booking-retry")).resolves.toEqual([{ ruleId: a.rule.id, status: "completed" }]);
    expect(await db.automationExecutionLog.count({ where: { vendorId: a.vendor.id } })).toBe(1);
    expect(await latestLog(a.vendor.id)).toMatchObject({ status: "completed", errorCode: null });
    expect(await db.customerTagAssignment.count({ where: { vendorId: a.vendor.id } })).toBe(1);
    const delivery = await db.emailDelivery.findFirstOrThrow({ where: { vendorId: a.vendor.id } });
    expect(unsubscribeLink(delivery).pathname).toBe("/unsubscribe");
    // A third delivery of the same event is a duplicate: nothing new.
    await expect(booked(a.vendor.id, "lead@example.test", "booking-retry")).resolves.toEqual([{ ruleId: a.rule.id, status: "duplicate" }]);
    expect(await db.emailDelivery.count({ where: { vendorId: a.vendor.id } })).toBe(1);
  });
});

/** Waits until another connection is blocked on a row lock in a statement matching `fragment`; fails if it never is. */
async function waitForLockWait(fragment: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await db.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%${fragment}%`}
    `;
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No statement waited on a lock for ${fragment}`);
}

describe("deleting a rule while it runs (review M1)", () => {
  const form = (entries: Record<string, string>) => {
    const value = new FormData();
    for (const [key, entry] of Object.entries(entries)) value.set(key, entry);
    return value;
  };

  // Each case holds a row lock from one connection while another waits. The
  // finally blocks release the lock and settle the other side even when an
  // assertion fails, so a failure never leaves a lock behind for later tests.
  it("waits for an execution log still being written and then keeps the rule and its log", async () => {
    const a = await tenant();
    await db.automationRule.update({ where: { id: a.rule.id }, data: { isActive: false } });
    runtime.actor = { user: { id: "synthetic-user" }, vendor: { id: a.vendor.id }, member: { role: "admin" } };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let written!: () => void;
    const logWritten = new Promise<void>((resolve) => { written = resolve; });
    const writer = db.$transaction(async (tx) => {
      await tx.automationExecutionLog.create({
        data: { vendorId: a.vendor.id, ruleId: a.rule.id, idempotencyKey: `concurrent-${randomUUID()}`, eventId: "concurrent", trigger: "consultation_booked", subjectType: "buyer_registration", status: "running" },
      });
      written();
      await gate;
    }, { timeout: 15_000 });
    let deletion: Promise<unknown> | undefined;
    try {
      await logWritten;
      deletion = deleteAutomationRuleAction(form({ ruleId: a.rule.id })).catch((error: Error) => error.message);
      await waitForLockWait("AutomationRule\"");
    } finally {
      release();
      await writer.catch(() => {});
    }
    expect(await deletion).toBe("redirect:/settings/automations?error=delete_has_history");
    expect(await db.automationRule.count({ where: { id: a.rule.id } })).toBe(1);
    expect(await db.automationExecutionLog.count({ where: { ruleId: a.rule.id } })).toBe(1);
  }, 20_000);

  it("lets an execution that starts during the delete skip the deleted rule and run the event's other rules", async () => {
    const a = await tenant();
    const next = await db.automationRule.create({
      data: { vendorId: a.vendor.id, name: "第二條", trigger: "consultation_booked", condition: { type: "always" } as Prisma.InputJsonValue, actions: [{ type: "add_customer_tag", tag: "第二條" }] as Prisma.InputJsonArray },
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const deleteLocked = new Promise<void>((resolve) => { locked = resolve; });
    // The same statements as deleteAutomationRuleAction, held open.
    const deleter = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id" = ${a.rule.id} AND "vendorId" = ${a.vendor.id} FOR UPDATE`;
      await tx.automationRule.delete({ where: { vendorId_id: { vendorId: a.vendor.id, id: a.rule.id } } });
      locked();
      await gate;
    }, { timeout: 15_000 });
    let dispatched: ReturnType<typeof booked> | undefined;
    try {
      await deleteLocked;
      // The engine still sees the rule (the delete is not committed) and its
      // log insert waits on the locked rule row.
      dispatched = booked(a.vendor.id, "lead@example.test");
      await waitForLockWait("AutomationExecutionLog");
    } finally {
      release();
      await deleter.catch(() => {});
    }
    await expect(dispatched).resolves.toEqual([
      { ruleId: a.rule.id, status: "rule_deleted" },
      { ruleId: next.id, status: "completed" },
    ]);
    expect(await db.automationRule.count({ where: { id: a.rule.id } })).toBe(0);
    expect(await db.customerTagAssignment.findMany({ where: { vendorId: a.vendor.id }, select: { tag: true } })).toEqual([{ tag: "第二條" }]);
    expect(await db.emailDelivery.count({ where: { vendorId: a.vendor.id } })).toBe(0);
  }, 20_000);

  it("gives up after the lock timeout while the rule stays locked and answers delete_busy", async () => {
    const a = await tenant();
    await db.automationRule.update({ where: { id: a.rule.id }, data: { isActive: false } });
    runtime.actor = { user: { id: "synthetic-user" }, vendor: { id: a.vendor.id }, member: { role: "owner" } };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const rowLocked = new Promise<void>((resolve) => { locked = resolve; });
    // Stands in for a long-running execution holding the rule row.
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id" = ${a.rule.id} FOR UPDATE`;
      locked();
      await gate;
    }, { timeout: 15_000 });
    let outcome: unknown;
    const started = Date.now();
    try {
      await rowLocked;
      outcome = await deleteAutomationRuleAction(form({ ruleId: a.rule.id })).catch((error: Error) => error.message);
    } finally {
      release();
      await holder.catch(() => {});
    }
    expect(outcome).toBe("redirect:/settings/automations?error=delete_busy");
    // lock_timeout is 5 s, well before the 15 s transaction timeout.
    expect(Date.now() - started).toBeGreaterThanOrEqual(4_500);
    expect(Date.now() - started).toBeLessThan(12_000);
    expect(await db.automationRule.count({ where: { id: a.rule.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { vendorId: a.vendor.id, action: "delete_automation_rule" } })).toBe(0);
  }, 20_000);
});

describe("hidden automation triggers on stored rules (F-4 gap 2)", () => {
  async function storedRule(vendorId: string, trigger: string, isActive: boolean) {
    return db.automationRule.create({
      data: { vendorId, name: `舊規則 ${trigger}`, trigger, isActive, condition: { type: "always" } as Prisma.InputJsonValue, actions: [{ type: "add_customer_tag", tag: "舊" }] as Prisma.InputJsonArray },
    });
  }
  const form = (entries: Record<string, string>) => {
    const value = new FormData();
    for (const [key, entry] of Object.entries(entries)) value.set(key, entry);
    return value;
  };

  it("refuses new rules on hidden triggers and keeps existing ones switchable off and deletable by their own vendor only", async () => {
    const a = await tenant();
    const b = await tenant();
    runtime.actor = { user: { id: "synthetic-user" }, vendor: { id: a.vendor.id }, member: { role: "admin" } };

    for (const trigger of ["payment_paid", "form_no_show", "viewer_watch_progress", "webinar_attended_duration_gte"]) {
      await expect(createAutomationRuleAction(form({ name: "新規則", trigger, conditionValue: "100", actionTag: "on", customerTag: "x" })))
        .rejects.toThrow("redirect:/settings/automations?error=trigger_unavailable");
    }
    expect(await db.automationRule.count({ where: { vendorId: a.vendor.id } })).toBe(1);

    const paid = await storedRule(a.vendor.id, "payment_paid", true);
    // Switching off works; switching back on does not.
    await expect(toggleAutomationRuleAction(form({ ruleId: paid.id }))).rejects.toThrow("updated=toggled");
    await expect(toggleAutomationRuleAction(form({ ruleId: paid.id }))).rejects.toThrow("error=trigger_unavailable");
    expect(await db.automationRule.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ isActive: false, trigger: "payment_paid" });

    // Another vendor's admin cannot touch it.
    runtime.actor = { user: { id: "synthetic-user-b" }, vendor: { id: b.vendor.id }, member: { role: "owner" } };
    await expect(deleteAutomationRuleAction(form({ ruleId: paid.id }))).rejects.toThrow("error=not_found");
    await expect(toggleAutomationRuleAction(form({ ruleId: a.rule.id }))).rejects.toThrow("error=not_found");
    expect(await db.automationRule.count({ where: { id: { in: [paid.id, a.rule.id] } } })).toBe(2);

    runtime.actor = { user: { id: "synthetic-user" }, vendor: { id: a.vendor.id }, member: { role: "admin" } };
    await expect(deleteAutomationRuleAction(form({ ruleId: paid.id }))).rejects.toThrow("updated=deleted");
    expect(await db.automationRule.findUnique({ where: { id: paid.id } })).toBeNull();
    expect(await db.auditLog.count({ where: { vendorId: a.vendor.id, action: "delete_automation_rule", targetId: paid.id } })).toBe(1);
  });

  it("keeps a switched-off rule that has run, with the tags it issued", async () => {
    const a = await tenant();
    runtime.actor = { user: { id: "synthetic-user" }, vendor: { id: a.vendor.id }, member: { role: "owner" } };
    await booked(a.vendor.id, "lead@example.test");
    await db.automationRule.update({ where: { id: a.rule.id }, data: { isActive: false } });

    await expect(deleteAutomationRuleAction(form({ ruleId: a.rule.id }))).rejects.toThrow("error=delete_has_history");
    expect(await db.automationRule.count({ where: { id: a.rule.id } })).toBe(1);
    expect(await db.customerTagAssignment.count({ where: { vendorId: a.vendor.id } })).toBe(1);
  });
});
