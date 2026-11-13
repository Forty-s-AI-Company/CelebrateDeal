import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { revealEmailDeliveryPayload } from "../../src/lib/email-delivery-pii";
import { createFormSubmissionVerificationToken } from "../../src/lib/form-submission-verification";
import { hashPassword } from "../../src/lib/password";

/**
 * F-3 Email 追銷序列, end to end on the production build: the merchant creates
 * a sequence template and a three-step sequence in the back office and
 * activates it; a synthetic registrant verifies their e-mail through the real
 * verify route; the scheduled job route is then called with the registrant's
 * timeline moved back (no waiting) to reach the first and second steps; the
 * registrant unsubscribes through the link in the e-mail and the third step is
 * never queued. Every run creates its own vendor, user and Live (uuid slugs).
 */

const db = new PrismaClient();
const e2ePort = process.env.E2E_PORT ?? "31023";
// The worker runs in this process and must build the same public links as the server.
process.env.NEXT_PUBLIC_APP_URL = `http://127.0.0.1:${e2ePort}`;
const password = "Sequence-e2e-password-2026!";
const MINUTE = 60_000;
// Same synthetic value the Playwright web server is started with (playwright.config.ts).
const jobSecret = process.env.JOB_SECRET || "e2e-job-secret-at-least-16-chars";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);
test.afterAll(async () => {
  await db.$disconnect();
});

async function createFixture() {
  const runId = randomUUID();
  const vendor = await db.vendor.create({
    data: {
      name: `序列商家 ${runId.slice(0, 8)}`,
      slug: `f3-sequence-${runId}`,
      email: `f3-sequence-vendor-${runId}@example.test`,
      passwordHash: hashPassword(password),
      betaFeatureGrants: ["email_sequences"],
    },
  });
  const ownerEmail = `f3-sequence-owner-${runId}@example.test`;
  const user = await db.user.create({
    data: {
      email: ownerEmail,
      name: "序列測試老闆",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
    },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: "序列報名表",
      slug: `f3-sequence-form-${runId}`,
      headline: "序列報名",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
    },
  });
  // A month ahead, at a fixed minute: no day or session boundary near the run.
  const scheduledAt = new Date(Math.floor((Date.now() + 30 * 24 * 60 * MINUTE) / (60 * MINUTE)) * 60 * MINUTE);
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      formId: form.id,
      title: `序列直播 ${runId.slice(0, 8)}`,
      slug: `f3-sequence-live-${runId}`,
      scheduledAt,
      status: "scheduled",
    },
  });
  return { runId, vendor, user, ownerEmail, form, live };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function cleanup(fixture: Fixture | null) {
  if (!fixture) return;
  await db.vendor.deleteMany({ where: { id: fixture.vendor.id } });
  await db.user.deleteMany({ where: { id: fixture.user.id } });
}

async function login(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "load" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/u);
  await expect(page.getByRole("link", { name: "跳至主要內容" })).toBeVisible();
}

test("a verified registrant gets the sequence's first two e-mails on time, and nothing after unsubscribing", async ({ page }) => {
  let fixture: Fixture | null = null;
  try {
    fixture = await createFixture();
    await login(page, fixture.ownerEmail);

    // 1. A sequence e-mail template, created in the template editor.
    await page.goto("/messages/templates/new", { waitUntil: "load" });
    await page.getByLabel("模板名稱").fill("報名後追銷信");
    await page.locator('select[name="trigger"]').selectOption("sequence_email");
    await page.getByLabel("主旨").fill("{{live_title}}：給 {{name}} 的下一步");
    await page.locator('textarea[name="body"]').fill("{{name}} 你好，{{live_title}} 的重點整理在這裡：{{live_url}}");
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page).toHaveURL(/\/messages\/templates$/u);
    const template = await db.messageTemplate.findFirstOrThrow({ where: { vendorId: fixture.vendor.id, trigger: "sequence_email" } });

    // 2. A three-step sequence: 1 hour, 1 day and 3 days after verification.
    await page.goto(`/messages/sequences/new?liveId=${encodeURIComponent(fixture.live.id)}`, { waitUntil: "load" });
    const save = page.getByRole("button", { name: "儲存序列" });
    await expect(save).toBeEnabled();
    await page.getByLabel("序列名稱").fill("報名後三封追銷");
    await expect(page.locator('select[name="liveId"]')).toHaveValue(fixture.live.id);
    const steps = [{ value: "1", unit: "hours" }, { value: "1", unit: "days" }, { value: "3", unit: "days" }];
    for (const [index, step] of steps.entries()) {
      if (index > 0) await page.getByRole("button", { name: "新增一封" }).click();
      await page.locator(`input[name="steps.${index}.delayValue"]`).fill(step.value);
      await page.locator(`select[name="steps.${index}.delayUnit"]`).selectOption(step.unit);
      await page.locator(`select[name="steps.${index}.messageTemplateId"]`).selectOption(template.id);
    }
    await save.click();
    await expect(page).toHaveURL(/\/messages\/sequences\?notice=created$/u);
    const item = page.getByRole("listitem").filter({ hasText: "報名後三封追銷" });
    await expect(item).toContainText("3 封：驗證後 1 小時、驗證後第 1 天、驗證後第 3 天");
    await item.getByRole("button", { name: "啟用" }).click();
    await expect(page).toHaveURL(/\/messages\/sequences\?notice=activated$/u);
    await expect(page.getByRole("listitem").filter({ hasText: "報名後三封追銷" })).toContainText("寄送中");
    const sequence = await db.emailSequence.findFirstOrThrow({ where: { vendorId: fixture.vendor.id }, include: { steps: true } });
    expect(sequence).toMatchObject({ status: "active", liveId: fixture.live.id });
    expect(sequence.steps.map((step) => step.delayMinutes).sort((a, b) => a - b)).toEqual([60, 1_440, 4_320]);

    // 3. A synthetic registrant confirms their e-mail through the real verify route.
    const expiresAt = new Date(Date.now() + 60 * MINUTE);
    const submission = await db.formSubmission.create({
      data: {
        formId: fixture.form.id,
        liveId: fixture.live.id,
        name: "序列學員",
        email: `f3-sequence-lead-${fixture.runId}@example.test`,
        verificationExpiresAt: expiresAt,
      },
    });
    const token = createFormSubmissionVerificationToken({ submissionId: submission.id, expiresAt, version: submission.verificationVersion });
    await page.context().clearCookies();
    await page.goto(`/verify-registration?token=${encodeURIComponent(token)}`, { waitUntil: "load" });
    await page.getByRole("button", { name: "確認 Email 並完成報名", exact: true }).click();
    await expect(page).toHaveURL(/\/verify-registration\?status=verified$/u);
    const run = await db.delayedStepRun.findFirstOrThrow({ where: { vendorId: fixture.vendor.id, formSubmissionId: submission.id } });
    const verified = await db.formSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(run).toMatchObject({ emailSequenceId: sequence.id, status: "active", cursorDelayMinutes: -1, anchorAt: verified.verifiedAt });
    const anchor = run.anchorAt.getTime();

    expect(anchor).toBeLessThanOrEqual(Date.now());

    // 4. The scheduled job (real route, synthetic JOB_SECRET) queues one e-mail
    // per due step. Instead of waiting, the registrant's timeline is moved back:
    // verified `offset` ago, with the run's next due time and the sequence's
    // activation moved along, exactly as if that much time had passed.
    const sequenceId = sequence.id;
    const runId = run.id;
    async function elapse(offsetMs: number, nextDelayMinutes: number) {
      const shiftedAnchor = new Date(Date.now() - offsetMs);
      await db.emailSequence.update({ where: { id: sequenceId }, data: { activatedAt: new Date(shiftedAnchor.getTime() - MINUTE) } });
      await db.delayedStepRun.updateMany({
        where: { id: runId, status: "active" },
        data: { anchorAt: shiftedAnchor, nextRunAt: new Date(shiftedAnchor.getTime() + nextDelayMinutes * MINUTE) },
      });
    }
    async function runJob() {
      const response = await page.request.post("/api/jobs/email-deliveries", { headers: { authorization: `Bearer ${jobSecret}` } });
      expect(response.status()).toBe(200);
      return await response.json() as { ok: boolean; sequenceStepResults: Array<{ status: string }> };
    }
    const sequenceMails = () => db.emailDelivery.findMany({ where: { vendorId: fixture!.vendor.id, trigger: "sequence_email" }, orderBy: { createdAt: "asc" } });
    await elapse(59 * MINUTE, 60);
    await runJob();
    await expect(sequenceMails()).resolves.toHaveLength(0);
    await elapse(61 * MINUTE, 60);
    expect((await runJob()).sequenceStepResults).toContainEqual({ status: "queued" });
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: runId } })).resolves.toMatchObject({ cursorDelayMinutes: 60, status: "active" });
    const [first] = await sequenceMails();
    // This browser QA server has no e-mail provider, so the job's send attempt
    // failed and the first e-mail is still waiting for a retry: the next step
    // waits too (one step in the queue per person).
    expect(first).toMatchObject({ status: "failed", lastErrorCode: "configuration" });
    await elapse(24 * 60 * MINUTE + MINUTE, 1_440);
    expect((await runJob()).sequenceStepResults).toContainEqual({ status: "waiting_previous" });
    await expect(sequenceMails()).resolves.toHaveLength(1);
    // Stand in for the provider accepting the first e-mail, then the next round sends step 2.
    await db.emailDelivery.update({ where: { id: first!.id }, data: { status: "sent", sentAt: new Date(), nextAttemptAt: null } });
    await elapse(24 * 60 * MINUTE + MINUTE, 1_440);
    expect((await runJob()).sequenceStepResults).toContainEqual({ status: "queued" });
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: runId } })).resolves.toMatchObject({ cursorDelayMinutes: 1_440, status: "active" });
    const deliveries = await db.emailDelivery.findMany({
      where: { vendorId: fixture.vendor.id, trigger: "sequence_email" },
      orderBy: { createdAt: "asc" },
    });
    expect(deliveries).toHaveLength(2);
    const payloads = deliveries.map((delivery) => revealEmailDeliveryPayload(delivery.payloadEncryptedEnvelope, { vendorId: delivery.vendorId, deliveryId: delivery.id }));
    for (const payload of payloads) {
      expect(payload.subject).toBe(`${fixture.live.title}：給 序列學員 的下一步`);
      expect(payload.body).toContain(`/live/${fixture.live.slug}`);
      expect(payload.body).toMatch(/退訂：http:\/\/127\.0\.0\.1:\d+\/unsubscribe\?token=/u);
    }

    // 5. Unsubscribing through the e-mail's link stops the sequence for good.
    const unsubscribeUrl = new URL(payloads[1]!.body.match(/http:\/\/127\.0\.0\.1:\d+\/unsubscribe\?token=\S+/u)![0]);
    await page.goto(`${unsubscribeUrl.pathname}${unsubscribeUrl.search}`, { waitUntil: "load" });
    await page.getByRole("button", { name: "確認停止通知" }).click();
    await expect(page).toHaveURL(/\/unsubscribe\?status=done$/u);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "cancelled", cancelReason: "unsubscribed", nextRunAt: null });
    await elapse(3 * 24 * 60 * MINUTE + MINUTE, 4_320);
    await runJob();
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: runId } })).resolves.toMatchObject({ status: "cancelled", cursorDelayMinutes: 1_440 });
    await expect(db.emailDelivery.count({ where: { vendorId: fixture.vendor.id, trigger: "sequence_email" } })).resolves.toBe(2);
  } finally {
    await cleanup(fixture);
  }
});
