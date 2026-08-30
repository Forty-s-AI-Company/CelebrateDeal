import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  actionState: null as { status: "idle" | "success" | "error"; message: string } | null,
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

import { TeamTemplateForm } from "./team-template-form";

const action = async () => ({ status: "idle" as const, message: "" });

type ElementNode = {
  type: unknown;
  props: Record<string, unknown>;
};

function isElementNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && "props" in value && "type" in value;
}

function findElement(value: unknown, predicate: (element: ElementNode) => boolean): ElementNode | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const matchingChild = findElement(child, predicate);
      if (matchingChild) return matchingChild;
    }
    return undefined;
  }

  if (!isElementNode(value)) return undefined;
  if (predicate(value)) return value;
  return findElement(value.props.children, predicate);
}

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  return isElementNode(value) ? textContent(value.props.children) : "";
}

type FormProps = Parameters<typeof TeamTemplateForm>[0];

function renderForm(overrides: Partial<FormProps> = {}) {
  hookState.cursor = 0;
  return TeamTemplateForm({
    teams: [{ id: "team-1", name: "北區團隊" }],
    products: [{ id: "product-1", name: "主打課程" }],
    webinars: [{ id: "live-1", title: "七月 webinar", scheduledAt: "2026/07/17" }],
    csrfToken: "csrf-test-token",
    action,
    ...overrides,
  });
}

function formElement(tree: unknown) {
  const form = findElement(tree, (candidate) => candidate.type === "form");
  expect(form).toBeDefined();
  return form as ElementNode;
}

describe("TeamTemplateForm", () => {
  beforeEach(() => {
    hookState.cursor = 0;
    hookState.values = [];
    hookState.actionState = null;
    hookState.pending = false;
  });

  it("renders the selected locked fields and product-slot controls", () => {
    const html = renderToStaticMarkup(
      <TeamTemplateForm
        template={{ id: "template-1", teamId: "team-1", name: "A 的模板", slug: "leader-page", headline: "活動標題", ctaLabel: "立即報名", lockedFields: ["HEADLINE", "PRODUCT_SLOTS"] }}
        teams={[{ id: "team-1", name: "北區團隊" }]}
        products={[{ id: "product-1", name: "主打課程" }]}
        webinars={[{ id: "live-1", title: "七月 webinar", scheduledAt: "2026/07/17" }]}
        csrfToken="csrf-test-token"
        action={action}
      />,
    );

    expect(html).toContain('name="lockedFields"');
    expect(html).toMatch(/name="lockedFields" checked="" value="HEADLINE"/);
    expect(html).toMatch(/name="lockedFields" checked="" value="PRODUCT_SLOTS"/);
    expect(html).toContain("鎖定區塊");
    expect(html).toContain("商品槽選擇");
    expect(html).toContain('name="webinarId"');
  });

  it("shows the allowed dynamic fields without adding a second page builder", () => {
    const html = renderToStaticMarkup(
      <TeamTemplateForm teams={[{ id: "team-1", name: "北區團隊" }]} products={[]} webinars={[]} csrfToken="csrf-test-token" action={action} />,
    );

    expect(html).toContain("{{partner.displayName}}");
    expect(html).toContain("{{webinar.title}}");
    expect(html).toContain("建立原始頁");
  });

  it("renders create mode with an explicit operation and disables submit for an empty team list", () => {
    const tree = renderForm({ teams: [], products: [], webinars: [] });
    const form = formElement(tree);
    const operation = findElement(form, (candidate) => (
      candidate.type === "input" && candidate.props.name === "operation"
    ));

    expect(operation?.props.value).toBe("create");
    expect(findElement(form, (candidate) => candidate.props.name === "templateId")).toBeUndefined();
    expect(findElement(form, (candidate) => candidate.props.name === "sourcePageId")).toBeUndefined();
    expect(findElement(form, (candidate) => candidate.props.name === "name")).toBeDefined();

    const submit = findElement(form, (candidate) => textContent(candidate.props.children) === "建立原始頁");
    expect(submit?.props.disabled).toBe(true);
  });

  it("renders publish mode with immutable identifiers, webinar values, and product slots", () => {
    const tree = renderForm({
      template: {
        id: "template-2",
        sourcePageId: "source-page-2",
        teamId: "team-1",
        name: "既有模板",
        slug: "leader-page",
        headline: "活動標題",
        ctaLabel: "立即報名",
        webinarId: "live-1",
        productSlots: {
          main_product: { productId: "product-1", offerLabel: "主打優惠" },
        },
      },
    });
    const form = formElement(tree);
    const operation = findElement(form, (candidate) => (
      candidate.type === "input" && candidate.props.name === "operation"
    ));
    const templateId = findElement(form, (candidate) => candidate.props.name === "templateId");
    const sourcePageId = findElement(form, (candidate) => candidate.props.name === "sourcePageId");
    const webinar = findElement(form, (candidate) => candidate.props.name === "webinarId");
    const mainProduct = findElement(form, (candidate) => candidate.props.name === "product_main_product");

    expect(operation?.props.value).toBe("publish");
    expect(templateId?.props.value).toBe("template-2");
    expect(sourcePageId?.props.value).toBe("source-page-2");
    expect(findElement(form, (candidate) => candidate.props.name === "name")).toBeUndefined();
    expect(webinar?.props.defaultValue).toBe("live-1");
    expect(mainProduct?.props.defaultValue).toBe("product-1");
    expect(textContent(findElement(form, (candidate) => textContent(candidate.props.children).includes("發布會建立下一個不可變版本"))?.props.children)).toContain("發布會建立下一個不可變版本");
  });

  it("submits create and publish without a client confirmation blocker", () => {
    const globalScope = globalThis as Record<string, unknown>;
    const previousWindow = globalScope.window;
    const confirm = vi.fn(() => false);
    globalScope.window = { confirm };

    try {
      const publishForm = formElement(renderForm({ template: { id: "template-2", teamId: "team-1" } }));
      const createForm = formElement(renderForm());

      expect(publishForm.props.onSubmit).toBeUndefined();
      expect(createForm.props.onSubmit).toBeUndefined();
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      if (previousWindow === undefined) delete globalScope.window;
      else globalScope.window = previousWindow;
    }
  });

  it("renders success, error, and pending action states with fail-closed submit behavior", () => {
    hookState.actionState = { status: "success", message: "模板已儲存" };
    const successForm = formElement(renderForm());
    const successStatus = findElement(successForm, (candidate) => candidate.props.role === "status");
    expect(textContent(successStatus?.props.children)).toBe("模板已儲存");
    expect(successStatus?.props.className).toContain("emerald");

    hookState.actionState = { status: "error", message: "模板資料無效" };
    const errorForm = formElement(renderForm());
    const errorStatus = findElement(errorForm, (candidate) => candidate.props.role === "alert");
    expect(textContent(errorStatus?.props.children)).toBe("模板資料無效");
    expect(errorStatus?.props.className).toContain("red");

    hookState.actionState = null;
    hookState.pending = true;
    const pendingForm = formElement(renderForm());
    const submit = findElement(pendingForm, (candidate) => textContent(candidate.props.children) === "建立中…");
    expect(submit?.props.disabled).toBe(true);
    expect(submit?.props["aria-disabled"]).toBe(true);
    expect(submit?.props["aria-busy"]).toBe(true);
    expect(pendingForm.props["aria-busy"]).toBe(true);
    expect(textContent(submit?.props.children)).toBe("建立中…");
    expect(textContent(findElement(pendingForm, (candidate) => candidate.props.role === "status" && candidate.props.className === "sr-only")?.props.children)).toContain("正在建立團隊原始頁");

    const publishingForm = formElement(renderForm({ template: { id: "template-2", teamId: "team-1" } }));
    expect(textContent(findElement(publishingForm, (candidate) => candidate.type === "button" && candidate.props.type === "submit")?.props.children)).toBe("發布中…");
  });

  it("inserts a dynamic field at the active selection and safely handles missing targets", () => {
    const globalScope = globalThis as Record<string, unknown>;
    const previousDocument = globalScope.document;
    const previousEvent = globalScope.Event;
    const target = {
      value: "活動 {{webinar.title}} 內容",
      selectionStart: 3,
      selectionEnd: 20,
      dispatchEvent: vi.fn(),
      focus: vi.fn(),
    };
    const getElementById = vi.fn<() => typeof target | null>(() => target);
    class SyntheticEvent {
      type: string;
      bubbles: boolean;

      constructor(type: string, init: { bubbles?: boolean } = {}) {
        this.type = type;
        this.bubbles = init.bubbles ?? false;
      }
    }
    globalScope.document = { getElementById };
    globalScope.Event = SyntheticEvent;

    try {
      const tree = renderForm();
      const body = findElement(tree, (candidate) => (
        candidate.type === "textarea" && candidate.props.id === "team-template-body"
      ));
      (body?.props.onFocus as () => void)();
      const fieldButton = findElement(tree, (candidate) => (
        candidate.type === "button" && textContent(candidate.props.children) === "{{partner.name}}"
      ));
      expect(fieldButton).toBeDefined();
      (fieldButton?.props.onClick as () => void)();

      expect(getElementById).toHaveBeenCalledWith("team-template-body");
      expect(target.value).toBe("活動 {{partner.name}} 內容");
      expect(target.dispatchEvent).toHaveBeenCalledTimes(1);
      const dispatchedEvent = target.dispatchEvent.mock.calls[0]?.[0] as SyntheticEvent;
      expect(dispatchedEvent.type).toBe("input");
      expect(dispatchedEvent.bubbles).toBe(true);
      expect(target.focus).toHaveBeenCalledTimes(1);

      getElementById.mockReturnValue(null);
      const missingTargetButton = findElement(tree, (candidate) => (
        candidate.type === "button" && textContent(candidate.props.children) === "{{partner.email}}"
      ));
      expect(missingTargetButton).toBeDefined();
      (missingTargetButton?.props.onClick as () => void)();
      expect(target.dispatchEvent).toHaveBeenCalledTimes(1);
    } finally {
      if (previousDocument === undefined) delete globalScope.document;
      else globalScope.document = previousDocument;
      if (previousEvent === undefined) delete globalScope.Event;
      else globalScope.Event = previousEvent;
    }
  });

  it("uses the value tail when selection ranges are unavailable", () => {
    const globalScope = globalThis as Record<string, unknown>;
    const previousDocument = globalScope.document;
    const previousEvent = globalScope.Event;
    const target = {
      value: "內容",
      selectionStart: null as number | null,
      selectionEnd: null as number | null,
      dispatchEvent: vi.fn(),
      focus: vi.fn(),
    };
    const getElementById = vi.fn(() => target);
    globalScope.document = { getElementById };
    globalScope.Event = class {
      constructor(public readonly type: string, public readonly init: { bubbles?: boolean } = {}) {}
    };

    try {
      const tree = renderForm();
      const fieldButton = findElement(tree, (candidate) => (
        candidate.type === "button" && textContent(candidate.props.children) === "{{webinar.title}}"
      ));
      expect(fieldButton).toBeDefined();
      (fieldButton?.props.onClick as () => void)();
      expect(target.value).toBe("內容{{webinar.title}}");
      expect(target.dispatchEvent).toHaveBeenCalledTimes(1);
    } finally {
      if (previousDocument === undefined) delete globalScope.document;
      else globalScope.document = previousDocument;
      if (previousEvent === undefined) delete globalScope.Event;
      else globalScope.Event = previousEvent;
    }
  });
});
