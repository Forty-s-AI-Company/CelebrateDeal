import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  manager: vi.fn(),
  scope: vi.fn(),
  audit: vi.fn(),
  snapshot: vi.fn((value: unknown) => value),
  db: {
    landingPage: { findFirst: vi.fn() },
    automationRule: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: runtime.manager }));
vi.mock("@/lib/sales-project-scope", () => ({ requireEditableSalesProjectScope: runtime.scope }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: runtime.audit, auditSnapshot: runtime.snapshot }));
vi.mock("@/lib/db", () => ({ getDb: () => runtime.db }));

import {
  createFunnelAutomationRule,
  FunnelAutomationConflictError,
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
      { id: "rule-1", name: "已報名", tag: "講座已報名", isActive: true, version: 2, updatedAt: "2026-09-17T00:00:00.000Z" },
    ]);
    expect(runtime.db.landingPage.findFirst).toHaveBeenCalledWith({
      where: { id: "page-1", vendorId: "vendor-1", projectId: "project-1" },
      select: { id: true },
    });
    expect(runtime.db.automationRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1", funnelPageId: "page-1", trigger: "form_registered" },
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
    runtime.db.automationRule.updateMany.mockResolvedValue({ count: 0 });
    runtime.db.automationRule.findFirst.mockResolvedValue({ id: "rule-1" });

    await expect(updateFunnelAutomationRule({ pageId: "page-1", ruleId: "rule-1", version: 4, name: "新版", tag: "新版標籤" }, runtime.db as never)).rejects.toBeInstanceOf(FunnelAutomationConflictError);
    expect(runtime.db.automationRule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "rule-1", vendorId: "vendor-1", funnelPageId: "page-1", version: 4 }),
      data: expect.objectContaining({ version: { increment: 1 } }),
    }));
  });

  it("uses the same page-scoped CAS for enable and disable", async () => {
    runtime.db.automationRule.updateMany.mockResolvedValue({ count: 1 });

    await expect(setFunnelAutomationRuleEnabled({ pageId: "page-1", ruleId: "rule-1", version: 2, isActive: false }, runtime.db as never)).resolves.toBeUndefined();
    expect(runtime.db.automationRule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "rule-1", funnelPageId: "page-1", version: 2 }),
      data: { isActive: false, version: { increment: 1 } },
    }));
  });

  it("does not reveal or mutate a page outside the selected project", async () => {
    runtime.db.landingPage.findFirst.mockResolvedValue(null);
    await expect(listFunnelAutomationRules({ pageId: "page-other" }, runtime.db as never)).rejects.toBeInstanceOf(FunnelAutomationNotFoundError);
    expect(runtime.db.automationRule.findMany).not.toHaveBeenCalled();
  });
});
