import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));
const mocks = vi.hoisted(() => ({ unblock: vi.fn() }));

vi.mock("@/app/actions", () => ({ unblockBlacklistAction: mocks.unblock }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      const index = hookState.cursor++;
      if (hookState.values[index] === undefined) hookState.values[index] = initial;
      const setValue = (next: unknown) => {
        hookState.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(hookState.values[index]) : next;
      };
      return [hookState.values[index], setValue] as const;
    },
    useMemo: (factory: () => unknown) => {
      hookState.cursor++;
      return factory();
    },
  };
});

import { BlacklistSearchList } from "./blacklist-search-list";

type ElementNode = { type: unknown; props: Record<string, unknown> };
function isElementNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && "type" in value && "props" in value;
}
function findElements(node: unknown, predicate: (element: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, predicate));
  if (!isElementNode(node)) return [];
  return [...(predicate(node) ? [node] : []), ...findElements(node.props.children, predicate)];
}
function textContent(node: unknown): string {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return isElementNode(node) ? textContent(node.props.children) : "";
}

const entries = [
  { id: "entry-active", identifier: "alice@example.test", identifierType: "email", reason: "重複提交", notes: "付款表單", isActive: true, createdAt: "2026-01-02T03:04:05.000Z" },
  { id: "entry-inactive", identifier: "198.51.100.7", identifierType: "ip", reason: "人工解除", notes: "復核完成", isActive: false, createdAt: "2026-01-03T03:04:05.000Z" },
  { id: "entry-notes", identifier: "member-42", identifierType: "member", reason: "風險標記", notes: "needs-review", isActive: true, createdAt: "2026-01-04T03:04:05.000Z" },
];

function renderList(listEntries = entries) {
  hookState.cursor = 0;
  return BlacklistSearchList({ entries: listEntries, csrfToken: "csrf-test-token" });
}

beforeEach(() => {
  hookState.cursor = 0;
  hookState.values = [];
  vi.clearAllMocks();
});

describe("BlacklistSearchList", () => {
  it("renders search semantics, active/inactive badges, and only active mutation forms", () => {
    const tree = renderList();
    const search = findElements(tree, (element) => element.props.role === "search")[0];
    const input = findElements(search, (element) => element.type === "input")[0];
    expect(search).toBeDefined();
    expect(input.props.type).toBe("search");
    expect(input.props.placeholder).toBe("搜尋識別值、原因、備註");
    expect(textContent(findElements(tree, (element) => element.props["aria-live"] === "polite")[0])).toBe("顯示 3 筆黑名單");
    expect(textContent(tree)).toContain("alice@example.test");
    expect(textContent(tree)).toContain("email");
    expect(textContent(tree)).toContain("重複提交");
    expect(textContent(tree)).toContain("封鎖中");
    expect(textContent(tree)).toContain("已解除");
    expect(findElements(tree, (element) => element.type === "form")).toHaveLength(2);
    const activeForm = findElements(tree, (element) => element.type === "form").find((form) => findElements(form, (element) => element.props.name === "id")[0]?.props.value === "entry-active");
    expect(activeForm).toBeDefined();
    expect(findElements(activeForm, (element) => element.props.name === "_csrf")[0].props.value).toBe("csrf-test-token");
    expect(findElements(tree, (element) => element.type === "form").some((form) => findElements(form, (element) => element.props.value === "entry-inactive").length > 0)).toBe(false);
  });

  it("filters through identifier, reason, notes, and empty-result states via the public input handler", () => {
    let tree = renderList();
    const input = findElements(tree, (element) => element.props.id === "blacklist-local-search")[0];
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "needs-review" } });
    tree = renderList();
    expect(textContent(tree)).toContain("member-42");
    expect(textContent(tree)).not.toContain("alice@example.test");
    expect(textContent(findElements(tree, (element) => element.props["aria-live"] === "polite")[0])).toBe("顯示 1 筆黑名單");

    (findElements(tree, (element) => element.props.id === "blacklist-local-search")[0].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "   " } });
    tree = renderList();
    expect(textContent(findElements(tree, (element) => element.props["aria-live"] === "polite")[0])).toBe("顯示 3 筆黑名單");

    (findElements(tree, (element) => element.props.id === "blacklist-local-search")[0].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "does-not-exist" } });
    tree = renderList();
    expect(textContent(findElements(tree, (element) => element.props["aria-live"] === "polite")[0])).toBe("顯示 0 筆黑名單");
    expect(findElements(tree, (element) => element.type === "form")).toHaveLength(0);
    expect(textContent(tree)).not.toContain("alice@example.test");
  });

  it("renders an empty list safely without creating an unblock form", () => {
    const tree = renderList([]);
    expect(textContent(findElements(tree, (element) => element.props["aria-live"] === "polite")[0])).toBe("顯示 0 筆黑名單");
    expect(findElements(tree, (element) => element.type === "form")).toHaveLength(0);
    expect(textContent(tree)).not.toContain("解除封鎖");
    expect(renderToStaticMarkup(tree as never)).toContain("搜尋黑名單");
  });
});
