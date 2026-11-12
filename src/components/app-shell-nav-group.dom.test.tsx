// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import { AppShellNavGroup } from "./app-shell-nav-group";
import { NAV_GROUP_STORAGE_KEY, resetNavGroupMemory } from "@/lib/nav-group-state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function group(defaultOpen: boolean) {
  return (
    <AppShellNavGroup label="夥伴成長" hrefs={["/affiliates", "/team-performance"]} defaultOpen={defaultOpen}>
      <span>推廣夥伴</span>
    </AppShellNavGroup>
  );
}
async function render(defaultOpen: boolean) {
  await act(async () => { root.render(group(defaultOpen)); });
}
const header = () => container.querySelector<HTMLButtonElement>("button")!;
const panel = () => container.querySelector<HTMLElement>("div[id]")!;

beforeEach(() => {
  navigation.pathname = "/dashboard";
  window.localStorage.clear();
  resetNavGroupMemory();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("AppShellNavGroup", () => {
  it("starts at the default open state and links the header to its panel", async () => {
    await render(false);
    expect(header().getAttribute("aria-expanded")).toBe("false");
    expect(panel().hidden).toBe(true);
    expect(header().getAttribute("aria-controls")).toBe(panel().id);
    await render(true);
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(panel().hidden).toBe(false);
  });

  it("remembers a toggle in localStorage and restores it over the default on the next mount", async () => {
    await render(false);
    await act(async () => { header().click(); });
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(JSON.parse(window.localStorage.getItem(NAV_GROUP_STORAGE_KEY)!)).toEqual({ 夥伴成長: true });

    act(() => root.unmount());
    resetNavGroupMemory();
    root = createRoot(container);
    await render(false);
    expect(header().getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the group holding the current page open and ignores a stored collapse", async () => {
    window.localStorage.setItem(NAV_GROUP_STORAGE_KEY, JSON.stringify({ 夥伴成長: false }));
    navigation.pathname = "/team-performance";
    await render(false);
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(panel().hidden).toBe(false);
    await act(async () => { header().click(); });
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(window.localStorage.getItem(NAV_GROUP_STORAGE_KEY)).toBe(JSON.stringify({ 夥伴成長: false }));
  });

  it("falls back to the default when localStorage cannot be read, and still toggles in memory", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    await render(false);
    expect(header().getAttribute("aria-expanded")).toBe("false");
    await act(async () => { header().click(); });
    expect(header().getAttribute("aria-expanded")).toBe("true");
  });

  it("ignores corrupt or wrongly typed stored data", async () => {
    window.localStorage.setItem(NAV_GROUP_STORAGE_KEY, "{not json");
    await render(false);
    expect(header().getAttribute("aria-expanded")).toBe("false");
    window.localStorage.setItem(NAV_GROUP_STORAGE_KEY, JSON.stringify({ 夥伴成長: "yes" }));
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: NAV_GROUP_STORAGE_KEY })); });
    expect(header().getAttribute("aria-expanded")).toBe("false");
  });
});
