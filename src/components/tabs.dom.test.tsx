// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TabPanel, Tabs, tabId, tabPanelId, type TabItem } from "./tabs";

type Key = "one" | "two" | "three" | "four";

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

const defaultItems: ReadonlyArray<TabItem<Key>> = [
  { key: "one", label: "第一" },
  { key: "two", label: "第二" },
  { key: "three", label: "第三", disabled: true },
  { key: "four", label: "第四" },
];

function Harness({ items = defaultItems, initial = "one", orientation, onChange = vi.fn() }: { items?: ReadonlyArray<TabItem<Key>>; initial?: Key; orientation?: "horizontal" | "vertical"; onChange?: (key: Key) => void }) {
  const [value, setValue] = useState<Key>(initial);
  return (
    <>
      <Tabs idPrefix="demo" label="示範分頁" items={items} value={value} orientation={orientation} onChange={(key) => { onChange(key); setValue(key); }} />
      <TabPanel idPrefix="demo" tabKey={value}>內容：{value}</TabPanel>
    </>
  );
}

const tab = (key: Key) => container.querySelector<HTMLButtonElement>(`#${tabId("demo", key)}`)!;
const selected = () => [...container.querySelectorAll('[role="tab"][aria-selected="true"]')].map((element) => element.id);

async function press(target: HTMLElement, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}

describe("Tabs", () => {
  it("wires tablist, tabs and panel with the WAI-ARIA tabs roles and ids", async () => {
    await act(async () => { root.render(<Harness />); });
    const list = container.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-label")).toBe("示範分頁");
    expect(list.hasAttribute("aria-orientation")).toBe(false);
    expect(tab("one").getAttribute("aria-selected")).toBe("true");
    expect(tab("two").getAttribute("aria-selected")).toBe("false");
    expect(tab("one").getAttribute("aria-controls")).toBe(tabPanelId("demo", "one"));
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(panel.id).toBe("demo-panel-one");
    expect(panel.getAttribute("aria-labelledby")).toBe("demo-tab-one");
    expect(panel.hasAttribute("tabindex")).toBe(false);
  });

  it("keeps only the selected tab in the Tab order (roving tabindex)", async () => {
    await act(async () => { root.render(<Harness />); });
    expect(["one", "two", "three", "four"].map((key) => tab(key as Key).getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);
    await act(async () => { tab("two").click(); });
    expect(selected()).toEqual(["demo-tab-two"]);
    expect(tab("one").getAttribute("tabindex")).toBe("-1");
    expect(tab("two").getAttribute("tabindex")).toBe("0");
    expect(container.querySelector('[role="tabpanel"]')!.textContent).toBe("內容：two");
  });

  it("moves and selects with the arrow keys, skipping disabled tabs and wrapping at both ends", async () => {
    await act(async () => { root.render(<Harness />); });
    tab("one").focus();

    expect((await press(tab("one"), "ArrowRight")).defaultPrevented).toBe(true);
    expect(selected()).toEqual(["demo-tab-two"]);
    expect(document.activeElement).toBe(tab("two"));

    await press(tab("two"), "ArrowRight");
    expect(selected()).toEqual(["demo-tab-four"]);
    expect(document.activeElement).toBe(tab("four"));

    await press(tab("four"), "ArrowRight");
    expect(selected()).toEqual(["demo-tab-one"]);

    await press(tab("one"), "ArrowLeft");
    expect(selected()).toEqual(["demo-tab-four"]);
    expect(document.activeElement).toBe(tab("four"));
  });

  it("jumps to the first and last enabled tab with Home and End", async () => {
    const items: ReadonlyArray<TabItem<Key>> = [{ key: "one", label: "1", disabled: true }, { key: "two", label: "2" }, { key: "three", label: "3" }, { key: "four", label: "4", disabled: true }];
    await act(async () => { root.render(<Harness items={items} initial="two" />); });
    await press(tab("two"), "End");
    expect(selected()).toEqual(["demo-tab-three"]);
    expect(document.activeElement).toBe(tab("three"));
    await press(tab("three"), "Home");
    expect(selected()).toEqual(["demo-tab-two"]);
    expect(document.activeElement).toBe(tab("two"));
  });

  it("ignores other keys and leaves them to the browser", async () => {
    const onChange = vi.fn();
    await act(async () => { root.render(<Harness onChange={onChange} />); });
    for (const key of ["ArrowDown", "Enter", "a", "Tab"]) expect((await press(tab("one"), key)).defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses the up and down arrows when vertical", async () => {
    await act(async () => { root.render(<Harness orientation="vertical" />); });
    expect(container.querySelector('[role="tablist"]')!.getAttribute("aria-orientation")).toBe("vertical");
    await press(tab("one"), "ArrowDown");
    expect(selected()).toEqual(["demo-tab-two"]);
    await press(tab("two"), "ArrowUp");
    expect(selected()).toEqual(["demo-tab-one"]);
    expect((await press(tab("one"), "ArrowRight")).defaultPrevented).toBe(false);
  });

  it("keeps an enabled tab focusable when the selected tab is disabled", async () => {
    const items: ReadonlyArray<TabItem<Key>> = [{ key: "one", label: "1", disabled: true }, { key: "two", label: "2" }];
    await act(async () => { root.render(<Harness items={items} />); });
    expect(tab("one").getAttribute("tabindex")).toBe("-1");
    expect(tab("two").getAttribute("tabindex")).toBe("0");
  });

  it("can put a panel without focusable content in the Tab order", async () => {
    await act(async () => { root.render(<TabPanel idPrefix="demo" tabKey="one" focusable>純文字</TabPanel>); });
    expect(container.querySelector('[role="tabpanel"]')!.getAttribute("tabindex")).toBe("0");
  });
});
