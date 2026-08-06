import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  actionState: null as { status: "idle" | "success" | "error"; message: string; shareUrl?: string } | null,
  pending: false,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();

  return {
    ...react,
    useActionState: (_action: unknown, initialState: unknown) => {
      const index = hookState.cursor++;
      if (hookState.values.length === index) hookState.values.push(initialState);
      return [hookState.actionState ?? initialState, vi.fn(), hookState.pending];
    },
    useState: <Value,>(initialValue: Value) => {
      const index = hookState.cursor++;
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
import { TeamTemplateList } from "./team-template-list";

const action = async () => ({ status: "idle" as const, message: "" });

type ElementNode = {
  type: unknown;
  props: Record<string, unknown>;
};

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

const defaultTemplates: ListProps["templates"] = [{
  id: "template-1",
  name: "A 的 webinar 模板",
  teamId: "team-1",
  teamName: "北區團隊",
  status: "ACTIVE",
  latestVersion: 3,
  copiedPartnerCount: 8,
  sourcePage: { id: "page-1", slug: "leader-webinar", shareEnabled: true },
}];

function renderList(overrides: Partial<ListProps> = {}) {
  hookState.cursor = 0;
  return TeamTemplateList({ templates: defaultTemplates, csrfToken: "csrf-test-token", action, ...overrides });
}

function findFormByOperation(tree: unknown, operation: string) {
  const form = findElements(tree, (candidate) => (
    candidate.type === "form" && findElements(candidate.props.children, (child) => (
      child.type === "input" && child.props.name === "operation" && child.props.value === operation
    )).length > 0
  ))[0];
  expect(form).toBeDefined();
  return form as ElementNode;
}

describe("TeamTemplateList", () => {
  beforeEach(() => {
    hookState.cursor = 0;
    hookState.values = [];
    hookState.actionState = null;
    hookState.pending = false;
  });

  it("guides a leader when no template exists", () => {
    const html = renderToStaticMarkup(<TeamTemplateList templates={[]} csrfToken="csrf-test-token" action={action} />);

    expect(html).toContain("還沒有團隊模板");
    expect(html).toContain("建立第一個模板");
  });

  it("shows share status, copied partners, and a destructive confirmation path", () => {
    const html = renderToStaticMarkup(
      <TeamTemplateList
        csrfToken="csrf-test-token"
        action={action}
        templates={[{
          id: "template-1", name: "A 的 webinar 模板", teamId: "team-1", teamName: "北區團隊", status: "ACTIVE", latestVersion: 3, copiedPartnerCount: 8,
          sourcePage: { id: "page-1", slug: "leader-webinar", shareEnabled: true },
        }]}
      />,
    );

    expect(html).toContain("已複製給 8 位夥伴");
    expect(html).toContain("分享啟用中");
    expect(html).toContain("停用分享");
    expect(html).toContain('name="_csrf" value="csrf-test-token"');
  });

  it("renders active and draft badges with every source-page sharing state", () => {
    const tree = renderList({
      templates: [
        ...defaultTemplates,
        {
          id: "template-2",
          name: "草稿模板",
          teamId: "team-1",
          teamName: "北區團隊",
          status: "DRAFT",
          latestVersion: 1,
          copiedPartnerCount: 0,
          sourcePage: { id: "page-2", slug: "draft-webinar", shareEnabled: false },
        },
        {
          id: "template-3",
          name: "未綁定原始頁",
          teamId: "team-2",
          teamName: "南區團隊",
          status: "DRAFT",
          latestVersion: 2,
          copiedPartnerCount: 1,
          sourcePage: null,
        },
      ],
    });
    const html = renderToStaticMarkup(tree as never);
    const forms = findElements(tree, (candidate) => candidate.type === "form");

    expect(html).toContain("已發布");
    expect(html).toContain("草稿");
    expect(html).toContain("分享啟用中");
    expect(html).toContain("分享已停用");
    expect(html).toContain("沒有可分享的原始頁");
    expect(forms).toHaveLength(2);
    expect(findFormByOperation(tree, "disable-share")).toBeDefined();
    expect(findFormByOperation(tree, "create-share")).toBeDefined();
  });

  it("confirms disable-share actions and preserves the CSRF and tenant identifiers", () => {
    const globalScope = globalThis as Record<string, unknown>;
    const previousWindow = globalScope.window;
    const confirm = vi.fn(() => false);
    globalScope.window = { confirm };

    try {
      const tree = renderList();
      const disableForm = findFormByOperation(tree, "disable-share");
      const csrf = findElements(disableForm.props.children, (candidate) => candidate.props.name === "_csrf")[0];
      const teamId = findElements(disableForm.props.children, (candidate) => candidate.props.name === "teamId")[0];
      const pageId = findElements(disableForm.props.children, (candidate) => candidate.props.name === "pageId")[0];
      expect(csrf?.props.value).toBe("csrf-test-token");
      expect(teamId?.props.value).toBe("team-1");
      expect(pageId?.props.value).toBe("page-1");

      const blocked = { preventDefault: vi.fn() };
      (disableForm.props.onSubmit as (event: typeof blocked) => void)(blocked);
      expect(confirm).toHaveBeenCalledWith("確定要停用這個分享連結？已發出的連結會立刻失效。");
      expect(blocked.preventDefault).toHaveBeenCalledTimes(1);

      confirm.mockReturnValue(true);
      const allowed = { preventDefault: vi.fn() };
      (disableForm.props.onSubmit as (event: typeof allowed) => void)(allowed);
      expect(allowed.preventDefault).not.toHaveBeenCalled();
    } finally {
      if (previousWindow === undefined) delete globalScope.window;
      else globalScope.window = previousWindow;
    }
  });

  it("renders action success and error states without exposing extra data", () => {
    hookState.actionState = { status: "success", message: "分享連結已建立" };
    const successTree = renderList();
    const successStatus = findElements(successTree, (candidate) => candidate.props.role === "status")[0];
    expect(textContent(successStatus?.props.children)).toContain("分享連結已建立");
    expect(successStatus?.props.className).toContain("emerald");

    hookState.actionState = { status: "error", message: "分享連結建立失敗" };
    const errorTree = renderList();
    const errorStatus = findElements(errorTree, (candidate) => candidate.props.role === "status")[0];
    expect(textContent(errorStatus?.props.children)).toContain("分享連結建立失敗");
    expect(errorStatus?.props.className).toContain("red");
  });

  it("copies a relative share URL against the current origin and reports the copied state", async () => {
    const globalScope = globalThis as Record<string, unknown>;
    const previousWindow = globalScope.window;
    const previousNavigator = Object.getOwnPropertyDescriptor(globalScope, "navigator");
    const writeText = vi.fn(async (value: string) => {
      void value;
    });
    globalScope.window = { location: { origin: "https://merchant.example" } };
    Object.defineProperty(globalScope, "navigator", {
      configurable: true,
      writable: true,
      value: { clipboard: { writeText } },
    });

    try {
      const shareState: { status: "success"; message: string; shareUrl?: string } = { status: "success", message: "分享連結已建立", shareUrl: "/share/abc" };
      hookState.actionState = shareState;
      const tree = renderList();
      const copyButton = findElements(tree, (candidate) => (
        candidate.type === "button" && textContent(candidate.props.children) === "複製分享連結"
      ))[0];
      expect(copyButton).toBeDefined();
      await (copyButton?.props.onClick as () => Promise<void>)();
      expect(writeText).toHaveBeenCalledWith("https://merchant.example/share/abc");

      const rerendered = renderList();
      expect(findElements(rerendered, (candidate) => (
        candidate.type === "button" && textContent(candidate.props.children) === "已複製"
      ))).toHaveLength(1);

      shareState.shareUrl = undefined;
      const noShareButton = findElements(rerendered, (candidate) => candidate.type === "button" && textContent(candidate.props.children) === "已複製")[0];
      expect(noShareButton).toBeDefined();
      await (noShareButton?.props.onClick as () => Promise<void>)();
      expect(writeText).toHaveBeenCalledTimes(1);
    } finally {
      if (previousWindow === undefined) delete globalScope.window;
      else globalScope.window = previousWindow;
      if (previousNavigator === undefined) delete globalScope.navigator;
      else Object.defineProperty(globalScope, "navigator", previousNavigator);
    }
  });

  it("disables share mutations and exposes pending labels for both operations", () => {
    hookState.pending = true;
    const disableTree = renderList();
    const disableForm = findFormByOperation(disableTree, "disable-share");
    const disableButton = findElements(disableForm.props.children, (candidate) => candidate.type === "button")[0];
    expect(disableButton?.props.disabled).toBe(true);
    expect(textContent(disableButton?.props.children)).toContain("處理中…");

    const createTree = renderList({
      templates: [{ ...defaultTemplates[0], sourcePage: { id: "page-1", slug: "leader-webinar", shareEnabled: false } }],
    });
    const createForm = findFormByOperation(createTree, "create-share");
    const createButton = findElements(createForm.props.children, (candidate) => candidate.type === "button")[0];
    expect(createButton?.props.disabled).toBe(true);
    expect(textContent(createButton?.props.children)).toContain("建立中…");
  });
});
