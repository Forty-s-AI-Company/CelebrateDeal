import { beforeEach, describe, expect, it, vi } from "vitest";

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

function renderForm() {
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
      events: [],
    },
    roles: [],
    products: [],
    boundLives: [{
      id: "test-fixture-live-1",
      vendorId: "test-fixture-vendor-1",
      videoId: null,
      formId: null,
      messageTemplateId: null,
      interactionScriptId: "test-fixture-script-1",
      teamId: null,
      seminarOwnerMembershipId: null,
      title: "七月新品直播",
      slug: "test-fixture-july-live",
      description: null,
      scheduledAt: new Date("2026-07-01T00:00:00.000Z"),
      status: "scheduled",
      heroImageUrl: null,
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
      candidate.type === "button" && candidate.props.formAction === actionMocks.unbindInteractionScriptFromLiveAction
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
      candidate.type === "button" && candidate.props.formAction === actionMocks.unbindInteractionScriptFromLiveAction
    )).at(0);
    const preventDefault = vi.fn();
    vi.stubGlobal("window", { confirm: vi.fn(() => false) });

    (unbindButton?.props.onClick as (event: { preventDefault: () => void }) => void)({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
