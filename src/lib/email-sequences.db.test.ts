import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  activateEmailSequence,
  deleteEmailSequence,
  emailSequenceRunCounts,
  pauseEmailSequence,
  saveEmailSequence,
} from "@/lib/email-sequences";
import { MAX_ACTIVE_EMAIL_SEQUENCES_PER_VENDOR, MAX_EMAIL_SEQUENCE_STEPS } from "@/lib/email-sequence-rules";
import { initialMessageTemplateActionState } from "@/lib/message-template";
import { saveMessageTemplate } from "@/lib/message-template-save";

/**
 * F-3 merchant-side writes (docs/product/delayed-steps-design.md §4, §6, §7):
 * every id from the form is bound to the current vendor, the limits are
 * enforced on the server, the optimistic lock rejects stale saves, and pausing
 * stops people part-way through without reviving them on resume.
 */

const db = getDb();
const createdVendorIds: string[] = [];

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

const now = new Date("2026-12-01T00:00:00.000Z");

async function tenant() {
  const suffix = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: { name: `序列 ${suffix}`, slug: `seq-svc-${suffix}`, email: `svc-${suffix}@example.test`, passwordHash: "disposable", betaFeatureGrants: ["email_sequences"] },
  });
  createdVendorIds.push(vendor.id);
  const live = await db.live.create({
    data: { vendorId: vendor.id, title: "直播", slug: `seq-svc-live-${suffix}`, scheduledAt: new Date("2026-12-10T00:00:00.000Z") },
  });
  const template = (data: Partial<{ trigger: string; isActive: boolean; body: string }> = {}) => db.messageTemplate.create({
    data: {
      vendorId: vendor.id,
      name: "序列信",
      trigger: data.trigger ?? "sequence_email",
      subject: "{{live_title}} 的下一步",
      body: data.body ?? "{{name}} 你好 {{unsubscribe_url}}",
      isActive: data.isActive ?? true,
    },
  });
  return { vendor, live, template, mail: await template() };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

function steps(t: Tenant, delays: number[], overrides: Partial<{ messageTemplateId: string; isActive: boolean }> = {}) {
  return delays.map((delayMinutes) => ({ id: null, delayMinutes, messageTemplateId: overrides.messageTemplateId ?? t.mail.id, isActive: overrides.isActive ?? true }));
}

async function create(t: Tenant, delays = [60, 1_440]) {
  const result = await saveEmailSequence({ vendorId: t.vendor.id, sequenceId: null, expectedVersion: null, data: { name: "報名後追銷", liveId: t.live.id, steps: steps(t, delays) }, now });
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result)}`);
  return result;
}

describe("saveEmailSequence", () => {
  it("creates a draft with its steps for the current vendor", async () => {
    const t = await tenant();
    const created = await create(t);
    const row = await db.emailSequence.findUniqueOrThrow({ where: { id: created.id }, include: { steps: { orderBy: { delayMinutes: "asc" } } } });
    expect(row).toMatchObject({ vendorId: t.vendor.id, liveId: t.live.id, status: "draft", activatedAt: null, stopOnPurchase: true, version: 1 });
    expect(row.steps.map((step) => [step.delayMinutes, step.messageTemplateId, step.isActive])).toEqual([[60, t.mail.id, true], [1_440, t.mail.id, true]]);
  });

  it("refuses another vendor's Live or template and a template that is not a sequence e-mail", async () => {
    const a = await tenant();
    const b = await tenant();
    const otherTrigger = await a.template({ trigger: "post_live_followup" });
    const result = await saveEmailSequence({
      vendorId: a.vendor.id, sequenceId: null, expectedVersion: null, now,
      data: { name: "跨租戶", liveId: b.live.id, steps: [...steps(a, [60], { messageTemplateId: b.mail.id }), ...steps(a, [120], { messageTemplateId: otherTrigger.id })] },
    });
    expect(result).toMatchObject({
      ok: false,
      code: "invalid",
      fieldErrors: {
        liveId: expect.any(String),
        "steps.0.messageTemplateId": expect.any(String),
        "steps.1.messageTemplateId": expect.any(String),
      },
    });
    expect(await db.emailSequence.count({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } } })).toBe(0);
  });

  it("does not let another vendor read or change a sequence by id", async () => {
    const a = await tenant();
    const b = await tenant();
    const created = await create(a);
    await expect(saveEmailSequence({ vendorId: b.vendor.id, sequenceId: created.id, expectedVersion: 1, now, data: { name: "偷改", liveId: b.live.id, steps: steps(b, [60]) } }))
      .resolves.toEqual({ ok: false, code: "not_found" });
    await expect(activateEmailSequence({ vendorId: b.vendor.id, sequenceId: created.id, expectedVersion: 1, now })).resolves.toEqual({ ok: false, code: "not_found" });
    await expect(pauseEmailSequence({ vendorId: b.vendor.id, sequenceId: created.id, expectedVersion: 1 })).resolves.toEqual({ ok: false, code: "not_found" });
    await expect(deleteEmailSequence({ vendorId: b.vendor.id, sequenceId: created.id, expectedVersion: 1 })).resolves.toEqual({ ok: false, code: "not_found" });
    await expect(db.emailSequence.findUniqueOrThrow({ where: { id: created.id } })).resolves.toMatchObject({ name: "報名後追銷", version: 1, status: "draft" });
  });

  it("rejects a stale version (optimistic lock) and keeps the newer save", async () => {
    const t = await tenant();
    const created = await create(t);
    const first = await saveEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 1, now, data: { name: "第一個分頁", liveId: t.live.id, steps: steps(t, [60]) } });
    expect(first).toMatchObject({ ok: true, version: 2 });
    await expect(saveEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 1, now, data: { name: "第二個分頁", liveId: t.live.id, steps: steps(t, [120]) } }))
      .resolves.toEqual({ ok: false, code: "conflict" });
    await expect(activateEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 1, now })).resolves.toEqual({ ok: false, code: "conflict" });
    const row = await db.emailSequence.findUniqueOrThrow({ where: { id: created.id }, include: { steps: true } });
    expect(row.name).toBe("第一個分頁");
    expect(row.steps.map((step) => step.delayMinutes)).toEqual([60]);
  });

  it("enforces the step limit on the server", async () => {
    const t = await tenant();
    const delays = Array.from({ length: MAX_EMAIL_SEQUENCE_STEPS + 1 }, (_, index) => 60 * (index + 1));
    await expect(saveEmailSequence({ vendorId: t.vendor.id, sequenceId: null, expectedVersion: null, now, data: { name: "太多", liveId: t.live.id, steps: steps(t, delays) } }))
      .resolves.toMatchObject({ ok: false, code: "invalid" });
    await expect(saveEmailSequence({ vendorId: t.vendor.id, sequenceId: null, expectedVersion: null, now, data: { name: "剛好", liveId: t.live.id, steps: steps(t, delays.slice(0, MAX_EMAIL_SEQUENCE_STEPS)) } }))
      .resolves.toMatchObject({ ok: true });
    // The database refuses delays outside 1 hour to 90 days even past the parser.
    const created = await create(t);
    await expect(db.emailSequenceStep.create({ data: { vendorId: t.vendor.id, emailSequenceId: created.id, delayMinutes: 59, messageTemplateId: t.mail.id } })).rejects.toThrow();
    await expect(db.emailSequenceStep.create({ data: { vendorId: t.vendor.id, emailSequenceId: created.id, delayMinutes: 129_601, messageTemplateId: t.mail.id } })).rejects.toThrow();
  });

  it("keeps unchanged steps, replaces moved ones (also a swap) and reschedules people part-way", async () => {
    const t = await tenant();
    const created = await create(t, [60, 1_440, 2_880]);
    await activateEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 1, now });
    const before = await db.emailSequenceStep.findMany({ where: { emailSequenceId: created.id }, orderBy: { delayMinutes: "asc" } });
    const form = await db.registrationForm.create({ data: { vendorId: t.vendor.id, name: "表", slug: `seq-svc-form-${randomUUID().slice(0, 8)}`, headline: "表", fields: [] } });
    const lead = await db.formSubmission.create({ data: { formId: form.id, liveId: t.live.id, name: "人", email: "p@example.test", verificationStatus: "VERIFIED", verifiedAt: now } });
    await db.delayedStepRun.create({ data: { vendorId: t.vendor.id, emailSequenceId: created.id, formSubmissionId: lead.id, subjectKeyHash: "x", anchorAt: now, cursorDelayMinutes: 60, nextRunAt: new Date(now.getTime() + 1_440 * 60_000) } });

    const saved = await saveEmailSequence({
      vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 2, now,
      data: {
        name: "報名後追銷",
        liveId: t.live.id,
        steps: [
          { id: before[0]!.id, delayMinutes: 60, messageTemplateId: t.mail.id, isActive: false },
          // Swap the second and third delays.
          { id: before[1]!.id, delayMinutes: 2_880, messageTemplateId: t.mail.id, isActive: true },
          { id: before[2]!.id, delayMinutes: 1_440, messageTemplateId: t.mail.id, isActive: true },
          { id: null, delayMinutes: 720, messageTemplateId: t.mail.id, isActive: true },
        ],
      },
    });
    expect(saved).toMatchObject({ ok: true, version: 3 });
    const after = await db.emailSequenceStep.findMany({ where: { emailSequenceId: created.id }, orderBy: { delayMinutes: "asc" } });
    expect(after.map((step) => [step.delayMinutes, step.isActive])).toEqual([[60, false], [720, true], [1_440, true], [2_880, true]]);
    expect(after[0]!.id).toBe(before[0]!.id);
    const [run] = await db.delayedStepRun.findMany({ where: { emailSequenceId: created.id } });
    expect(run!.nextRunAt).toEqual(new Date(now.getTime() + 720 * 60_000));
  });

  it("does not let an activated sequence move to another Live, or an active one end without a step to send", async () => {
    const t = await tenant();
    const otherLive = await db.live.create({ data: { vendorId: t.vendor.id, title: "另一場", slug: `seq-svc-other-${randomUUID().slice(0, 8)}`, scheduledAt: now } });
    const created = await create(t, [60]);
    await activateEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 1, now });
    const step = await db.emailSequenceStep.findFirstOrThrow({ where: { emailSequenceId: created.id } });
    await expect(saveEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 2, now, data: { name: "x", liveId: otherLive.id, steps: [{ id: step.id, delayMinutes: 60, messageTemplateId: t.mail.id, isActive: true }] } }))
      .resolves.toMatchObject({ ok: false, code: "invalid", fieldErrors: { liveId: expect.any(String) } });
    await expect(saveEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 2, now, data: { name: "x", liveId: t.live.id, steps: [{ id: step.id, delayMinutes: 60, messageTemplateId: t.mail.id, isActive: false }] } }))
      .resolves.toMatchObject({ ok: false, code: "invalid", fieldErrors: { steps: expect.any(String) } });
  });
});

describe("activate / pause / delete", () => {
  it(`allows at most ${MAX_ACTIVE_EMAIL_SEQUENCES_PER_VENDOR} active sequences per vendor, also under concurrent activation`, async () => {
    const t = await tenant();
    const sequences = [];
    for (let index = 0; index < MAX_ACTIVE_EMAIL_SEQUENCES_PER_VENDOR + 2; index += 1) sequences.push(await create(t, [60]));
    const results = await Promise.all(sequences.map((sequence) => activateEmailSequence({ vendorId: t.vendor.id, sequenceId: sequence.id, expectedVersion: 1, now })));
    expect(results.filter((result) => result.ok)).toHaveLength(MAX_ACTIVE_EMAIL_SEQUENCES_PER_VENDOR);
    expect(results.filter((result) => !result.ok && result.code === "active_limit")).toHaveLength(2);
    expect(await db.emailSequence.count({ where: { vendorId: t.vendor.id, status: "active" } })).toBe(MAX_ACTIVE_EMAIL_SEQUENCES_PER_VENDOR);
    // Another vendor has its own limit.
    const other = await tenant();
    const otherSequence = await create(other, [60]);
    await expect(activateEmailSequence({ vendorId: other.vendor.id, sequenceId: otherSequence.id, expectedVersion: 1, now })).resolves.toEqual({ ok: true, status: "activated" });
  });

  it("refuses to activate without a sendable step", async () => {
    const t = await tenant();
    const created = await saveEmailSequence({ vendorId: t.vendor.id, sequenceId: null, expectedVersion: null, now, data: { name: "空", liveId: t.live.id, steps: steps(t, [60], { isActive: false }) } });
    if (!created.ok) throw new Error("create failed");
    await expect(activateEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 1, now })).resolves.toMatchObject({ ok: false, code: "not_ready" });
    const withMail = await create(t, [60]);
    await db.messageTemplate.update({ where: { id: t.mail.id }, data: { isActive: false } });
    await expect(activateEmailSequence({ vendorId: t.vendor.id, sequenceId: withMail.id, expectedVersion: 1, now })).resolves.toMatchObject({ ok: false, code: "not_ready" });
  });

  it("pausing cancels the runs part-way; resuming re-anchors activation and does not revive them", async () => {
    const t = await tenant();
    const created = await create(t, [60]);
    await activateEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 1, now });
    const form = await db.registrationForm.create({ data: { vendorId: t.vendor.id, name: "表", slug: `seq-svc-form-${randomUUID().slice(0, 8)}`, headline: "表", fields: [] } });
    const lead = await db.formSubmission.create({ data: { formId: form.id, liveId: t.live.id, name: "人", email: "p@example.test", verificationStatus: "VERIFIED", verifiedAt: now } });
    await db.delayedStepRun.create({ data: { vendorId: t.vendor.id, emailSequenceId: created.id, formSubmissionId: lead.id, subjectKeyHash: "x", anchorAt: now, nextRunAt: now } });

    await expect(pauseEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 2 })).resolves.toEqual({ ok: true, status: "paused", cancelledRuns: 1 });
    expect(await db.delayedStepRun.findMany({ where: { emailSequenceId: created.id } })).toEqual([expect.objectContaining({ status: "cancelled", cancelReason: "definition_paused", nextRunAt: null })]);
    const later = new Date(now.getTime() + 3_600_000);
    await expect(activateEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 3, now: later })).resolves.toEqual({ ok: true, status: "activated" });
    await expect(db.emailSequence.findUniqueOrThrow({ where: { id: created.id } })).resolves.toMatchObject({ status: "active", activatedAt: later, version: 4 });
    expect(await db.delayedStepRun.findMany({ where: { emailSequenceId: created.id } })).toEqual([expect.objectContaining({ status: "cancelled" })]);
    expect(await emailSequenceRunCounts(t.vendor.id)).toEqual(new Map([[created.id, { active: 0, completed: 0, cancelled: 1 }]]));
  });

  it("deletes with the version, together with steps and runs", async () => {
    const t = await tenant();
    const created = await create(t, [60, 120]);
    await expect(deleteEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 7 })).resolves.toEqual({ ok: false, code: "conflict" });
    await expect(deleteEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 1 })).resolves.toEqual({ ok: true });
    expect(await db.emailSequenceStep.count({ where: { emailSequenceId: created.id } })).toBe(0);
    // The template itself stays, and can now be deleted with the vendor.
    await expect(db.messageTemplate.findUnique({ where: { id: t.mail.id } })).resolves.not.toBeNull();
  });

  it("refuses to switch off or re-purpose a template an active sequence sends, and allows it once paused (S4)", async () => {
    const t = await tenant();
    const created = await create(t, [60]);
    await activateEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 1, now });
    const current = await db.messageTemplate.findUniqueOrThrow({ where: { id: t.mail.id } });
    const form = (values: Record<string, string>) => {
      const data = new FormData();
      const fields = { id: t.mail.id, expectedUpdatedAt: current.updatedAt.toISOString(), name: "序列信", channel: "email", trigger: "sequence_email", subject: "{{live_title}} 的下一步", body: "{{name}} 你好 {{unsubscribe_url}}", isActive: "on", ...values };
      for (const [key, value] of Object.entries(fields)) if (value !== "") data.set(key, value);
      return data;
    };
    const actor = { actorId: "user-1", actorLabel: "owner" };
    for (const values of [{ isActive: "" }, { trigger: "post_live_followup" }] as Array<Record<string, string>>) {
      const result = await saveMessageTemplate({ vendorId: t.vendor.id, auditActor: actor, previousState: initialMessageTemplateActionState, formData: form(values) });
      expect(result).toMatchObject({ ok: false, state: { error: "in_use_by_sequence", expectedUpdatedAt: current.updatedAt.toISOString() } });
    }
    await expect(db.messageTemplate.findUniqueOrThrow({ where: { id: t.mail.id } })).resolves.toMatchObject({ isActive: true, trigger: "sequence_email", updatedAt: current.updatedAt });
    // A content edit is allowed.
    await expect(saveMessageTemplate({ vendorId: t.vendor.id, auditActor: actor, previousState: initialMessageTemplateActionState, formData: form({ body: "新的內容 {{unsubscribe_url}}" }) })).resolves.toMatchObject({ ok: true });
    // Once the sequence is paused, the template can be switched off.
    await pauseEmailSequence({ vendorId: t.vendor.id, sequenceId: created.id, expectedVersion: 2 });
    const latest = await db.messageTemplate.findUniqueOrThrow({ where: { id: t.mail.id } });
    await expect(saveMessageTemplate({ vendorId: t.vendor.id, auditActor: actor, previousState: initialMessageTemplateActionState, formData: form({ isActive: "", expectedUpdatedAt: latest.updatedAt.toISOString() }) })).resolves.toMatchObject({ ok: true });
  });

  it("refuses to delete a template a step still uses", async () => {
    const t = await tenant();
    await create(t, [60]);
    await expect(db.messageTemplate.delete({ where: { id: t.mail.id } })).rejects.toThrow();
  });
});
