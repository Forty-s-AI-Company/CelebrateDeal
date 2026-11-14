// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setEnabled: vi.fn(),
}));

vi.mock("@/app/actions/funnel-automation-actions", () => ({
  listFunnelAutomationRulesAction: actions.list,
  createFunnelAutomationRuleAction: actions.create,
  updateFunnelAutomationRuleAction: actions.update,
  setFunnelAutomationRuleEnabledAction: actions.setEnabled,
}));

import { FunnelAutomationSettings } from "./funnel-automation-settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const base = { tag: "已報名", version: 1, updatedAt: "2026-11-14T00:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderWith(rules: unknown[]) {
  actions.list.mockResolvedValue({ status: "success", message: "", rules });
  await act(async () => {
    root.render(<FunnelAutomationSettings pageId="page-1" csrfName="_csrf" csrfToken="synthetic-token" />);
  });
  // The editor self-loads its rules after the first commit (setTimeout 0, then a transition).
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

function article(name: string) {
  return [...container.querySelectorAll("article")].find((node) => node.querySelector<HTMLInputElement>('input[name="name"]')?.defaultValue === name)!;
}
const buttons = (node: Element) => [...node.querySelectorAll("button")].map((button) => button.textContent);

// Owner decision 2026-11-14: a rule with a custom LINE push (a delayed step
// added in /settings/automations) is read-only for a non-owner, except
// switching it off. The service sets linePushOwnerOnly from the viewer's role.
describe("FunnelAutomationSettings owner-only LINE push", () => {
  it("shows a LINE push rule read-only to a non-owner, keeping only the switch-off button", async () => {
    await renderWith([
      { ...base, id: "on", name: "推播啟用中", isActive: true, linePushOwnerOnly: true },
      { ...base, id: "off", name: "推播已停用", isActive: false, linePushOwnerOnly: true },
      { ...base, id: "plain", name: "一般規則", isActive: false, linePushOwnerOnly: false },
    ]);
    expect(actions.list).toHaveBeenCalledTimes(1);

    const on = article("推播啟用中");
    expect(on.textContent).toContain("這條規則含 LINE 推播，LINE 推播僅限擁有者設定：你只能停用它。");
    expect([...on.querySelectorAll<HTMLInputElement>('input[name="name"], input[name="tag"]')].every((input) => input.disabled)).toBe(true);
    expect(buttons(on)).toEqual(["停用規則"]);

    const off = article("推播已停用");
    expect(off.textContent).toContain("LINE 推播僅限擁有者設定");
    expect(buttons(off)).toEqual([]);

    const plain = article("一般規則");
    expect(plain.textContent).not.toContain("LINE 推播");
    expect(buttons(plain)).toEqual(["儲存變更", "啟用規則"]);
    expect([...plain.querySelectorAll<HTMLInputElement>('input[name="name"], input[name="tag"]')].some((input) => input.disabled)).toBe(false);
  });

  it("leaves the owner every control of a LINE push rule", async () => {
    await renderWith([{ ...base, id: "off", name: "推播已停用", isActive: false, linePushOwnerOnly: false }]);
    const off = article("推播已停用");
    expect(off.textContent).not.toContain("LINE 推播");
    expect(buttons(off)).toEqual(["儲存變更", "啟用規則"]);
  });
});
