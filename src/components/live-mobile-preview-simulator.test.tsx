import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useMemo: <Value,>(factory: () => Value) => factory(),
    useEffect: vi.fn(),
    useState: <Value,>(initialValue: Value) => {
      const index = hookState.cursor++;
      if (hookState.values.length === index) hookState.values.push(initialValue);
      const setValue = (nextValue: Value | ((value: Value) => Value)) => {
        const current = hookState.values[index] as Value;
        hookState.values[index] = typeof nextValue === "function" ? (nextValue as (value: Value) => Value)(current) : nextValue;
      };
      return [hookState.values[index] as Value, setValue];
    },
  };
});

import { LiveMobilePreviewSimulator, type LivePreviewEvent } from "./live-mobile-preview-simulator";

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

const events: LivePreviewEvent[] = [
  { eventType: "poll", triggerSec: 30, title: "最愛哪一款？", metadata: { durationSec: 60, question: "今天最愛哪一款？", options: ["晨光藍", "夕陽紅"] } },
  { eventType: "flash_voucher", triggerSec: 120, title: "限時券", metadata: { durationSec: 30, discountType: "percentage", discountValue: 25, maxClaims: 50, productId: "product-1" } },
  { eventType: "lucky_draw", triggerSec: 180, title: "抽獎", metadata: { durationSec: 30, slogan: "週年快樂" } },
];

function renderPreview() {
  hookState.cursor = 0;
  return LiveMobilePreviewSimulator({ events, products: [{ id: "product-1", name: "星光保養組" }], liveTitle: "週年直播" });
}

describe("LiveMobilePreviewSimulator", () => {
  beforeEach(() => { hookState.cursor = 0; hookState.values = []; });

  it("renders the device, responsive drawer trigger, perspectives, timeline and event markers", () => {
    const preview = renderPreview();
    expect(find(preview, (node) => node.props["data-testid"] === "mobile-device-frame")).toHaveLength(1);
    expect(find(preview, (node) => node.props["data-testid"] === "timeline-director")).toHaveLength(1);
    expect(text(preview)).toContain("一般觀眾視角");
    expect(text(preview)).toContain("得獎者視角");
    expect(text(preview)).toContain("預覽手機效果");
    expect(find(preview, (node) => typeof node.props["aria-label"] === "string" && String(node.props["aria-label"]).includes("最愛哪一款"))).toHaveLength(1);
  });

  it("seeks to markers and reactively renders poll and voucher content", () => {
    let preview = renderPreview();
    expect(text(preview)).toContain("今天最愛哪一款？");
    expect(text(preview)).toContain("晨光藍");
    const voucherMarker = find(preview, (node) => String(node.props["aria-label"] ?? "").includes("限時券"))[0];
    (voucherMarker?.props.onClick as () => void)();
    preview = renderPreview();
    expect(text(preview)).toContain("25% OFF");
    expect(text(preview)).toContain("星光保養組");
    expect(text(preview)).toContain("限量 50 份");
  });

  it("switches to the winner perspective and shows an eight-character redemption code", () => {
    let preview = renderPreview();
    const drawMarker = find(preview, (node) => String(node.props["aria-label"] ?? "").includes("抽獎"))[0];
    (drawMarker?.props.onClick as () => void)();
    preview = renderPreview();
    const winnerButton = find(preview, (node) => node.type === "button" && text(node.props.children) === "得獎者視角")[0];
    (winnerButton?.props.onClick as () => void)();
    preview = renderPreview();
    expect(find(preview, (node) => node.props["data-testid"] === "winner-card")).toHaveLength(1);
    expect(text(preview)).toContain("LIVE8WIN");
    expect(text(preview)).toContain("恭喜中獎");
  });

  it("starts the local five-second test play without submitting a form", () => {
    const preview = renderPreview();
    const play = find(preview, (node) => node.type === "button" && text(node.props.children).includes("播放 5 秒快轉試看"))[0];
    expect(play?.props.type).toBe("button");
    (play?.props.onClick as () => void)();
    renderPreview();
    expect(hookState.values[2]).toBe(true);
    expect(hookState.values[3]).toBe(0);
  });
});
