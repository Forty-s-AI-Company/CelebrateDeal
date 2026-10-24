// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FunnelElementInspector } from "@/components/landing-pages/funnel-element-inspector";
import { FunnelRegistrationLinkProvider } from "@/components/landing-pages/funnel-registration-links";
import type { FunnelNode } from "@/lib/funnel-page-document";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

const forms = [{ id: "form_1", slug: "webinar-signup", name: "講座報名" }, { id: "form_2", slug: "vip", name: "VIP 報名" }];
const button = (actions: FunnelNode["actions"] = []): FunnelNode => ({ schemaVersion: 1, id: "cta_button", type: "button", props: { label: "立即報名" }, style: {}, overrides: {}, visible: true, actions, attributes: {} });

async function mount(node: FunnelNode, onCommand = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<FunnelRegistrationLinkProvider value={{ forms }}><FunnelElementInspector node={node} onCommand={onCommand} /></FunnelRegistrationLinkProvider>));
  cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
  const toggle = container.querySelector<HTMLButtonElement>('[aria-controls="funnel-inspector-cta_button-actions"]')!;
  if (toggle.getAttribute("aria-expanded") === "false") await act(async () => toggle.click());
  return { container, onCommand };
}

const selectByLabel = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.startsWith(label))!.querySelector("select")!;
async function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  await act(async () => { setter.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); });
}
const applyButton = (container: HTMLElement) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "套用動作")!;

describe("button action picker: 開啟報名表", () => {
  it("lets the merchant bind a button to one of the project's forms", async () => {
    const { container, onCommand } = await mount(button());
    await choose(selectByLabel(container, "點擊後動作"), "registration");
    const formSelect = selectByLabel(container, "選擇報名表");
    expect(Array.from(formSelect.options).map((option) => option.textContent)).toEqual(["請選擇", "講座報名", "VIP 報名"]);
    expect(applyButton(container).disabled).toBe(true);
    await choose(formSelect, "form_2");
    await act(async () => applyButton(container).click());
    expect(onCommand).toHaveBeenCalledWith({ type: "update", nodeId: "cta_button", patch: { actions: [{ type: "registration", formId: "form_2", useBoundLive: true }] } });
  });

  it("flags a stored form that is no longer offered and blocks applying it", async () => {
    const { container } = await mount(button([{ type: "registration", formId: "deactivated_form", useBoundLive: true }]));
    const formSelect = selectByLabel(container, "選擇報名表");
    expect(formSelect.value).toBe("deactivated_form");
    expect(container.textContent).toContain("原報名表已停用或不屬於此專案，請重新選擇");
    expect(applyButton(container).disabled).toBe(true);
  });
});
