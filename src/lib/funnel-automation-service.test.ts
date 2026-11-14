import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  manager: vi.fn(),
  scope: vi.fn(),
  audit: vi.fn(),
  snapshot: vi.fn((value: unknown) => value),
  db: {
    landingPage: { findFirst: vi.fn() },
    automationRule: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
    delayedStepRun: { updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: runtime.manager }));
vi.mock("@/lib/sales-project-scope", () => ({ requireEditableSalesProjectScope: runtime.scope }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: runtime.audit, auditSnapshot: runtime.snapshot }));
vi.mock("@/lib/db", () => ({ getDb: () => runtime.db }));

import {
  createFunnelAutomationRule,
  FunnelAutomationBusyError,
  FunnelAutomationConflictError,
  FunnelAutomationLinePushOwnerOnlyError,
  FunnelAutomationNotFoundError,
  listFunnelAutomationRules,
  setFunnelAutomationRuleEnabled,
  updateFunnelAutomationRule,
} from "./funnel-automation-service";

const managerContext = { auth: { user: { id: "user-1" }, member: { role: "owner" } }, vendor: { id: "vendor-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  runtime.manager.mockResolvedValue(managerContext);
  runtime.scope.mockResolvedValue({ projectId: "project-1", isAggregate: false, isLegacyWorkspace: false, projectName: "Project" });
  runtime.db.landingPage.findFirst.mockResolvedValue({ id: "page-1" });
  runtime.db.automationRule.findMany.mockResolvedValue([]);
});

describe("funnel automation service", () => {
  it("rejects a missing membership before reading the scoped page", async () => {
    runtime.manager.mockResolvedValue({ ...managerContext, auth: { ...managerContext.auth, member: null } });
    await expect(listFunnelAutomationRules({ pageId: "page-1" }, runtime.db as never)).rejects.toThrow();
    expect(runtime.scope).not.toHaveBeenCalled();
    expect(runtime.db.landingPage.findFirst).not.toHaveBeenCalled();
    expect(runtime.audit).not.toHaveBeenCalled();
  });

  it("lists only rules owned by the selected project page and hides invalid stored actions", async () => {
    runtime.db.automationRule.findMany.mockResolvedValue([
      { id: "rule-1", name: "已報名", isActive: true, version: 2, actions: [{ type: "add_customer_tag", tag: "講座已報名" }], updatedAt: new Date("2026-09-17T00:00:00.000Z") },
      { id: "rule-2", name: "無效", isActive: true, version: 1, actions: [{ type: "line_push", message: "不可用" }], updatedAt: new Date() },
    ]);

    await expect(listFunnelAutomationRules({ pageId: "page-1" }, runtime.db as never)).resolves.toEqual([
      { id: "rule-1", name: "已報名", tag: "講座已報名", isActive: true, version: 2, updatedAt: "2026-09-17T00:00:00.000Z", linePushOwnerOnly: false },
    ]);
    expect(runtime.db.landingPage.findFirst).toHaveBeenCalledWith({
      where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1", archivedAt: null },
      select: { id: true },
    });
    expect(runtime.db.automationRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1", funnelPageId: "page-1", trigger: "form_registered" },
      // The steps' actions (bound to the vendor) only flag a LINE push for a non-owner.
      select: expect.objectContaining({ steps: { where: { vendorId: "vendor-1" }, select: { actions: true } } }),
    }));
  });

  it("creates only the MVP form_registered tag rule inside the scoped funnel", async () => {
    const created = { id: "rule-1", name: "九月報名", isActive: true, version: 1, actions: [{ type: "add_customer_tag", tag: "九月講座" }], updatedAt: new Date("2026-09-17T00:00:00.000Z") };
    runtime.db.automationRule.create.mockResolvedValue(created);

    await expect(createFunnelAutomationRule({ pageId: "page-1", name: "九月報名", tag: "九月講座" }, runtime.db as never)).resolves.toMatchObject({ id: "rule-1", tag: "九月講座" });
    expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        funnelPageId: "page-1",
        trigger: "form_registered",
        condition: { type: "always" },
        actions: [{ type: "add_customer_tag", tag: "九月講座" }],
      }),
    }));
    expect(runtime.audit).toHaveBeenCalled();
  });

  it("uses version compare-and-swap for edits and returns a conflict without overwriting a newer rule", async () => {
    runtime.db.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(runtime.db));
    runtime.db.$queryRaw.mockResolvedValue([{ id: "rule-1" }]);
    runtime.db.automationRule.updateMany.mockResolvedValue({ count: 0 });
    runtime.db.automationRule.findFirst.mockResolvedValue({ id: "rule-1" });

    await expect(updateFunnelAutomationRule({ pageId: "page-1", ruleId: "rule-1", version: 4, name: "新版", tag: "新版標籤" }, runtime.db as never)).rejects.toBeInstanceOf(FunnelAutomationConflictError);
    expect(runtime.db.automationRule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "rule-1", vendorId: "vendor-1", funnelPageId: "page-1", version: 4 }),
      data: expect.objectContaining({ version: { increment: 1 } }),
    }));
    // The edit now locks the rule (bound to the vendor) before the CAS, like every other writer.
    const [lockSql, ...lockValues] = runtime.db.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(lockSql.join("?")).toMatch(/FROM "AutomationRule" WHERE "id" = \? AND "vendorId" = \? FOR UPDATE/u);
    expect(lockValues).toEqual(["rule-1", "vendor-1"]);
    expect(runtime.db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(runtime.db.automationRule.updateMany.mock.invocationCallOrder[0]!);
  });

  it("uses the same page-scoped CAS for enable and disable", async () => {
    runtime.db.automationRule.updateMany.mockResolvedValue({ count: 1 });
    runtime.db.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(runtime.db));
    runtime.db.$queryRaw.mockResolvedValue([{ id: "rule-1" }]);
    runtime.db.delayedStepRun.updateMany.mockResolvedValue({ count: 2 });

    await expect(setFunnelAutomationRuleEnabled({ pageId: "page-1", ruleId: "rule-1", version: 2, isActive: false }, runtime.db as never)).resolves.toBeUndefined();
    expect(runtime.db.automationRule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "rule-1", funnelPageId: "page-1", version: 2 }),
      data: { isActive: false, version: { increment: 1 } },
    }));
    // Switching off locks the rule (bound to the vendor) and stops its delayed-step runs (F-4 M1).
    const [lockSql, ...lockValues] = runtime.db.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(lockSql.join("?")).toMatch(/FROM "AutomationRule" WHERE "id" = \? AND "vendorId" = \? FOR UPDATE/u);
    expect(lockValues).toEqual(["rule-1", "vendor-1"]);
    expect(runtime.db.delayedStepRun.updateMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", automationRuleId: "rule-1", status: "active" },
      data: { status: "cancelled", cancelReason: "definition_paused", nextRunAt: null, claimedAt: null },
    });
    runtime.db.delayedStepRun.updateMany.mockClear();
    await expect(setFunnelAutomationRuleEnabled({ pageId: "page-1", ruleId: "rule-1", version: 3, isActive: true }, runtime.db as never)).resolves.toBeUndefined();
    expect(runtime.db.delayedStepRun.updateMany).not.toHaveBeenCalled();
  });

  it("bounds the wait for the rule lock and reports a held rule as busy", async () => {
    runtime.db.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(runtime.db));
    runtime.db.$queryRaw.mockResolvedValue([{ id: "rule-1" }]);
    runtime.db.automationRule.updateMany.mockResolvedValue({ count: 1 });
    await setFunnelAutomationRuleEnabled({ pageId: "page-1", ruleId: "rule-1", version: 2, isActive: true }, runtime.db as never);
    const [setLocal] = runtime.db.$executeRaw.mock.calls[0] as [TemplateStringsArray];
    expect(setLocal.join("?")).toBe("SET LOCAL lock_timeout = '5s'");
    expect(runtime.db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(runtime.db.$queryRaw.mock.invocationCallOrder[0]!);
    for (const error of [
      new Prisma.PrismaClientKnownRequestError("canceling statement due to lock timeout", { code: "P2010", clientVersion: Prisma.prismaVersion.client, meta: { code: "55P03" } }),
      new Prisma.PrismaClientKnownRequestError("Transaction API error", { code: "P2028", clientVersion: Prisma.prismaVersion.client }),
    ]) {
      runtime.db.$transaction.mockRejectedValueOnce(error);
      await expect(setFunnelAutomationRuleEnabled({ pageId: "page-1", ruleId: "rule-1", version: 2, isActive: false }, runtime.db as never)).rejects.toBeInstanceOf(FunnelAutomationBusyError);
    }
    runtime.db.$transaction.mockRejectedValueOnce(new Error("connection lost"));
    await expect(setFunnelAutomationRuleEnabled({ pageId: "page-1", ruleId: "rule-1", version: 2, isActive: false }, runtime.db as never)).rejects.toThrow("connection lost");
  });

  describe("owner-only LINE push (owner decision 2026-11-14)", () => {
    const asAdmin = () => runtime.manager.mockResolvedValue({ ...managerContext, auth: { ...managerContext.auth, member: { role: "admin" } } });
    const tagRule = { id: "rule-1", name: "已報名", isActive: false, version: 2, actions: [{ type: "add_customer_tag", tag: "講座已報名" }], updatedAt: new Date("2026-09-17T00:00:00.000Z") };
    // A funnel rule's immediate action is always a tag; a LINE push can only come from a delayed step added in /settings/automations.
    const withLineStep = { actions: tagRule.actions, steps: [{ actions: [{ type: "add_customer_tag", tag: "x" }] }, { actions: [{ type: "line_push", message: "第二天" }] }] };
    const inTransaction = () => {
      runtime.db.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(runtime.db));
      runtime.db.$queryRaw.mockResolvedValue([{ id: "rule-1" }]);
      runtime.db.automationRule.updateMany.mockResolvedValue({ count: 1 });
      runtime.db.delayedStepRun.updateMany.mockResolvedValue({ count: 0 });
    };

    it.each([["admin", true], ["owner", false]] as const)("flags a rule with a LINE push step as owner-only for an %s: %s", async (role, flagged) => {
      if (role === "admin") asAdmin();
      runtime.db.automationRule.findMany.mockResolvedValue([{ ...tagRule, steps: withLineStep.steps }, { ...tagRule, id: "rule-2", steps: [] }]);
      const rules = await listFunnelAutomationRules({ pageId: "page-1" }, runtime.db as never);
      expect(rules.map((rule) => [rule.id, rule.linePushOwnerOnly])).toEqual([["rule-1", flagged], ["rule-2", false]]);
    });

    it("refuses an admin's edit of a rule with a LINE push after the lock, writing nothing", async () => {
      asAdmin();
      inTransaction();
      runtime.db.automationRule.findFirst.mockResolvedValue(withLineStep);
      await expect(updateFunnelAutomationRule({ pageId: "page-1", ruleId: "rule-1", version: 2, name: "新名稱", tag: "新標籤" }, runtime.db as never)).rejects.toBeInstanceOf(FunnelAutomationLinePushOwnerOnlyError);
      expect(runtime.db.automationRule.findFirst).toHaveBeenCalledWith({
        // Scoped like the CAS: this page's form_registered rules only (NIT-2).
        where: { id: "rule-1", vendorId: "vendor-1", funnelPageId: "page-1", trigger: "form_registered" },
        select: { actions: true, steps: { where: { vendorId: "vendor-1" }, select: { actions: true } } },
      });
      expect(runtime.db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(runtime.db.automationRule.findFirst.mock.invocationCallOrder[0]!);
      expect(runtime.db.automationRule.updateMany).not.toHaveBeenCalled();
      expect(runtime.audit).not.toHaveBeenCalled();
    });

    it("refuses an admin switching on a rule with a LINE push, and lets them switch it off", async () => {
      asAdmin();
      inTransaction();
      runtime.db.automationRule.findFirst.mockResolvedValue(withLineStep);
      await expect(setFunnelAutomationRuleEnabled({ pageId: "page-1", ruleId: "rule-1", version: 2, isActive: true }, runtime.db as never)).rejects.toBeInstanceOf(FunnelAutomationLinePushOwnerOnlyError);
      expect(runtime.db.automationRule.updateMany).not.toHaveBeenCalled();
      expect(runtime.audit).not.toHaveBeenCalled();

      runtime.db.automationRule.findFirst.mockClear();
      await expect(setFunnelAutomationRuleEnabled({ pageId: "page-1", ruleId: "rule-1", version: 2, isActive: false }, runtime.db as never)).resolves.toBeUndefined();
      expect(runtime.db.automationRule.findFirst).not.toHaveBeenCalled();
      expect(runtime.db.automationRule.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false, version: { increment: 1 } } }));
    });

    it("lets an admin edit and switch on a rule without a LINE push", async () => {
      asAdmin();
      inTransaction();
      runtime.db.automationRule.findFirst.mockResolvedValue({ actions: tagRule.actions, steps: [{ actions: [{ type: "send_email_notification", template: "class_reminder" }] }] });
      await expect(updateFunnelAutomationRule({ pageId: "page-1", ruleId: "rule-1", version: 2, name: "新名稱", tag: "新標籤" }, runtime.db as never)).resolves.toBeUndefined();
      await expect(setFunnelAutomationRuleEnabled({ pageId: "page-1", ruleId: "rule-1", version: 3, isActive: true }, runtime.db as never)).resolves.toBeUndefined();
      expect(runtime.db.automationRule.updateMany).toHaveBeenCalledTimes(2);
    });

    it("lets the owner edit and switch on a rule with a LINE push without reading its actions", async () => {
      inTransaction();
      await expect(updateFunnelAutomationRule({ pageId: "page-1", ruleId: "rule-1", version: 2, name: "新名稱", tag: "新標籤" }, runtime.db as never)).resolves.toBeUndefined();
      await expect(setFunnelAutomationRuleEnabled({ pageId: "page-1", ruleId: "rule-1", version: 3, isActive: true }, runtime.db as never)).resolves.toBeUndefined();
      expect(runtime.db.automationRule.findFirst).not.toHaveBeenCalled();
      expect(runtime.db.automationRule.updateMany).toHaveBeenCalledTimes(2);
    });

    it("lets an admin create the funnel's tag rule", async () => {
      asAdmin();
      runtime.db.automationRule.create.mockResolvedValue({ ...tagRule, isActive: true });
      await expect(createFunnelAutomationRule({ pageId: "page-1", name: "九月報名", tag: "講座已報名" }, runtime.db as never)).resolves.toMatchObject({ id: "rule-1", linePushOwnerOnly: false });
    });
  });

  it("bounds the edit's wait for the rule lock and reports a held rule as busy, writing nothing (MINOR-1)", async () => {
    runtime.db.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(runtime.db));
    runtime.db.$queryRaw.mockResolvedValue([{ id: "rule-1" }]);
    runtime.db.automationRule.updateMany.mockResolvedValue({ count: 1 });
    await updateFunnelAutomationRule({ pageId: "page-1", ruleId: "rule-1", version: 2, name: "新版", tag: "新標籤" }, runtime.db as never);
    // SET LOCAL lock_timeout runs on the transaction client before the FOR UPDATE.
    const [setLocal] = runtime.db.$executeRaw.mock.calls[0] as [TemplateStringsArray];
    expect(setLocal.join("?")).toBe("SET LOCAL lock_timeout = '5s'");
    expect(runtime.db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(runtime.db.$queryRaw.mock.invocationCallOrder[0]!);
    expect(runtime.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5_000, timeout: 15_000 });
    runtime.db.automationRule.updateMany.mockClear();
    runtime.audit.mockClear();
    for (const error of [
      new Prisma.PrismaClientKnownRequestError("canceling statement due to lock timeout", { code: "P2010", clientVersion: Prisma.prismaVersion.client, meta: { code: "55P03" } }),
      new Prisma.PrismaClientKnownRequestError("Transaction API error", { code: "P2028", clientVersion: Prisma.prismaVersion.client }),
    ]) {
      runtime.db.$transaction.mockRejectedValueOnce(error);
      await expect(updateFunnelAutomationRule({ pageId: "page-1", ruleId: "rule-1", version: 2, name: "新版", tag: "新標籤" }, runtime.db as never)).rejects.toBeInstanceOf(FunnelAutomationBusyError);
    }
    runtime.db.$transaction.mockRejectedValueOnce(new Error("connection lost"));
    await expect(updateFunnelAutomationRule({ pageId: "page-1", ruleId: "rule-1", version: 2, name: "新版", tag: "新標籤" }, runtime.db as never)).rejects.toThrow("connection lost");
    expect(runtime.db.automationRule.updateMany).not.toHaveBeenCalled();
    expect(runtime.audit).not.toHaveBeenCalled();
  });

  it("does not reveal or mutate a page outside the selected project", async () => {
    runtime.db.landingPage.findFirst.mockResolvedValue(null);
    await expect(listFunnelAutomationRules({ pageId: "page-other" }, runtime.db as never)).rejects.toBeInstanceOf(FunnelAutomationNotFoundError);
    expect(runtime.db.automationRule.findMany).not.toHaveBeenCalled();
  });
});
