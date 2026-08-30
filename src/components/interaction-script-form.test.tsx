import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InteractionEvent, InteractionRole } from "@prisma/client";

const hookState = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
}));

const actionMocks = vi.hoisted(() => ({
  unbindInteractionScriptFromLiveAction: vi.fn(),
  upsertInteractionScriptAction: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();

  return {
    ...react,
    useMemo: <Value,>(factory: () => Value) => factory(),
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

vi.mock("@/app/actions", () => actionMocks);

import { InteractionScriptForm } from "./interaction-script-form";

type ElementNode = {
  type: unknown;
  props: Record<string, unknown>;
};

function isElementNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && "props" in value && "type" in value;
}

function findElements(value: unknown, predicate: (element: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(value)) return value.flatMap((child) => findElements(child, predicate));
  if (!isElementNode(value)) return [];

  return [
    ...(predicate(value) ? [value] : []),
    ...findElements(value.props.children, predicate),
  ];
}

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  return isElementNode(value) ? textContent(value.props.children) : "";
}

function role(overrides: Partial<InteractionRole> = {}): InteractionRole {
  return {
    id: "role-available",
    vendorId: "test-fixture-vendor-1",
    name: "可用排程角色",
    avatarUrl: null,
    label: "官方角色",
    roleType: "official",
    tone: null,
    isActive: true,
    isSimulated: true,
    isScheduled: true,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

function invalidRoleEvent(): InteractionEvent {
  return {
    id: "event-invalid-role",
    scriptId: "test-fixture-script-1",
    roleId: "removed-role",
    eventType: "chat_message",
    triggerSec: 5,
    title: "舊角色留言",
    message: "這則留言仍保留，但角色已失效。",
    productId: null,
    ctaLabel: null,
    ctaUrl: null,
    metadata: null,
    isSimulated: true,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  };
}

function renderForm({ roles = [], events = [] }: { roles?: InteractionRole[]; events?: InteractionEvent[] } = {}) {
  hookState.cursor = 0;
  return InteractionScriptForm({
    script: {
      id: "test-fixture-script-1",
      vendorId: "test-fixture-vendor-1",
      name: "測試留言組",
      description: null,
      status: "draft",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      events,
    },
    roles,
    products: [],
    boundLives: [{
      id: "test-fixture-live-1",
      vendorId: "test-fixture-vendor-1",
      videoId: null,
      formId: null,
      messageTemplateId: null,
      liveReminderTemplateId: null,
      liveReminderOffsetMinutes: 60,
      interactionScriptId: "test-fixture-script-1",
      teamId: null,
      seminarOwnerMembershipId: null,
      title: "七月新品直播",
      slug: "test-fixture-july-live",
      description: null,
      scheduledAt: new Date("2026-07-01T00:00:00.000Z"),
      status: "scheduled",
      startedAt: null,
      endedAt: null,
      replayAvailableUntil: null,
      heroImageUrl: null,
      heroImageAssetId: null,
      accentCopy: null,
      replayEnabled: true,
      streamMode: "vod",
      cloudflareLiveInputUid: null,
      quotaPolicy: null,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      video: null,
    }],
    csrfToken: "test-fixture-csrf-token",
  });
}

describe("InteractionScriptForm", () => {
  beforeEach(() => {
    hookState.cursor = 0;
    hookState.values = [];
    vi.unstubAllGlobals();
  });

  it("shows the bound live and submits its identifier to the unbind action after confirmation", () => {
    const form = renderForm();
    const boundLive = findElements(form, (candidate) => candidate.props["data-testid"] === "bound-live");
    const unbindButton = findElements(form, (candidate) => (
      candidate.props.formAction === actionMocks.unbindInteractionScriptFromLiveAction
    )).at(0);

    expect(textContent(boundLive)).toContain("七月新品直播");
    expect(unbindButton).toMatchObject({
      props: expect.objectContaining({
        type: "submit",
        name: "liveId",
        value: "test-fixture-live-1",
        "data-intent": "unbind-live",
        formAction: actionMocks.unbindInteractionScriptFromLiveAction,
        formNoValidate: true,
      }),
    });

    const confirm = vi.fn(() => true);
    const preventDefault = vi.fn();
    vi.stubGlobal("window", { confirm });
    (unbindButton?.props.onClick as (event: { preventDefault: () => void }) => void)({ preventDefault });

    expect(confirm).toHaveBeenCalledWith("確定要解除「七月新品直播」與此留言組的綁定嗎？");
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("does not submit the unbind action when confirmation is declined", () => {
    const form = renderForm();
    const unbindButton = findElements(form, (candidate) => (
      candidate.props.formAction === actionMocks.unbindInteractionScriptFromLiveAction
    )).at(0);
    const preventDefault = vi.fn();
    vi.stubGlobal("window", { confirm: vi.fn(() => false) });

    (unbindButton?.props.onClick as (event: { preventDefault: () => void }) => void)({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("makes the video and timeline outline scroll region keyboard-focusable", () => {
    const form = renderForm();
    const regions = findElements(form, (candidate) => (
      candidate.props.className === "min-h-0 flex-1 overflow-y-auto p-4"
      && findElements(candidate.props.children, (child) => (
        child.props["data-testid"] === "interaction-timeline-outline"
      )).length === 1
    ));

    expect(regions).toHaveLength(1);
    expect(regions[0]?.props).toMatchObject({
      role: "region",
      "aria-label": "綁定影片與時間點大綱",
      tabIndex: 0,
      className: "min-h-0 flex-1 overflow-y-auto p-4",
    });
    expect(findElements(regions[0]?.props.children, (child) => (
      child.props["data-testid"] === "interaction-timeline-outline"
    ))).toHaveLength(1);
  });
});

function renderNewForm(roles: InteractionRole[] = []) {
  hookState.cursor = 0;
  return InteractionScriptForm({
    roles,
    products: [{
      id: "test-product-1",
      vendorId: "test-fixture-vendor-1",
      name: "測試主打商品",
      slug: "test-product-1",
      description: null,
      priceCents: 128000,
      compareAtCents: null,
      currency: "TWD",
      imageUrl: null,
      imageAssetId: null,
      checkoutUrl: null,
      customCheckoutFields: null,
      inventory: 10,
      isActive: true,
      commerceDomain: "merchant",
      fulfillmentType: "physical",
      fulfillmentTypeConfirmed: true,
      courseContentOwnerMembershipId: null,
      coursePromoterShareBps: null,
      coursePolicyVersion: 1,
      revision: 1,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    }],
    csrfToken: "test-new-script-csrf-token",
  });
}

describe("InteractionScriptForm deterministic edit states", () => {
  beforeEach(() => {
    hookState.cursor = 0;
    hookState.values = [];
    vi.unstubAllGlobals();
  });

  it("renders the new-script templates and applies a template without a bound live", () => {
    const form = renderNewForm();
    expect(textContent(form)).toContain("常見互動腳本範本");
    expect(textContent(form)).toContain("尚未綁定直播");
    const templateButton = findElements(form, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "新品快閃"
    )).at(0);
    expect(templateButton).toBeDefined();
    (templateButton?.props.onClick as () => void)();

    const applied = renderNewForm();
    expect(findElements(applied, (candidate) => candidate.props["data-testid"] === "interaction-message-row")).toHaveLength(4);
    expect(textContent(findElements(applied, (candidate) => candidate.props["data-testid"] === "interaction-timeline-outline-time"))).toContain("00:00:05");
  });

  it("adds and removes a message while keeping the time validation state deterministic", () => {
    const form = renderNewForm();
    // The lightweight React test double keeps lazy initializers as values; seed the
    // deterministic clock array before exercising the append/remove handlers.
    hookState.values[1] = Array.from({ length: 5 }, () => "00:00:00");
    const addButton = findElements(form, (candidate) => (
      candidate.type === "button" && textContent(candidate.props.children) === "新增留言"
    )).at(0);
    expect(addButton).toBeDefined();
    (addButton?.props.onClick as () => void)();

    const added = renderNewForm();
    expect(findElements(added, (candidate) => candidate.props["data-testid"] === "interaction-message-row")).toHaveLength(6);
    const firstTimeInput = findElements(added, (candidate) => candidate.props["data-testid"] === "interaction-message-time").at(0);
    expect(firstTimeInput).toBeDefined();
    (firstTimeInput?.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "not-a-time" } });

    const invalid = renderNewForm();
    const invalidInput = findElements(invalid, (candidate) => candidate.props["data-testid"] === "interaction-message-time").at(0);
    expect(invalidInput?.props["aria-invalid"]).toBe(true);
    expect(findElements(invalid, (candidate) => candidate.props.id === "triggerSec-error-0")).toHaveLength(1);

    const deleteButton = findElements(invalid, (candidate) => (
      candidate.type === "button" && String(candidate.props["aria-label"] ?? "").startsWith("刪除第")
    )).at(0);
    expect(deleteButton).toBeDefined();
    (deleteButton?.props.onClick as () => void)();
    const removed = renderNewForm();
    expect(findElements(removed, (candidate) => candidate.props["data-testid"] === "interaction-message-row")).toHaveLength(5);
  });
});

describe("InteractionScriptForm scheduled role selection", () => {
  beforeEach(() => {
    hookState.cursor = 0;
    hookState.values = [];
    vi.unstubAllGlobals();
  });

  it("lists only active scheduled roles that can be normalized canonically", () => {
    const form = renderNewForm([
      role({ id: "role-available", name: "可用觀眾", roleType: "audience", isScheduled: true }),
      role({ id: "role-unscheduled", name: "未排程角色", isScheduled: false }),
      role({ id: "role-inactive", name: "停用角色", isActive: false }),
      role({ id: "role-unknown", name: "未知角色", roleType: "legacy-invalid" }),
      role({ id: "role-legacy", name: "已知舊主持", roleType: "ai_host" }),
    ]);
    const roleOptions = findElements(form, (candidate) => candidate.type === "option");

    expect(textContent(roleOptions)).toContain("可用觀眾");
    expect(textContent(roleOptions)).toContain("已知舊主持");
    expect(textContent(roleOptions)).not.toContain("未排程角色");
    expect(textContent(roleOptions)).not.toContain("停用角色");
    expect(textContent(roleOptions)).not.toContain("未知角色");
  });

  it("does not fall back to an official role when an existing message role is invalid", () => {
    const form = renderForm({
      roles: [role({ id: "role-available", name: "目前可用角色" })],
      events: [invalidRoleEvent()],
    });
    const roleSelect = findElements(form, (candidate) => candidate.type === "select" && candidate.props.name === "roleId").at(0);

    expect(roleSelect?.props.value).toBe("");
    expect(textContent(roleSelect)).toContain("原角色無效，請重新選擇");
    expect(textContent(form)).toContain("目前無法使用，請重新選擇排程角色");
    expect(textContent(form)).not.toContain("官方系統");
  });
});
