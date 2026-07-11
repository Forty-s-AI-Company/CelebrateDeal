import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as submitForm } from "@/app/api/form-submissions/route";
import { getDb } from "@/lib/db";
import {
  enqueueRegistrationConfirmation,
  processNotificationOutboxItem,
  queueNotificationRetry,
} from "@/lib/notifications";

const vendorIds: string[] = [];
const planIds: string[] = [];

async function createFixture(label: string) {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const plan = await getDb().billingPlan.create({
    data: { name: `Notification plan ${label}`, code: `notification-plan-${suffix}`, includedNotificationEmails: 100 },
  });
  planIds.push(plan.id);
  const vendor = await getDb().vendor.create({
    data: {
      name: `Notification ${label}`,
      slug: `notification-${suffix}`,
      email: `notification-${suffix}@example.test`,
      passwordHash: "test",
      templates: {
        create: {
          name: "Registration confirmation",
          channel: "email",
          trigger: "registration_confirmed",
          subject: "{{live_title}} 報名成功",
          body: "{{name}}，你已完成 {{live_title}} 報名。",
        },
      },
      forms: {
        create: {
          name: "Registration",
          slug: `registration-${suffix}`,
          headline: "Register",
          fields: [],
        },
      },
      subscriptions: { create: { planId: plan.id, status: "active" } },
      usageLimit: { create: { billingPlanId: plan.id, notificationEmailsLimit: 100, resetAt: new Date(Date.now() + 86_400_000) } },
    },
    include: { templates: true, forms: true },
  });
  vendorIds.push(vendor.id);
  return { vendor, template: vendor.templates[0], form: vendor.forms[0] };
}

function formRequest(formId: string, email = "lead@example.test") {
  return new Request("https://app.example.test/api/form-submissions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
    },
    body: JSON.stringify({ formId, payload: { name: "Lead", email } }),
  });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  const vendors = vendorIds.splice(0);
  await getDb().auditLog.deleteMany({ where: { vendorId: { in: vendors } } });
  await getDb().vendor.deleteMany({ where: { id: { in: vendors } } });
  await getDb().billingPlan.deleteMany({ where: { id: { in: planIds.splice(0) } } });
});

describe("notification outbox", () => {
  it("enqueues one idempotent registration confirmation", async () => {
    const { vendor } = await createFixture("idempotent");
    const submission = await getDb().formSubmission.create({
      data: { formId: vendor.forms[0].id, name: "Ada", email: "ada@example.test" },
    });

    await getDb().$transaction((tx) => enqueueRegistrationConfirmation(tx, {
      vendorId: vendor.id,
      submissionId: submission.id,
      recipient: submission.email,
      name: submission.name,
      liveTitle: "Growth Live",
    }));
    await getDb().$transaction((tx) => enqueueRegistrationConfirmation(tx, {
      vendorId: vendor.id,
      submissionId: submission.id,
      recipient: submission.email,
      name: submission.name,
      liveTitle: "Growth Live",
    }));

    const messages = await getDb().notificationOutbox.findMany({ where: { vendorId: vendor.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ subject: "Growth Live 報名成功", body: "Ada，你已完成 Growth Live 報名。" });
  });

  it("creates the submission, analytics boundary, and outbox in the form transaction", async () => {
    const { vendor, form } = await createFixture("form-route");
    const response = await submitForm(formRequest(form.id));
    expect(response.status).toBe(200);

    const [submissions, messages] = await Promise.all([
      getDb().formSubmission.findMany({ where: { formId: form.id } }),
      getDb().notificationOutbox.findMany({ where: { vendorId: vendor.id } }),
    ]);
    expect(submissions).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect(messages[0].sourceId).toBe(submissions[0].id);
  });

  it("delivers through fixture mode exactly once", async () => {
    vi.stubEnv("NOTIFICATION_DELIVERY_MODE", "fixture");
    const { vendor } = await createFixture("fixture");
    const outbox = await getDb().notificationOutbox.create({
      data: {
        vendorId: vendor.id,
        channel: "email",
        recipient: "fixture@example.test",
        subject: "Fixture",
        body: "Fixture body",
        sourceType: "test",
        sourceId: "fixture-source",
        idempotencyKey: `fixture-${Date.now()}-${Math.random()}`,
      },
    });

    await expect(processNotificationOutboxItem(outbox.id)).resolves.toMatchObject({ status: "sent" });
    await expect(processNotificationOutboxItem(outbox.id)).resolves.toMatchObject({ status: "skipped" });
    const attempts = await getDb().notificationDeliveryAttempt.findMany({ where: { outboxId: outbox.id } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].provider).toBe("fixture");
  });

  it("marks a one-attempt Resend delivery as exhausted without leaking credentials", async () => {
    vi.stubEnv("NOTIFICATION_DELIVERY_MODE", "resend");
    vi.stubEnv("RESEND_API_KEY", "test-resend-key");
    vi.stubEnv("EMAIL_FROM", "test@example.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("provider unavailable", { status: 503 })));
    const { vendor } = await createFixture("failure");
    const outbox = await getDb().notificationOutbox.create({
      data: {
        vendorId: vendor.id,
        channel: "email",
        recipient: "failure@example.test",
        subject: "Failure",
        body: "Failure body",
        sourceType: "test",
        sourceId: "failure-source",
        idempotencyKey: `failure-${Date.now()}-${Math.random()}`,
        maxAttempts: 1,
      },
    });

    await expect(processNotificationOutboxItem(outbox.id)).resolves.toMatchObject({ status: "exhausted" });
    const updated = await getDb().notificationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
    expect(updated.status).toBe("exhausted");
    expect(updated.lastError).toContain("Resend email failed");
    expect(updated.lastError).not.toContain("test-resend-key");
  });

  it("queues retries only inside the current vendor", async () => {
    const current = await createFixture("retry-current");
    const foreign = await createFixture("retry-foreign");
    const outbox = await getDb().notificationOutbox.create({
      data: {
        vendorId: foreign.vendor.id,
        channel: "email",
        recipient: "retry@example.test",
        subject: "Retry",
        body: "Retry body",
        sourceType: "test",
        sourceId: "retry-source",
        idempotencyKey: `retry-${Date.now()}-${Math.random()}`,
        status: "exhausted",
        attemptCount: 5,
      },
    });

    await expect(queueNotificationRetry({ vendorId: current.vendor.id, outboxId: outbox.id })).resolves.toBeNull();
    await expect(queueNotificationRetry({ vendorId: foreign.vendor.id, outboxId: outbox.id })).resolves.toMatchObject({
      status: "pending",
      attemptCount: 0,
    });
  });

  it("atomically enforces the vendor email quota under concurrency", async () => {
    const { vendor } = await createFixture("quota");
    await getDb().vendorUsageLimit.update({ where: { vendorId: vendor.id }, data: { notificationEmailsLimit: 2 } });
    const submissions = await Promise.all(["a", "b", "c"].map((key) => getDb().formSubmission.create({
      data: { formId: vendor.forms[0].id, name: key, email: `${key}@example.test` },
    })));
    await Promise.all(submissions.map((submission) => getDb().$transaction((tx) => enqueueRegistrationConfirmation(tx, {
      vendorId: vendor.id,
      submissionId: submission.id,
      recipient: submission.email,
      name: submission.name,
    }))));
    await expect(getDb().notificationOutbox.count({ where: { vendorId: vendor.id } })).resolves.toBe(2);
    await expect(getDb().vendorUsageLimit.findUniqueOrThrow({ where: { vendorId: vendor.id } })).resolves.toMatchObject({ notificationEmailsUsed: 2 });
  });

  it("atomically starts a new monthly quota period after resetAt", async () => {
    const { vendor } = await createFixture("quota-reset");
    await getDb().vendorUsageLimit.update({
      where: { vendorId: vendor.id },
      data: {
        notificationEmailsLimit: 2,
        notificationEmailsUsed: 2,
        resetAt: new Date(Date.now() - 60_000),
      },
    });
    const submission = await getDb().formSubmission.create({
      data: { formId: vendor.forms[0].id, name: "New period", email: "new-period@example.test" },
    });

    await getDb().$transaction((tx) => enqueueRegistrationConfirmation(tx, {
      vendorId: vendor.id,
      submissionId: submission.id,
      recipient: submission.email,
      name: submission.name,
    }));

    const usage = await getDb().vendorUsageLimit.findUniqueOrThrow({ where: { vendorId: vendor.id } });
    expect(usage.notificationEmailsUsed).toBe(1);
    expect(usage.resetAt.getTime()).toBeGreaterThan(Date.now() + 27 * 24 * 60 * 60 * 1000);
    await expect(getDb().notificationOutbox.count({ where: { vendorId: vendor.id } })).resolves.toBe(1);
  });

  it("limits a single recipient to three messages per day", async () => {
    const { vendor } = await createFixture("recipient-limit");
    const submissions = await Promise.all(["1", "2", "3", "4"].map((key) => getDb().formSubmission.create({
      data: { formId: vendor.forms[0].id, name: key, email: "same-recipient@example.test" },
    })));
    for (const submission of submissions) {
      await getDb().$transaction((tx) => enqueueRegistrationConfirmation(tx, {
        vendorId: vendor.id,
        submissionId: submission.id,
        recipient: submission.email,
        name: submission.name,
      }));
    }
    await expect(getDb().notificationOutbox.count({ where: { vendorId: vendor.id } })).resolves.toBe(3);
  });
});
