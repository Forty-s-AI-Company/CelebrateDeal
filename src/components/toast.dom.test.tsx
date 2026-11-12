// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TOAST_DURATION_MS, Toast, useToast, type ToastTone } from "./toast";

let container: HTMLDivElement;
let root: Root;
const handle: { current: ReturnType<typeof useToast> | null } = { current: null };

function Harness() {
  const api = useToast();
  useEffect(() => { handle.current = api; });
  return (
    <>
      <button type="button">儲存</button>
      <Toast toast={api.toast} onDismiss={api.dismissToast} />
    </>
  );
}

beforeEach(async () => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => { root.render(<Harness />); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
});

const status = () => container.querySelector<HTMLElement>('[role="status"]')!;
const closeButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="關閉通知"]');
const saveButton = () => [...container.querySelectorAll("button")].find((button) => button.textContent === "儲存")!;

async function show(text: string, options?: { tone?: ToastTone; duration?: number | null; link?: { href: string; label: string; external?: boolean } }) {
  await act(async () => { handle.current!.showToast(text, options); });
}

async function advance(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
}

describe("Toast", () => {
  it("renders an optional follow-up link after the announced text, outside the live region", async () => {
    await show("已發布版本 v2。公開網址：http://127.0.0.1/lp/synthetic", { link: { href: "/lp/synthetic", label: "開啟公開頁", external: true } });
    const link = container.querySelector<HTMLAnchorElement>("[data-ui-toast] a")!;
    expect(link.textContent).toBe("開啟公開頁");
    expect(link.getAttribute("href")).toBe("/lp/synthetic");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(status().contains(link)).toBe(false);
    expect(status().textContent).toBe("已發布版本 v2。公開網址：http://127.0.0.1/lp/synthetic");
    await show("已複製連結。");
    expect(container.querySelector("[data-ui-toast] a")).toBeNull();
  });

  it("keeps an empty polite live region mounted before any message", () => {
    expect(status().getAttribute("aria-live")).toBe("polite");
    expect(status().getAttribute("aria-atomic")).toBe("true");
    expect(status().textContent).toBe("");
    expect(closeButton()).toBeNull();
  });

  it("announces the message in the same region without taking focus", async () => {
    const save = saveButton();
    save.focus();
    const region = status();
    await show("已儲存。");
    expect(status()).toBe(region);
    expect(region.textContent).toBe("已儲存。");
    expect(document.activeElement).toBe(save);
    expect(region.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("disappears after the default duration and after a custom one", async () => {
    await show("已儲存。");
    await advance(DEFAULT_TOAST_DURATION_MS - 1);
    expect(status().textContent).toBe("已儲存。");
    await advance(1);
    expect(status().textContent).toBe("");

    await show("已複製。", { duration: 1_000 });
    await advance(1_000);
    expect(status().textContent).toBe("");
  });

  it("stays until closed when the duration is null", async () => {
    await show("已儲存。", { duration: null, tone: "info" });
    await advance(60_000);
    expect(status().textContent).toBe("已儲存。");
    await act(async () => { closeButton()!.click(); });
    expect(status().textContent).toBe("");
  });

  it("restarts the timer and re-announces when a new message replaces the current one", async () => {
    await show("已儲存。");
    await advance(4_000);
    const first = status().querySelector("span");
    await show("已儲存。");
    expect(status().querySelector("span")).not.toBe(first);
    await advance(4_000);
    expect(status().textContent).toBe("已儲存。");
    await advance(1_000);
    expect(status().textContent).toBe("");
  });

  it("pauses while the pointer is over it", async () => {
    await show("已儲存。");
    const card = status().parentElement!;
    await act(async () => { card.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    await advance(DEFAULT_TOAST_DURATION_MS * 2);
    expect(status().textContent).toBe("已儲存。");
    await act(async () => { card.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })); });
    await advance(DEFAULT_TOAST_DURATION_MS);
    expect(status().textContent).toBe("");
  });

  it("pauses while focus is inside, closes with Escape and returns focus to where it came from", async () => {
    const save = saveButton();
    save.focus();
    await show("已儲存。");
    await act(async () => { closeButton()!.focus(); });
    expect(document.activeElement).toBe(closeButton());
    await advance(DEFAULT_TOAST_DURATION_MS * 2);
    expect(status().textContent).toBe("已儲存。");

    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => { closeButton()!.dispatchEvent(escape); });
    expect(escape.defaultPrevented).toBe(true);
    expect(status().textContent).toBe("");
    expect(document.activeElement).toBe(save);
  });

  it("returns focus when closed with its button", async () => {
    const save = saveButton();
    save.focus();
    await show("已儲存。", { duration: null });
    await act(async () => { closeButton()!.focus(); });
    await act(async () => { closeButton()!.click(); });
    expect(closeButton()).toBeNull();
    expect(document.activeElement).toBe(save);
  });

  it("uses the entrance class that globals.css turns off under prefers-reduced-motion", async () => {
    await show("已儲存。");
    expect(status().parentElement!.className).toContain("ui-toast-card");
    expect(container.querySelector("[data-ui-toast]")!.className).toContain("ui-toast-region");
    const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.ui-toast-card \{\s*animation: none;/u);
  });
});
