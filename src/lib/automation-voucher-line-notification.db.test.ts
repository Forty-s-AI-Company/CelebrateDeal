import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The database URL with an explicit pool size (see the same helper in
 * automation-line-push-policy.db.test.ts): the concurrency case below needs a
 * known number of connections, never the environment's default pool.
 */
function pooledUrl(connections: number) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.searchParams.set("connection_limit", String(connections));
  url.searchParams.set("pool_timeout", "20");
  return url.toString();
}

const clients = vi.hoisted(() => ({ app: null as null | import("@prisma/client").PrismaClient, appConnections: 6 }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return {
    getDb: () => {
      clients.app ??= new Client({ datasourceUrl: pooledUrl(clients.appConnections) });
      return clients.app;
    },
  };
});

// Owner decision 2026-11-15: the LINE notification a voucher action sends
// with the platform's fixed text is owner-only, like the custom LINE push
// (2026-11-14). The Server Actions of /settings/automations, the delayed-step
// library and worker, and the automation engine run for real against the
// disposable PostgreSQL database; only the session (the membership role),
// CSRF, Next.js, e-mail dispatch and monitoring are synthetic. A LINE Official
// Account and a linked LINE identity exist in every case, so the only thing
// that decides whether a LINE outbox row (LineDelivery) is written is the rule.
const runtime = vi.hoisted(() => ({
  actor: null as null | { user: { id: string }; vendor: { id: string; betaFeatureGrants?: string[] }; member: { role: string } },
  projectId: "",
}));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/email-delivery-immediate", () => ({ scheduleImmediateEmailDispatch: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string): never => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", () => ({
  requireVendorManagerMember: async () => {
    if (!runtime.actor) throw new Error("redirect:/login");
    return { auth: {}, ...runtime.actor };
  },
  requireVendorManagerContext: async () => {
    if (!runtime.actor) throw new Error("redirect:/login");
    return { auth: { user: runtime.actor.user, member: { id: "member", role: runtime.actor.member.role } }, vendor: runtime.actor.vendor };
  },
}));
vi.mock("@/lib/sales-project-scope", () => ({ requireEditableSalesProjectScope: async () => ({ projectId: runtime.projectId }) }));

import {
  createAutomationRecipeAction,
  createAutomationRuleAction,
  createAutomationRuleStepAction,
  deleteAutomationRuleAction,
  deleteAutomationRuleStepAction,
  toggleAutomationRuleAction,
  updateAutomationRuleStepAction,
} from "@/app/actions/automation-actions";
import { FunnelAutomationLinePushOwnerOnlyError, setFunnelAutomationRuleEnabled, updateFunnelAutomationRule } from "@/lib/funnel-automation-service";
import { createAutomationRuleStep, runDelayedStepWorker, updateAutomationRuleStep } from "@/lib/automation-delayed-steps";
import { automationCustomerKeyHash, automationStepExecutionLogId, dispatchAutomationEvent } from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
import { protectLineOfficialAccountCredentials } from "@/lib/line-credentials";
import { stableLineIdempotencyKey } from "@/lib/line-notification";

const db = getDb();
const createdVendorIds: string[] = [];
const ERROR = "redirect:/settings/automations?error=line_push_owner_only";
const MINUTE = 60_000;
const TAG = { type: "add_customer_tag", tag: "派券" };

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "voucher-line-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://voucher-line.example.test");
  runtime.actor = null;
  runtime.projectId = "";
});

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await clients.app?.$disconnect();
});

async function tenant() {
  const suffix = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: {
      name: `派券 LINE 商家 ${suffix}`,
      slug: `voucher-line-${suffix}`,
      email: `merchant-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
      betaFeatureGrants: ["automation_delayed_steps"],
    },
  });
  createdVendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "報名表", slug: `voucher-line-form-${suffix}`, headline: "報名", fields: [{ key: "email", label: "Email", type: "email", required: true }] },
  });
  const product = await db.product.create({
    data: { vendorId: vendor.id, name: "回購商品", slug: `voucher-line-product-${suffix}`, priceCents: 100_000, isActive: true },
  });
  await db.lineOfficialAccount.create({
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
  });
  return { vendor, form, product };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

function as(role: "owner" | "admin", t: Tenant) {
  runtime.actor = { user: { id: `user-${role}` }, vendor: { id: t.vendor.id, betaFeatureGrants: ["automation_delayed_steps"] }, member: { role } };
}

function voucher(t: Tenant, flag: Record<string, unknown> = {}) {
  return { type: "issue_repurchase_voucher", productId: t.product.id, discountType: "fixed", discountValue: 10_000, expiresInDays: 7, ...flag };
}

async function rule(t: Tenant, options: { actions?: unknown[]; isActive?: boolean; funnelPageId?: string } = {}) {
  return db.automationRule.create({
    data: {
      vendorId: t.vendor.id,
      name: `規則 ${randomUUID().slice(0, 6)}`,
      trigger: "form_registered",
      funnelPageId: options.funnelPageId ?? null,
      condition: { type: "always" } as Prisma.InputJsonValue,
      actions: (options.actions ?? [TAG]) as Prisma.InputJsonArray,
      isActive: options.isActive ?? true,
    },
  });
}

async function step(t: Tenant, ruleId: string, delayMinutes: number, actions: unknown[], isActive = true) {
  return db.automationRuleStep.create({
    data: { vendorId: t.vendor.id, ruleId, delayMinutes, condition: { type: "always" } as Prisma.InputJsonValue, actions: actions as Prisma.InputJsonArray, isActive },
  });
}

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}
const voucherFields = (t: Tenant, extra: Record<string, string> = {}) => ({ actionVoucher: "on", productId: t.product.id, discountType: "fixed", discountValue: "100", expiresInDays: "7", ...extra });
const ticked = { voucherLineNotificationShown: "1", voucherLineNotification: "on" };
const unticked = { voucherLineNotificationShown: "1" };
const stepFields = (ruleId: string, extra: Record<string, string>) => form({ ruleId, delayValue: "1", delayUnit: "days", stepActive: "on", ...extra });

/** A verified registration whose LINE identity is linked (so a LINE message to it would be queued). */
async function linkedLead(t: Tenant) {
  const lead = await db.formSubmission.create({
    data: { formId: t.form.id, name: "王小明", email: `lead-${randomUUID().slice(0, 8)}@example.test`, verificationStatus: "VERIFIED", verifiedAt: new Date() },
  });
  await db.lineUserIdentity.create({
    data: { vendorId: t.vendor.id, subjectType: "buyer_registration", subjectId: lead.id, lineUserIdHash: createHash("sha256").update(randomUUID()).digest("hex"), lineUserIdEncrypted: "v1.synthetic" },
  });
  return lead;
}

function registered(t: Tenant, lead: { id: string; email: string }) {
  return dispatchAutomationEvent(db, {
    vendorId: t.vendor.id,
    eventId: `form-registered:${lead.id}`,
    trigger: "form_registered",
    subjectType: "buyer_registration",
    subjectId: lead.id,
    subjectKeyHash: automationCustomerKeyHash(t.vendor.id, lead.email),
    recipientEmail: lead.email,
  });
}

/** The vouchers issued and the LINE outbox rows written for this vendor. */
async function outcome(t: Tenant) {
  const [vouchers, lines] = await Promise.all([
    db.automationVoucherGrant.count({ where: { vendorId: t.vendor.id } }),
    db.lineDelivery.findMany({ where: { vendorId: t.vendor.id }, select: { idempotencyKey: true, trigger: true } }),
  ]);
  return { vouchers, lines };
}

async function onlyLog(t: Tenant, ruleId: string) {
  const logs = await db.automationExecutionLog.findMany({ where: { vendorId: t.vendor.id, ruleId } });
  expect(logs).toHaveLength(1);
  return logs[0]!;
}

async function snapshot(vendorId: string) {
  const [rules, steps, audit] = await Promise.all([
    db.automationRule.findMany({ where: { vendorId }, orderBy: { id: "asc" }, select: { id: true, isActive: true, actions: true, version: true } }),
    db.automationRuleStep.findMany({ where: { vendorId }, orderBy: { id: "asc" }, select: { id: true, delayMinutes: true, isActive: true, actions: true } }),
    db.auditLog.count({ where: { vendorId } }),
  ]);
  return { rules, steps, audit };
}

describe("immediate voucher actions", () => {
  it("saves an admin's voucher rule with the LINE notification off, even when the form asks for it; it issues the voucher without a LINE message", async () => {
    const t = await tenant();
    as("admin", t);
    await expect(createAutomationRuleAction(form({ name: "管理員派券", trigger: "form_registered", ...voucherFields(t, ticked) }))).rejects.toThrow("updated=created");
    const created = await db.automationRule.findFirstOrThrow({ where: { vendorId: t.vendor.id, name: "管理員派券" } });
    expect(created.actions).toEqual([voucher(t, { lineNotification: false })]);
    await expect(db.auditLog.count({ where: { vendorId: t.vendor.id, actorLabel: "admin", action: "create_automation_rule" } })).resolves.toBe(1);

    await expect(registered(t, await linkedLead(t))).resolves.toEqual([{ ruleId: created.id, status: "completed" }]);
    await expect(outcome(t)).resolves.toEqual({ vouchers: 1, lines: [] });
    // The admin's rule stays the admin's to manage: switch it off and on again.
    await expect(toggleAutomationRuleAction(form({ ruleId: created.id }))).rejects.toThrow("updated=toggled");
    await expect(toggleAutomationRuleAction(form({ ruleId: created.id }))).rejects.toThrow("updated=toggled");
  });

  it("applies the voucher recipe for an admin without the LINE notification and for the owner with it", async () => {
    const t = await tenant();
    as("admin", t);
    await expect(createAutomationRecipeAction(form({ recipeId: "vip_auto_tiering", productId: t.product.id }))).rejects.toThrow("updated=recipe_created");
    as("owner", t);
    await expect(createAutomationRecipeAction(form({ recipeId: "vip_auto_tiering", productId: t.product.id }))).rejects.toThrow("updated=recipe_created");
    const rules = await db.automationRule.findMany({ where: { vendorId: t.vendor.id }, orderBy: { createdAt: "asc" }, select: { actions: true } });
    expect(rules.map((r) => (r.actions as Array<Record<string, unknown>>).find((action) => action.type === "issue_repurchase_voucher")?.lineNotification)).toEqual([false, true]);
  });

  it.each([
    ["the default (ticked)", ticked, true],
    ["a form rendered before the checkbox existed", {}, true],
    ["the box unticked", unticked, false],
  ] as const)("saves the owner's voucher rule with %s and sends the fixed-text LINE message only when it is on", async (_label, extra, sends) => {
    const t = await tenant();
    as("owner", t);
    await expect(createAutomationRuleAction(form({ name: "老闆派券", trigger: "form_registered", ...voucherFields(t, extra) }))).rejects.toThrow("updated=created");
    const created = await db.automationRule.findFirstOrThrow({ where: { vendorId: t.vendor.id, name: "老闆派券" } });
    expect(created.actions).toEqual([voucher(t, { lineNotification: sends })]);
    await registered(t, await linkedLead(t));
    const log = await onlyLog(t, created.id);
    await expect(outcome(t)).resolves.toEqual({
      vouchers: 1,
      lines: sends ? [{ idempotencyKey: stableLineIdempotencyKey(["automation-voucher", log.id]), trigger: "automation" }] : [],
    });
  });

  it("keeps an admin's legacy voucher rule (no flag) sending LINE, and makes it read-only for an admin except switching off and deleting", async () => {
    const t = await tenant();
    // Saved before 2026-11-15 (an admin could then): the action has no flag.
    const legacy = await rule(t, { actions: [voucher(t)] });
    await registered(t, await linkedLead(t));
    const log = await onlyLog(t, legacy.id);
    await expect(outcome(t)).resolves.toEqual({ vouchers: 1, lines: [{ idempotencyKey: stableLineIdempotencyKey(["automation-voucher", log.id]), trigger: "automation" }] });

    // A second, never-run copy to show the whole admin matrix including delete.
    const copy = await rule(t, { actions: [voucher(t)], isActive: false });
    const tagStep = await step(t, copy.id, 60, [TAG]);
    as("admin", t);
    const before = await snapshot(t.vendor.id);
    await expect(toggleAutomationRuleAction(form({ ruleId: copy.id }))).rejects.toThrow(ERROR);
    await expect(createAutomationRuleStepAction(stepFields(copy.id, { actionTag: "on", customerTag: "第二天" }))).rejects.toThrow(ERROR);
    await expect(updateAutomationRuleStepAction(stepFields(copy.id, { stepId: tagStep.id, actionTag: "on", customerTag: "改" }))).rejects.toThrow(ERROR);
    expect(await snapshot(t.vendor.id)).toEqual(before);
    // Switching off (the running legacy rule) and deleting stay.
    await expect(toggleAutomationRuleAction(form({ ruleId: legacy.id }))).rejects.toThrow("updated=toggled");
    await expect(db.automationRule.findUniqueOrThrow({ where: { id: legacy.id } })).resolves.toMatchObject({ isActive: false });
    await expect(toggleAutomationRuleAction(form({ ruleId: legacy.id }))).rejects.toThrow(ERROR);
    await expect(deleteAutomationRuleStepAction(form({ ruleId: copy.id, stepId: tagStep.id }))).rejects.toThrow("updated=step_deleted");
    await expect(deleteAutomationRuleAction(form({ ruleId: copy.id }))).rejects.toThrow("updated=deleted");
    await expect(db.automationRule.count({ where: { id: copy.id } })).resolves.toBe(0);

    // The owner may switch it on again.
    as("owner", t);
    await expect(toggleAutomationRuleAction(form({ ruleId: legacy.id }))).rejects.toThrow("updated=toggled");
  });
});

describe("delayed steps with a voucher", () => {
  /** Runs the rule's single due step through the real worker. */
  async function runDueStep(t: Tenant) {
    const run = await db.delayedStepRun.findFirstOrThrow({ where: { vendorId: t.vendor.id } });
    const due = new Date(run.anchorAt.getTime() + 61 * MINUTE);
    return { run, results: await runDelayedStepWorker({ now: due, vendorId: t.vendor.id }) };
  }

  it("saves an admin's voucher step with the LINE notification off (also through the library), and it issues the voucher without a LINE message", async () => {
    const t = await tenant();
    const r = await rule(t);
    as("admin", t);
    await expect(createAutomationRuleStepAction(stepFields(r.id, { delayValue: "1", delayUnit: "hours", ...voucherFields(t, ticked) }))).rejects.toThrow("updated=step_created");
    const s = await db.automationRuleStep.findFirstOrThrow({ where: { vendorId: t.vendor.id, ruleId: r.id } });
    expect(s.actions).toEqual([voucher(t, { lineNotification: false })]);
    // Editing keeps it off.
    await expect(updateAutomationRuleStepAction(stepFields(r.id, { stepId: s.id, delayValue: "1", delayUnit: "hours", ...voucherFields(t, ticked) }))).rejects.toThrow("updated=step_updated");
    await expect(db.automationRuleStep.findUniqueOrThrow({ where: { id: s.id } })).resolves.toMatchObject({ actions: [voucher(t, { lineNotification: false })] });
    // The library itself forces it off without the owner flag.
    await expect(createAutomationRuleStep({ vendorId: t.vendor.id, ruleId: r.id, linePushAllowed: false, step: { delayMinutes: 120, condition: { type: "always" }, actions: [voucher(t, { lineNotification: true })], isActive: false } })).resolves.toMatchObject({ ok: true, after: { actions: [voucher(t, { lineNotification: false })] } });

    await registered(t, await linkedLead(t));
    const { run, results } = await runDueStep(t);
    expect(results).toEqual([{ runId: run.id, status: "executed" }]);
    await expect(outcome(t)).resolves.toEqual({ vouchers: 1, lines: [] });
  });

  it("sends the step voucher's LINE message for the owner's default, not when the owner turned it off", async () => {
    for (const [extra, sends] of [[ticked, true], [unticked, false]] as const) {
      const t = await tenant();
      const r = await rule(t);
      as("owner", t);
      await expect(createAutomationRuleStepAction(stepFields(r.id, { delayValue: "1", delayUnit: "hours", ...voucherFields(t, extra) }))).rejects.toThrow("updated=step_created");
      const s = await db.automationRuleStep.findFirstOrThrow({ where: { vendorId: t.vendor.id, ruleId: r.id } });
      expect(s.actions).toEqual([voucher(t, { lineNotification: sends })]);
      await registered(t, await linkedLead(t));
      const { run } = await runDueStep(t);
      const logId = automationStepExecutionLogId(t.vendor.id, run.id, s.id);
      await expect(outcome(t)).resolves.toEqual({
        vouchers: 1,
        lines: sends ? [{ idempotencyKey: stableLineIdempotencyKey(["automation-voucher", logId]), trigger: "automation" }] : [],
      });
    }
  });

  it("keeps a legacy voucher step (no flag) sending LINE and the rule read-only for an admin, who may still delete the step", async () => {
    const t = await tenant();
    const r = await rule(t);
    const s = await step(t, r.id, 60, [voucher(t)]);
    await registered(t, await linkedLead(t));
    await runDueStep(t);
    await expect(outcome(t)).resolves.toMatchObject({ vouchers: 1, lines: [expect.objectContaining({ trigger: "automation" })] });

    as("admin", t);
    const before = await snapshot(t.vendor.id);
    await expect(updateAutomationRuleStepAction(stepFields(r.id, { stepId: s.id, delayValue: "1", delayUnit: "hours", ...voucherFields(t) }))).rejects.toThrow(ERROR);
    await expect(createAutomationRuleStepAction(stepFields(r.id, { actionTag: "on", customerTag: "第三天" }))).rejects.toThrow(ERROR);
    expect(await snapshot(t.vendor.id)).toEqual(before);
    await expect(updateAutomationRuleStep({ vendorId: t.vendor.id, ruleId: r.id, stepId: s.id, linePushAllowed: false, step: { delayMinutes: 60, condition: { type: "always" }, actions: [voucher(t)], isActive: true } })).resolves.toEqual({ ok: false, code: "line_push_owner_only" });
    // Deleting the step makes the rule the admin's again.
    await expect(deleteAutomationRuleStepAction(form({ ruleId: r.id, stepId: s.id }))).rejects.toThrow("updated=step_deleted");
    await expect(createAutomationRuleStepAction(stepFields(r.id, { actionTag: "on", customerTag: "第三天" }))).rejects.toThrow("updated=step_created");
  });

  it.each([
    ["an old snapshot without the flag sends LINE although the step is now off", {}, { lineNotification: false }, true],
    ["a snapshot with the flag off sends nothing although the step is now on", { lineNotification: false }, { lineNotification: true }, false],
  ] as const)("resumes a step from its snapshot: %s", async (_label, snapshotFlag, currentFlag, sends) => {
    const t = await tenant();
    const r = await rule(t);
    const s = await step(t, r.id, 60, [voucher(t, currentFlag)]);
    const lead = await linkedLead(t);
    await registered(t, lead);
    const run = await db.delayedStepRun.findFirstOrThrow({ where: { vendorId: t.vendor.id } });
    // A first attempt recorded its actions and failed before running them (m2).
    const logId = automationStepExecutionLogId(t.vendor.id, run.id, s.id);
    await db.automationExecutionLog.create({
      data: {
        id: logId,
        vendorId: t.vendor.id,
        ruleId: r.id,
        idempotencyKey: `synthetic-step-${randomUUID()}`,
        eventId: `synthetic-step-event-${randomUUID()}`,
        trigger: "form_registered",
        subjectType: "buyer_registration",
        subjectKeyHash: automationCustomerKeyHash(t.vendor.id, lead.email),
        status: "failed",
        actionResults: { actions: [voucher(t, snapshotFlag)], results: [] } as Prisma.InputJsonObject,
      },
    });
    const { results } = await runDueStep(t);
    expect(results).toEqual([{ runId: run.id, status: "executed" }]);
    await expect(db.automationExecutionLog.findUniqueOrThrow({ where: { id: logId } })).resolves.toMatchObject({ status: "completed", actionResults: expect.objectContaining({ actions: [voucher(t, snapshotFlag)] }) });
    await expect(outcome(t)).resolves.toEqual({
      vouchers: 1,
      lines: sends ? [{ idempotencyKey: stableLineIdempotencyKey(["automation-voucher", logId]), trigger: "automation" }] : [],
    });
  });
});

describe("tenant boundary", () => {
  it("answers another tenant's voucher rule and step not_found to its admin and owner alike, and writes nothing there", async () => {
    const a = await tenant();
    const b = await tenant();
    const rb = await rule(b, { actions: [voucher(b)], isActive: false });
    const sb = await step(b, rb.id, 60, [voucher(b)]);
    const before = await snapshot(b.vendor.id);
    for (const role of ["admin", "owner"] as const) {
      as(role, a);
      await expect(toggleAutomationRuleAction(form({ ruleId: rb.id }))).rejects.toThrow("error=not_found");
      await expect(createAutomationRuleStepAction(stepFields(rb.id, { actionTag: "on", customerTag: "x" }))).rejects.toThrow("error=not_found");
      await expect(updateAutomationRuleStepAction(stepFields(rb.id, { stepId: sb.id, actionTag: "on", customerTag: "x" }))).rejects.toThrow("error=not_found");
      await expect(deleteAutomationRuleStepAction(form({ ruleId: rb.id, stepId: sb.id }))).rejects.toThrow("error=not_found");
      await expect(deleteAutomationRuleAction(form({ ruleId: rb.id }))).rejects.toThrow("error=not_found");
    }
    // The library with A's vendor and B's rule: not_found, never owner-only (no hint that B's rule sends LINE).
    await expect(createAutomationRuleStep({ vendorId: a.vendor.id, ruleId: rb.id, linePushAllowed: false, step: { delayMinutes: 240, condition: { type: "always" }, actions: [TAG], isActive: true } })).resolves.toEqual({ ok: false, code: "not_found" });
    await expect(updateAutomationRuleStep({ vendorId: a.vendor.id, ruleId: rb.id, stepId: sb.id, linePushAllowed: false, step: { delayMinutes: 60, condition: { type: "always" }, actions: [TAG], isActive: true } })).resolves.toEqual({ ok: false, code: "not_found" });
    // A's own voucher naming B's product is refused.
    const ra = await rule(a);
    as("owner", a);
    await expect(createAutomationRuleStepAction(stepFields(ra.id, voucherFields(b)))).rejects.toThrow("error=invalid_product");
    expect(await snapshot(b.vendor.id)).toEqual(before);
    await expect(db.auditLog.count({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } } })).resolves.toBe(0);
  });
});

describe("funnel editor: a delayed voucher step without the flag", () => {
  it("refuses an admin's edit and switch-on of a funnel rule whose step voucher has no flag, and lets the admin switch it off", async () => {
    const t = await tenant();
    const project = await db.salesProject.create({ data: { vendorId: t.vendor.id, name: "合成專案", slug: `voucher-project-${randomUUID()}`, mode: "live_course", primaryFlow: "live" } });
    const page = await db.landingPage.create({ data: { vendorId: t.vendor.id, projectId: project.id, name: "單頁網站", slug: `voucher-page-${randomUUID()}`, draftContent: {} } });
    runtime.projectId = project.id;
    // Stored before the flag existed: a missing flag still sends LINE.
    const off = await rule(t, { funnelPageId: page.id, isActive: false });
    await step(t, off.id, 60, [voucher(t)]);
    const on = await rule(t, { funnelPageId: page.id, isActive: true });
    await step(t, on.id, 60, [voucher(t)]);

    as("admin", t);
    await expect(updateFunnelAutomationRule({ pageId: page.id, ruleId: off.id, version: 1, name: "改名", tag: "改標籤" })).rejects.toBeInstanceOf(FunnelAutomationLinePushOwnerOnlyError);
    await expect(setFunnelAutomationRuleEnabled({ pageId: page.id, ruleId: off.id, version: 1, isActive: true })).rejects.toBeInstanceOf(FunnelAutomationLinePushOwnerOnlyError);
    await expect(db.automationRule.findUniqueOrThrow({ where: { id: off.id } })).resolves.toMatchObject({ name: off.name, isActive: false, version: 1 });
    // Switching off is always allowed.
    await expect(setFunnelAutomationRuleEnabled({ pageId: page.id, ruleId: on.id, version: 1, isActive: false })).resolves.toBeUndefined();
    await expect(db.automationRule.findUniqueOrThrow({ where: { id: on.id } })).resolves.toMatchObject({ isActive: false, version: 2 });
  });
});

// The stored check runs after the rule row is locked FOR UPDATE: an owner
// transaction holds the row and adds a voucher step whose LINE notification is
// on; an admin's switch-on and new step queue on the lock and, once it
// commits, see the step and refuse. Own one-connection clients for the owner
// and the pg_stat_activity observer; the admin calls use the app client's
// explicit pool (pooledUrl), never the environment's default one.
describe("concurrency with an owner adding a LINE-notified voucher step", () => {
  let owner: PrismaClient;
  let observer: PrismaClient;

  beforeAll(() => {
    owner = new PrismaClient({ datasourceUrl: pooledUrl(1) });
    observer = new PrismaClient({ datasourceUrl: pooledUrl(1) });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), observer.$disconnect()]);
  });

  async function waitersOnRule() {
    const [row] = await observer.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%"AutomationRule"%FOR UPDATE%'
    `;
    return row?.n ?? 0;
  }

  it("refuses an admin's switch-on and new step that waited for the owner's voucher step", async () => {
    const t = await tenant();
    const r = await rule(t, { isActive: false });
    as("admin", t);
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let ready!: () => void;
    let failed!: (error: unknown) => void;
    const locked = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
    const held = owner.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id" = ${r.id} AND "vendorId" = ${t.vendor.id} FOR UPDATE`;
      await tx.automationRuleStep.create({
        data: { vendorId: t.vendor.id, ruleId: r.id, delayMinutes: 60, condition: { type: "always" }, actions: [voucher(t, { lineNotification: true })] as Prisma.InputJsonArray, isActive: true },
      });
      ready();
      await released;
    }, { maxWait: 5_000, timeout: 30_000 }).then(() => undefined, (error: unknown) => { failed(error); throw error; });
    await locked;
    const settle = (promise: Promise<unknown>) => promise.then(() => ({ ok: true as const, error: undefined }), (error: unknown) => ({ ok: false as const, error }));
    let calls: Array<Promise<{ ok: boolean; error: unknown }>> = [];
    try {
      calls = [
        settle(toggleAutomationRuleAction(form({ ruleId: r.id }))),
        settle(createAutomationRuleStepAction(stepFields(r.id, { delayValue: "3", actionTag: "on", customerTag: "x" }))),
      ];
      // Both queue on the row lock (they give up after lock_timeout, 5 s) before the owner commits.
      const deadline = Date.now() + 15_000;
      while ((await waitersOnRule()) < 2) {
        if (Date.now() > deadline) throw new Error("the admin calls did not wait on the rule lock");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release();
      await held;
    }
    const results = await Promise.all(calls);
    expect(results.map((result) => String((result.error as Error | undefined)?.message))).toEqual([ERROR, ERROR]);
    await expect(db.automationRule.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ isActive: false });
    await expect(db.automationRuleStep.findMany({ where: { ruleId: r.id }, select: { delayMinutes: true } })).resolves.toEqual([{ delayMinutes: 60 }]);
    await expect(db.auditLog.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(0);
  }, 20_000);
});
