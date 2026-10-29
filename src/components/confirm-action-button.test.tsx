// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmActionButton, useConfirmDialog } from "./confirm-action-button";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function mount(element: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
  return container;
}
const dialog = () => document.body.querySelector<HTMLElement>('[role="alertdialog"]');
const buttonIn = (scope: ParentNode, name: string) => {
  const match = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === name);
  if (!match) throw new Error(`button not found: ${name}`);
  return match;
};
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
const press = async (key: string) => {
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
};

describe("ConfirmActionButton with onConfirm", () => {
  const onConfirm = vi.fn();
  beforeEach(() => onConfirm.mockClear());

  async function open(props: Partial<React.ComponentProps<typeof ConfirmActionButton>> = {}) {
    const container = await mount(<ConfirmActionButton message="確定要刪除嗎？" onConfirm={onConfirm} {...props}>刪除</ConfirmActionButton>);
    await click(buttonIn(container, "刪除"));
    return container;
  }

  it("opens an accessible alertdialog without running the action", async () => {
    await open({ description: "刪除後無法復原。" });
    const panel = dialog()!;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(panel.getAttribute("aria-labelledby")!)?.textContent).toBe("確定要刪除嗎？");
    expect(document.getElementById(panel.getAttribute("aria-describedby")!)?.textContent).toBe("刪除後無法復原。");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("starts focus on the safe choice and returns it to the trigger on cancel", async () => {
    const container = await open();
    expect(document.activeElement).toBe(buttonIn(document.body, "取消"));
    await click(buttonIn(document.body, "取消"));
    expect(dialog()).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(buttonIn(container, "刪除"));
  });

  it("runs the action once and closes when confirmed", async () => {
    await open({ confirmLabel: "確定刪除" });
    await click(buttonIn(document.body, "確定刪除"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
  });

  it("does nothing on Escape", async () => {
    await open();
    await press("Escape");
    expect(dialog()).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does nothing when the backdrop is clicked", async () => {
    await open();
    await act(async () => {
      document.body.querySelector<HTMLElement>("[data-confirm-backdrop]")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(dialog()).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("styles the confirm button as destructive only when asked", async () => {
    await open({ destructive: true });
    expect(document.body.querySelector("[data-confirm-action]")?.className).toContain("bg-red-700");
    await click(buttonIn(document.body, "取消"));
    await mount(<ConfirmActionButton message="一般確認" onConfirm={onConfirm}>一般</ConfirmActionButton>);
    await click(buttonIn(document.body, "一般"));
    expect(document.body.querySelector("[data-confirm-action]")?.className).not.toContain("bg-red-700");
  });

  it("keeps the first line as the title and the rest as supporting text", async () => {
    await open({ message: "確定要封存「影片」嗎？\n\n目前引用：2 個直播場次。" });
    expect(dialog()?.querySelector("h2")?.textContent).toBe("確定要封存「影片」嗎？");
    expect(dialog()?.querySelector("p")?.textContent).toBe("目前引用：2 個直播場次。");
  });

  it("acts immediately when confirmation is not required", async () => {
    const container = await mount(<ConfirmActionButton message="不會出現" confirmRequired={false} onConfirm={onConfirm}>執行</ConfirmActionButton>);
    await click(buttonIn(container, "執行"));
    expect(dialog()).toBeNull();
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("ConfirmActionButton as a submit button", () => {
  function Harness({ onSubmit, required = false }: { onSubmit: (data: FormData, intent: string | null) => void; required?: boolean }) {
    return (
      <form onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        onSubmit(new FormData(event.currentTarget, submitter), submitter?.getAttribute("data-intent") ?? null);
      }}>
        <input name="id" defaultValue="row-1" required={required} />
        <ConfirmActionButton type="submit" name="intent" value="delete" data-intent="delete" message="確定刪除？" destructive>刪除</ConfirmActionButton>
      </form>
    );
  }

  it("submits the same form data with the clicked button's name and value only after confirming", async () => {
    const onSubmit = vi.fn();
    const container = await mount(<Harness onSubmit={onSubmit} />);
    await click(buttonIn(container, "刪除"));
    expect(onSubmit).not.toHaveBeenCalled();
    await click(buttonIn(document.body, "確認"));
    expect(onSubmit).toHaveBeenCalledOnce();
    const [data, intent] = onSubmit.mock.calls[0]!;
    expect(intent).toBe("delete");
    expect(data.get("id")).toBe("row-1");
    expect(data.get("intent")).toBe("delete");
  });

  it("submits nothing when cancelled", async () => {
    const onSubmit = vi.fn();
    const container = await mount(<Harness onSubmit={onSubmit} />);
    await click(buttonIn(container, "刪除"));
    await click(buttonIn(document.body, "取消"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it("lets native validation report an invalid form instead of asking", async () => {
    const onSubmit = vi.fn();
    const container = await mount(<Harness onSubmit={onSubmit} required />);
    container.querySelector<HTMLInputElement>("input")!.value = "";
    const reportValidity = vi.spyOn(container.querySelector("form")!, "reportValidity");
    await click(buttonIn(container, "刪除"));
    expect(reportValidity).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("useConfirmDialog", () => {
  function Dirty() {
    const [log, setLog] = useState<string[]>([]);
    const { confirm, dialog: confirmDialog } = useConfirmDialog();
    return (
      <div>
        <button type="button" onClick={() => confirm({ message: "尚有未儲存的設定，確定離開？" }, () => setLog((value) => [...value, "left"]))}>離開</button>
        <output>{log.join(",")}</output>
        {confirmDialog}
      </div>
    );
  }

  it("runs the deferred action only after confirmation", async () => {
    const container = await mount(<Dirty />);
    await click(buttonIn(container, "離開"));
    await click(buttonIn(document.body, "取消"));
    expect(container.querySelector("output")?.textContent).toBe("");
    await click(buttonIn(container, "離開"));
    await click(buttonIn(document.body, "確認"));
    expect(container.querySelector("output")?.textContent).toBe("left");
    expect(dialog()).toBeNull();
  });

describe("ConfirmDialog event isolation", () => {
  it("keeps keyboard, click and mousedown events from reaching outer handlers through the React tree", async () => {
    const outer = { keydown: vi.fn(), click: vi.fn(), mousedown: vi.fn() };
    const container = await mount(
      <div onKeyDown={outer.keydown} onClick={outer.click} onMouseDown={outer.mousedown}>
        <ConfirmActionButton message="確定？" onConfirm={() => undefined}>開啟</ConfirmActionButton>
      </div>,
    );
    await click(buttonIn(container, "開啟"));
    outer.click.mockClear();
    const confirmButton = buttonIn(document.body, "確認");
    await act(async () => {
      confirmButton.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
      confirmButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      document.body.querySelector("[role=alertdialog]")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(outer.keydown).not.toHaveBeenCalled();
    expect(outer.mousedown).not.toHaveBeenCalled();
    expect(outer.click).not.toHaveBeenCalled();
  });

  it("still closes on Escape when focus is inside the dialog, without reaching outer handlers", async () => {
    const outerKeydown = vi.fn();
    const container = await mount(
      <div onKeyDown={outerKeydown}><ConfirmActionButton message="確定？" onConfirm={() => undefined}>開啟</ConfirmActionButton></div>,
    );
    await click(buttonIn(container, "開啟"));
    await act(async () => {
      buttonIn(document.body, "取消").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(dialog()).toBeNull();
    expect(outerKeydown).not.toHaveBeenCalled();
  });

  it("only advertises a popup when it will actually ask", async () => {
    const asking = await mount(<ConfirmActionButton message="確定？">一</ConfirmActionButton>);
    const plain = await mount(<ConfirmActionButton message="確定？" confirmRequired={false}>二</ConfirmActionButton>);
    expect(buttonIn(asking, "一").getAttribute("aria-haspopup")).toBe("dialog");
    expect(buttonIn(plain, "二").hasAttribute("aria-haspopup")).toBe(false);
  });
});
});
