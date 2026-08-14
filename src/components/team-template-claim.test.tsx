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
    useActionState: (_action: unknown, initial: unknown) => {
      const index = hookState.cursor++;
      if (hookState.values.length === index) hookState.values.push(initial);
      return [hookState.actionState ?? initial, vi.fn(), hookState.pending] as const;
    },
    useState: (initial: unknown) => {
      const index = hookState.cursor++;
      if (hookState.values.length === index) hookState.values.push(initial);
      const setValue = (next: unknown) => {
        hookState.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(hookState.values[index]) : next;
      };
      return [hookState.values[index], setValue] as const;
    },
  };
});

vi.mock("react-dom", async (importOriginal) => {
  const reactDom = await importOriginal<typeof import("react-dom")>();
  return {
    ...reactDom,
    useFormStatus: () => ({ pending: hookState.pending, data: null, method: null, action: null }),
  };
});

import { TeamTemplateClaim, TeamTemplateClaimError } from "./team-template-claim";

const action = async () => ({ status: "idle" as const, message: "" });
const template: Parameters<typeof TeamTemplateClaim>[0]["template"] = { teamId: "team-1", shareCode: "tf1.claim.test", sourceOwnerName: "A 領隊", templateName: "A 的研討會模板", version: 4, webinar: "七月 webinar", lockedFields: ["HEADLINE", "PRODUCT_SLOTS"] };

type ElementNode = { type: unknown; props: Record<string, unknown> };

function isElementNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && "props" in value && "type" in value;
}

function findElements(node: unknown, predicate: (element: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, predicate));
  if (!isElementNode(node)) return [];
  const matches = predicate(node) ? [node] : [];
  return [...matches, ...findElements(node.props.children, predicate)];
}

function textContent(node: unknown): string {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isElementNode(node)) return "";
  return textContent(node.props.children);
}

function renderClaim(overrides: Partial<typeof template> = {}) {
  hookState.cursor = 0;
  return TeamTemplateClaim({ template: { ...template, ...overrides }, csrfToken: "csrf-test-token", action });
}

beforeEach(() => {
  hookState.cursor = 0;
  hookState.values = [];
  hookState.actionState = null;
  hookState.pending = false;
});

describe("TeamTemplateClaim", () => {
  it("shows source metadata, locked scope, all three modes, and an explicit confirmation", () => {
    const html = renderToStaticMarkup(<TeamTemplateClaim csrfToken="csrf-test-token" action={action} template={{ teamId: "team-1", shareCode: "tf1.claim.test", sourceOwnerName: "A 領隊", templateName: "A 的研討會模板", version: 4, webinar: "七月 webinar", lockedFields: ["HEADLINE", "PRODUCT_SLOTS"] }} />);
    expect(html).toContain("來源 A");
    expect(html).toContain("A 領隊");
    expect(html).toContain("A 的研討會模板");
    expect(html).toContain("v4");
    expect(html).toContain("七月 webinar");
    expect(html).toContain("快速套用");
    expect(html).toContain("複製後編輯");
    expect(html).toContain("空白頁綁定研討會");
    expect(html).toContain("確認並建立夥伴頁");
    expect(html).toContain('name="_csrf" value="csrf-test-token"');
  });

  it("uses one non-disclosing security state for expired, disabled, and foreign-team shares", () => {
    expect(renderToStaticMarkup(<TeamTemplateClaimError state="expired" />)).toContain("已過期");
    expect(renderToStaticMarkup(<TeamTemplateClaimError state="disabled" />)).toContain("已停用");
    expect(renderToStaticMarkup(<TeamTemplateClaimError state="not_team" />)).toContain("不屬於你的團隊");
  });

  it("renders safe webinar and locked-field fallbacks without hiding unknown values", () => {
    const tree = renderClaim({ webinar: null, lockedFields: ["HEADLINE", "UNKNOWN_FIELD"] });
    expect(textContent(tree)).toContain("未綁定研討會");
    expect(textContent(tree)).toContain("主標題、UNKNOWN_FIELD");
    expect(textContent(renderClaim({ lockedFields: [] }))).toContain("鎖定範圍無");
  });

  it("keeps the hidden mode in sync with deterministic radio transitions", () => {
    let tree = renderClaim();
    const radios = () => findElements(tree, (element) => element.props.name === "mode-option");
    const hiddenMode = () => findElements(tree, (element) => element.props.name === "mode")[0];
    expect(radios()[0].props.checked).toBe(true);
    expect(hiddenMode().props.value).toBe("QUICK_APPLY");

    (radios()[1].props.onChange as () => void)();
    tree = renderClaim();
    expect(radios()[1].props.checked).toBe(true);
    expect(hiddenMode().props.value).toBe("COPY_THEN_EDIT");
    const modeLabels = findElements(tree, (element) => element.type === "label");
    expect(modeLabels[0].props.className).toContain("border-border");
    expect(modeLabels[1].props.className).toContain("border-blue-600");

    (radios()[2].props.onChange as () => void)();
    tree = renderClaim();
    expect(radios()[2].props.checked).toBe(true);
    expect(hiddenMode().props.value).toBe("BLANK_PAGE_BOUND_TO_A_WEBINAR");
    expect(findElements(tree, (element) => element.type === "label")[2].props.className).toContain("border-blue-600");
  });

  it("renders success and error action states with distinct safe presentation", () => {
    hookState.actionState = { status: "success", message: "已建立夥伴頁" };
    const success = findElements(renderClaim(), (element) => element.props.role === "status")[0];
    expect(success.props.className).toContain("emerald");
    expect(textContent(success)).toBe("已建立夥伴頁");
    expect(Array.isArray(success.props.children)).toBe(true);
    expect((success.props.children as unknown[])).toHaveLength(2);

    hookState.actionState = { status: "error", message: "無法建立" };
    const error = findElements(renderClaim(), (element) => element.props.role === "alert")[0];
    expect(error.props.className).toContain("red");
    expect(textContent(error)).toBe("無法建立");
    expect(error.props.children).toEqual([null, "無法建立"]);
  });

  it("disables submission while pending and preserves form safety constraints", () => {
    hookState.pending = true;
    const pendingHtml = renderToStaticMarkup(<TeamTemplateClaim template={template} csrfToken="csrf-test-token" action={action} />);
    expect(pendingHtml).toContain("disabled");
    expect(pendingHtml).toContain('aria-busy="true"');
    expect(pendingHtml).toContain("建立中…");
    expect(pendingHtml).toContain("正在建立夥伴頁，請勿重複送出。");

    hookState.pending = false;
    const tree = renderClaim();
    const inputs = findElements(tree, (element) => element.type === "input");
    const slug = inputs.find((element) => element.props.name === "slug");
    const confirmed = inputs.find((element) => element.props.name === "confirmed");
    expect(slug?.props.required).toBe(true);
    expect(slug?.props.pattern).toBe("[a-z0-9]+(-[a-z0-9]+)*");
    expect(confirmed?.props.required).toBe(true);
    expect(confirmed?.props.value).toBe("yes");
    expect(textContent(tree)).toContain("確認並建立夥伴頁");
  });
});
