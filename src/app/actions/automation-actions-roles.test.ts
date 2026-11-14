import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// F-4 gap 3: /settings/automations and every one of its Server Actions use the
// real role guard from @/lib/auth. Only the session cookie, the database and
// the Next.js boundaries are synthetic, so a role change in the guard or a
// page/action falling back to a different guard fails here.
const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  findSession: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
  db: {
    product: { findFirst: vi.fn(), findMany: vi.fn() },
    automationRule: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    automationExecutionLog: { findMany: vi.fn(), count: vi.fn() },
    automationRuleStep: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    delayedStepRun: { count: vi.fn(), groupBy: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: mocks.audit }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ ...mocks.db, userSession: { findUnique: mocks.findSession } }) }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));

import AutomationSettingsPage from "@/app/(app)/settings/automations/page";
import {
  createAutomationRecipeAction,
  createAutomationRuleAction,
  createAutomationRuleStepAction,
  deleteAutomationRuleAction,
  deleteAutomationRuleStepAction,
  dryRunAutomationRuleAction,
  toggleAutomationRuleAction,
  updateAutomationRuleStepAction,
} from "./automation-actions";

function sessionFor(role: string) {
  const vendor = { id: "vendor-1", name: "商家一", tracking: null, suspendedAt: null, betaFeatureGrants: ["automation_delayed_steps"] };
  return {
    id: "session-1",
    vendorId: vendor.id,
    revokedAt: null,
    createdAt: new Date(),
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    mfaVerifiedAt: null,
    vendor,
    user: {
      id: "user-1",
      status: "active",
      platformRole: "none",
      memberships: [{ id: "member-1", vendorId: vendor.id, role, status: "active", createdAt: new Date("2026-01-01T00:00:00.000Z"), vendor }],
      mfaFactor: null,
      recoveryCodes: [],
    },
  };
}

function data(entries: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

const ACTIONS = [
  ["createAutomationRuleAction", () => createAutomationRuleAction(data({ name: "報名標籤", trigger: "form_registered", actionTag: "on", customerTag: "報名" })), "updated=created"],
  // A recipe without a LINE push (that one is owner-only, covered below), so both roles apply it.
  ["createAutomationRecipeAction", () => createAutomationRecipeAction(data({ recipeId: "vip_auto_tiering", productId: "product-1" })), "updated=recipe_created"],
  ["dryRunAutomationRuleAction", () => dryRunAutomationRuleAction(data({ ruleId: "rule-1" })), "dryRun=would_dispatch"],
  ["toggleAutomationRuleAction", () => toggleAutomationRuleAction(data({ ruleId: "rule-1" })), "updated=toggled"],
  ["deleteAutomationRuleAction", () => deleteAutomationRuleAction(data({ ruleId: "rule-1" })), "updated=deleted"],
  // F-4 delayed steps: same guard; the rule is locked by id AND vendorId ($queryRaw values checked below).
  ["createAutomationRuleStepAction", () => createAutomationRuleStepAction(data({ ruleId: "rule-1", delayValue: "1", delayUnit: "days", actionTag: "on", customerTag: "第二天", stepActive: "on" })), "updated=step_created"],
  ["updateAutomationRuleStepAction", () => updateAutomationRuleStepAction(data({ ruleId: "rule-1", stepId: "step-1", delayValue: "2", delayUnit: "hours", actionTag: "on", customerTag: "第二天" })), "updated=step_updated"],
  ["deleteAutomationRuleStepAction", () => deleteAutomationRuleStepAction(data({ ruleId: "rule-1", stepId: "step-1" })), "updated=step_deleted"],
] as const;

function databaseCalls() {
  return [...Object.values(mocks.db.automationRule), ...Object.values(mocks.db.product), ...Object.values(mocks.db.automationExecutionLog), ...Object.values(mocks.db.automationRuleStep), ...Object.values(mocks.db.delayedStepRun), mocks.db.$queryRaw, mocks.db.$executeRaw, mocks.db.$transaction]
    .reduce((total, method) => total + method.mock.calls.length, 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ get: (name: string) => (name === "__Host-celebrate_session" ? { value: "synthetic-session-token" } : undefined) });
  mocks.redirect.mockImplementation((path: string): never => { throw new Error(`redirect:${path}`); });
  mocks.db.automationRule.create.mockResolvedValue({ id: "rule-1", vendorId: "vendor-1" });
  mocks.db.product.findFirst.mockResolvedValue({ id: "product-1" });
  mocks.db.automationRule.findFirst.mockResolvedValue({ id: "rule-1", name: "規則", trigger: "consultation_booked", isActive: false, funnelPageId: null, condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: "VIP" }], _count: { executionLogs: 0 } });
  mocks.db.automationRule.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.automationRule.delete.mockResolvedValue({ id: "rule-1" });
  mocks.db.automationExecutionLog.count.mockResolvedValue(0);
  mocks.db.$queryRaw.mockResolvedValue([{ id: "rule-1", trigger: "consultation_booked" }]);
  mocks.db.automationRuleStep.count.mockResolvedValue(0);
  // The step being edited exists; no other step uses the new delay.
  mocks.db.automationRuleStep.findFirst.mockImplementation(async (query: { where: { id?: unknown } }) => (
    typeof query.where.id === "string" ? { id: "step-1", delayMinutes: 1_440, isActive: true, actions: [{ type: "add_customer_tag", tag: "第二天" }] } : null
  ));
  mocks.db.automationRuleStep.create.mockResolvedValue({ id: "step-new", delayMinutes: 1_440, isActive: true, actions: [] });
  mocks.db.automationRuleStep.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.automationRuleStep.deleteMany.mockResolvedValue({ count: 1 });
  mocks.db.delayedStepRun.count.mockResolvedValue(0);
  mocks.db.delayedStepRun.groupBy.mockResolvedValue([]);
  mocks.db.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(mocks.db));
  mocks.db.automationRule.findMany.mockResolvedValue([]);
  mocks.db.product.findMany.mockResolvedValue([]);
  mocks.db.automationExecutionLog.findMany.mockResolvedValue([]);
});

describe("/settings/automations role boundary", () => {
  it.each(["owner", "admin"])("lets a vendor %s open the page", async (role) => {
    mocks.findSession.mockResolvedValue(sessionFor(role));
    const html = renderToStaticMarkup(await AutomationSettingsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toMatch(/<h1[^>]*>自動化<\/h1>/u);
    expect(mocks.db.automationRule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1" } }));
  });

  it.each(["accountant", "support", "member"])("sends a vendor %s away from the page before any query", async (role) => {
    mocks.findSession.mockResolvedValue(sessionFor(role));
    await expect(AutomationSettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/dashboard?error=insufficient_role");
    expect(databaseCalls()).toBe(0);
  });

  it("keeps a partner-only membership in the partner portal", async () => {
    mocks.findSession.mockResolvedValue(sessionFor("partner"));
    await expect(AutomationSettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/affiliate-portal");
    expect(databaseCalls()).toBe(0);
  });

  describe.each(ACTIONS)("%s", (_name, run, success) => {
    it.each(["owner", "admin"])("runs for a vendor %s and binds the current vendor", async (role) => {
      mocks.findSession.mockResolvedValue(sessionFor(role));
      await expect(run()).rejects.toThrow(success);
      const firstQuery = [...mocks.db.automationRule.findFirst.mock.calls, ...mocks.db.automationRule.create.mock.calls][0]?.[0] as { where?: { vendorId?: string }; data?: { vendorId?: string } } | undefined;
      if (firstQuery) expect(firstQuery.where?.vendorId ?? firstQuery.data?.vendorId).toBe("vendor-1");
      // Step actions lock the rule with a raw FOR UPDATE by id and vendorId first.
      else expect(mocks.db.$queryRaw).toHaveBeenCalled();
      for (const [, ...values] of mocks.db.$queryRaw.mock.calls) expect(values).toContain("vendor-1");
      for (const method of Object.values(mocks.db.automationRuleStep)) {
        for (const [query] of method.mock.calls as Array<[{ where?: { vendorId?: string }; data?: { vendorId?: string } }]>) {
          expect(query.where?.vendorId ?? query.data?.vendorId).toBe("vendor-1");
        }
      }
    });

    it.each(["accountant", "support", "member", "partner"])("refuses a vendor %s without touching the database", async (role) => {
      mocks.findSession.mockResolvedValue(sessionFor(role));
      await expect(run()).rejects.toThrow(role === "partner" ? "redirect:/affiliate-portal" : "redirect:/dashboard?error=insufficient_role");
      expect(databaseCalls()).toBe(0);
      expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("refuses an anonymous request", async () => {
      mocks.cookies.mockResolvedValue({ get: () => undefined });
      await expect(run()).rejects.toThrow("redirect:/login");
      expect(databaseCalls()).toBe(0);
    });
  });
});

// Owner decision 2026-11-14: the custom LINE push is owner-only. Judged from
// the real membership role (same guard as above) and the server-parsed or
// stored actions, never a form flag.
describe("/settings/automations owner-only LINE push", () => {
  const LINE = { actionLine: "on", lineMessage: "第二天的提醒" };
  const TAG = [{ type: "add_customer_tag", tag: "VIP" }];
  const STORED_LINE = [{ type: "line_push", message: "老闆寫的推播" }];
  const stepForm = (extra: Record<string, string>) => data({ ruleId: "rule-1", delayValue: "1", delayUnit: "days", stepActive: "on", ...extra });
  /** The stored rule as storedAutomationRuleIncludesLinePush reads it (actions + steps' actions, bound to the vendor). */
  const storedRule = (rule: { actions: unknown; steps?: Array<{ actions: unknown }> }) => {
    mocks.db.automationRule.findFirst.mockImplementation(async (query: { select?: { steps?: unknown } }) => (
      query.select?.steps ? { steps: [], ...rule } : { id: "rule-1", name: "規則", trigger: "consultation_booked", isActive: false, funnelPageId: null, condition: { type: "always" }, actions: rule.actions, _count: { executionLogs: 0 } }
    ));
  };
  const expectNoWrite = () => {
    for (const method of [mocks.db.automationRule.create, mocks.db.automationRule.updateMany, mocks.db.automationRule.delete, mocks.db.automationRuleStep.create, mocks.db.automationRuleStep.updateMany, mocks.db.automationRuleStep.deleteMany, mocks.db.delayedStepRun.updateMany]) {
      expect(method).not.toHaveBeenCalled();
    }
    expect(mocks.audit).not.toHaveBeenCalled();
  };
  const expectLinePushReadBoundToVendor = () => {
    expect(mocks.db.automationRule.findFirst).toHaveBeenCalledWith({
      where: { id: "rule-1", vendorId: "vendor-1" },
      select: { actions: true, steps: { where: { vendorId: "vendor-1" }, select: { actions: true } } },
    });
  };

  it.each([
    ["createAutomationRuleAction", () => createAutomationRuleAction(data({ name: "推播", trigger: "form_registered", ...LINE }))],
    ["createAutomationRecipeAction", () => createAutomationRecipeAction(data({ recipeId: "consultation_confirmer" }))],
    ["createAutomationRuleStepAction", () => createAutomationRuleStepAction(stepForm(LINE))],
    ["updateAutomationRuleStepAction", () => updateAutomationRuleStepAction(stepForm({ stepId: "step-1", ...LINE }))],
  ])("%s with a LINE push: an admin is refused before any query", async (_name, run) => {
    mocks.findSession.mockResolvedValue(sessionFor("admin"));
    await expect(run()).rejects.toThrow("redirect:/settings/automations?error=line_push_owner_only");
    expect(databaseCalls()).toBe(0);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each([
    ["createAutomationRuleAction", () => createAutomationRuleAction(data({ name: "推播", trigger: "form_registered", ...LINE })), "updated=created", () => mocks.db.automationRule.create],
    ["createAutomationRecipeAction", () => createAutomationRecipeAction(data({ recipeId: "consultation_confirmer" })), "updated=recipe_created", () => mocks.db.automationRule.create],
    ["createAutomationRuleStepAction", () => createAutomationRuleStepAction(stepForm(LINE)), "updated=step_created", () => mocks.db.automationRuleStep.create],
    ["updateAutomationRuleStepAction", () => updateAutomationRuleStepAction(stepForm({ stepId: "step-1", ...LINE })), "updated=step_updated", () => mocks.db.automationRuleStep.updateMany],
  ])("%s with a LINE push: the owner saves it", async (_name, run, success, writer) => {
    mocks.findSession.mockResolvedValue(sessionFor("owner"));
    await expect(run()).rejects.toThrow(success);
    const [[query]] = writer().mock.calls as Array<[{ where?: { vendorId?: string }; data: { actions?: unknown; vendorId?: string } }]>;
    expect(query.where?.vendorId ?? query.data.vendorId).toBe("vendor-1");
    expect(query.data.actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "line_push" })]));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorLabel: "owner" }));
  });

  it.each([
    ["its immediate actions", { actions: STORED_LINE, steps: [] }],
    ["another delayed step", { actions: TAG, steps: [{ actions: TAG }, { actions: STORED_LINE }] }],
    // The step being edited itself (it carries the LINE push): even editing it into a tag is the owner's.
    ["the step being edited", { actions: TAG, steps: [{ actions: STORED_LINE }] }],
  ])("an admin cannot add or edit a tag-only step on a rule with a LINE push in %s", async (_label, rule) => {
    mocks.findSession.mockResolvedValue(sessionFor("admin"));
    storedRule(rule);
    await expect(createAutomationRuleStepAction(stepForm({ actionTag: "on", customerTag: "第二天" }))).rejects.toThrow("redirect:/settings/automations?error=line_push_owner_only");
    await expect(updateAutomationRuleStepAction(stepForm({ stepId: "step-1", actionTag: "on", customerTag: "第二天" }))).rejects.toThrow("redirect:/settings/automations?error=line_push_owner_only");
    // Read after the rule row is locked FOR UPDATE by id and vendor.
    expectLinePushReadBoundToVendor();
    const [lockSql, ...lockValues] = mocks.db.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(lockSql.join("?")).toMatch(/FROM "AutomationRule" WHERE "id" = \? AND "vendorId" = \? FOR UPDATE/u);
    expect(lockValues).toEqual(["rule-1", "vendor-1"]);
    expect(mocks.db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.db.automationRule.findFirst.mock.invocationCallOrder[0]!);
    expectNoWrite();
  });

  it("an admin switches a rule with a LINE push off, deletes its steps and deletes the rule, but cannot switch it on", async () => {
    mocks.findSession.mockResolvedValue(sessionFor("admin"));
    storedRule({ actions: TAG, steps: [{ actions: STORED_LINE }] });
    // Switching on: refused after the lock, nothing written.
    await expect(toggleAutomationRuleAction(data({ ruleId: "rule-1" }))).rejects.toThrow("redirect:/settings/automations?error=line_push_owner_only");
    expectLinePushReadBoundToVendor();
    expectNoWrite();

    // Deleting a step and the (switched-off, unused) rule stays allowed.
    await expect(deleteAutomationRuleStepAction(data({ ruleId: "rule-1", stepId: "step-1" }))).rejects.toThrow("updated=step_deleted");
    expect(mocks.db.automationRuleStep.deleteMany).toHaveBeenCalledWith({ where: { id: "step-1", vendorId: "vendor-1", ruleId: "rule-1" } });
    await expect(deleteAutomationRuleAction(data({ ruleId: "rule-1" }))).rejects.toThrow("updated=deleted");
    expect(mocks.db.automationRule.delete).toHaveBeenCalledWith({ where: { vendorId_id: { vendorId: "vendor-1", id: "rule-1" } } });

    // Switching off is always allowed (and stops the rule's delayed-step runs).
    mocks.db.delayedStepRun.updateMany.mockResolvedValue({ count: 0 });
    mocks.db.automationRule.findFirst.mockResolvedValueOnce({ id: "rule-1", isActive: true, trigger: "consultation_booked" });
    await expect(toggleAutomationRuleAction(data({ ruleId: "rule-1" }))).rejects.toThrow("updated=toggled");
    expect(mocks.db.automationRule.updateMany).toHaveBeenCalledWith({ where: { id: "rule-1", vendorId: "vendor-1", isActive: true }, data: { isActive: false } });
  });

  it("the owner switches a rule with a LINE push on and edits its steps", async () => {
    mocks.findSession.mockResolvedValue(sessionFor("owner"));
    storedRule({ actions: STORED_LINE, steps: [{ actions: STORED_LINE }] });
    await expect(toggleAutomationRuleAction(data({ ruleId: "rule-1" }))).rejects.toThrow("updated=toggled");
    expect(mocks.db.automationRule.updateMany).toHaveBeenCalledWith({ where: { id: "rule-1", vendorId: "vendor-1", isActive: false }, data: { isActive: true } });
    await expect(updateAutomationRuleStepAction(stepForm({ stepId: "step-1", actionTag: "on", customerTag: "第二天" }))).rejects.toThrow("updated=step_updated");
    await expect(createAutomationRuleStepAction(stepForm({ actionTag: "on", customerTag: "第三天" }))).rejects.toThrow("updated=step_created");
  });

  it("an admin keeps managing a rule without a LINE push (switch on, add and edit steps)", async () => {
    mocks.findSession.mockResolvedValue(sessionFor("admin"));
    storedRule({ actions: TAG, steps: [{ actions: [{ type: "send_email_notification", template: "class_reminder" }] }] });
    await expect(toggleAutomationRuleAction(data({ ruleId: "rule-1" }))).rejects.toThrow("updated=toggled");
    await expect(createAutomationRuleStepAction(stepForm({ actionTag: "on", customerTag: "第三天" }))).rejects.toThrow("updated=step_created");
    await expect(updateAutomationRuleStepAction(stepForm({ stepId: "step-1", actionEmail: "on", emailTemplate: "class_reminder" }))).rejects.toThrow("updated=step_updated");
    expect(mocks.audit).toHaveBeenCalledTimes(3);
  });

  it("another vendor's rule stays not_found for an admin, before any LINE push check", async () => {
    mocks.findSession.mockResolvedValue(sessionFor("admin"));
    mocks.db.$queryRaw.mockResolvedValue([]);
    await expect(createAutomationRuleStepAction(stepForm({ actionTag: "on", customerTag: "x" }))).rejects.toThrow("redirect:/settings/automations?error=not_found");
    expect(mocks.db.automationRule.findFirst).not.toHaveBeenCalled();
    expectNoWrite();
  });
});
