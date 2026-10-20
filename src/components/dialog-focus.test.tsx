// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { AppShellAccountMenu } from "./app-shell-account-menu";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button id="trigger" onClick={() => setOpen(true)}>open</button>
      {open ? <Dialog onClose={() => { setOpen(false); onClosed(); }} /> : null}
    </div>
  );
}
function Dialog({ onClose }: { onClose: () => void }) {
  useDialogBehavior(true, onClose);
  return <div role="dialog"><button id="inside">inside</button></div>;
}

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container, cleanup: async () => { await act(async () => root.unmount()); container.remove(); } };
}

describe("F-127 dialog focus behaviour", () => {
  it("closes on Escape and restores focus to the trigger", async () => {
    const closed = vi.fn();
    const { container, cleanup } = await mount(<Harness onClosed={closed} />);
    const trigger = container.querySelector<HTMLButtonElement>("#trigger")!;
    trigger.focus();
    await act(async () => trigger.click());
    container.querySelector<HTMLButtonElement>("#inside")!.focus();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await cleanup();
  });

  it("account menu links aria-controls, closes on Escape (focus back) and on outside press", async () => {
    const { container, cleanup } = await mount(
      <AppShellAccountMenu vendorName="商家" roleLabel="管理員" vendorInitial="商" planLabel="Pro"><span>設定</span></AppShellAccountMenu>,
    );
    const button = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    const menu = container.querySelector<HTMLElement>(`#${CSS.escape(button.getAttribute("aria-controls")!)}`)!;
    expect(menu).not.toBeNull();
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
    await act(async () => button.click());
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await cleanup();
  });
});
