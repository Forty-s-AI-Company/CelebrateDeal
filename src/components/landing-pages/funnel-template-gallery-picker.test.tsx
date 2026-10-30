// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filterStepTemplateOptions } from "@/lib/funnel-step-template-options-meta";
import { listStepTemplateOptions } from "@/lib/funnel-step-template-options";
import { previewFunnelTemplate } from "@/lib/funnel-template-gallery";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/app/actions/landing-page-template-actions", () => ({ readStepTemplatePreviewAction: mocks.read }));

import { FunnelTemplateGalleryPicker } from "./funnel-template-gallery-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
beforeEach(() => vi.clearAllMocks());

const templates = filterStepTemplateOptions(listStepTemplateOptions("audience"), "opt_in_page");
const first = templates[0]!;

async function mount(props: Partial<Parameters<typeof FunnelTemplateGalleryPicker>[0]> = {}) {
  const onApply = vi.fn();
  const onSelect = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<FunnelTemplateGalleryPicker templates={templates} goal="audience" stepType="opt_in_page" selectedId={first.id} onSelect={onSelect} onApply={onApply} {...props} />));
  cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
  return { container, onApply, onSelect };
}
const cards = (scope: ParentNode) => Array.from(scope.querySelectorAll<HTMLElement>(":scope > div > div > article"));
const buttons = (scope: ParentNode, name: string) => Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).filter((item) => item.textContent?.trim() === name);
const click = async (element: HTMLElement) => { await act(async () => element.click()); };

describe("step template picker", () => {
  it("renders every card from metadata and thumbnails, without reading any template document", async () => {
    const { container } = await mount();
    expect(templates.length).toBeGreaterThan(1);
    expect(cards(container)).toHaveLength(templates.length);
    for (const template of templates) expect(container.textContent).toContain(template.name);
    expect(cards(container).every((card) => card.querySelector("[data-funnel-renderer]"))).toBe(true);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(buttons(container, "完整預覽")).toHaveLength(templates.length);
  });

  it("shows the empty state when no template fits", async () => {
    const { container } = await mount({ templates: [] });
    expect(container.querySelector("[role=status]")?.textContent).toContain("還沒有可用模板");
  });

  it("selects a card and applies from the card without a server read", async () => {
    const { container, onApply, onSelect } = await mount();
    await click(cards(container)[1]!.querySelector<HTMLButtonElement>("button[aria-pressed]")!);
    expect(onSelect).toHaveBeenCalledWith(templates[1]!.id);
    await click(buttons(container, "套用模板")[0]!);
    expect(onApply).toHaveBeenCalledWith(first.id);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("loads the full document from the server when previewing, then applies from the dialog", async () => {
    mocks.read.mockResolvedValue({ ok: true, document: previewFunnelTemplate(first.id, `gallery_preview_${first.id}`) });
    const { container, onApply } = await mount();
    await click(buttons(container, "完整預覽")[0]!);
    expect(mocks.read).toHaveBeenCalledWith({ goal: "audience", stepType: "opt_in_page", templateId: first.id });
    const dialog = document.body.querySelector("[role=dialog]")!;
    expect(dialog.textContent).toContain(first.name);
    await click(buttons(dialog, "套用這個模板")[0]!);
    expect(onApply).toHaveBeenCalledWith(first.id);
    await click(buttons(dialog, "關閉")[0]!);
    expect(document.body.querySelector("[role=dialog]")).toBeNull();
  });

  it("reports a refused or failed preview read without opening a dialog", async () => {
    mocks.read.mockResolvedValueOnce({ ok: false, message: "找不到這個範本，或你沒有使用它的權限。" });
    const { container } = await mount();
    await click(buttons(container, "完整預覽")[0]!);
    expect(container.querySelector("[role=alert]")?.textContent).toBe("找不到這個範本，或你沒有使用它的權限。");
    expect(document.body.querySelector("[role=dialog]")).toBeNull();
    mocks.read.mockRejectedValueOnce(new Error("network"));
    await click(buttons(container, "完整預覽")[0]!);
    expect(container.querySelector("[role=alert]")?.textContent).toBe("無法讀取模板內容，請稍後再試。");
    expect(document.body.querySelector("[role=dialog]")).toBeNull();
  });

  it("shows the apply error reported by the owner of the apply flow", async () => {
    const { container } = await mount({ applyError: "模板目前無法套用，畫布內容沒有變更，請稍後再試。" });
    expect(container.querySelector("[role=alert]")?.textContent).toContain("畫布內容沒有變更");
  });

  it("disables every action while an apply is running", async () => {
    const { container } = await mount({ disabled: true });
    for (const item of [...buttons(container, "完整預覽"), ...buttons(container, "套用中…"), ...buttons(container, "套用模板")]) expect(item.disabled).toBe(true);
  });
});
