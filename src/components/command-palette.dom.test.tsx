// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { CommandPalette } from "./command-palette";
import { navigationForRole, settingsHubForRole } from "@/lib/app-navigation";
import { paletteEntriesFromNavigation } from "@/lib/command-palette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const entriesFor = (role: string) => paletteEntriesFromNavigation(navigationForRole(role), settingsHubForRole(role));

async function mount(role = "owner") {
  await act(async () => { root.render(<CommandPalette entries={entriesFor(role)} />); });
}
const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const input = () => document.body.querySelector<HTMLInputElement>('[role="combobox"]')!;
const options = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
const optionLabels = () => options().map((option) => option.firstElementChild!.textContent);
const closeButton = () => document.body.querySelector<HTMLButtonElement>('button[aria-label="關閉搜尋"]')!;

async function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
}
async function type(value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function openWithClick() {
  await act(async () => { trigger().click(); });
}

beforeEach(() => {
  router.push.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

describe("CommandPalette", () => {
  it("shows a trigger with the shortcut and toggles on Ctrl+K and Meta+K", async () => {
    await mount();
    expect(trigger().textContent).toContain("搜尋頁面");
    expect(trigger().getAttribute("aria-keyshortcuts")).toBe("Control+K Meta+K");
    expect(trigger().querySelector("kbd")?.textContent).toMatch(/Ctrl K|⌘K/u);
    expect(dialog()).toBeNull();
    await press(document, "k", { ctrlKey: true });
    expect(dialog()).not.toBeNull();
    await press(document, "k", { metaKey: true });
    expect(dialog()).toBeNull();
    await press(document, "K", { metaKey: true });
    expect(dialog()).not.toBeNull();
  });

  it("ignores a plain K and other modifier combinations", async () => {
    await mount();
    await press(document, "k");
    await press(document, "k", { ctrlKey: true, shiftKey: true });
    await press(document, "k", { ctrlKey: true, altKey: true });
    expect(dialog()).toBeNull();
  });

  it("exposes the WAI-ARIA combobox and listbox structure and focuses the input", async () => {
    await mount();
    await openWithClick();
    const listbox = document.body.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(dialog()!.getAttribute("aria-modal")).toBe("true");
    expect(dialog()!.getAttribute("aria-label")).toBeTruthy();
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(input().getAttribute("aria-autocomplete")).toBe("list");
    expect(input().getAttribute("aria-controls")).toBe(listbox.id);
    expect(options().length).toBeGreaterThan(5);
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0]!.id);
    expect(options().filter((option) => option.getAttribute("aria-selected") === "true")).toEqual([options()[0]]);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("moves the active option with ArrowDown and ArrowUp, wrapping at both ends, without moving focus", async () => {
    await mount();
    await openWithClick();
    const last = options().length - 1;
    await press(input(), "ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[1]!.id);
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    await press(input(), "ArrowUp");
    await press(input(), "ArrowUp");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[last]!.id);
    await press(input(), "ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0]!.id);
    expect(document.activeElement).toBe(input());
  });

  it("filters by substring and navigates to the active option on Enter", async () => {
    await mount();
    await openWithClick();
    await type("訂單");
    expect(optionLabels()[0]).toBe("訂單與履約");
    await press(input(), "Enter");
    expect(router.push).toHaveBeenCalledWith("/orders");
    expect(dialog()).toBeNull();
  });

  it("navigates to the option chosen with the arrow keys", async () => {
    await mount();
    await openWithClick();
    await type("管理");
    expect(options().length).toBeGreaterThan(1);
    await press(input(), "ArrowDown");
    const chosen = optionLabels()[1];
    await press(input(), "Enter");
    expect(router.push).toHaveBeenCalledTimes(1);
    const href = router.push.mock.calls[0]![0] as string;
    expect(entriesFor("owner").find((entry) => entry.href === href)?.label).toBe(chosen);
  });

  it("navigates when an option is clicked", async () => {
    await mount();
    await openWithClick();
    await type("學員");
    await act(async () => { options()[0]!.click(); });
    expect(router.push).toHaveBeenCalledWith("/customers");
  });

  it("announces an empty result and does nothing on Enter or arrows", async () => {
    await mount();
    await openWithClick();
    await type("不存在的頁面");
    expect(options()).toHaveLength(0);
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
    expect(document.body.querySelector('[role="status"]')?.textContent).toBe("找不到符合的頁面");
    await press(input(), "ArrowDown");
    await press(input(), "Enter");
    expect(router.push).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    await mount();
    trigger().focus();
    await openWithClick();
    expect(document.activeElement).toBe(input());
    await press(input(), "Escape");
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(document.body.style.overflow).toBe("");
  });

  it("closes from the close button and the backdrop, and resets the query when reopened", async () => {
    await mount();
    await openWithClick();
    await type("訂單");
    await act(async () => { closeButton().click(); });
    expect(dialog()).toBeNull();
    await openWithClick();
    expect(input().value).toBe("");
    await act(async () => { dialog()!.parentElement!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(dialog()).toBeNull();
  });

  it("keeps Tab inside the dialog", async () => {
    await mount();
    await openWithClick();
    closeButton().focus();
    await press(closeButton(), "Tab");
    expect(document.activeElement).toBe(input());
    await press(input(), "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(closeButton());
  });

  it("lists only pages the role may see", async () => {
    await mount("accountant");
    await openWithClick();
    const labels = optionLabels();
    expect(labels).toContain("帳單");
    for (const hidden of ["訂單與履約", "品牌設定", "LINE 整合", "報名管理"]) expect(labels).not.toContain(hidden);
    await type("訂單");
    expect(optionLabels()).not.toContain("訂單與履約");
  });

  it("does not register the shortcut for the secondary icon trigger", async () => {
    await act(async () => { root.render(<CommandPalette entries={entriesFor("owner")} variant="icon" registerShortcut={false} />); });
    expect(trigger().getAttribute("aria-label")).toBe("搜尋頁面");
    await press(document, "k", { ctrlKey: true });
    expect(dialog()).toBeNull();
    await openWithClick();
    expect(dialog()).not.toBeNull();
  });
});
