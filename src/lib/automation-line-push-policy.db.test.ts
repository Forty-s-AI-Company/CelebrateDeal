import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Owner decision 2026-11-14: the custom LINE push of an automation is
// owner-only. Every writer of automation actions runs here for real against
// the disposable PostgreSQL database (Server Actions of /settings/automations,
// the delayed-step library and the funnel editor's service); only the session
// (the membership role), CSRF and the Next.js boundaries are synthetic.
const runtime = vi.hoisted(() => ({
  actor: null as null | { user: { id: string }; vendor: { id: string; betaFeatureGrants?: string[] }; member: { role: string } },
  projectId: "",
}));
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
import { createAutomationRuleStep, updateAutomationRuleStep } from "@/lib/automation-delayed-steps";
import { getDb } from "@/lib/db";
import {
  FunnelAutomationBusyError,
  FunnelAutomationLinePushOwnerOnlyError,
  FunnelAutomationNotFoundError,
  listFunnelAutomationRules,
  setFunnelAutomationRuleEnabled,
  updateFunnelAutomationRule,
} from "@/lib/funnel-automation-service";

const db = getDb();
const createdVendorIds: string[] = [];
const LINE = [{ type: "line_push", message: "老闆寫的推播", buttonLabel: null, buttonUrl: null }];
const TAG = [{ type: "add_customer_tag", tag: "第二天" }];
const ERROR = "redirect:/settings/automations?error=line_push_owner_only";

beforeEach(() => {
  runtime.actor = null;
  runtime.projectId = "";
});

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

async function tenant() {
  const suffix = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: {
      name: `LINE 權限商家 ${suffix}`,
      slug: `line-owner-only-${suffix}`,
      email: `merchant-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
      betaFeatureGrants: ["automation_delayed_steps"],
    },
  });
  createdVendorIds.push(vendor.id);
  return vendor;
}

function as(role: "owner" | "admin", vendor: { id: string }) {
  runtime.actor = { user: { id: `user-${role}` }, vendor: { id: vendor.id, betaFeatureGrants: ["automation_delayed_steps"] }, member: { role } };
}

async function rule(vendorId: string, options: { actions?: unknown[]; isActive?: boolean; funnelPageId?: string } = {}) {
  return db.automationRule.create({
    data: {
      vendorId,
      name: `規則 ${randomUUID().slice(0, 6)}`,
      trigger: "form_registered",
      funnelPageId: options.funnelPageId ?? null,
      condition: { type: "always" } as Prisma.InputJsonValue,
      actions: (options.actions ?? TAG) as Prisma.InputJsonArray,
      isActive: options.isActive ?? false,
    },
  });
}

async function step(vendorId: string, ruleId: string, delayMinutes: number, actions: unknown[], isActive = true) {
  return db.automationRuleStep.create({
    data: { vendorId, ruleId, delayMinutes, condition: { type: "always" } as Prisma.InputJsonValue, actions: actions as Prisma.InputJsonArray, isActive },
  });
}

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}
const lineFields = { actionLine: "on", lineMessage: "第二天的提醒" };
const tagFields = { actionTag: "on", customerTag: "第二天" };
const stepFields = (ruleId: string, extra: Record<string, string>) => form({ ruleId, delayValue: "1", delayUnit: "days", stepActive: "on", ...extra });

async function snapshot(vendorId: string) {
  const [rules, steps, audit] = await Promise.all([
    db.automationRule.findMany({ where: { vendorId }, orderBy: { id: "asc" }, select: { id: true, name: true, isActive: true, actions: true, version: true } }),
    db.automationRuleStep.findMany({ where: { vendorId }, orderBy: { id: "asc" }, select: { id: true, delayMinutes: true, isActive: true, actions: true } }),
    db.auditLog.count({ where: { vendorId } }),
  ]);
  return { rules, steps, audit };
}

describe("/settings/automations: a LINE push is the owner's", () => {
  it("refuses an admin's new rule, recipe and steps with a LINE push and writes nothing", async () => {
    const vendor = await tenant();
    const tagRule = await rule(vendor.id);
    as("admin", vendor);
    const before = await snapshot(vendor.id);
    await expect(createAutomationRuleAction(form({ name: "推播", trigger: "form_registered", ...lineFields }))).rejects.toThrow(ERROR);
    await expect(createAutomationRuleAction(form({ name: "推播＋標籤", trigger: "consultation_booked", ...lineFields, ...tagFields }))).rejects.toThrow(ERROR);
    await expect(createAutomationRecipeAction(form({ recipeId: "consultation_confirmer" }))).rejects.toThrow(ERROR);
    await expect(createAutomationRuleStepAction(stepFields(tagRule.id, lineFields))).rejects.toThrow(ERROR);
    const tagStep = await step(vendor.id, tagRule.id, 60, TAG);
    const withStep = await snapshot(vendor.id);
    await expect(updateAutomationRuleStepAction(stepFields(tagRule.id, { stepId: tagStep.id, ...lineFields }))).rejects.toThrow(ERROR);
    expect(await snapshot(vendor.id)).toEqual(withStep);
    expect(withStep.rules).toEqual(before.rules);
    expect(withStep.audit).toBe(before.audit);
  });

  it("lets the owner create a rule, a recipe and steps with a LINE push", async () => {
    const vendor = await tenant();
    as("owner", vendor);
    await expect(createAutomationRuleAction(form({ name: "推播", trigger: "form_registered", ...lineFields }))).rejects.toThrow("updated=created");
    await expect(createAutomationRecipeAction(form({ recipeId: "consultation_confirmer" }))).rejects.toThrow("updated=recipe_created");
    const created = await db.automationRule.findFirstOrThrow({ where: { vendorId: vendor.id, name: "推播" } });
    expect(created.actions).toEqual([expect.objectContaining({ type: "line_push", message: "第二天的提醒" })]);
    await expect(createAutomationRuleStepAction(stepFields(created.id, lineFields))).rejects.toThrow("updated=step_created");
    const ownerStep = await db.automationRuleStep.findFirstOrThrow({ where: { vendorId: vendor.id, ruleId: created.id } });
    await expect(updateAutomationRuleStepAction(stepFields(created.id, { stepId: ownerStep.id, delayValue: "2", ...lineFields, ...tagFields }))).rejects.toThrow("updated=step_updated");
    await expect(db.automationRuleStep.findUniqueOrThrow({ where: { id: ownerStep.id } })).resolves.toMatchObject({ delayMinutes: 2_880 });
    await expect(db.automationRule.count({ where: { vendorId: vendor.id } })).resolves.toBe(2);
    await expect(db.auditLog.findMany({ where: { vendorId: vendor.id }, select: { actorLabel: true } })).resolves.toEqual(expect.arrayContaining([{ actorLabel: "owner" }]));
  });

  it.each([
    ["its immediate actions", async (vendorId: string) => rule(vendorId, { actions: LINE })],
    ["a switched-off delayed step", async (vendorId: string) => {
      const r = await rule(vendorId);
      await step(vendorId, r.id, 120, LINE, false);
      return r;
    }],
  ])("keeps an admin from switching on, adding or editing steps of a rule with a LINE push in %s; switching off and deleting stay", async (_label, makeRule) => {
    const vendor = await tenant();
    const r = await makeRule(vendor.id);
    const tagStep = await step(vendor.id, r.id, 60, TAG);
    as("admin", vendor);
    const before = await snapshot(vendor.id);
    await expect(toggleAutomationRuleAction(form({ ruleId: r.id }))).rejects.toThrow(ERROR);
    await expect(createAutomationRuleStepAction(stepFields(r.id, tagFields))).rejects.toThrow(ERROR);
    await expect(updateAutomationRuleStepAction(stepFields(r.id, { stepId: tagStep.id, delayValue: "3", ...tagFields }))).rejects.toThrow(ERROR);
    expect(await snapshot(vendor.id)).toEqual(before);

    // The owner switches it on; the admin may switch it off again (the safe direction).
    as("owner", vendor);
    await expect(toggleAutomationRuleAction(form({ ruleId: r.id }))).rejects.toThrow("updated=toggled");
    as("admin", vendor);
    await expect(toggleAutomationRuleAction(form({ ruleId: r.id }))).rejects.toThrow("updated=toggled");
    await expect(db.automationRule.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ isActive: false });
    // Deleting a step and then the (switched-off, unused) rule stays allowed.
    await expect(deleteAutomationRuleStepAction(form({ ruleId: r.id, stepId: tagStep.id }))).rejects.toThrow("updated=step_deleted");
    await expect(deleteAutomationRuleAction(form({ ruleId: r.id }))).rejects.toThrow("updated=deleted");
    await expect(db.automationRule.count({ where: { id: r.id } })).resolves.toBe(0);
  });

  it("refuses an admin editing a LINE push step into a tag, but lets them delete it and then manage the rule", async () => {
    const vendor = await tenant();
    const r = await rule(vendor.id);
    const lineStep = await step(vendor.id, r.id, 60, LINE);
    as("admin", vendor);
    await expect(updateAutomationRuleStepAction(stepFields(r.id, { stepId: lineStep.id, ...tagFields }))).rejects.toThrow(ERROR);
    await expect(db.automationRuleStep.findUniqueOrThrow({ where: { id: lineStep.id } })).resolves.toMatchObject({ actions: LINE, delayMinutes: 60 });
    await expect(deleteAutomationRuleStepAction(form({ ruleId: r.id, stepId: lineStep.id }))).rejects.toThrow("updated=step_deleted");
    // Without its LINE push the rule is the admin's to manage again.
    await expect(createAutomationRuleStepAction(stepFields(r.id, tagFields))).rejects.toThrow("updated=step_created");
    await expect(toggleAutomationRuleAction(form({ ruleId: r.id }))).rejects.toThrow("updated=toggled");
    await expect(db.automationRule.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ isActive: true });
  });

  it("lets an admin manage rules without a LINE push as before", async () => {
    const vendor = await tenant();
    as("admin", vendor);
    await expect(createAutomationRuleAction(form({ name: "標籤", trigger: "form_registered", ...tagFields }))).rejects.toThrow("updated=created");
    const r = await db.automationRule.findFirstOrThrow({ where: { vendorId: vendor.id, name: "標籤" } });
    await expect(createAutomationRuleStepAction(stepFields(r.id, { actionEmail: "on", emailTemplate: "class_reminder" }))).rejects.toThrow("updated=step_created");
    const s = await db.automationRuleStep.findFirstOrThrow({ where: { vendorId: vendor.id, ruleId: r.id } });
    await expect(updateAutomationRuleStepAction(stepFields(r.id, { stepId: s.id, ...tagFields }))).rejects.toThrow("updated=step_updated");
    await expect(toggleAutomationRuleAction(form({ ruleId: r.id }))).rejects.toThrow("updated=toggled");
    await expect(toggleAutomationRuleAction(form({ ruleId: r.id }))).rejects.toThrow("updated=toggled");
    await expect(db.auditLog.count({ where: { vendorId: vendor.id, actorLabel: "admin" } })).resolves.toBe(5);
  });

  it("keeps every id bound to the session's vendor: another tenant's LINE push rule is not_found, and its owner's rights end at its own tenant", async () => {
    const a = await tenant();
    const b = await tenant();
    const rb = await rule(b.id, { actions: LINE });
    const sb = await step(b.id, rb.id, 60, LINE);
    const before = await snapshot(b.id);
    for (const role of ["admin", "owner"] as const) {
      as(role, a);
      await expect(toggleAutomationRuleAction(form({ ruleId: rb.id }))).rejects.toThrow("error=not_found");
      await expect(createAutomationRuleStepAction(stepFields(rb.id, tagFields))).rejects.toThrow("error=not_found");
      await expect(updateAutomationRuleStepAction(stepFields(rb.id, { stepId: sb.id, ...tagFields }))).rejects.toThrow("error=not_found");
    }
    expect(await snapshot(b.id)).toEqual(before);
    // The library refuses the same way without the owner flag.
    await expect(createAutomationRuleStep({ vendorId: b.id, ruleId: rb.id, linePushAllowed: false, step: { delayMinutes: 240, condition: { type: "always" }, actions: TAG, isActive: true } })).resolves.toEqual({ ok: false, code: "line_push_owner_only" });
    await expect(updateAutomationRuleStep({ vendorId: b.id, ruleId: rb.id, stepId: sb.id, linePushAllowed: false, step: { delayMinutes: 60, condition: { type: "always" }, actions: TAG, isActive: true } })).resolves.toEqual({ ok: false, code: "line_push_owner_only" });
    await expect(createAutomationRuleStep({ vendorId: a.id, ruleId: rb.id, linePushAllowed: false, step: { delayMinutes: 240, condition: { type: "always" }, actions: TAG, isActive: true } })).resolves.toEqual({ ok: false, code: "not_found" });
    expect(await snapshot(b.id)).toEqual(before);
  });
});

describe("funnel editor: a LINE push is the owner's", () => {
  async function funnel() {
    const vendor = await tenant();
    const project = await db.salesProject.create({ data: { vendorId: vendor.id, name: "合成專案", slug: `line-project-${randomUUID()}`, mode: "live_course", primaryFlow: "live" } });
    const page = await db.landingPage.create({ data: { vendorId: vendor.id, projectId: project.id, name: "單頁網站", slug: `line-page-${randomUUID()}`, draftContent: {} } });
    runtime.projectId = project.id;
    // A funnel rule's immediate action is a tag; its LINE push comes from a step added in /settings/automations.
    const withLine = await rule(vendor.id, { funnelPageId: page.id, actions: [{ type: "add_customer_tag", tag: "漏斗" }] });
    await step(vendor.id, withLine.id, 60, LINE);
    const plain = await rule(vendor.id, { funnelPageId: page.id, actions: [{ type: "add_customer_tag", tag: "一般" }] });
    return { vendor, page, withLine, plain };
  }

  it("refuses an admin's edit and switch-on of a rule with a LINE push step, flags it in the list and keeps switch-off", async () => {
    const { vendor, page, withLine, plain } = await funnel();
    as("admin", vendor);
    await expect(listFunnelAutomationRules({ pageId: page.id })).resolves.toEqual([
      expect.objectContaining({ id: withLine.id, linePushOwnerOnly: true }),
      expect.objectContaining({ id: plain.id, linePushOwnerOnly: false }),
    ]);
    await expect(updateFunnelAutomationRule({ pageId: page.id, ruleId: withLine.id, version: 1, name: "改名", tag: "改標籤" })).rejects.toBeInstanceOf(FunnelAutomationLinePushOwnerOnlyError);
    await expect(setFunnelAutomationRuleEnabled({ pageId: page.id, ruleId: withLine.id, version: 1, isActive: true })).rejects.toBeInstanceOf(FunnelAutomationLinePushOwnerOnlyError);
    await expect(db.automationRule.findUniqueOrThrow({ where: { id: withLine.id } })).resolves.toMatchObject({ name: withLine.name, isActive: false, version: 1, actions: [{ type: "add_customer_tag", tag: "漏斗" }] });
    await expect(db.auditLog.count({ where: { vendorId: vendor.id } })).resolves.toBe(0);

    // The admin's own rule without a LINE push is edited and switched on as before.
    await expect(updateFunnelAutomationRule({ pageId: page.id, ruleId: plain.id, version: 1, name: "改名", tag: "改標籤" })).resolves.toBeUndefined();
    await expect(setFunnelAutomationRuleEnabled({ pageId: page.id, ruleId: plain.id, version: 2, isActive: true })).resolves.toBeUndefined();

    // The owner switches the LINE push rule on and edits it; the admin may switch it off.
    as("owner", vendor);
    await expect(listFunnelAutomationRules({ pageId: page.id })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: withLine.id, linePushOwnerOnly: false })]));
    await expect(setFunnelAutomationRuleEnabled({ pageId: page.id, ruleId: withLine.id, version: 1, isActive: true })).resolves.toBeUndefined();
    await expect(updateFunnelAutomationRule({ pageId: page.id, ruleId: withLine.id, version: 2, name: "老闆改名", tag: "漏斗" })).resolves.toBeUndefined();
    as("admin", vendor);
    await expect(setFunnelAutomationRuleEnabled({ pageId: page.id, ruleId: withLine.id, version: 3, isActive: false })).resolves.toBeUndefined();
    await expect(db.automationRule.findUniqueOrThrow({ where: { id: withLine.id } })).resolves.toMatchObject({ name: "老闆改名", isActive: false, version: 4 });
  });

  it("keeps a LINE push rule of another page of the same vendor, or of /settings/automations, not_found from this page (NIT-2)", async () => {
    const { vendor, page, withLine } = await funnel();
    const otherPage = await db.landingPage.create({ data: { vendorId: vendor.id, projectId: runtime.projectId, name: "另一頁", slug: `line-page-${randomUUID()}`, draftContent: {} } });
    const otherPageRule = await rule(vendor.id, { funnelPageId: otherPage.id, actions: [{ type: "add_customer_tag", tag: "另一頁" }] });
    await step(vendor.id, otherPageRule.id, 60, LINE);
    const settingsRule = await rule(vendor.id, { actions: [{ type: "add_customer_tag", tag: "全商家" }] });
    await step(vendor.id, settingsRule.id, 60, LINE);
    as("admin", vendor);
    for (const id of [otherPageRule.id, settingsRule.id]) {
      await expect(updateFunnelAutomationRule({ pageId: page.id, ruleId: id, version: 1, name: "改名", tag: "改標籤" })).rejects.toBeInstanceOf(FunnelAutomationNotFoundError);
      await expect(setFunnelAutomationRuleEnabled({ pageId: page.id, ruleId: id, version: 1, isActive: true })).rejects.toBeInstanceOf(FunnelAutomationNotFoundError);
    }
    // This page's own LINE push rule is still owner-only.
    await expect(setFunnelAutomationRuleEnabled({ pageId: page.id, ruleId: withLine.id, version: 1, isActive: true })).rejects.toBeInstanceOf(FunnelAutomationLinePushOwnerOnlyError);
    await expect(db.automationRule.findMany({ where: { id: { in: [otherPageRule.id, settingsRule.id] } }, select: { isActive: true, version: true } })).resolves.toEqual([{ isActive: false, version: 1 }, { isActive: false, version: 1 }]);
  });

  it("keeps another tenant's funnel rule not_found for an admin, without revealing its LINE push", async () => {
    const other = await funnel();
    const vendor = await tenant();
    const project = await db.salesProject.create({ data: { vendorId: vendor.id, name: "合成專案", slug: `line-project-${randomUUID()}`, mode: "live_course", primaryFlow: "live" } });
    const page = await db.landingPage.create({ data: { vendorId: vendor.id, projectId: project.id, name: "單頁網站", slug: `line-page-${randomUUID()}`, draftContent: {} } });
    runtime.projectId = project.id;
    as("admin", vendor);
    await expect(updateFunnelAutomationRule({ pageId: page.id, ruleId: other.withLine.id, version: 1, name: "改名", tag: "改標籤" })).rejects.toBeInstanceOf(FunnelAutomationNotFoundError);
    await expect(setFunnelAutomationRuleEnabled({ pageId: page.id, ruleId: other.withLine.id, version: 1, isActive: true })).rejects.toBeInstanceOf(FunnelAutomationNotFoundError);
    await expect(db.automationRule.findUniqueOrThrow({ where: { id: other.withLine.id } })).resolves.toMatchObject({ isActive: false, version: 1 });
  });
});

// MINOR-1: the LINE push check is read after the rule row is locked FOR UPDATE.
// An owner transaction holds the row, adds a LINE push step and commits only
// once every admin call is waiting on the lock; each call must then see the
// step and refuse. A second case holds the row past lock_timeout (5 s) and
// checks every writer gives up as busy, twice in a row on the same pool.
describe("concurrency with an owner holding the rule row", () => {
  type Held = { done: Promise<void>; release: () => void };

  /** Locks the rule row in its own transaction (pinned connection), runs `work`, and commits only on release(). */
  async function holdRule(vendorId: string, ruleId: string, work: (tx: Prisma.TransactionClient) => Promise<unknown> = async () => undefined): Promise<Held> {
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let ready!: () => void;
    let failed!: (error: unknown) => void;
    const locked = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
    const done = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id" = ${ruleId} AND "vendorId" = ${vendorId} FOR UPDATE`;
      await work(tx);
      ready();
      await released;
    }, { maxWait: 5_000, timeout: 30_000 }).then(() => undefined, (error: unknown) => { failed(error); throw error; });
    await locked;
    return { done, release };
  }

  /** Backends of this database waiting for a lock on an AutomationRule FOR UPDATE (each admin call queues there). */
  async function waitersOnRule() {
    const [row] = await db.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%"AutomationRule"%FOR UPDATE%'
    `;
    return row?.n ?? 0;
  }

  async function untilWaiting(count: number, withinMs: number) {
    const deadline = Date.now() + withinMs;
    while (Date.now() < deadline) {
      if ((await waitersOnRule()) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`fewer than ${count} calls waited on the rule lock`);
  }

  const settle = (promise: Promise<unknown>) => promise.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));

  async function funnelRule() {
    const vendor = await tenant();
    const project = await db.salesProject.create({ data: { vendorId: vendor.id, name: "合成專案", slug: `line-project-${randomUUID()}`, mode: "live_course", primaryFlow: "live" } });
    const page = await db.landingPage.create({ data: { vendorId: vendor.id, projectId: project.id, name: "單頁網站", slug: `line-page-${randomUUID()}`, draftContent: {} } });
    runtime.projectId = project.id;
    // A funnel rule (so the funnel editor can act on it too), switched off, no LINE push yet.
    const r = await rule(vendor.id, { funnelPageId: page.id, actions: [{ type: "add_customer_tag", tag: "漏斗" }] });
    return { vendor, page, r };
  }

  function adminCalls(vendorId: string, pageId: string, ruleId: string) {
    return [
      settle(toggleAutomationRuleAction(form({ ruleId }))),
      settle(createAutomationRuleStepAction(stepFields(ruleId, { delayValue: "3", ...tagFields }))),
      settle(updateFunnelAutomationRule({ pageId, ruleId, version: 1, name: "改名", tag: "改標籤" })),
      settle(setFunnelAutomationRuleEnabled({ pageId, ruleId, version: 1, isActive: true })),
    ];
  }

  it("refuses an admin's switch-on, new step, funnel edit and funnel switch-on that waited for an owner adding a LINE push step", async () => {
    const { vendor, page, r } = await funnelRule();
    as("admin", vendor);
    const held = await holdRule(vendor.id, r.id, (tx) => tx.automationRuleStep.create({
      data: { vendorId: vendor.id, ruleId: r.id, delayMinutes: 60, condition: { type: "always" }, actions: LINE as Prisma.InputJsonArray, isActive: true },
    }));
    let calls: Array<Promise<{ ok: boolean; error?: unknown }>> = [];
    try {
      calls = adminCalls(vendor.id, page.id, r.id);
      // Every call is queued on the row lock before the owner commits (well inside lock_timeout).
      await untilWaiting(4, 3_000);
    } finally {
      held.release();
      await held.done;
    }
    const results = await Promise.all(calls);
    expect(results.map((result) => result.ok)).toEqual([false, false, false, false]);
    const [toggle, create, funnelEdit, funnelEnable] = results.map((result) => result.error);
    expect(String((toggle as Error).message)).toBe(ERROR);
    expect(String((create as Error).message)).toBe(ERROR);
    expect(funnelEdit).toBeInstanceOf(FunnelAutomationLinePushOwnerOnlyError);
    expect(funnelEnable).toBeInstanceOf(FunnelAutomationLinePushOwnerOnlyError);
    // Only the owner's step was written.
    await expect(db.automationRule.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ name: r.name, isActive: false, version: 1, actions: [{ type: "add_customer_tag", tag: "漏斗" }] });
    await expect(db.automationRuleStep.findMany({ where: { ruleId: r.id }, select: { delayMinutes: true, actions: true } })).resolves.toEqual([{ delayMinutes: 60, actions: LINE }]);
    await expect(db.auditLog.count({ where: { vendorId: vendor.id } })).resolves.toBe(0);
  });

  it("gives up after lock_timeout as busy on every writer, also on a second consecutive round", async () => {
    const { vendor, page, r } = await funnelRule();
    as("admin", vendor);
    for (let round = 0; round < 2; round += 1) {
      const held = await holdRule(vendor.id, r.id);
      let results: Array<{ ok: boolean; error?: unknown; ms: number }> = [];
      try {
        const started = Date.now();
        results = await Promise.all(adminCalls(vendor.id, page.id, r.id).map((call) => call.then((result) => ({ ...result, ms: Date.now() - started }))));
      } finally {
        held.release();
        await held.done;
      }
      const [toggle, create, funnelEdit, funnelEnable] = results;
      expect(String((toggle!.error as Error).message)).toBe("redirect:/settings/automations?error=toggle_busy");
      expect(String((create!.error as Error).message)).toBe("redirect:/settings/automations?error=step_busy");
      expect(funnelEdit!.error).toBeInstanceOf(FunnelAutomationBusyError);
      expect(funnelEnable!.error).toBeInstanceOf(FunnelAutomationBusyError);
      // Nothing waited for the owner's commit (released only afterwards) or
      // for the 15 s transaction timeout. PostgreSQL applies lock_timeout to
      // each lock acquisition: the first queued FOR UPDATE waits on the
      // holder's transaction id, the others first on the row's tuple lock, and
      // the one that gets the tuple lock when the first gives up then waits
      // again on the transaction id. So a call gives up after 5 s or, queued
      // behind another, after up to about 10 s (2 × lock_timeout).
      for (const result of results) {
        expect(result.ms).toBeGreaterThanOrEqual(4_500);
        expect(result.ms).toBeLessThan(12_500);
      }
      expect(Math.min(...results.map((result) => result.ms))).toBeLessThan(7_000);
    }
    await expect(db.automationRule.findUniqueOrThrow({ where: { id: r.id } })).resolves.toMatchObject({ isActive: false, version: 1 });
    await expect(db.automationRuleStep.count({ where: { ruleId: r.id } })).resolves.toBe(0);
    await expect(db.auditLog.count({ where: { vendorId: vendor.id } })).resolves.toBe(0);
  }, 40_000);
});
