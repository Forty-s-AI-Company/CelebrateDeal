import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PricingTableBlock } from "@/lib/funnel-blocks-schema";

const hookState = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useMemo: <T,>(factory: () => T) => factory(),
    useState: <T,>(initial: T) => {
      const index = hookState.cursor++;
      if (hookState.values.length === index) hookState.values.push(initial);
      const setValue = (next: T | ((current: T) => T)) => {
        const current = hookState.values[index] as T;
        hookState.values[index] = typeof next === "function" ? (next as (value: T) => T)(current) : next;
      };
      return [hookState.values[index] as T, setValue] as const;
    },
  };
});
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => (
  // The mock intentionally renders the native element so tests stay framework-independent.
  // eslint-disable-next-line @next/next/no-img-element
  <img alt={String(props.alt ?? "")} {...props} />
) }));

import { FunnelCanvasEditor, moveCanvasBlock, removeCanvasBlock, resizePricingCards } from "./funnel-canvas-editor";

type Node = { type: unknown; props: Record<string, unknown> };
function isNode(value: unknown): value is Node { return typeof value === "object" && value !== null && "type" in value && "props" in value; }
function content(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(content).join("");
  if (!isNode(value)) return "";
  return content(typeof value.type === "function" ? (value.type as (props: Record<string, unknown>) => unknown)(value.props) : value.props.children);
}
function find(value: unknown, predicate: (node: Node) => boolean): Node[] {
  if (Array.isArray(value)) return value.flatMap((child) => find(child, predicate));
  if (!isNode(value)) return [];
  const rendered = typeof value.type === "function" ? (value.type as (props: Record<string, unknown>) => unknown)(value.props) : value.props.children;
  return [...(predicate(value) ? [value] : []), ...find(rendered, predicate)];
}

const pricing: PricingTableBlock = {
  id: "pricing", type: "pricing_table", sortOrder: 0, isVisible: true,
  settings: { layout: "two_column", cards: ["basic", "pro"].map((id) => ({ id, name: id, salePrice: 100, currency: "TWD", features: ["特色"], isFeatured: false, badgeText: "熱門", showBuyButton: true, buyButtonLabel: "立即購買", checkoutUrl: "#registration", showMoreInfoButton: false, moreInfoButtonLabel: "了解更多" })) },
};
const faq = { id: "faq", type: "accordion_faq" as const, sortOrder: 1, isVisible: true, settings: { title: "FAQ", items: [{ id: "q1", question: "問題", answer: "答案" }] } };

describe("FunnelCanvasEditor", () => {
  beforeEach(() => { hookState.cursor = 0; hookState.values = []; vi.stubGlobal("confirm", vi.fn(() => true)); });

  it("moves blocks up and down while normalizing sortOrder", () => {
    expect(moveCanvasBlock([pricing, faq], "pricing", 1).map((block) => block.id)).toEqual(["faq", "pricing"]);
    expect(moveCanvasBlock([pricing, faq], "faq", -1).map((block) => block.id)).toEqual(["faq", "pricing"]);
  });

  it("deletes a block without leaving a sortOrder gap", () => {
    expect(removeCanvasBlock([pricing, faq], "pricing")).toEqual([{ ...faq, sortOrder: 0 }]);
  });

  it("switches pricing layouts and creates the required third anchor card", () => {
    const next = resizePricingCards(pricing, "three_column");
    expect(next.settings.layout).toBe("three_column");
    expect(next.settings.cards).toHaveLength(3);
  });

  it("switches between the 390px mobile canvas and desktop canvas", () => {
    const render = () => { hookState.cursor = 0; return FunnelCanvasEditor({ formName: "測試漏斗", blocks: [pricing], onChange: vi.fn(), onUseTraditionalEditor: vi.fn() }); };
    let view = render();
    expect(find(view, (node) => node.props["data-testid"] === "canvas-shell")[0]?.props["data-device"]).toBe("desktop");
    const mobile = find(view, (node) => node.type === "button" && content(node).includes("手機版"))[0];
    expect(mobile).toBeTruthy();
    (mobile!.props.onClick as () => void)();
    view = render();
    const shell = find(view, (node) => node.props["data-testid"] === "canvas-shell")[0];
    expect(shell?.props["data-device"]).toBe("mobile");
    expect(String(shell?.props.className)).toContain("w-[390px]");
  });
});
