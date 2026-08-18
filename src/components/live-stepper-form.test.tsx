import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Product } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLiveStudioDraft } from "@/lib/live-studio-draft";

const hookState = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
}));
const draftMocks = vi.hoisted(() => ({
  getCurrentClaim: vi.fn(() => ({ draftId: "draft-1", revision: 2 })),
  isCurrentFormSaved: vi.fn(() => true),
  saveNow: vi.fn().mockResolvedValue({ draftId: "draft-1", revision: 2 }),
  scheduleSave: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();

  return {
    ...react,
    useEffect: (effect: () => void | (() => void)) => { effect(); },
    useState: <Value,>(initialValue: Value) => {
      const index = hookState.cursor++;
      if (!(index in hookState.values)) hookState.values[index] = initialValue;

      const setValue = (nextValue: Value | ((currentValue: Value) => Value)) => {
        const currentValue = hookState.values[index] as Value;
        hookState.values[index] = typeof nextValue === "function"
          ? (nextValue as (currentValue: Value) => Value)(currentValue)
          : nextValue;
      };

      return [hookState.values[index] as Value, setValue];
    },
    useRef: <Value,>(initialValue: Value) => {
      const index = hookState.cursor++;
      if (!hookState.refs[index]) hookState.refs[index] = { current: initialValue };
      return hookState.refs[index] as { current: Value };
    },
  };
});

vi.mock("@/app/actions", () => ({ upsertLiveAction: vi.fn() }));
vi.mock("@/components/use-live-studio-draft", () => ({
  useLiveStudioDraft: () => ({
    status: "saved",
    draftId: "draft-1",
    revision: 2,
    updatedAt: "2026-08-08T01:00:00.000Z",
    errorCode: "",
    canSubmit: true,
    message: "草稿已儲存，可安全離開後再繼續。",
    getCurrentClaim: draftMocks.getCurrentClaim,
    isCurrentFormSaved: draftMocks.isCurrentFormSaved,
    saveNow: draftMocks.saveNow,
    scheduleSave: draftMocks.scheduleSave,
  }),
}));
vi.mock("@/components/stream-allocation-editor", () => ({
  StreamAllocationEditor: ({ members, pages }: { members: Array<{ label: string }>; pages: Array<{ label: string }> }) => (
    <section>
      <h3>Stream 用量與額度分配</h3>
      {members.map((member) => <span key={member.label}>{member.label}</span>)}
      {pages.map((page) => <span key={page.label}>{page.label}</span>)}
      <input type="hidden" name="customAllocations" value="[]" />
      <input type="hidden" name="memberQuotas" value="[]" />
      <input type="hidden" name="pageQuotas" value="[]" />
    </section>
  ),
}));

import { LiveStepperForm } from "./live-stepper-form";

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

const products: Product[] = [
  {
    id: "test-fixture-product-1",
    vendorId: "test-fixture-vendor-1",
    name: "亮白精華組",
    slug: "test-fixture-brightening-serum",
    description: null,
    priceCents: 128000,
    compareAtCents: null,
    currency: "TWD",
    imageUrl: null,
    imageAssetId: null,
    checkoutUrl: null,
    inventory: 12,
    isActive: true,
    commerceDomain: "merchant",
    fulfillmentType: "physical",
    fulfillmentTypeConfirmed: true,
    courseContentOwnerMembershipId: null,
    coursePromoterShareBps: null,
    coursePolicyVersion: 1,
    revision: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "test-fixture-product-2",
    vendorId: "test-fixture-vendor-1",
    name: "保濕修護霜",
    slug: "test-fixture-repair-cream",
    description: null,
    priceCents: 98000,
    compareAtCents: null,
    currency: "TWD",
    imageUrl: null,
    imageAssetId: null,
    checkoutUrl: null,
    inventory: 8,
    isActive: true,
    commerceDomain: "merchant",
    fulfillmentType: "physical",
    fulfillmentTypeConfirmed: true,
    courseContentOwnerMembershipId: null,
    coursePromoterShareBps: null,
    coursePolicyVersion: 1,
    revision: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "test-fixture-product-3",
    vendorId: "test-fixture-vendor-1",
    name: "夜間舒緩面膜",
    slug: "test-fixture-night-mask",
    description: null,
    priceCents: 68000,
    compareAtCents: null,
    currency: "TWD",
    imageUrl: null,
    imageAssetId: null,
    checkoutUrl: null,
    inventory: 20,
    isActive: true,
    commerceDomain: "merchant",
    fulfillmentType: "physical",
    fulfillmentTypeConfirmed: true,
    courseContentOwnerMembershipId: null,
    coursePromoterShareBps: null,
    coursePolicyVersion: 1,
    revision: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
];

type FormOverrides = Partial<Parameters<typeof LiveStepperForm>[0]>;

function renderForm(availableProducts: Product[] = products, overrides: FormOverrides = {}) {
  hookState.cursor = 0;
  return LiveStepperForm({
    videos: [],
    forms: [],
    templates: [],
    scripts: [],
    affiliates: [],
    streamMembers: [],
    streamPages: [],
    csrfToken: "test-fixture-csrf-token",
    timeZone: "Asia/Taipei",
    ...overrides,
    products: availableProducts,
  });
}

function control(tree: unknown, name: string, value?: string) {
  const element = findElement(tree, (candidate) => (
    candidate.type === "input" &&
    candidate.props.name === name &&
    (value === undefined || candidate.props.value === value)
  ));

  expect(element).toBeDefined();
  return element as ElementNode & {
    props: Record<string, unknown> & {
      onChange: (event: { target: { value?: string; checked?: boolean } }) => void;
    };
  };
}

function selectControl(tree: unknown, name: string) {
  const element = findElement(tree, (candidate) => (
    candidate.type === "select" && candidate.props.name === name
  ));

  expect(element).toBeDefined();
  return element as ElementNode & {
    props: Record<string, unknown> & {
      onChange: (event: { target: { value: string } }) => void;
    };
  };
}

function productSelection(tree: unknown) {
  const element = findElement(tree, (candidate) => (
    typeof candidate.type === "function" && candidate.type.name === "ProductSelection"
  ));
  expect(element).toBeDefined();
  return element as ElementNode & {
    props: Record<string, unknown> & {
      onSelectionChange: (productId: string, checked: boolean) => void;
    };
  };
}

function submitAction(tree: unknown, label: string) {
  const actions = findElement(tree, (candidate) => (
    typeof candidate.type === "function" && candidate.type.name === "LiveSubmitActions"
  ));
  expect(actions).toBeDefined();
  const renderedActions = (actions?.type as (props: Record<string, unknown>) => unknown)(actions?.props ?? {});
  return findElement(renderedActions, (candidate) => (
    typeof candidate.type === "function"
    && candidate.type.name === "FormSubmitButton"
    && textContent(candidate.props.children) === label
  ));
}

function stepButton(tree: unknown, label: string) {
  return findElement(tree, (candidate) => (
    candidate.type === "button" && textContent(candidate.props.children).includes(label)
  ));
}

function showPublishPreview(tree: unknown) {
  let currentTree = tree;
  for (let step = 0; step < 7; step += 1) {
    const nextButton = findElement(currentTree, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "下一步"
    ));
    expect(nextButton).toBeDefined();
    (nextButton?.props.onClick as () => void)();
    currentTree = renderForm();
  }

  const publishPanel = findElement(currentTree, (candidate) => (
    candidate.props.active === true && candidate.props.index === 7
  ));
  expect(publishPanel).toBeDefined();
  return renderToStaticMarkup(publishPanel as unknown as ReactElement);
}

describe("LiveStepperForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookState.cursor = 0;
    hookState.values = [];
    hookState.refs = [];
    draftMocks.isCurrentFormSaved.mockReturnValue(true);
    draftMocks.getCurrentClaim.mockReturnValue({ draftId: "draft-1", revision: 2 });
    draftMocks.saveNow.mockResolvedValue({ draftId: "draft-1", revision: 2 });
  });

  it("shows the tenant timezone beside the schedule input without submitting a timezone field", () => {
    const markup = renderToStaticMarkup(renderForm([], { timeZone: "America/New_York" }) as ReactElement);

    expect(markup).toContain("開播時間（America/New_York）");
    expect(markup).toContain("請依商家時區輸入");
    expect(markup).not.toContain('name="timezone"');
  });

  it("shows stable default copy in the empty publish preview", () => {
    const preview = showPublishPreview(renderForm([]));

    expect(preview).toContain("未命名直播");
    expect(preview).toContain("直播限定優惠");
    expect(preview).toContain("尚未選擇主打商品");
  });

  it("keeps an accessible live preview available while editing earlier steps", () => {
    const markup = renderToStaticMarkup(renderForm([]) as ReactElement);

    expect(markup).toContain("即時手機預覽");
    expect(markup).toContain("查看即時手機預覽");
    expect(markup).toContain('aria-labelledby="live-studio-preview-title"');
    expect(markup).toContain("修改標題、促銷短句或商品時會同步更新。");
  });

  it("offers a persisted purpose starter and selects commerce without submitting the form", () => {
    const form = renderForm([]);
    const starter = findElement(form, (candidate) => (
      typeof candidate.type === "function" && candidate.type.name === "LiveStudioPurposeStarter"
    ));
    expect(starter).toBeDefined();
    const renderedStarter = (starter?.type as (props: Record<string, unknown>) => unknown)(starter?.props ?? {});
    const commerceButton = findElement(renderedStarter, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children).includes("商品銷售直播")
    ));

    expect(commerceButton?.props.type).toBe("button");
    expect(commerceButton?.props["aria-pressed"]).toBe(false);
    (commerceButton?.props.onClick as () => void)();

    const selectedForm = renderForm([]);
    const selectedStarter = findElement(selectedForm, (candidate) => (
      typeof candidate.type === "function" && candidate.type.name === "LiveStudioPurposeStarter"
    ));
    expect(selectedStarter?.props.selectedPreset).toBe("COMMERCE");
    expect(draftMocks.scheduleSave).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(renderForm([], { liveId: "live-1" }) as ReactElement)).not.toContain("先選這場直播的用途");
  });

  it("does not expose a writable Cloudflare Live Input UID field", () => {
    const form = renderForm();
    const providerUidInput = findElement(form, (candidate) => (
      candidate.type === "input" && candidate.props.name === "cloudflareLiveInputUid"
    ));

    expect(providerUidInput).toBeUndefined();
  });

  it("marks the current step and connects every step control to its panel", () => {
    const form = renderForm();
    const basicsButton = stepButton(form, "用途與基本資料");

    expect(basicsButton?.props["aria-current"]).toBe("step");
    expect(basicsButton?.props["aria-controls"]).toBe("live-step-panel-0");
    const labels = ["用途與基本資料", "媒體與 Live Input", "商品優惠", "報名頁", "時間、回放與品牌", "Email", "留言、商品浮窗與 CTA", "桌機／手機預覽發布"];
    labels.forEach((label, index) => {
      expect(stepButton(form, label)?.props["aria-controls"]).toBe(`live-step-panel-${index}`);
    });
  });

  it("keeps every field in its canonical eight-step panel", () => {
    const form = renderForm();
    const expectedFields = [
      [0, ["studioPreset", "title", "slug", "description"]],
      [1, ["streamMode", "videoId"]],
      [2, ["accentCopy"]],
      [3, ["formId"]],
      [4, ["replayEnabled"]],
      [5, ["messageTemplateId", "liveReminderTemplateId", "liveReminderOffsetMinutes"]],
      [6, ["interactionScriptId"]],
    ] as const;

    for (const [index, names] of expectedFields) {
      const panel = findElement(form, (candidate) => candidate.props.index === index && "active" in candidate.props);
      expect(panel).toBeDefined();
      for (const name of names) {
        expect(
          findElement(panel?.props.children, (candidate) => candidate.props.name === name),
          `step ${index + 1} should own ${name}`,
        ).toBeDefined();
      }
    }
    const productPanel = findElement(form, (candidate) => candidate.props.index === 2 && "active" in candidate.props);
    expect(findElement(productPanel?.props.children, (candidate) => typeof candidate.type === "function" && candidate.type.name === "ProductSelection")).toBeDefined();
    const brandPanel = findElement(form, (candidate) => candidate.props.index === 4 && "active" in candidate.props);
    expect(findElement(brandPanel?.props.children, (candidate) => (
      typeof candidate.type === "function" && candidate.type.name === "ScheduleDateTimeField"
    ))).toBeDefined();
    expect(findElement(brandPanel?.props.children, (candidate) => (
      typeof candidate.type === "function" && candidate.type.name === "MediaUploadField" && candidate.props.urlInputName === "heroImageUrl"
    ))).toBeDefined();
    const interactionPanel = findElement(form, (candidate) => candidate.props.index === 6 && "active" in candidate.props);
    expect(findElement(interactionPanel?.props.children, (candidate) => (
      typeof candidate.type === "function" && candidate.type.name === "LiveRulesFields"
    ))).toBeDefined();
  });

  it("shows an instructive empty product state instead of a blank panel", () => {
    const form = renderForm([]);
    const productButton = stepButton(form, "商品優惠");
    expect(productButton).toBeDefined();

    const onClick = productButton?.props.onClick as () => void;
    onClick();
    const productPanel = findElement(renderForm([]), (candidate) => candidate.props.active === true);
    const markup = renderToStaticMarkup(productPanel as unknown as ReactElement);
    expect(markup).toContain("目前沒有可綁定的啟用商品");
    expect(markup).toContain('href="/products/new"');
  });

  it("updates the publish phone preview with entered copy and selected product summary", () => {
    const form = renderForm();
    control(form, "title").props.onChange({ target: { value: "夏日保養直播" } });
    control(form, "accentCopy").props.onChange({ target: { value: "今晚滿額免運" } });
    const selection = productSelection(form);
    for (const product of products) selection.props.onSelectionChange(product.id, true);

    const preview = showPublishPreview(form);

    expect(preview).toContain("夏日保養直播");
    expect(preview).toContain("今晚滿額免運");
    expect(preview).toContain("亮白精華組");
    expect(preview).toContain("保濕修護霜");
    expect(preview).toContain("及其他 1 件商品");
    expect(preview).not.toContain("尚未選擇主打商品");
  });

  it("moves between steps in both directions and keeps the active panel linked", () => {
    const form = renderForm();
    const nextButton = findElement(form, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "下一步"
    ));
    expect(nextButton).toBeDefined();
    (nextButton?.props.onClick as () => void)();

    const conversionForm = renderForm();
    const conversionButton = stepButton(conversionForm, "媒體與 Live Input");
    expect(conversionButton?.props["aria-current"]).toBe("step");
    expect(conversionButton?.props["aria-controls"]).toBe("live-step-panel-1");
    const activePanel = findElement(conversionForm, (candidate) => candidate.props.active === true);
    expect(activePanel?.props.index).toBe(1);

    const previousButton = findElement(conversionForm, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "上一步"
    ));
    expect(previousButton).toBeDefined();
    (previousButton?.props.onClick as () => void)();
    const basicsForm = renderForm();
    const basicsButton = stepButton(basicsForm, "用途與基本資料");
    expect(basicsButton?.props["aria-current"]).toBe("step");
    expect(findElement(basicsForm, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "上一步"
    ))?.props.disabled).toBe(true);
  });

  it("reports required-field validation and refuses to advance until the panel is valid", () => {
    const reportValidity = vi.fn();
    let invalidControl: { reportValidity: () => void } | null = { reportValidity };
    const panel = {
      querySelector: vi.fn(() => invalidControl),
    };
    const formNode = {
      querySelector: vi.fn(() => panel),
    };
    const form = renderForm();
    const formRef = hookState.refs[7];
    expect(formRef).toBeDefined();
    formRef.current = formNode;

    const nextButton = findElement(form, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "下一步"
    ));
    expect(nextButton).toBeDefined();
    (nextButton?.props.onClick as () => void)();

    const blockedForm = renderForm();
    const status = findElement(blockedForm, (candidate) => candidate.props.role === "status");
    expect(textContent(status?.props.children)).toBe("請先完成本步驟的必填欄位，再繼續下一步。");
    expect(reportValidity).toHaveBeenCalledTimes(1);
    expect(panel.querySelector).toHaveBeenCalledWith("input:invalid, select:invalid, textarea:invalid");

    invalidControl = null;
    const retryButton = findElement(blockedForm, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "下一步"
    ));
    expect(retryButton).toBeDefined();
    (retryButton?.props.onClick as () => void)();
    const advancedForm = renderForm();
    const conversionButton = stepButton(advancedForm, "媒體與 Live Input");
    expect(conversionButton?.props["aria-current"]).toBe("step");
  });

  it("moves to the invalid field step, focuses the field, and renders invalid-reference feedback", () => {
    const globalScope = globalThis as Record<string, unknown>;
    const previousHTMLElement = globalScope.HTMLElement;
    const previousRequestAnimationFrame = globalScope.requestAnimationFrame;

    class SyntheticHTMLElement {
      focus = vi.fn();
      closest = vi.fn(() => ({ dataset: { stepIndex: "3" } }));
    }

    globalScope.HTMLElement = SyntheticHTMLElement;
    globalScope.requestAnimationFrame = (callback: (timestamp: number) => void) => {
      callback(0);
      return 0;
    };

    try {
      const form = renderForm(products, { error: "invalid_reference" });
      const control = new SyntheticHTMLElement();
      const preventDefault = vi.fn();
      const onInvalid = form.props.onInvalid as (event: {
        preventDefault: () => void;
        target: unknown;
      }) => void;

      onInvalid({ preventDefault, target: control });
      const movedForm = renderForm(products, { error: "invalid_reference" });
      const activePanel = findElement(movedForm, (candidate) => candidate.props.active === true);
      expect(activePanel?.props.index).toBe(3);
      expect(control.focus).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalledTimes(1);

      const alert = findElement(movedForm, (candidate) => candidate.props.role === "alert");
      expect(textContent(alert?.props.children)).toContain("直播關聯資料無效");

      onInvalid({ preventDefault, target: {} });
      expect(preventDefault).toHaveBeenCalledTimes(2);
    } finally {
      if (previousHTMLElement === undefined) delete globalScope.HTMLElement;
      else globalScope.HTMLElement = previousHTMLElement;
      if (previousRequestAnimationFrame === undefined) delete globalScope.requestAnimationFrame;
      else globalScope.requestAnimationFrame = previousRequestAnimationFrame;
    }
  });

  it("supports selecting and then removing a product from the preview", () => {
    const form = renderForm();
    const selection = productSelection(form);
    selection.props.onSelectionChange(products[0].id, true);
    selection.props.onSelectionChange(products[0].id, false);

    const preview = showPublishPreview(form);
    expect(preview).toContain("尚未選擇主打商品");
    expect(preview).not.toContain("亮白精華組");
  });

  it("renders every available media, form, template, script, and affiliate option", () => {
    const form = renderForm(products, {
      videos: [{ id: "video-1", title: "示範影片" }],
      forms: [{ id: "form-1", name: "活動報名表" }] as FormOverrides["forms"],
      templates: [
        { id: "template-1", name: "報名成功", channel: "email", trigger: "registration_confirmed" },
        { id: "template-2", name: "開播通知", channel: "email", trigger: "live_reminder" },
      ] as FormOverrides["templates"],
      scripts: [{ id: "script-1", name: "互動腳本" }] as FormOverrides["scripts"],
      affiliates: [{ id: "affiliate-1", code: "REF-1", name: "合作推廣者" }] as FormOverrides["affiliates"],
    });
    const markup = renderToStaticMarkup(form as ReactElement);

    expect(markup).toContain("示範影片");
    expect(markup).toContain("活動報名表");
    expect(markup).toContain("開播通知 · email");
    expect(markup).toContain("互動腳本");
    expect(markup).toContain("合作推廣者 · REF-1");
  });

  it("offers direct create links for every missing Studio resource", () => {
    const markup = renderToStaticMarkup(renderForm([]) as ReactElement);

    for (const href of ["/videos/new", "/products/new", "/forms/new", "/settings/brand", "/messages/templates/new", "/interaction-scripts/new"]) {
      expect(markup).toContain(`href="${href}"`);
    }
  });

  it("shows a readonly selected-script summary with an edit-timeline link", () => {
    const markup = renderToStaticMarkup(renderForm([], {
      scripts: [{ id: "script-1", name: "首波促購腳本" }] as FormOverrides["scripts"],
      initialValues: { ...emptyLiveStudioDraft(), interactionScriptId: "script-1", activeStep: 6 },
    }) as ReactElement);

    expect(markup).toContain("已選腳本");
    expect(markup).toContain("首波促購腳本");
    expect(markup).toContain("至互動腳本編輯時間軸");
    expect(markup).toContain('href="/interaction-scripts/script-1/edit"');
  });

  it("renders the final confirmation step and submit action", () => {
    const form = renderForm();
    const publishButton = stepButton(form, "桌機／手機預覽發布");
    expect(publishButton).toBeDefined();
    (publishButton?.props.onClick as () => void)();

    const reviewForm = renderForm();
    const markup = renderToStaticMarkup(reviewForm as ReactElement);
    expect(markup).toContain("確認直播間設定");
    expect(markup).toContain("桌機預覽");
    expect(markup).toContain("手機預覽");
    expect(markup).toContain("建立草稿並預覽");
    expect(markup).toContain('name="liveDraftRevision"');
    expect(findElement(reviewForm, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "上一步"
    ))?.props.disabled).toBe(false);
  });

  it("does not mark optional product, copy, hero, or script fields as pending for a complete content live", () => {
    const initialValues = {
      ...emptyLiveStudioDraft(),
      studioPreset: "CONTENT" as const,
      title: "內容場",
      slug: "content-live",
      scheduledAt: "2026-08-20T20:00",
      videoId: "video-1",
      formId: "form-1",
      messageTemplateId: "template-1",
      liveReminderTemplateId: "template-2",
      activeStep: 7,
    };
    const markup = renderToStaticMarkup(renderForm([], {
      initialValues,
      videos: [{ id: "video-1", title: "影片" }],
      forms: [{ id: "form-1", name: "報名頁" }] as FormOverrides["forms"],
      templates: [
        { id: "template-1", name: "報名信", channel: "email", trigger: "registration_confirmed" },
        { id: "template-2", name: "提醒信", channel: "email", trigger: "live_reminder" },
      ] as FormOverrides["templates"],
    }) as ReactElement);

    for (const label of ["用途與基本資料", "媒體與 Live Input", "商品優惠", "報名頁", "時間、回放與品牌", "Email", "留言、商品浮窗與 CTA", "桌機／手機預覽發布"]) {
      expect(textContent(stepButton(renderForm([], {
        initialValues,
        videos: [{ id: "video-1", title: "影片" }],
        forms: [{ id: "form-1", name: "報名頁" }] as FormOverrides["forms"],
        templates: [
          { id: "template-1", name: "報名信", channel: "email", trigger: "registration_confirmed" },
          { id: "template-2", name: "提醒信", channel: "email", trigger: "live_reminder" },
        ] as FormOverrides["templates"],
      }), label)?.props.children)).toContain("已完成");
    }
    expect(markup).not.toContain(">待完成<");
  });

  it("moves a readiness blocker to its exact step and focuses its control after render", () => {
    const initialValues = { ...emptyLiveStudioDraft(), activeStep: 7 };
    const form = renderForm([], { initialValues });
    const target = { focus: vi.fn() };
    const querySelector = vi.fn(() => target);
    hookState.refs[7].current = { querySelector };
    const review = findElement(form, (candidate) => typeof candidate.type === "function" && candidate.type.name === "LiveReviewPanel");
    const renderedReview = (review?.type as (props: Record<string, unknown>) => unknown)(review?.props ?? {});
    const fixMedia = findElement(renderedReview, (candidate) => candidate.type === "button" && textContent(candidate.props.children) === "前往媒體");

    (fixMedia?.props.onClick as () => void)();
    const moved = renderForm([], { initialValues });

    expect(findElement(moved, (candidate) => candidate.props.active === true)?.props.index).toBe(1);
    expect(querySelector).toHaveBeenCalledWith('[name="videoId"]');
    expect(target.focus).toHaveBeenCalledOnce();
  });

  it("offers separate draft and schedule submitters for a new complete content live", () => {
    const initialValues = {
      ...emptyLiveStudioDraft(),
      studioPreset: "CONTENT" as const,
      title: "內容研討會",
      slug: "content-webinar-new",
      scheduledAt: "2026-08-20T20:00",
      videoId: "video-1",
      formId: "form-1",
      messageTemplateId: "template-1",
      liveReminderTemplateId: "template-2",
      activeStep: 7,
    };
    const form = renderForm([], {
      initialValues,
      videos: [{ id: "video-1", title: "預錄影片" }],
      forms: [{ id: "form-1", name: "有效報名表" }] as FormOverrides["forms"],
      templates: [
        { id: "template-1", name: "報名成功", channel: "email", trigger: "registration_confirmed" },
        { id: "template-2", name: "開播提醒", channel: "email", trigger: "live_reminder" },
      ] as FormOverrides["templates"],
    });
    const draftButton = submitAction(form, "建立草稿並預覽");
    const scheduleButton = submitAction(form, "建立並排程");

    expect(draftButton?.props.name).toBe("status");
    expect(draftButton?.props.value).toBe("draft");
    expect(draftButton?.props.disabled).toBe(false);
    expect(scheduleButton?.props.name).toBe("status");
    expect(scheduleButton?.props.value).toBe("scheduled");
    expect(scheduleButton?.props.disabled).toBe(false);
  });

  it("updates reminder readiness immediately and gates only the schedule submitter", () => {
    const initialValues = {
      ...emptyLiveStudioDraft(),
      studioPreset: "CONTENT" as const,
      title: "待補提醒研討會",
      slug: "missing-reminder-webinar",
      scheduledAt: "2026-08-20T20:00",
      videoId: "video-1",
      formId: "form-1",
      messageTemplateId: "template-1",
      activeStep: 7,
    };
    const overrides: FormOverrides = {
      initialValues,
      videos: [{ id: "video-1", title: "預錄影片" }],
      forms: [{ id: "form-1", name: "有效報名表" }] as FormOverrides["forms"],
      templates: [
        { id: "template-1", name: "報名成功", channel: "email", trigger: "registration_confirmed" },
        { id: "template-2", name: "開播提醒", channel: "email", trigger: "live_reminder" },
      ] as FormOverrides["templates"],
    };
    const form = renderForm([], overrides);
    const draftButton = submitAction(form, "建立草稿並預覽");
    const blockedSchedule = submitAction(form, "建立並排程");
    expect(draftButton?.props.disabled).toBe(false);
    expect(blockedSchedule?.props.disabled).toBe(true);
    expect(renderToStaticMarkup(form as ReactElement)).toContain("可寄送的開播提醒 Email");

    selectControl(form, "liveReminderTemplateId").props.onChange({ target: { value: "template-2" } });
    const completedForm = renderForm([], overrides);
    expect(submitAction(completedForm, "建立並排程")?.props.disabled).toBe(false);
    expect(renderToStaticMarkup(completedForm as ReactElement)).toContain("發布條件已完成");
  });

  it("shows a complete sales-live checklist and enables scheduling", () => {
    const initialValues = {
      ...emptyLiveStudioDraft(),
      title: "新品銷售直播",
      slug: "new-sales-live",
      scheduledAt: "2026-08-10T20:00",
      productIds: [products[0].id],
      videoId: "video-1",
      formId: "form-1",
      messageTemplateId: "template-1",
      liveReminderTemplateId: "template-2",
      interactionScriptId: "script-1",
      activeStep: 7,
    };
    const form = renderForm(products, {
      liveId: "live-1",
      currentStatus: "draft",
      initialValues,
      videos: [{ id: "video-1", title: "可播放影片" }],
      forms: [{ id: "form-1", name: "有效報名表" }] as FormOverrides["forms"],
      templates: [
        { id: "template-1", name: "報名成功", channel: "email", trigger: "registration_confirmed" },
        { id: "template-2", name: "開播提醒", channel: "email", trigger: "live_reminder" },
      ] as FormOverrides["templates"],
      scripts: [{ id: "script-1", name: "已發布腳本" }] as FormOverrides["scripts"],
    });
    const markup = renderToStaticMarkup(form as ReactElement);
    const scheduleButton = submitAction(form, "排程發布");

    expect(markup).toContain("銷售型直播發布檢查");
    expect(markup).toContain("發布條件已完成");
    expect(markup).toContain("有效的報名表單");
    expect(scheduleButton?.props.disabled).toBe(false);
  });

  it("keeps sales publishing disabled and links each missing requirement to its step", () => {
    const initialValues = {
      ...emptyLiveStudioDraft(),
      title: "待補媒體直播",
      slug: "missing-media-live",
      scheduledAt: "2026-08-10T20:00",
      productIds: [products[0].id],
      formId: "form-1",
      messageTemplateId: "template-1",
      liveReminderTemplateId: "template-2",
      interactionScriptId: "script-1",
      activeStep: 7,
    };
    const form = renderForm(products, {
      liveId: "live-1",
      currentStatus: "draft",
      initialValues,
      forms: [{ id: "form-1", name: "有效報名表" }] as FormOverrides["forms"],
      templates: [
        { id: "template-1", name: "報名成功", channel: "email", trigger: "registration_confirmed" },
        { id: "template-2", name: "開播提醒", channel: "email", trigger: "live_reminder" },
      ] as FormOverrides["templates"],
      scripts: [{ id: "script-1", name: "已發布腳本" }] as FormOverrides["scripts"],
    });
    const markup = renderToStaticMarkup(form as ReactElement);
    const scheduleButton = submitAction(form, "排程發布");

    expect(markup).toContain("還有 1 項需要完成");
    expect(markup).toContain("待完成 · 可播放的影片或 Live Input");
    expect(markup).toContain("前往媒體");
    expect(scheduleButton?.props.disabled).toBe(true);
  });

  it("keeps content-live publishing simple and offers a recoverable unpublish action", () => {
    const initialValues = {
      ...emptyLiveStudioDraft(),
      title: "內容講座",
      slug: "content-webinar",
      scheduledAt: "2026-08-10T20:00",
      videoId: "video-1",
      productIds: [],
      formId: "form-1",
      messageTemplateId: "template-1",
      liveReminderTemplateId: "template-2",
      activeStep: 7,
    };
    const form = renderForm(products, {
      liveId: "live-1",
      currentStatus: "scheduled",
      initialValues,
      videos: [{ id: "video-1", title: "講座影片" }],
      forms: [{ id: "form-1", name: "有效報名表" }] as FormOverrides["forms"],
      templates: [
        { id: "template-1", name: "報名成功", channel: "email", trigger: "registration_confirmed" },
        { id: "template-2", name: "開播提醒", channel: "email", trigger: "live_reminder" },
      ] as FormOverrides["templates"],
    });
    const markup = renderToStaticMarkup(form as ReactElement);
    const unpublishButton = submitAction(form, "下架為草稿");

    expect(markup).toContain("內容直播發布檢查");
    expect(markup).toContain("發布條件已完成");
    expect(markup).toContain("有效的報名表單");
    expect(unpublishButton?.props.value).toBe("draft");
    expect(unpublishButton?.props.disabled).toBe(false);
  });

  it("flushes the newest form payload before allowing a fast final submit", async () => {
    draftMocks.isCurrentFormSaved.mockReturnValue(false);
    draftMocks.saveNow.mockResolvedValueOnce({ draftId: "draft-2", revision: 4 });
    const form = renderForm();
    const requestSubmit = vi.fn();
    const draftIdControl = { value: "draft-1" };
    const revisionControl = { value: "3" };
    const formRef = hookState.refs[7];
    formRef.current = {
      requestSubmit,
      elements: {
        namedItem: (name: string) => name === "liveDraftId" ? draftIdControl : revisionControl,
      },
    };
    const preventDefault = vi.fn();
    const previousButton = (globalThis as Record<string, unknown>).HTMLButtonElement;
    class SyntheticButton {
      name = "status";
      value = "scheduled";
    }
    const submitter = new SyntheticButton();
    (globalThis as Record<string, unknown>).HTMLButtonElement = SyntheticButton;

    try {
      (form.props.onSubmit as (event: unknown) => void)({
        preventDefault,
        nativeEvent: { submitter },
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(preventDefault).toHaveBeenCalledOnce();
      expect(draftMocks.saveNow).toHaveBeenCalledWith(0);
      expect(draftIdControl.value).toBe("draft-2");
      expect(revisionControl.value).toBe("4");
      expect(submitter.name).toBe("status");
      expect(submitter.value).toBe("scheduled");
      expect(requestSubmit).toHaveBeenCalledWith(submitter);
    } finally {
      if (previousButton === undefined) delete (globalThis as Record<string, unknown>).HTMLButtonElement;
      else (globalThis as Record<string, unknown>).HTMLButtonElement = previousButton;
    }
  });
});
