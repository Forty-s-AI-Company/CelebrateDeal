// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CircleCheck, FileVideo } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Stepper, type StepperStep } from "./stepper";

type Key = "basics" | "details" | "review";

const steps: ReadonlyArray<StepperStep<Key>> = [
  { key: "basics", label: "基本資料", description: "名稱與網址", icon: FileVideo, panelId: "panel-basics", status: { label: "已完成", shortLabel: "完成", icon: CircleCheck, className: "border-emerald-200" } },
  { key: "details", label: "細節", panelId: "panel-details", status: { label: "尚有必填", className: "border-amber-300" } },
  { key: "review", label: "確認", panelId: "panel-review", disabled: true },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

function Harness({ onSelect = vi.fn() }: { onSelect?: (key: Key) => void }) {
  const [active, setActive] = useState<Key>("basics");
  return <Stepper label="設定步驟" steps={steps} activeKey={active} onSelect={(key) => { onSelect(key); setActive(key); }} />;
}

const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("nav ol > li > button")];

describe("Stepper", () => {
  it("renders a labelled navigation with one ordered button per step", async () => {
    await act(async () => { root.render(<Harness />); });
    const nav = container.querySelector("nav")!;
    expect(nav.getAttribute("aria-label")).toBe("設定步驟");
    expect(buttons().map((button) => button.getAttribute("aria-controls"))).toEqual(["panel-basics", "panel-details", "panel-review"]);
    expect(buttons().every((button) => button.type === "button")).toBe(true);
    expect(buttons()[0]!.textContent).toContain("1. 基本資料");
    expect(container.querySelector("ol")!.className).toContain("grid-cols-3");
  });

  it("marks only the active step with aria-current=step and shows the phone position line", async () => {
    await act(async () => { root.render(<Harness />); });
    expect(buttons().map((button) => button.getAttribute("aria-current"))).toEqual(["step", null, null]);
    expect(container.textContent).toContain("第 1 步／共 3 步：基本資料");
  });

  it("gives every status text, keeping the full label for assistive tech when a short label is shown", async () => {
    await act(async () => { root.render(<Harness />); });
    const [first, second] = buttons();
    const short = [...first!.querySelectorAll("span")].find((span) => span.textContent === "完成");
    expect(short?.getAttribute("aria-hidden")).toBe("true");
    const full = [...first!.querySelectorAll("span")].find((span) => span.textContent === "已完成");
    expect(full?.className).toContain("sr-only");
    expect(second!.textContent).toContain("尚有必填");
    // Decorative icons stay out of the accessible name.
    for (const svg of first!.querySelectorAll("svg")) expect(svg.closest("[aria-hidden=true]") ?? svg.getAttribute("aria-hidden")).toBeTruthy();
  });

  it("keeps every enabled step in the Tab order and selects with a native button press, leaving focus on it", async () => {
    const onSelect = vi.fn();
    await act(async () => { root.render(<Harness onSelect={onSelect} />); });
    const [, details] = buttons();
    expect(buttons().every((button) => button.tabIndex === 0)).toBe(true);

    details!.focus();
    await act(async () => { details!.click(); });

    expect(onSelect).toHaveBeenCalledWith("details");
    expect(details!.getAttribute("aria-current")).toBe("step");
    expect(buttons()[0]!.getAttribute("aria-current")).toBeNull();
    expect(document.activeElement).toBe(details);
    expect(container.textContent).toContain("第 2 步／共 3 步：細節");
  });

  it("does not select a disabled step", async () => {
    const onSelect = vi.fn();
    await act(async () => { root.render(<Harness onSelect={onSelect} />); });
    const review = buttons()[2]!;
    expect(review.disabled).toBe(true);
    await act(async () => { review.click(); });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("can hide the position line", async () => {
    await act(async () => { root.render(<Stepper label="步驟" steps={steps} activeKey="basics" onSelect={vi.fn()} showPosition={false} />); });
    expect(container.textContent).not.toContain("第 1 步");
  });
});
