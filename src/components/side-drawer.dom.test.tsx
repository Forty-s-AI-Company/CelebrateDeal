// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SideDrawer } from "./side-drawer";

let container: HTMLDivElement;
let root: Root;

const parentHandlers = {
  change: vi.fn(),
  submit: vi.fn(),
  keyDown: vi.fn(),
  invalid: vi.fn(),
};

function Harness({ busy = false, onClose = vi.fn() }: { busy?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <form
      onChange={parentHandlers.change}
      onSubmit={(event) => { event.preventDefault(); parentHandlers.submit(); }}
      onKeyDown={parentHandlers.keyDown}
      onInvalid={parentHandlers.invalid}
    >
      <button type="button" onClick={() => setOpen(true)}>開啟</button>
      {open ? (
        <SideDrawer title="抽屜標題" description="說明" busy={busy} onClose={() => { onClose(); setOpen(false); }}>
          <form onSubmit={(event) => event.preventDefault()}>
            <input name="inside" required />
            <button type="submit">送出</button>
          </form>
        </SideDrawer>
      ) : null}
    </form>
  );
}

function trigger() {
  return Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === "開啟")!;
}

function dialog() {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

async function open() {
  const button = trigger();
  button.focus();
  await act(async () => { button.click(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("SideDrawer", () => {
  it("renders a labelled modal dialog outside the opener's DOM and focuses its first control", async () => {
    await act(async () => { root.render(<Harness />); });
    await open();

    const drawer = dialog()!;
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(drawer.getAttribute("aria-labelledby")!)?.textContent).toBe("抽屜標題");
    expect(document.getElementById(drawer.getAttribute("aria-describedby")!)?.textContent).toBe("說明");
    expect(container.contains(drawer)).toBe(false);
    expect(document.activeElement).toBe(drawer.querySelector('button[aria-label="關閉"]'));
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("keeps React events from reaching the form that opened it", async () => {
    await act(async () => { root.render(<Harness />); });
    await open();
    const input = dialog()!.querySelector<HTMLInputElement>('[name="inside"]')!;

    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "typed");
    await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })); });
    await act(async () => { dialog()!.querySelector("form")!.requestSubmit(); });

    expect(parentHandlers.change).not.toHaveBeenCalled();
    expect(parentHandlers.keyDown).not.toHaveBeenCalled();
    expect(parentHandlers.submit).not.toHaveBeenCalled();
  });

  it("closes from the backdrop and Escape, restoring focus and scrolling", async () => {
    await act(async () => { root.render(<Harness />); });
    await open();
    const backdrop = document.body.querySelector<HTMLElement>("[data-side-drawer]")!;
    await act(async () => { backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(document.body.style.overflow).toBe("");

    await open();
    await act(async () => {
      dialog()!.querySelector('[name="inside"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("stays open while busy", async () => {
    const onClose = vi.fn();
    await act(async () => { root.render(<Harness busy onClose={onClose} />); });
    await open();

    await act(async () => {
      dialog()!.querySelector('[name="inside"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await act(async () => { document.body.querySelector("[data-side-drawer]")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });

    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="關閉"]')!.disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the drawer", async () => {
    await act(async () => { root.render(<Harness />); });
    await open();
    const submit = Array.from(dialog()!.querySelectorAll("button")).find((candidate) => candidate.textContent === "送出")!;
    submit.focus();
    await act(async () => { submit.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(dialog()!.querySelector('button[aria-label="關閉"]'));
  });
});
