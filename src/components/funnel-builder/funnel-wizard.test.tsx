import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useMemo: <T,>(factory: () => T) => factory(), useState: <T,>(initial: T) => {
    const index = hookState.cursor++;
    if (hookState.values.length === index) hookState.values.push(initial);
    const setValue = (next: T | ((current: T) => T)) => { const current = hookState.values[index] as T; hookState.values[index] = typeof next === "function" ? (next as (current: T) => T)(current) : next; };
    return [hookState.values[index] as T, setValue] as const;
  } };
});
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => <img {...props} /> }));

import { FunnelWizard } from "./funnel-wizard";

type Node = { type: unknown; props: Record<string, unknown> };
function isNode(value: unknown): value is Node { return typeof value === "object" && value !== null && "type" in value && "props" in value; }
function find(value: unknown, predicate: (node: Node) => boolean): Node[] {
  if (Array.isArray(value)) return value.flatMap((child) => find(child, predicate));
  if (!isNode(value)) return [];
  const rendered = typeof value.type === "function" ? (value.type as (props: Record<string, unknown>) => unknown)(value.props) : value.props.children;
  return [...(predicate(value) ? [value] : []), ...find(rendered, predicate)];
}
function content(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(content).join("");
  if (!isNode(value)) return "";
  return content(typeof value.type === "function" ? (value.type as (props: Record<string, unknown>) => unknown)(value.props) : value.props.children);
}
function render(onApply = vi.fn(), onBlank = vi.fn()) { hookState.cursor = 0; return FunnelWizard({ onApply, onBlank }); }
function click(view: unknown, label: string) { const button = find(view, (node) => node.type === "button" && content(node).includes(label))[0]; expect(button).toBeTruthy(); (button!.props.onClick as () => void)(); }

describe("FunnelWizard", () => {
  beforeEach(() => { hookState.cursor = 0; hookState.values = []; });

  it("allows the original blank-canvas path", () => {
    const onBlank = vi.fn();
    click(render(vi.fn(), onBlank), "從空白畫布開始");
    expect(onBlank).toHaveBeenCalledOnce();
  });

  it("filters template cards by category tabs", () => {
    let view = render();
    click(view, "從高轉換範本挑選");
    view = render();
    expect(find(view, (node) => String(node.props["data-testid"] ?? "").startsWith("template-"))).toHaveLength(3);
    click(view, "商業自媒體");
    view = render();
    expect(find(view, (node) => String(node.props["data-testid"] ?? "").startsWith("template-"))).toHaveLength(1);
    expect(content(view)).toContain("高客單銷講大師範本");
  });

  it("applies the selected preset after step three confirmation", () => {
    const onApply = vi.fn();
    let view = render(onApply);
    click(view, "從高轉換範本挑選"); view = render(onApply);
    click(view, "選擇範本"); view = render(onApply);
    expect(content(view)).toContain("已選擇");
    click(view, "套用此範本");
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: "high-ticket-masterclass", archetype: "high_ticket" }));
  });
});
