import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { runDelayedStepWorker } from "../../src/lib/automation-delayed-steps";
import { revealEmailDeliveryPayload } from "../../src/lib/email-delivery-pii";
import { createFormSubmissionVerificationToken } from "../../src/lib/form-submission-verification";
import { hashPassword } from "../../src/lib/password";

/**
 * F-4 PR 2 自動化規則的延遲步驟, end to end on the production build: an owner
 * creates a 報名 rule in /settings/automations and adds, edits and deletes its
 * delayed steps; a visitor registers through the public form and confirms the
 * e-mail through the real verify route; with the timeline moved back (no
 * waiting), the step worker runs the "2 hours after" step and the scheduled
 * job route tries to send its e-mail on the sequence quota. Every run creates
 * its own vendor, user and form (uuid slugs).
 */

const db = new PrismaClient();
const e2ePort = process.env.E2E_PORT ?? "31023";
// The worker runs in this process and must build the same public links as the server.
process.env.NEXT_PUBLIC_APP_URL = `http://127.0.0.1:${e2ePort}`;
const password = "Automation-steps-e2e-password-2026!";
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
      name: `自動化商家 ${runId.slice(0, 8)}`,
      slug: `f4-steps-${runId}`,
      email: `f4-steps-vendor-${runId}@example.test`,
      passwordHash: hashPassword(password),
      // Closed beta (review M3): the platform opened delayed steps for this vendor.
      betaFeatureGrants: ["automation_delayed_steps"],
    },
  });
  const ownerEmail = `f4-steps-owner-${runId}@example.test`;
  const user = await db.user.create({
    data: {
      email: ownerEmail,
      name: "自動化測試老闆",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
    },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: "自動化報名表",
      slug: `f4-steps-form-${runId}`,
      headline: "自動化報名",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
    },
  });
  return { runId, vendor, user, ownerEmail, form };
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

test("a registration gets the rule's 2-hour step from the worker, after the owner adds, edits and deletes steps", async ({ page, browser }) => {
  let fixture: Fixture | null = null;
  try {
    fixture = await createFixture();
    await login(page, fixture.ownerEmail);

    // 1. A 報名 rule with an immediate tag.
    await page.goto("/settings/automations", { waitUntil: "load" });
    const create = page.getByRole("form", { name: "建立自訂規則" });
    await create.getByLabel("規則名稱").fill("報名後追蹤");
    await expect(create.locator('select[name="trigger"]')).toHaveValue("form_registered");
    await create.getByLabel("加上客戶標籤", { exact: true }).check();
    await create.getByLabel("客戶標籤", { exact: true }).fill("已報名");
    await create.getByRole("button", { name: "建立規則" }).click();
    await expect(page).toHaveURL(/\/settings\/automations\?updated=created$/u);
    const rule = await db.automationRule.findFirstOrThrow({ where: { vendorId: fixture.vendor.id } });
    const article = page.getByRole("article", { name: "報名後追蹤" });
    await expect(article).toContainText("立即執行：客戶打標");
    await expect(article).toContainText("尚未設定延遲步驟");

    // 2. Add "2 小時後：Email + 標籤" and "第 1 天：標籤".
    async function addStep(value: string, unit: "小時" | "天", options: { email?: boolean; tag: string }) {
      const section = page.getByRole("article", { name: "報名後追蹤" });
      await section.getByText("新增延遲步驟").click();
      const add = page.getByRole("form", { name: "新增「報名後追蹤」的延遲步驟" });
      await add.getByLabel("事件發生後多久執行").fill(value);
      await add.getByLabel("單位").selectOption({ label: unit });
      if (options.email) {
        await add.getByLabel("Email 通知", { exact: true }).check();
        await add.getByLabel("Email 範本").selectOption("repurchase_followup");
      }
      await add.getByLabel("加上客戶標籤", { exact: true }).check();
      await add.getByLabel("客戶標籤", { exact: true }).fill(options.tag);
      await add.getByRole("button", { name: "新增步驟" }).click();
      await expect(page).toHaveURL(/\/settings\/automations\?updated=step_created$/u);
      await expect(page.getByRole("status").filter({ hasText: "延遲步驟已新增。" })).toBeVisible();
    }
    await addStep("2", "小時", { email: true, tag: "兩小時後" });
    await addStep("1", "天", { tag: "隔天" });
    await expect(article).toContainText("延遲步驟（2／10）");
    await expect(article).toContainText("事件後 2 小時");
    await expect(article).toContainText("事件後第 1 天");
    const steps = await db.automationRuleStep.findMany({ where: { vendorId: fixture.vendor.id, ruleId: rule.id }, orderBy: { delayMinutes: "asc" } });
    expect(steps.map((step) => [step.delayMinutes, step.isActive])).toEqual([[120, true], [1_440, true]]);
    expect(steps[0]!.actions).toEqual([
      { type: "send_email_notification", template: "repurchase_followup" },
      { type: "add_customer_tag", tag: "兩小時後" },
    ]);

    // 3. Edit the second step to day 3 (same step id), then delete it.
    await article.getByText("事件後第 1 天").click();
    const edit = page.getByRole("form", { name: "編輯步驟：事件後第 1 天" });
    await expect(edit.getByLabel("客戶標籤", { exact: true })).toHaveValue("隔天");
    await edit.getByLabel("事件發生後多久執行").fill("3");
    await edit.getByRole("button", { name: "儲存步驟" }).click();
    await expect(page).toHaveURL(/\/settings\/automations\?updated=step_updated$/u);
    await expect(db.automationRuleStep.findUniqueOrThrow({ where: { id: steps[1]!.id } })).resolves.toMatchObject({ delayMinutes: 3 * 1_440 });
    await page.getByRole("article", { name: "報名後追蹤" }).getByText("事件後第 3 天").click();
    await page.getByRole("article", { name: "報名後追蹤" }).getByRole("button", { name: "刪除步驟" }).click();
    await page.getByRole("alertdialog", { name: /^確定刪除「事件後第 3 天」這一步？/u }).getByRole("button", { name: "刪除", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/automations\?updated=step_deleted$/u);
    await expect(page.getByRole("article", { name: "報名後追蹤" })).toContainText("延遲步驟（1／10）");
    await expect(db.automationRuleStep.count({ where: { ruleId: rule.id } })).resolves.toBe(1);

    // 4. A visitor registers through the public form (a fresh browser), then confirms the e-mail.
    const visitor = await browser.newContext();
    const visitorPage = await visitor.newPage();
    const leadEmail = `f4-steps-lead-${fixture.runId}@example.test`;
    try {
      await visitorPage.goto(`/form/${encodeURIComponent(fixture.form.slug)}`, { waitUntil: "load" });
      await visitorPage.getByLabel("姓名").fill("延遲學員");
      await visitorPage.getByLabel("Email").fill(leadEmail);
      await visitorPage.getByRole("button", { name: "送出報名" }).click();
      await expect(visitorPage.getByRole("status").filter({ hasText: "已收到你的資料" })).toBeVisible();
      const submission = await db.formSubmission.findFirstOrThrow({ where: { formId: fixture.form.id } });
      const run = await db.delayedStepRun.findFirstOrThrow({ where: { vendorId: fixture.vendor.id } });
      const log = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: fixture.vendor.id, ruleId: rule.id } });
      expect(log).toMatchObject({ status: "completed", trigger: "form_registered" });
      expect(run).toMatchObject({ automationRuleId: rule.id, sourceExecutionLogId: log.id, formSubmissionId: submission.id, status: "active", cursorDelayMinutes: -1, anchorAt: log.createdAt });
      expect(run.nextRunAt!.getTime() - run.anchorAt.getTime()).toBe(120 * MINUTE);
      const token = createFormSubmissionVerificationToken({ submissionId: submission.id, expiresAt: submission.verificationExpiresAt!, version: submission.verificationVersion });
      await visitorPage.goto(`/verify-registration?token=${encodeURIComponent(token)}`, { waitUntil: "load" });
      await visitorPage.getByRole("button", { name: "確認 Email 並完成報名", exact: true }).click();
      await expect(visitorPage).toHaveURL(/\/verify-registration\?status=verified$/u);
    } finally {
      await visitor.close();
    }

    // 5. Instead of waiting, the timeline moves back: the event happened `offset` ago.
    const run = await db.delayedStepRun.findFirstOrThrow({ where: { vendorId: fixture.vendor.id } });
    async function elapse(offsetMs: number) {
      const shiftedAnchor = new Date(Date.now() - offsetMs);
      await db.delayedStepRun.update({ where: { id: run.id }, data: { anchorAt: shiftedAnchor, nextRunAt: new Date(shiftedAnchor.getTime() + 120 * MINUTE) } });
    }
    /** The server has no e-mail provider (and creates no step e-mail without one); see email-sequences.spec.ts. */
    async function workerWithSyntheticProvider() {
      const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
      process.env.RESEND_API_KEY = "re_synthetic_e2e_only";
      process.env.EMAIL_FROM = "CelebrateDeal <no-reply@example.test>";
      try {
        return await runDelayedStepWorker({ vendorId: fixture!.vendor.id });
      } finally {
        if (saved.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.key;
        if (saved.from === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = saved.from;
      }
    }
    await elapse(119 * MINUTE);
    await expect(workerWithSyntheticProvider()).resolves.toEqual([]);
    await elapse(121 * MINUTE);
    await expect(workerWithSyntheticProvider()).resolves.toEqual([{ runId: run.id, status: "executed", emailsQueued: 1 }]);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "completed", cursorDelayMinutes: 120 });
    await expect(db.customerTagAssignment.count({ where: { vendorId: fixture.vendor.id, tag: { in: ["已報名", "兩小時後"] } } })).resolves.toBe(2);
    const [mail] = await db.emailDelivery.findMany({ where: { vendorId: fixture.vendor.id, trigger: "automation_step" } });
    const payload = revealEmailDeliveryPayload(mail!.payloadEncryptedEnvelope, { vendorId: fixture.vendor.id, deliveryId: mail!.id });
    expect(payload.recipientEmail).toBe(leadEmail);
    expect(payload.body).toMatch(/退訂：http:\/\/127\.0\.0\.1:\d+\/unsubscribe\?token=/u);
    // The scheduled job sends it on the sequence quota; without a provider the attempt fails and waits for a retry.
    const response = await page.request.post("/api/jobs/email-deliveries", { headers: { authorization: `Bearer ${jobSecret}` } });
    expect(response.status()).toBe(200);
    await expect(db.emailDelivery.findUniqueOrThrow({ where: { id: mail!.id } })).resolves.toMatchObject({ status: "failed", lastErrorCode: "configuration" });

    // 6. The back office shows the step's execution and the run's progress.
    await page.goto("/settings/automations", { waitUntil: "load" });
    await expect(page.getByRole("article", { name: "報名後追蹤" })).toContainText("進行中 0 人・完成 1 人・停止 0 人");
    await expect(page.getByRole("row").filter({ hasText: "（延遲步驟）" })).toHaveCount(1);
    // A rule with people's progress is never deleted.
    await page.getByRole("article", { name: "報名後追蹤" }).getByRole("button", { name: "停用" }).click();
    await expect(page).toHaveURL(/\/settings\/automations\?updated=toggled$/u);
    await expect(page.getByRole("article", { name: "報名後追蹤" }).getByRole("button", { name: "刪除規則" })).toHaveCount(0);
  } finally {
    await cleanup(fixture);
  }
});
