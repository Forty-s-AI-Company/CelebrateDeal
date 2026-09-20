import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  security: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setEnabled: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: runtime.security }));
vi.mock("@/lib/funnel-automation-service", () => {
  class FunnelAutomationInputError extends Error {}
  class FunnelAutomationScopeError extends Error {}
  class FunnelAutomationNotFoundError extends Error {}
  class FunnelAutomationConflictError extends Error {}
  return {
    listFunnelAutomationRules: runtime.list,
    createFunnelAutomationRule: runtime.create,
    updateFunnelAutomationRule: runtime.update,
    setFunnelAutomationRuleEnabled: runtime.setEnabled,
    FunnelAutomationInputError,
    FunnelAutomationScopeError,
    FunnelAutomationNotFoundError,
    FunnelAutomationConflictError,
  };
});

import {
  createFunnelAutomationRuleAction,
  listFunnelAutomationRulesAction,
  setFunnelAutomationRuleEnabledAction,
  updateFunnelAutomationRuleAction,
} from "./funnel-automation-actions";

function form(values: Record<string, string>) {
  const result = new FormData();
  Object.entries(values).forEach(([key, value]) => result.set(key, value));
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.list.mockResolvedValue([{ id: "rule-1", name: "報名", tag: "已報名", isActive: true, version: 1, updatedAt: "2026-09-17T00:00:00.000Z" }]);
});

describe("funnel automation actions", () => {
  it("protects the self-loaded rules list with the supplied CSRF form token", async () => {
    await expect(listFunnelAutomationRulesAction(form({ pageId: "page-1", _csrf: "csrf" }))).resolves.toMatchObject({ status: "success", rules: [{ id: "rule-1" }] });
    expect(runtime.security).toHaveBeenCalled();
    expect(runtime.list).toHaveBeenCalledWith({ pageId: "page-1" });
  });

  it("creates a rule and returns a fresh minimal list without invalidating the parent editor", async () => {
    await expect(createFunnelAutomationRuleAction(form({ pageId: "page-1", name: "九月報名", tag: "九月講座", _csrf: "csrf" }))).resolves.toMatchObject({ status: "success", rules: [{ tag: "已報名" }] });
    expect(runtime.create).toHaveBeenCalledWith({ pageId: "page-1", name: "九月報名", tag: "九月講座" });
    expect(runtime.list).toHaveBeenCalledWith({ pageId: "page-1" });
  });

  it("passes the expected version to update and enable state changes", async () => {
    await updateFunnelAutomationRuleAction(form({ pageId: "page-1", ruleId: "rule-1", version: "3", name: "新版", tag: "新標籤", _csrf: "csrf" }));
    await setFunnelAutomationRuleEnabledAction(form({ pageId: "page-1", ruleId: "rule-1", version: "4", isActive: "false", _csrf: "csrf" }));
    expect(runtime.update).toHaveBeenCalledWith({ pageId: "page-1", ruleId: "rule-1", version: 3, name: "新版", tag: "新標籤" });
    expect(runtime.setEnabled).toHaveBeenCalledWith({ pageId: "page-1", ruleId: "rule-1", version: 4, isActive: false });
  });

  it("returns a visible input error before an invalid enable operation reaches the service", async () => {
    await expect(setFunnelAutomationRuleEnabledAction(form({ pageId: "page-1", ruleId: "rule-1", version: "1", isActive: "yes", _csrf: "csrf" }))).resolves.toMatchObject({ status: "error", message: expect.stringContaining("格式") });
    expect(runtime.setEnabled).not.toHaveBeenCalled();
  });
});
