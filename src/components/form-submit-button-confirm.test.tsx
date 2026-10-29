// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormSubmitButton } from "./form-submit-button";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  vi.unstubAllGlobals();
});

async function mount(element: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
  return container;
}
const buttonIn = (scope: ParentNode, name: string) => {
  const match = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === name);
  if (!match) throw new Error(`button not found: ${name}`);
  return match;
};
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
const dialog = () => document.body.querySelector<HTMLElement>('[role="alertdialog"]');

function Form({ onSubmit, onClick, required = false, noValidate = false, confirmMessage = "確定刪除？" }: {
  onSubmit: (data: FormData) => void;
  onClick?: () => void;
  required?: boolean;
  noValidate?: boolean;
  confirmMessage?: string;
}) {
  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      onSubmit(new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter));
    }}>
      <input name="id" defaultValue="row-1" required={required} />
      <FormSubmitButton
        name="intent"
        value="delete"
        formNoValidate={noValidate}
        confirmMessage={confirmMessage}
        confirmDestructive
        onClick={onClick}
        pendingChildren="刪除中…"
        pendingMessage="正在刪除。"
      >
        刪除
      </FormSubmitButton>
    </form>
  );
}

describe("FormSubmitButton in-page confirmation", () => {
  it("does not use the native confirm dialog and holds the submit until confirmed", async () => {
    const nativeConfirm = vi.fn(() => true);
    vi.stubGlobal("confirm", nativeConfirm);
    const onSubmit = vi.fn();
    const container = await mount(<Form onSubmit={onSubmit} />);
    await click(buttonIn(container, "刪除"));
    expect(dialog()?.textContent).toContain("確定刪除？");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("submits the same button, so its name, value and the form data are kept, once confirmed", async () => {
    const onSubmit = vi.fn();
    const container = await mount(<Form onSubmit={onSubmit} />);
    await click(buttonIn(container, "刪除"));
    await click(buttonIn(document.body, "確認"));
    expect(onSubmit).toHaveBeenCalledOnce();
    const data = onSubmit.mock.calls[0]![0] as FormData;
    expect(data.get("id")).toBe("row-1");
    expect(data.get("intent")).toBe("delete");
    expect(dialog()).toBeNull();
  });

  it("prevents the submit when the user cancels", async () => {
    const onSubmit = vi.fn();
    const container = await mount(<Form onSubmit={onSubmit} />);
    await click(buttonIn(container, "刪除"));
    await click(buttonIn(document.body, "取消"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it("lets native validation report invalid required fields before showing confirmation", async () => {
    const onSubmit = vi.fn();
    const onClick = vi.fn();
    const container = await mount(<Form onSubmit={onSubmit} onClick={onClick} required />);
    container.querySelector<HTMLInputElement>("input")!.value = "";
    await click(buttonIn(container, "刪除"));
    expect(dialog()).toBeNull();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps confirmation mandatory for a formNoValidate destructive submit on an invalid form", async () => {
    const onSubmit = vi.fn();
    const container = await mount(<Form onSubmit={onSubmit} required noValidate />);
    container.querySelector<HTMLInputElement>("input")!.value = "";
    await click(buttonIn(container, "刪除"));
    expect(dialog()).not.toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
    await click(buttonIn(document.body, "確認"));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("splits a multi-line message into a title and supporting text", async () => {
    const container = await mount(<Form onSubmit={vi.fn()} confirmMessage={"確定要封存「影片」嗎？\n\n既有回放不受影響。"} />);
    await click(buttonIn(container, "刪除"));
    expect(dialog()?.querySelector("h2")?.textContent).toBe("確定要封存「影片」嗎？");
    expect(dialog()?.querySelector("p")?.textContent).toBe("既有回放不受影響。");
  });
});
