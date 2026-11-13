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
    $queryRaw: vi.fn(),
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
  deleteAutomationRuleAction,
  dryRunAutomationRuleAction,
  toggleAutomationRuleAction,
} from "./automation-actions";

function sessionFor(role: string) {
  const vendor = { id: "vendor-1", name: "商家一", tracking: null, suspendedAt: null };
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
  ["createAutomationRecipeAction", () => createAutomationRecipeAction(data({ recipeId: "consultation_confirmer" })), "updated=recipe_created"],
  ["dryRunAutomationRuleAction", () => dryRunAutomationRuleAction(data({ ruleId: "rule-1" })), "dryRun=would_dispatch"],
  ["toggleAutomationRuleAction", () => toggleAutomationRuleAction(data({ ruleId: "rule-1" })), "updated=toggled"],
  ["deleteAutomationRuleAction", () => deleteAutomationRuleAction(data({ ruleId: "rule-1" })), "updated=deleted"],
] as const;

function databaseCalls() {
  return [...Object.values(mocks.db.automationRule), ...Object.values(mocks.db.product), ...Object.values(mocks.db.automationExecutionLog), mocks.db.$queryRaw, mocks.db.$transaction]
    .reduce((total, method) => total + method.mock.calls.length, 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ get: (name: string) => (name === "__Host-celebrate_session" ? { value: "synthetic-session-token" } : undefined) });
  mocks.redirect.mockImplementation((path: string): never => { throw new Error(`redirect:${path}`); });
  mocks.db.automationRule.create.mockResolvedValue({ id: "rule-1", vendorId: "vendor-1" });
  mocks.db.automationRule.findFirst.mockResolvedValue({ id: "rule-1", name: "規則", trigger: "consultation_booked", isActive: false, funnelPageId: null, condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: "VIP" }], _count: { executionLogs: 0 } });
  mocks.db.automationRule.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.automationRule.delete.mockResolvedValue({ id: "rule-1" });
  mocks.db.automationExecutionLog.count.mockResolvedValue(0);
  mocks.db.$queryRaw.mockResolvedValue([{ id: "rule-1" }]);
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
      const firstQuery = [...mocks.db.automationRule.findFirst.mock.calls, ...mocks.db.automationRule.create.mock.calls][0]?.[0] as { where?: { vendorId?: string }; data?: { vendorId?: string } };
      expect(firstQuery.where?.vendorId ?? firstQuery.data?.vendorId).toBe("vendor-1");
      for (const [, ...values] of mocks.db.$queryRaw.mock.calls) expect(values).toContain("vendor-1");
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
