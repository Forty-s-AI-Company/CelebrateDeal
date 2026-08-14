import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  actionCursor: 0,
  stateCursor: 0,
  formStatusCursor: 0,
  values: [] as unknown[],
  actionStates: [] as Array<{ status: "idle" | "success" | "error"; message: string; shareUrl?: string }>,
  formPendings: [] as boolean[],
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();

  return {
    ...react,
    useActionState: (_action: unknown, initialState: unknown) => {
      const index = hookState.actionCursor++;
      return [hookState.actionStates[index] ?? initialState, vi.fn(), false];
    },
    useState: <Value,>(initialValue: Value) => {
      const index = hookState.stateCursor++;
      if (hookState.values.length === index) hookState.values.push(initialValue);
      const setValue = (nextValue: Value | ((currentValue: Value) => Value)) => {
        const currentValue = hookState.values[index] as Value;
        hookState.values[index] = typeof nextValue === "function"
          ? (nextValue as (currentValue: Value) => Value)(currentValue)
          : nextValue;
      };
      return [hookState.values[index] as Value, setValue];
    },
  };
});

vi.mock("react-dom", async (importOriginal) => {
  const reactDom = await importOriginal<typeof import("react-dom")>();
  return {
    ...reactDom,
    useFormStatus: () => ({
      pending: hookState.formPendings[hookState.formStatusCursor++] ?? false,
      data: null,
      method: null,
      action: null,
    }),
  };
});

import { FormSubmitButton } from "./form-submit-button";
import { TeamTemplateList, TeamTemplateShareActions } from "./team-template-list";

const action = async () => ({ status: "idle" as const, message: "" });

type ElementNode = { type: unknown; props: Record<string, unknown> };

function isElementNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && "props" in value && "type" in value;
}

function findElements(value: unknown, predicate: (element: ElementNode) => boolean, result: ElementNode[] = []) {
  if (Array.isArray(value)) {
    for (const child of value) findElements(child, predicate, result);
    return result;
  }
  if (!isElementNode(value)) return result;
  if (predicate(value)) result.push(value);
  findElements(value.props.children, predicate, result);
  return result;
}

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  return isElementNode(value) ? textContent(value.props.children) : "";
}

type ListProps = Parameters<typeof TeamTemplateList>[0];
type ShareProps = Parameters<typeof TeamTemplateShareActions>[0];

const activeTemplate: ListProps["templates"][number] = {
  id: "template-1",
  name: "A 的 webinar 模板",
  teamId: "team-1",
  teamName: "北區團隊",
  status: "ACTIVE",
  latestVersion: 3,
  copiedPartnerCount: 8,
  sourcePage: { id: "page-1", slug: "leader-webinar", shareEnabled: true },
};

const inactiveTemplate: ListProps["templates"][number] = {
  ...activeTemplate,
  id: "template-2",
  name: "草稿模板",
  status: "DRAFT",
  sourcePage: { id: "page-2", slug: "draft-webinar", shareEnabled: false },
};

function resetRenderCursors() {
  hookState.actionCursor = 0;
  hookState.stateCursor = 0;
  hookState.formStatusCursor = 0;
}

function renderShare(overrides: Partial<ShareProps> = {}) {
  resetRenderCursors();
  return TeamTemplateShareActions({
    template: activeTemplate,
    sourcePage: activeTemplate.sourcePage!,
    csrfToken: "csrf-test-token",
    action,
    ...overrides,
  });
}

describe("TeamTemplateList", () => {
  beforeEach(() => {
    resetRenderCursors();
    hookState.values = [];
    hookState.actionStates = [];
    hookState.formPendings = [];
  });

  it("guides a leader when no template exists", () => {
    const html = renderToStaticMarkup(<TeamTemplateList templates={[]} csrfToken="csrf-test-token" action={action} />);
    expect(html).toContain("還沒有團隊模板");
    expect(html).toContain("建立第一個模板");
  });

  it("renders all source-page sharing states and leaves an unbound template without mutation controls", () => {
    const html = renderToStaticMarkup(
      <TeamTemplateList
        templates={[activeTemplate, inactiveTemplate, { ...inactiveTemplate, id: "template-3", sourcePage: null }]}
        csrfToken="csrf-test-token"
        action={action}
      />,
    );
    expect(html).toContain("已複製給 8 位夥伴");
    expect(html).toContain("分享啟用中");
    expect(html).toContain("分享已停用");
    expect(html).toContain("沒有可分享的原始頁");
    expect(html.match(/name="operation"/g)).toHaveLength(2);
  });

  it("preserves CSRF and tenant identifiers and delegates destructive confirmation to the submit control", () => {
    const tree = renderShare();
    const hiddenInputs = findElements(tree, (element) => element.type === "input");
    const submit = findElements(tree, (element) => element.type === FormSubmitButton)[0];
    const values = Object.fromEntries(hiddenInputs.map((input) => [input.props.name, input.props.value]));

    expect(values).toEqual({
      _csrf: "csrf-test-token",
      operation: "disable-share",
      teamId: "team-1",
      pageId: "page-1",
    });
    expect(submit.props.confirmMessage).toBe("確定要停用這個分享連結？已發出的連結會立刻失效。");
  });

  it("keeps action results attributed to their own rows with accessible success and error semantics", () => {
    hookState.actionStates = [
      { status: "success", message: "第一列分享已停用" },
      { status: "error", message: "第二列建立失敗" },
    ];
    const html = renderToStaticMarkup(
      <TeamTemplateList templates={[activeTemplate, inactiveTemplate]} csrfToken="csrf-test-token" action={action} />,
    );

    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain("第一列分享已停用");
    expect(html).toContain('role="alert"');
    expect(html).toContain("第二列建立失敗");
  });

  it("only marks the submitted row pending when multiple templates are present", () => {
    hookState.formPendings = [true, false];
    const html = renderToStaticMarkup(
      <TeamTemplateList templates={[activeTemplate, inactiveTemplate]} csrfToken="csrf-test-token" action={action} />,
    );

    expect(html.match(/aria-busy="true"/g)).toHaveLength(1);
    expect(html.match(/處理中…/g)).toHaveLength(1);
    expect(html).toContain("建立分享連結");
    expect(html).toContain("正在停用「A 的 webinar 模板」的分享連結。");
  });

  it("creates a share with the correct operation and no destructive confirmation", () => {
    const tree = renderShare({ sourcePage: inactiveTemplate.sourcePage! });
    const operation = findElements(tree, (element) => element.props.name === "operation")[0];
    const submit = findElements(tree, (element) => element.type === FormSubmitButton)[0];
    expect(operation.props.value).toBe("create-share");
    expect(submit.props.confirmMessage).toBeUndefined();
    expect(textContent(submit.props.children)).toContain("建立分享連結");
  });

  it("copies a relative share URL against the current origin and reports success", async () => {
    const globalScope = globalThis as Record<string, unknown>;
    const previousWindow = globalScope.window;
    const previousNavigator = Object.getOwnPropertyDescriptor(globalScope, "navigator");
    const writeText = vi.fn(async () => undefined);
    globalScope.window = { location: { origin: "https://merchant.example" } };
    Object.defineProperty(globalScope, "navigator", { configurable: true, value: { clipboard: { writeText } } });

    try {
      hookState.actionStates = [{ status: "success", message: "分享連結已建立", shareUrl: "/share/abc" }];
      const tree = renderShare();
      const copyButton = findElements(tree, (element) => element.type === "button")[0];
      await (copyButton.props.onClick as () => Promise<void>)();
      expect(writeText).toHaveBeenCalledWith("https://merchant.example/share/abc");

      const rerendered = renderShare();
      expect(textContent(findElements(rerendered, (element) => element.type === "button")[0])).toContain("已複製");
    } finally {
      if (previousWindow === undefined) delete globalScope.window;
      else globalScope.window = previousWindow;
      if (previousNavigator === undefined) delete globalScope.navigator;
      else Object.defineProperty(globalScope, "navigator", previousNavigator);
    }
  });

  it("offers a retry and an assertive accessible message when clipboard access fails", async () => {
    const globalScope = globalThis as Record<string, unknown>;
    const previousWindow = globalScope.window;
    const previousNavigator = Object.getOwnPropertyDescriptor(globalScope, "navigator");
    globalScope.window = { location: { origin: "https://merchant.example" } };
    Object.defineProperty(globalScope, "navigator", {
      configurable: true,
      value: { clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } },
    });

    try {
      hookState.actionStates = [{ status: "success", message: "分享連結已建立", shareUrl: "/share/abc" }];
      const tree = renderShare();
      await (findElements(tree, (element) => element.type === "button")[0].props.onClick as () => Promise<void>)();

      const rerendered = renderShare();
      expect(textContent(findElements(rerendered, (element) => element.type === "button")[0])).toContain("複製失敗，重試");
      expect(textContent(findElements(rerendered, (element) => element.props.role === "alert")[0])).toContain("請重試或手動複製");
    } finally {
      if (previousWindow === undefined) delete globalScope.window;
      else globalScope.window = previousWindow;
      if (previousNavigator === undefined) delete globalScope.navigator;
      else Object.defineProperty(globalScope, "navigator", previousNavigator);
    }
  });
});
