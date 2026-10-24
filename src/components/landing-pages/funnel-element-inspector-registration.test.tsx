// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FunnelElementInspector } from "@/components/landing-pages/funnel-element-inspector";
import { FunnelRegistrationLinkProvider } from "@/components/landing-pages/funnel-registration-links";
import type { FunnelNode } from "@/lib/funnel-page-document";
import type { FunnelRegistrationLinks } from "@/lib/funnel-registration-action";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

const forms = [{ id: "form_1", slug: "webinar-signup", name: "講座報名" }, { id: "form_2", slug: "vip", name: "VIP 報名" }];
const button = (actions: FunnelNode["actions"] = []): FunnelNode => ({ schemaVersion: 1, id: "cta_button", type: "button", props: { label: "立即報名" }, style: {}, overrides: {}, visible: true, actions, attributes: {} });

async function mount(node: FunnelNode, onCommand = vi.fn(), links: FunnelRegistrationLinks = { forms }) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<FunnelRegistrationLinkProvider value={links}><FunnelElementInspector node={node} onCommand={onCommand} /></FunnelRegistrationLinkProvider>));
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

  it("offers only the bound live's form, and says why", async () => {
    const { container, onCommand } = await mount(button(), vi.fn(), { forms, live: { id: "live_1", formId: "form_2", title: "秋季直播" } });
    await choose(selectByLabel(container, "點擊後動作"), "registration");
    expect(container.textContent).toContain("這個頁面已綁定活動場次，所有報名按鈕都必須使用該場次的報名表。（目前場次：秋季直播）");
    expect(Array.from(selectByLabel(container, "選擇報名表").options).map((option) => option.textContent)).toEqual(["請選擇", "VIP 報名"]);
    expect(container.textContent).toContain("報名連結帶入頁面綁定的活動場次");
    expect(container.textContent).not.toContain("場次使用同一份報名表時");
    await choose(selectByLabel(container, "選擇報名表"), "form_2");
    await act(async () => applyButton(container).click());
    expect(onCommand).toHaveBeenCalledWith({ type: "update", nodeId: "cta_button", patch: { actions: [{ type: "registration", formId: "form_2", useBoundLive: true }] } });
  });

  it("flags a stored form that conflicts with the bound live and blocks applying it", async () => {
    const { container } = await mount(button([{ type: "registration", formId: "form_1", useBoundLive: true }]), vi.fn(), { forms, live: { id: "live_1", formId: "form_2" } });
    expect(container.textContent).toContain("這份報名表不是頁面綁定場次的報名表，請重新選擇");
    expect(applyButton(container).disabled).toBe(true);
  });

  it("explains when the bound live has no usable form", async () => {
    const { container } = await mount(button(), vi.fn(), { forms, live: { id: "live_1" } });
    await choose(selectByLabel(container, "點擊後動作"), "registration");
    expect(selectByLabel(container, "選擇報名表").disabled).toBe(true);
    expect(container.textContent).toContain("頁面綁定的活動場次沒有可用的報名表");
  });

  it("flags a stored form that is no longer offered and blocks applying it", async () => {
    const { container } = await mount(button([{ type: "registration", formId: "deactivated_form", useBoundLive: true }]));
    const formSelect = selectByLabel(container, "選擇報名表");
    expect(formSelect.value).toBe("deactivated_form");
    expect(container.textContent).toContain("原報名表已停用或不屬於此專案，請重新選擇");
    expect(applyButton(container).disabled).toBe(true);
  });
});
