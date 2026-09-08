import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useMemo: <Value,>(factory: () => Value) => factory(),
    useState: <Value,>(initialValue: Value) => {
      const index = hookState.cursor++;
      if (hookState.values.length === index) hookState.values.push(initialValue);
      const setValue = (next: Value) => { hookState.values[index] = next; };
      return [hookState.values[index] as Value, setValue];
    },
  };
});

import { CommissionSimulator } from "./commission-simulator";

type ElementNode = { type: unknown; props: Record<string, unknown> };
function isElement(value: unknown): value is ElementNode { return typeof value === "object" && value !== null && "type" in value && "props" in value; }
function find(value: unknown, predicate: (element: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(value)) return value.flatMap((item) => find(item, predicate));
  if (!isElement(value)) return [];
  const rendered = typeof value.type === "function" ? (value.type as (props: Record<string, unknown>) => unknown)(value.props) : value.props.children;
  return [...(predicate(value) ? [value] : []), ...find(rendered, predicate)];
}
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  if (!isElement(value)) return "";
  return text(typeof value.type === "function" ? (value.type as (props: Record<string, unknown>) => unknown)(value.props) : value.props.children);
}
function render() { hookState.cursor = 0; return CommissionSimulator({ policyVersion: 7 }); }

describe("CommissionSimulator", () => {
  beforeEach(() => { hookState.cursor = 0; hookState.values = []; });

  it("呈現兩個合規範圍滑桿與完整試算指標", () => {
    const view = render();
    const ranges = find(view, (node) => node.type === "input" && node.props.type === "range");
    expect(ranges.map((node) => [node.props.min, node.props.max])).toEqual([[500, 50_000], [1, 200]]);
    expect(text(view)).toContain("規則 v7");
    expect(text(view)).toContain("預估二代健保代扣費（2.11%）");
    expect(find(view, (node) => node.props["data-testid"] === "commission-bar")).toHaveLength(1);
  });

  it("拖動滑桿後立即在 client 端更新營業額、分潤與毛利", () => {
    let view = render();
    const ranges = find(view, (node) => node.type === "input" && node.props.type === "range");
    (ranges[0]!.props.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "1000" } });
    (ranges[1]!.props.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "6" } });
    view = render();
    expect(text(find(view, (node) => node.props["data-testid"] === "gross-revenue")[0])).toContain("6,000");
    expect(text(find(view, (node) => node.props["data-testid"] === "affiliate-commission")[0])).toContain("950");
    expect(text(find(view, (node) => node.props["data-testid"] === "profit-margin")[0])).toBe("83.83%");
  });
});
