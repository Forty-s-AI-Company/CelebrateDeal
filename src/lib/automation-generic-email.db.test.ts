import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A2-04: the link-free `generic_message` e-mail template on the disposable
// PostgreSQL database. Vendors, forms, Lives, registrations, rules, execution
// logs and the queued e-mails are real. Synthetic: the post-response immediate
// send and monitoring. No provider or e-mail service is called.
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/monitoring", async (original) => ({
  ...await original<typeof import("@/lib/monitoring")>(),
  captureOperationalError: monitoring.captureOperationalError,
}));
vi.mock("@/lib/email-delivery-immediate", async (original) => ({
  ...await original<typeof import("@/lib/email-delivery-immediate")>(),
  scheduleImmediateEmailDispatch: vi.fn(),
}));

import { automationCustomerKeyHash, dispatchAutomationEvent, type AutomationEvent } from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
import { revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { richTextToEmailHtml } from "@/lib/rich-text";

const db = getDb();
const vendorIds: string[] = [];
const APP_URL = "https://generic-email.example.test";

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "generic-email-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  monitoring.captureOperationalError.mockClear();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

async function tenant(vendorName = "示範商家") {
  const key = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: {
      name: vendorName,
      slug: `generic-email-${key}`,
      email: `vendor-${key}@example.test`,
      passwordHash: "synthetic-only",
      betaFeatureGrants: ["automation_watch_progress", "automation_watch_duration"],
    },
  });
  vendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "報名表", slug: `generic-email-form-${key}`, headline: "報名", fields: [{ key: "email", label: "Email", type: "email", required: true }] },
  });
  const live = await db.live.create({
    data: { vendorId: vendor.id, formId: form.id, title: "新品發表會", slug: `generic-email-live-${key}`, scheduledAt: new Date(Date.now() - 3_600_000), status: "scheduled", streamMode: "vod" },
  });
  return { vendor, form, live };
}
type Tenant = Awaited<ReturnType<typeof tenant>>;

async function registrant(t: Tenant, name = "王小明") {
  return db.formSubmission.create({
    data: { formId: t.form.id, liveId: t.live.id, name, email: `lead-${randomUUID().slice(0, 8)}@example.test`, verificationStatus: "VERIFIED", verifiedAt: new Date() },
  });
}

const GENERIC = { type: "send_email_notification", template: "generic_message", subject: "{{name}}，謝謝你來看 {{live_title}}", body: "{{name}} 你好\n\n謝謝你的參與。\n{{vendor_name}}" };

function rule(t: Tenant, trigger: string, condition: unknown, actions: unknown[] = [GENERIC]) {
  return db.automationRule.create({
    data: { vendorId: t.vendor.id, name: `規則 ${randomUUID().slice(0, 6)}`, trigger, condition: condition as Prisma.InputJsonValue, actions: actions as Prisma.InputJsonArray, isActive: true, updatedAt: new Date(Date.now() - 3_600_000) },
  });
}

function event(t: Tenant, trigger: AutomationEvent["trigger"], extra: Partial<AutomationEvent>): AutomationEvent {
  const email = extra.recipientEmail ?? `buyer-${randomUUID().slice(0, 8)}@example.test`;
  return {
    vendorId: t.vendor.id,
    eventId: `generic-email:${randomUUID()}`,
    trigger,
    subjectType: "buyer_registration",
    subjectId: randomUUID(),
    subjectKeyHash: automationCustomerKeyHash(t.vendor.id, email),
    recipientEmail: email,
    ...extra,
  };
}

async function sentMail(t: Tenant) {
  const mails = await db.emailDelivery.findMany({ where: { vendorId: t.vendor.id } });
  return mails.map((mail) => ({ mail, payload: revealEmailDeliveryPayload(mail.payloadEncryptedEnvelope, { vendorId: t.vendor.id, deliveryId: mail.id }) }));
}

function expectComplianceFooter(body: string) {
  // The signed unsubscribe link of this delivery, last in the mail; no other link was written by the template.
  expect(body).toMatch(/\n\n退訂：https:\/\/generic-email\.example\.test\/[^\s]+$/u);
  expect(body.match(/https?:\/\//gu)).toHaveLength(1);
}

describe("generic_message e-mail on each trigger without a link", () => {
  it("form_registered: queues the mail with the registrant's name, the Live's title and the vendor's name", async () => {
    const t = await tenant();
    const submission = await registrant(t);
    await rule(t, "form_registered", { type: "always" });
    const results = await dispatchAutomationEvent(db, event(t, "form_registered", { subjectId: submission.id, recipientEmail: submission.email }));
    expect(results).toMatchObject([{ status: "completed" }]);
    const [{ mail, payload }] = await sentMail(t);
    expect(mail).toMatchObject({ status: "queued", sourceTemplateId: "automation_generic_message_v1", vendorId: t.vendor.id });
    expect(payload.recipientEmail).toBe(submission.email);
    expect(payload.subject).toBe("王小明，謝謝你來看 新品發表會");
    expect(payload.body.startsWith("王小明 你好\n\n謝謝你的參與。\n示範商家\n\n退訂：")).toBe(true);
    expectComplianceFooter(payload.body);
  });

  it("payment_paid: queues the mail with the vendor's name only", async () => {
    const t = await tenant("付款商家");
    await rule(t, "payment_paid", { type: "order_amount_gte", amountCents: 1_000 }, [{ ...GENERIC, subject: "{{vendor_name}} 謝謝你的購買", body: "我們收到你的付款了。\n{{vendor_name}}" }]);
    const results = await dispatchAutomationEvent(db, event(t, "payment_paid", { subjectType: "buyer_order", orderAmountCents: 2_000, currency: "TWD" }));
    expect(results).toMatchObject([{ status: "completed" }]);
    const [{ payload }] = await sentMail(t);
    expect(payload.subject).toBe("付款商家 謝謝你的購買");
    expect(payload.body.startsWith("我們收到你的付款了。\n付款商家\n\n退訂：")).toBe(true);
    expectComplianceFooter(payload.body);
  });

  it("viewer_watch_progress: queues the mail at 50 percent", async () => {
    const t = await tenant();
    const submission = await registrant(t, "林小姐");
    await rule(t, "viewer_watch_progress", { type: "watch_percent_gte", percent: 50 });
    const results = await dispatchAutomationEvent(db, event(t, "viewer_watch_progress", { subjectId: submission.id, recipientEmail: submission.email, liveId: t.live.id, watchPercent: 50, watchSecondsTotal: 300 }));
    expect(results).toMatchObject([{ status: "completed" }]);
    const [{ payload }] = await sentMail(t);
    expect(payload.subject).toBe("林小姐，謝謝你來看 新品發表會");
    expectComplianceFooter(payload.body);
  });

  it("webinar_attended_duration_gte: queues the mail after the watch time", async () => {
    const t = await tenant();
    const submission = await registrant(t, "陳先生");
    await rule(t, "webinar_attended_duration_gte", { type: "watch_minutes_gte", minutes: 15 });
    const results = await dispatchAutomationEvent(db, event(t, "webinar_attended_duration_gte", { subjectId: submission.id, recipientEmail: submission.email, liveId: t.live.id, watchSecondsTotal: 1_200 }));
    expect(results).toMatchObject([{ status: "completed" }]);
    const [{ payload }] = await sentMail(t);
    expect(payload.subject).toBe("陳先生，謝謝你來看 新品發表會");
    expect(payload.body.startsWith("陳先生 你好\n\n謝謝你的參與。\n示範商家\n\n退訂：")).toBe(true);
    expectComplianceFooter(payload.body);
  });
});

describe("generic_message safety on the real pipeline", () => {
  it("never turns a hostile registrant name into a link, markup or a second header", async () => {
    const t = await tenant();
    const submission = await registrant(t, "[點我](https://evil.test/phish)\r\nBcc: x@evil.test <b>x</b>");
    await rule(t, "form_registered", { type: "always" });
    await dispatchAutomationEvent(db, event(t, "form_registered", { subjectId: submission.id, recipientEmail: submission.email }));
    const [{ payload }] = await sentMail(t);
    expect(payload.subject).not.toMatch(/[\r\n]/u);
    expect(payload.subject).not.toContain("http");
    expectComplianceFooter(payload.body);
    expect(payload.body).not.toContain("](");
    expect(payload.body.split("\n\n退訂：")[0]).not.toContain("http");
    const html = richTextToEmailHtml(payload.body);
    expect(html).not.toContain("<b>");
    expect(html.match(/<a /gu)).toHaveLength(1);
  });

  it("escapes the merchant's own markup, keeps its line breaks and leaves the brand footer to the sender", async () => {
    const t = await tenant();
    const submission = await registrant(t);
    await rule(t, "form_registered", { type: "always" }, [{ type: "send_email_notification", template: "generic_message", subject: "感謝 <你>", body: "<script>alert(1)</script>\n第二行 & 結束" }]);
    await dispatchAutomationEvent(db, event(t, "form_registered", { subjectId: submission.id, recipientEmail: submission.email }));
    const [{ payload }] = await sentMail(t);
    expect(payload.subject).toBe("感謝 <你>");
    const html = richTextToEmailHtml(payload.body);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;<br>第二行 &amp; 結束");
    expect(html).not.toContain("<script>");
  });

  it("does not read another vendor's registration", async () => {
    const mine = await tenant("我的商家");
    const other = await tenant("別人的商家");
    const foreign = await registrant(other, "別家客人");
    await rule(mine, "form_registered", { type: "always" });
    await dispatchAutomationEvent(db, event(mine, "form_registered", { subjectId: foreign.id, recipientEmail: foreign.email }));
    const [{ payload }] = await sentMail(mine);
    expect(payload.subject).not.toContain("別家客人");
    expect(payload.subject).toBe("你，謝謝你來看 這場直播");
    expect(payload.body).toContain("我的商家");
    await expect(db.emailDelivery.count({ where: { vendorId: other.vendor.id } })).resolves.toBe(0);
  });

  it("skips an unsubscribed recipient like every automation e-mail", async () => {
    const t = await tenant();
    const submission = await registrant(t);
    const { createEmailRecipientHash } = await import("@/lib/email-delivery-pii");
    await db.emailSuppression.create({ data: { vendorId: t.vendor.id, recipientHash: createEmailRecipientHash(submission.email, t.vendor.id), reason: "recipient_request", recipientMaskedEmail: "l***@example.test", source: "unsubscribe_link" } });
    await rule(t, "form_registered", { type: "always" });
    const results = await dispatchAutomationEvent(db, event(t, "form_registered", { subjectId: submission.id, recipientEmail: submission.email }));
    expect(results).toMatchObject([{ status: "completed" }]);
    await expect(db.emailDelivery.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(0);
  });

  it("does not run a stored rule whose text is tampered into a header or an unknown variable", async () => {
    const t = await tenant();
    const submission = await registrant(t);
    await rule(t, "form_registered", { type: "always" }, [{ type: "send_email_notification", template: "generic_message", subject: "謝謝\r\nBcc: x@evil.test", body: "內文" }]);
    await rule(t, "form_registered", { type: "always" }, [{ type: "send_email_notification", template: "generic_message", subject: "謝謝", body: "{{voucher_url}}" }]);
    await dispatchAutomationEvent(db, event(t, "form_registered", { subjectId: submission.id, recipientEmail: submission.email }));
    const mails = await sentMail(t);
    // The first rule does not parse and never runs; the second parses but its variable is not allowed, so no mail is queued.
    expect(mails).toHaveLength(0);
  });
});
