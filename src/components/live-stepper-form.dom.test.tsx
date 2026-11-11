// @vitest-environment happy-dom
import { act, Profiler, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveStudioDraftPayloadSchema, parseStoredLiveStudioDraft, type LiveStudioDraftEnvelope, type LiveStudioDraftPayload } from "@/lib/live-studio-draft";
import { LIVE_STUDIO_LAST_STEP_INDEX, liveStudioStepIndex } from "@/lib/live-studio-steps";

const mocks = vi.hoisted(() => ({
  upsertLiveAction: vi.fn(async (formData: FormData) => { void formData; }),
  saveLiveStudioDraft: vi.fn(),
  createRegistrationFormQuickAction: vi.fn(),
  createMessageTemplateQuickAction: vi.fn(),
}));

vi.mock("@/app/actions", () => ({ upsertLiveAction: mocks.upsertLiveAction }));
vi.mock("@/app/actions/live-resource-quick-create", () => ({
  createRegistrationFormQuickAction: mocks.createRegistrationFormQuickAction,
  createMessageTemplateQuickAction: mocks.createMessageTemplateQuickAction,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/components/media-upload-field", () => ({
  MediaUploadField: ({ defaultUrl, defaultAssetId }: { defaultUrl: string; defaultAssetId: string }) => (
    <>
      <input type="hidden" name="heroImageUrl" value={defaultUrl} readOnly />
      <input type="hidden" name="heroImageAssetId" value={defaultAssetId} readOnly />
    </>
  ),
}));
vi.mock("@/lib/live-studio-draft-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/live-studio-draft-client")>(),
  saveLiveStudioDraft: mocks.saveLiveStudioDraft,
}));

import { LiveStepperForm } from "./live-stepper-form";
import { serializeLiveStudioDraft } from "@/lib/live-studio-draft-client";

const resources = {
  videos: [{ id: "video-cf-3341", title: "原型食物講座（33:41）" }],
  products: [{ id: "product-whole-food", name: "原型食物餐盒", inventory: 20 }],
  forms: [{ id: "form-signup", name: "講座報名表" }],
  templates: [{ id: "template-confirmed", name: "報名成功信", channel: "email", trigger: "registration_confirmed" }],
  scripts: [{ id: "script-13-events", name: "13 事件互動腳本" }],
  affiliates: [],
  streamMembers: [],
  streamPages: [],
  csrfToken: "test-fixture-csrf-token",
  timeZone: "Asia/Taipei",
};

/** The staging state from 2026-10-29: every select, checkbox, slug and replay deadline filled. */
const reportedPayload: LiveStudioDraftPayload = LiveStudioDraftPayloadSchema.parse({
  flowVersion: 3,
  title: "我吃原型食物就好!?",
  slug: "whole-food-live",
  description: "原型食物入門。",
  streamMode: "vod",
  videoId: "video-cf-3341",
  productIds: ["product-whole-food"],
  accentCopy: "直播限定優惠",
  formId: "form-signup",
  messageTemplateId: "template-confirmed",
  interactionScriptId: "script-13-events",
  scheduledAt: "2026-10-29T20:00",
  replayEnabled: true,
  replayAvailableUntil: "2026-11-15T23:59",
  customAllocations: "[]",
  memberQuotas: "[]",
  pageQuotas: "[]",
  activeStep: LIVE_STUDIO_LAST_STEP_INDEX,
});

const resumedDraft: LiveStudioDraftEnvelope = {
  id: "draft-resumed",
  revision: 2,
  payload: reportedPayload,
  updatedAt: "2026-10-29T08:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;
let commits = 0;

function studio(initialDraft?: LiveStudioDraftEnvelope, extra: { liveId?: string; currentStatus?: string; error?: string; invalidField?: string } = {}) {
  return (
    <Profiler id="live-studio" onRender={() => { commits += 1; }}>
      <LiveStepperForm {...resources} initialDraft={initialDraft} {...extra} />
    </Profiler>
  );
}

function control<T extends Element = HTMLInputElement>(selector: string) {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

function button(label: string, scope: ParentNode = container) {
  const match = Array.from(scope.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`missing button ${label}`);
  return match;
}

/** Sets a value the way typing does, so React's value tracker sees the change. */
async function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
}

/** The nearest inert element at or above `element`, as the browser's inert subtree would apply. */
function inertAncestor(element: Element) {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if ((node as HTMLElement).inert) return node;
  }
  return null;
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  commits = 0;
  window.history.replaceState({}, "", "/lives/new");
  mocks.saveLiveStudioDraft.mockImplementation(async (input: { draftId: string; revision: number | null; payload: LiveStudioDraftPayload }) => ({
    id: input.draftId || "draft-created",
    revision: (input.revision ?? 0) + 1,
    payload: input.payload,
    updatedAt: "2026-10-29T08:05:00.000Z",
    slugTaken: false,
    slugCheckFailed: false,
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe("LiveStepperForm draft resume", () => {
  it("restores every field when 繼續這份草稿 navigates the blank studio to a saved draft", async () => {
    await act(async () => { root.render(studio()); });
    // Same client root, new server props: what a same-route Link navigation does.
    await act(async () => { root.render(studio(resumedDraft)); });
    const form = control<HTMLFormElement>("form");

    expect(control('[name="title"]').value).toBe("我吃原型食物就好!?");
    expect(control('[name="slug"]').value).toBe("whole-food-live");
    expect(control<HTMLSelectElement>('select[name="videoId"]').value).toBe("video-cf-3341");
    expect(control('input[name="productIds"]').checked).toBe(true);
    expect(control<HTMLSelectElement>('select[name="formId"]').value).toBe("form-signup");
    expect(control<HTMLSelectElement>('select[name="messageTemplateId"]').value).toBe("template-confirmed");
    expect(control<HTMLSelectElement>('select[name="interactionScriptId"]').value).toBe("script-13-events");
    expect(control('input[type="datetime-local"][name="replayAvailableUntil"]').value).toBe("2026-11-15T23:59");
    expect(control('[name="liveDraftId"]').value).toBe("draft-resumed");
    expect(control('[name="liveDraftRevision"]').value).toBe("2");
    expect(control('[data-step-key="publish"]').hidden).toBe(false);
    // Round trip: what the restored form would save is exactly the saved draft.
    expect(serializeLiveStudioDraft(form, LIVE_STUDIO_LAST_STEP_INDEX)).toEqual(reportedPayload);
  });

  it("saves a resumed draft into its existing row instead of creating another draft", async () => {
    await act(async () => { root.render(studio()); });
    await act(async () => { root.render(studio(resumedDraft)); });

    await act(async () => { button("立即儲存草稿").click(); });
    await settle();

    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledTimes(1);
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: "draft-resumed", revision: 2 }));
    expect(control('[name="liveDraftRevision"]').value).toBe("3");
  });

  it("keeps the in-progress studio when the URL only catches up with its own autosaved draft", async () => {
    await act(async () => { root.render(studio()); });
    const title = control('[name="title"]');
    await type(title, "我吃原型食物就好!?");
    await act(async () => { button("立即儲存草稿").click(); });
    await settle();
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: "", revision: null }));
    expect(window.location.search).toBe("?draft=draft-created");

    const saved = mocks.saveLiveStudioDraft.mock.calls[0]![0] as { payload: LiveStudioDraftPayload };
    await act(async () => {
      root.render(studio({ id: "draft-created", revision: 1, payload: saved.payload, updatedAt: "2026-10-29T08:05:00.000Z" }));
    });

    expect(control('[name="title"]')).toBe(title);
    expect(control('[name="liveDraftId"]').value).toBe("draft-created");
  });
});

/** A row saved by the eight-step (v2) studio, as the resume pages hand it over. */
function versionTwoDraft(activeStep: number): LiveStudioDraftEnvelope {
  const stored = { ...reportedPayload, flowVersion: 2, activeStep };
  const parsed = parseStoredLiveStudioDraft(stored);
  if (!parsed) throw new Error("v2 fixture must parse");
  return { id: "draft-v2", revision: 7, payload: parsed.payload, updatedAt: "2026-10-29T08:00:00.000Z", storedPayloadOutdated: parsed.outdated };
}

function advancedSettings(step: string) {
  return control<HTMLDetailsElement>(`details[data-advanced-settings="${step}"]`);
}

describe("LiveStepperForm eight-step (v2) draft resume", () => {
  it("resumes a v2 draft saved on its Email step on the 通知 step with every field restored", async () => {
    await act(async () => { root.render(studio(versionTwoDraft(5))); });

    expect(control('[data-step-key="notifications"]').hidden).toBe(false);
    expect(control('[data-step-key="content"]').hidden).toBe(true);
    expect(control('button[aria-controls="live-step-panel-notifications"]').getAttribute("aria-current")).toBe("step");
    expect(control<HTMLSelectElement>('select[name="messageTemplateId"]').value).toBe("template-confirmed");
    expect(control('[name="flowVersion"]').value).toBe("3");
    expect(serializeLiveStudioDraft(control<HTMLFormElement>("form"), liveStudioStepIndex("notifications")))
      .toEqual({ ...reportedPayload, activeStep: liveStudioStepIndex("notifications") });
  });

  it("re-saves the v2 row as v3 before its publish claim, then submits once", async () => {
    await act(async () => { root.render(studio(versionTwoDraft(7))); });
    expect(control('[data-step-key="publish"]').hidden).toBe(false);

    await act(async () => { button("建立並排程").click(); });
    await act(async () => { button("確認建立並排程", control('[role="alertdialog"]')).click(); });
    await settle();

    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledTimes(1);
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({
      draftId: "draft-v2",
      revision: 7,
      payload: { ...reportedPayload, flowVersion: 3, activeStep: LIVE_STUDIO_LAST_STEP_INDEX },
    }));
    expect(mocks.upsertLiveAction).toHaveBeenCalledTimes(1);
    const submitted = mocks.upsertLiveAction.mock.calls[0]![0];
    expect(submitted.get("status")).toBe("scheduled");
    expect(submitted.get("liveDraftId")).toBe("draft-v2");
    expect(submitted.get("liveDraftRevision")).toBe("8");
  });
});

describe("LiveStepperForm advanced settings", () => {
  it("keeps 進階設定 collapsed by default and still submits its fields", async () => {
    await act(async () => { root.render(studio(resumedDraft)); });

    expect(advancedSettings("content").open).toBe(false);
    expect(advancedSettings("sales").open).toBe(false);
    expect(advancedSettings("content").contains(control('[name="slug"]'))).toBe(true);
    expect(advancedSettings("content").contains(control('[name="description"]'))).toBe(true);
    expect(advancedSettings("sales").contains(control('[name="maxConcurrentViewers"]'))).toBe(true);
    const data = new FormData(control<HTMLFormElement>("form"));
    expect(data.get("slug")).toBe("whole-food-live");
    expect(data.get("description")).toBe("原型食物入門。");
    expect(data.get("affiliateMode")).toBe("enabled");
  });

  it("opens the collapsed section and focuses the field when browser validation rejects it", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
    await act(async () => { root.render(studio(resumedDraft)); });
    const viewers = control('[name="maxConcurrentViewers"]');
    expect(advancedSettings("sales").open).toBe(false);

    await act(async () => { viewers.dispatchEvent(new Event("invalid", { cancelable: true })); });

    expect(control('[data-step-key="sales"]').hidden).toBe(false);
    expect(advancedSettings("sales").open).toBe(true);
    expect(advancedSettings("content").open).toBe(false);
    expect(document.activeElement).toBe(viewers);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("請先完成本步驟的必填欄位，再繼續下一步。");
  });

  it("opens the section that holds a field the server rejected and moves to its step", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
    await act(async () => { root.render(studio(resumedDraft, { error: "invalid_draft", invalidField: "description" })); });
    const description = control<HTMLTextAreaElement>('[name="description"]');

    expect(control('[data-step-key="content"]').hidden).toBe(false);
    expect(advancedSettings("content").open).toBe(true);
    expect(description.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(description);
    expect(control('[role="alert"]').textContent).toContain("直播說明");
  });

  it("focuses the visible replay deadline, not its hidden fallback, when the server rejects it", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
    await act(async () => { root.render(studio(resumedDraft, { error: "invalid_draft", invalidField: "replayAvailableUntil" })); });
    // Two controls share the name, so namedItem returns a RadioNodeList.
    expect(container.querySelectorAll('[name="replayAvailableUntil"]')).toHaveLength(2);
    const deadline = control('input[type="datetime-local"][name="replayAvailableUntil"]');
    const fallback = control('input[type="hidden"][name="replayAvailableUntil"]');

    expect(control('[data-step-key="content"]').hidden).toBe(false);
    expect(control('[data-step-key="publish"]').hidden).toBe(true);
    expect(advancedSettings("content").open).toBe(true);
    expect(deadline.getAttribute("aria-invalid")).toBe("true");
    expect(deadline.getAttribute("aria-describedby")).toBe("live-form-error");
    expect(fallback.hasAttribute("aria-invalid")).toBe(false);
    expect(document.activeElement).toBe(deadline);
    expect(control('[role="alert"]').textContent).toContain("回放");
  });

  it("does not move the studio when no control with the rejected name is editable", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
    const replayOff = { ...resumedDraft, payload: { ...reportedPayload, replayEnabled: false, replayAvailableUntil: "" } };
    await act(async () => { root.render(studio(replayOff, { error: "invalid_draft", invalidField: "replayAvailableUntil" })); });

    expect(control('input[type="datetime-local"][name="replayAvailableUntil"]').disabled).toBe(true);
    expect(control('[data-step-key="publish"]').hidden).toBe(false);
    expect(advancedSettings("content").open).toBe(false);
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
  });

  it("opens the address section when the address is already taken", async () => {
    await act(async () => { root.render(studio(resumedDraft, { error: "slug_taken" })); });

    expect(advancedSettings("content").open).toBe(true);
    expect(advancedSettings("sales").open).toBe(false);
  });
});

describe("LiveStepperForm leaving with an unsaved edit", () => {
  it("saves the newest edit when a 新增… link replaces the studio before the autosave fires", async () => {
    await act(async () => { root.render(studio(resumedDraft)); });
    await type(control('[name="title"]'), "離開前改的標題");
    expect(mocks.saveLiveStudioDraft).not.toHaveBeenCalled();

    // A client navigation (e.g. 「新增商品」) unmounts the studio inside the same document.
    await act(async () => { root.render(<main>新增商品頁</main>); });
    await settle();

    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledTimes(1);
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({
      draftId: "draft-resumed",
      revision: 2,
      payload: expect.objectContaining({ title: "離開前改的標題", activeStep: reportedPayload.activeStep }),
    }));
  });

  it("does not rewrite the next page's URL when the flushed create draft finishes", async () => {
    await act(async () => { root.render(studio()); });
    await type(control('[name="title"]'), "尚未建立的草稿");
    window.history.replaceState({}, "", "/products/new");
    await act(async () => { root.render(<main>新增商品頁</main>); });
    await settle();

    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledTimes(1);
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: "", revision: null }));
    expect(window.location.pathname).toBe("/products/new");
    expect(window.location.search).toBe("");
  });

  it("flushes the pending edit when the page is hidden and does not save it twice", async () => {
    await act(async () => { root.render(studio(resumedDraft)); });
    await type(control('[name="accentCopy"]'), "切換分頁前的優惠");
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    await settle();

    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledTimes(1);
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({
      keepalive: true,
      payload: expect.objectContaining({ accentCopy: "切換分頁前的優惠" }),
    }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)); });
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledTimes(1);
  });
});

describe("LiveStepperForm publish submit", () => {
  it("schedules the reported state once, with an in-page confirmation and a bounded number of renders", async () => {
    const nativeConfirm = vi.fn(() => true);
    vi.stubGlobal("confirm", nativeConfirm);
    await act(async () => { root.render(studio(resumedDraft)); });
    const mountedCommits = commits;

    await act(async () => { button("建立並排程").click(); });
    const dialog = control('[role="alertdialog"]');
    expect(dialog.textContent).toContain("確定要建立並排程這場直播嗎？");
    expect(nativeConfirm).not.toHaveBeenCalled();

    await act(async () => { button("確認建立並排程", dialog).click(); });
    await settle();

    expect(mocks.upsertLiveAction).toHaveBeenCalledTimes(1);
    expect(mocks.saveLiveStudioDraft).not.toHaveBeenCalled();
    const submitted = mocks.upsertLiveAction.mock.calls[0]![0];
    expect(submitted.get("status")).toBe("scheduled");
    expect(submitted.get("liveDraftId")).toBe("draft-resumed");
    expect(submitted.get("liveDraftRevision")).toBe("2");
    expect(submitted.getAll("productIds")).toEqual(["product-whole-food"]);
    expect(submitted.get("videoId")).toBe("video-cf-3341");
    expect(submitted.get("interactionScriptId")).toBe("script-13-events");
    expect(submitted.get("replayAvailableUntil")).toBe("2026-11-15T23:59");
    expect(nativeConfirm).not.toHaveBeenCalled();
    // A render/effect loop would commit without bound; a submit needs a handful.
    expect(commits - mountedCommits).toBeLessThan(15);
  });

  it("flushes a change the autosave has not seen once and then submits once", async () => {
    await act(async () => { root.render(studio(resumedDraft)); });
    // No input/change event (e.g. autofill): the draft still reads as saved,
    // so only the submit-time comparison can notice and flush it.
    control('[name="accentCopy"]').value = "最後一秒改的優惠";

    await act(async () => { button("建立並排程").click(); });
    const dialog = control('[role="alertdialog"]');
    await act(async () => { button("確認建立並排程", dialog).click(); });
    await settle();

    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledTimes(1);
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({
      draftId: "draft-resumed",
      revision: 2,
      payload: expect.objectContaining({ accentCopy: "最後一秒改的優惠" }),
    }));
    expect(mocks.upsertLiveAction).toHaveBeenCalledTimes(1);
    const submitted = mocks.upsertLiveAction.mock.calls[0]![0];
    expect(submitted.get("status")).toBe("scheduled");
    expect(submitted.get("liveDraftRevision")).toBe("3");
    expect(submitted.get("accentCopy")).toBe("最後一秒改的優惠");
  });

  it("does not submit when the confirmation is cancelled", async () => {
    await act(async () => { root.render(studio(resumedDraft)); });
    await act(async () => { button("建立並排程").click(); });
    await act(async () => { button("取消", control('[role="alertdialog"]')).click(); });
    await settle();

    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.upsertLiveAction).not.toHaveBeenCalled();
    expect(mocks.saveLiveStudioDraft).not.toHaveBeenCalled();
  });

  it("ignores a double click on the confirmation while the draft is still saving", async () => {
    let finishSave!: () => void;
    mocks.saveLiveStudioDraft.mockImplementationOnce((input: { draftId: string; revision: number; payload: LiveStudioDraftPayload }) => new Promise((resolve) => {
      finishSave = () => resolve({ id: input.draftId, revision: input.revision + 1, payload: input.payload, updatedAt: "2026-10-29T08:06:00.000Z", slugTaken: false, slugCheckFailed: false });
    }));
    await act(async () => { root.render(studio(resumedDraft)); });
    control('[name="accentCopy"]').value = "雙擊前的優惠";
    await act(async () => { button("建立並排程").click(); });
    const dialog = control('[role="alertdialog"]');
    const confirm = button("確認建立並排程", dialog);

    await act(async () => { confirm.click(); });
    await act(async () => { confirm.click(); });
    await act(async () => { confirm.click(); });
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledTimes(1);
    await act(async () => { finishSave(); });
    await settle();

    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledTimes(1);
    expect(mocks.upsertLiveAction).toHaveBeenCalledTimes(1);
    expect(mocks.upsertLiveAction.mock.calls[0]![0].get("status")).toBe("scheduled");
    expect(mocks.upsertLiveAction.mock.calls[0]![0].get("liveDraftRevision")).toBe("3");
  });

  it("does not submit when the confirmation is cancelled while the draft is saving", async () => {
    let finishSave!: () => void;
    mocks.saveLiveStudioDraft.mockImplementationOnce((input: { draftId: string; revision: number; payload: LiveStudioDraftPayload }) => new Promise((resolve) => {
      finishSave = () => resolve({ id: input.draftId, revision: input.revision + 1, payload: input.payload, updatedAt: "2026-10-29T08:06:00.000Z", slugTaken: false, slugCheckFailed: false });
    }));
    await act(async () => { root.render(studio(resumedDraft)); });
    control('[name="accentCopy"]').value = "取消前的優惠";
    await act(async () => { button("建立並排程").click(); });
    const dialog = control('[role="alertdialog"]');
    await act(async () => { button("確認建立並排程", dialog).click(); });
    await act(async () => { button("取消", dialog).click(); });
    await act(async () => { finishSave(); });
    await settle();

    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledTimes(1);
    expect(mocks.upsertLiveAction).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("locks the form while the submit is pending so late edits are not overwritten", async () => {
    let finishAction!: () => void;
    mocks.upsertLiveAction.mockImplementationOnce(() => new Promise<void>((resolve) => { finishAction = resolve; }));
    await act(async () => { root.render(studio(resumedDraft)); });
    const form = control<HTMLFormElement>("form");
    await act(async () => { button("建立並排程").click(); });
    await act(async () => { button("確認建立並排程", control('[role="alertdialog"]')).click(); });
    await settle();
    expect(form.getAttribute("aria-busy")).toBe("true");
    // The studio is locked, but the confirmation inside the form stays reachable.
    const dialog = control('[role="alertdialog"]');
    expect(inertAncestor(dialog)).toBeNull();
    expect(inertAncestor(control('[name="title"]'))).not.toBeNull();
    expect(inertAncestor(button("建立並排程"))).not.toBeNull();

    await act(async () => { finishAction(); });
    await settle();
    expect(inertAncestor(control('[name="title"]'))).toBeNull();
    expect(Array.from(container.querySelectorAll("*")).some((element) => (element as HTMLElement).inert)).toBe(false);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("keeps the pending announcement and draft status outside the inert area, and returns focus to the trigger", async () => {
    let finishAction!: () => void;
    mocks.upsertLiveAction.mockImplementationOnce(() => new Promise<void>((resolve) => { finishAction = resolve; }));
    const inertAtFocus: Array<{ target: Element; inert: boolean }> = [];
    const realFocus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      inertAtFocus.push({ target: this, inert: inertAncestor(this) !== null });
      realFocus.call(this, options);
    });
    await act(async () => { root.render(studio(resumedDraft)); });
    const trigger = button("建立並排程");
    trigger.focus();
    await act(async () => { trigger.click(); });
    await act(async () => { button("確認建立並排程", control('[role="alertdialog"]')).click(); });
    await settle();

    const statuses = Array.from(container.querySelectorAll('[role="status"]'));
    expect(statuses.some((status) => status.textContent === "正在建立並排程直播間，請勿重複送出。")).toBe(true);
    expect(statuses.length).toBeGreaterThanOrEqual(2);
    for (const status of statuses) expect(inertAncestor(status)).toBeNull();

    inertAtFocus.length = 0;
    await act(async () => { finishAction(); });
    await settle();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    // Focus is returned only after the studio is no longer inert.
    expect(inertAtFocus.filter((entry) => entry.target === trigger).map((entry) => entry.inert)).toEqual([false]);
  });

  it("closes the confirmation when the draft save before submit hits a conflict", async () => {
    const { LiveStudioDraftClientError } = await import("@/lib/live-studio-draft-client");
    mocks.saveLiveStudioDraft.mockRejectedValueOnce(new LiveStudioDraftClientError("draft_conflict"));
    await act(async () => { root.render(studio(resumedDraft)); });
    control('[name="accentCopy"]').value = "衝突前的優惠";
    await act(async () => { button("建立並排程").click(); });
    await act(async () => { button("確認建立並排程", control('[role="alertdialog"]')).click(); });
    await settle();

    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.upsertLiveAction).not.toHaveBeenCalled();
    expect(button("以我的覆蓋")).toBeTruthy();
  });

  it("starts on the safe choice when the confirmation opens", async () => {
    await act(async () => { root.render(studio(resumedDraft)); });
    await act(async () => { button("建立並排程").click(); });
    expect(document.activeElement).toBe(button("取消", control('[role="alertdialog"]')));
  });
});

describe("LiveStepperForm edit page status actions", () => {
  const editDraft: LiveStudioDraftEnvelope = { ...resumedDraft, id: "draft-edit", revision: 4 };

  it("does not leave the next status action confirmed after 開始直播 redirects to the same page", async () => {
    await act(async () => { root.render(studio(editDraft, { liveId: "live-1", currentStatus: "scheduled" })); });
    await act(async () => { button("開始直播").click(); });
    await act(async () => { button("確認開始直播", control('[role="alertdialog"]')).click(); });
    await settle();
    expect(mocks.upsertLiveAction).toHaveBeenCalledTimes(1);
    expect(mocks.upsertLiveAction.mock.calls[0]![0].get("status")).toBe("live");

    // The server committed the draft (revision 5) and re-rendered /lives/live-1/edit.
    await act(async () => { root.render(studio({ ...editDraft, revision: 5 }, { liveId: "live-1", currentStatus: "live" })); });

    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(button("結束直播").disabled).toBe(false);
    expect(control('[name="liveDraftRevision"]').value).toBe("5");
    expect(mocks.upsertLiveAction).toHaveBeenCalledTimes(1);
  });

  it("closes the confirmation once a submit settles even when the server props are unchanged", async () => {
    const props = { liveId: "live-1", currentStatus: "scheduled", error: "slug_taken" };
    await act(async () => { root.render(studio(editDraft, props)); });
    await act(async () => { button("開始直播").click(); });
    await act(async () => { button("確認開始直播", control('[role="alertdialog"]')).click(); });
    await settle();
    // Same error again: identical props, so the studio is not remounted.
    await act(async () => { root.render(studio(editDraft, props)); });

    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("adopts a newer server revision so the next autosave does not conflict", async () => {
    await act(async () => { root.render(studio(editDraft, { liveId: "live-1", currentStatus: "scheduled" })); });
    await act(async () => { root.render(studio({ ...editDraft, revision: 6 }, { liveId: "live-1", currentStatus: "scheduled" })); });
    await act(async () => { button("立即儲存草稿").click(); });
    await settle();

    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: "draft-edit", revision: 6 }));
  });

  it("keeps unsaved edits when an external newer revision of the same draft arrives", async () => {
    const props = { liveId: "live-1", currentStatus: "scheduled" };
    await act(async () => { root.render(studio(editDraft, props)); });
    const title = control('[name="title"]');
    await type(title, "尚未儲存的新標題");

    await act(async () => { root.render(studio({ ...editDraft, revision: 6 }, props)); });

    expect(control('[name="title"]')).toBe(title);
    expect(control('[name="title"]').value).toBe("尚未儲存的新標題");
    // The external revision is not adopted: the next save compares against what
    // this studio last saw, so the server reports a conflict instead of a silent overwrite.
    await act(async () => { button("立即儲存草稿").click(); });
    await settle();
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: "draft-edit", revision: 4 }));
  });

  it("shows a new submit error without dropping unsaved edits", async () => {
    const props = { liveId: "live-1", currentStatus: "scheduled" };
    await act(async () => { root.render(studio(editDraft, props)); });
    const title = control('[name="title"]');
    await type(title, "尚未儲存的新標題");

    // evergreen-webinar-actions redirects to /lives/{id}/edit?error=...
    await act(async () => { root.render(studio(editDraft, { ...props, error: "invalid_evergreen_settings" })); });

    expect(control('[name="title"]')).toBe(title);
    expect(control('[name="title"]').value).toBe("尚未儲存的新標題");

    // A message the studio itself renders shows up without a remount as well.
    await act(async () => { root.render(studio(editDraft, { ...props, error: "slug_taken" })); });
    expect(control('[name="title"]')).toBe(title);
    expect(control('[role="alert"]').textContent).toContain("直播網址已被使用");

    // Error and another admin's revision together: still no remount, no adoption.
    await act(async () => { root.render(studio({ ...editDraft, revision: 9 }, { ...props, error: "invalid_evergreen_settings" })); });
    expect(control('[name="title"]')).toBe(title);
    expect(control('[name="liveDraftRevision"]').value).toBe("4");
  });

  it("still remounts for an external revision once nothing is unsaved", async () => {
    const props = { liveId: "live-1", currentStatus: "scheduled" };
    await act(async () => { root.render(studio(editDraft, props)); });
    const title = control('[name="title"]');
    await act(async () => { root.render(studio({ ...editDraft, revision: 6 }, props)); });

    expect(control('[name="title"]')).not.toBe(title);
    expect(control('[name="liveDraftRevision"]').value).toBe("6");
  });

  it("keeps the same studio and its unsaved value when a revalidated edit page hands over a newer revision", async () => {
    const props = { liveId: "live-1", currentStatus: "scheduled" };
    await act(async () => { root.render(studio(editDraft, props)); });
    const studioForm = control<HTMLFormElement>("form");
    const accent = control('[name="accentCopy"]');
    await type(accent, "尚未儲存的優惠文案");

    // What revalidatePath on /lives/live-1/edit re-renders: same draft, newer revision.
    await act(async () => { root.render(studio({ ...editDraft, revision: 7 }, props)); });

    expect(control<HTMLFormElement>("form")).toBe(studioForm);
    expect(control('[name="accentCopy"]')).toBe(accent);
    expect(control('[name="accentCopy"]').value).toBe("尚未儲存的優惠文案");
    expect(control('[name="liveDraftRevision"]').value).toBe("4");
  });

  it("keeps the studio when a refresh only reports the revision it already saved", async () => {
    await act(async () => { root.render(studio(editDraft, { liveId: "live-1", currentStatus: "scheduled" })); });
    const title = control('[name="title"]');
    await act(async () => { button("立即儲存草稿").click(); });
    await settle();
    await act(async () => { root.render(studio({ ...editDraft, revision: 5 }, { liveId: "live-1", currentStatus: "scheduled" })); });

    expect(control('[name="title"]')).toBe(title);
  });
});

describe("LiveStepperForm 就地建立 drawers", () => {
  function emptyStudio(overrides: { forms?: typeof resources.forms; templates?: typeof resources.templates; projectId?: string | null } = {}) {
    return (
      <LiveStepperForm {...resources} forms={overrides.forms ?? []} templates={overrides.templates ?? []} projectId={overrides.projectId ?? "project-1"} />
    );
  }

  function dialog() {
    return document.body.querySelector<HTMLElement>('[role="dialog"]');
  }

  function drawerControl<T extends Element = HTMLInputElement>(selector: string) {
    const element = dialog()?.querySelector<T>(selector);
    if (!element) throw new Error(`missing drawer ${selector}`);
    return element;
  }

  async function submitDrawer() {
    const drawerForm = drawerControl<HTMLFormElement>("form");
    await act(async () => { drawerForm.requestSubmit(); });
    await settle();
  }

  /** Lets the studio's 700 ms autosave debounce run, if anything scheduled it. */
  async function waitForAutosaveWindow() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)); });
    await settle();
  }

  it("creates a registration form in the drawer without touching the studio form, then selects and saves it", async () => {
    await act(async () => { root.render(emptyStudio()); });
    const studioForm = control<HTMLFormElement>("form");
    const statusBefore = container.querySelector('[role="status"][aria-live="polite"]:not([data-live-resource-status])')?.textContent;
    const trigger = button("新增報名表");
    trigger.focus();
    await act(async () => { trigger.click(); });

    const drawer = dialog();
    expect(drawer).not.toBeNull();
    expect(drawer!.getAttribute("aria-modal")).toBe("true");
    expect(studioForm.contains(drawer)).toBe(false);
    expect(document.activeElement).toBe(drawerControl('[name="name"]'));

    await type(drawerControl('[name="name"]'), "週五講座報名表");
    await type(drawerControl('[name="headline"]'), "週五講座");
    // The drawer's fields never reach the studio's FormData or its autosave.
    const studioData = new FormData(studioForm);
    expect(studioData.has("headline")).toBe(false);
    expect([...studioData.values()]).not.toContain("週五講座報名表");

    mocks.createRegistrationFormQuickAction.mockResolvedValueOnce({ status: "error", message: "有幾個欄位需要調整；內容仍保留在畫面上。", fieldErrors: { headline: "公開標題不可超過 200 個字。" } });
    await submitDrawer();
    expect(dialog()).not.toBeNull();
    expect(drawerControl('[name="headline"]').getAttribute("aria-invalid")).toBe("true");
    expect(dialog()!.textContent).toContain("公開標題不可超過 200 個字。");
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toContain("有幾個欄位需要調整");
    expect(document.activeElement).toBe(drawerControl('[name="headline"]'));
    await waitForAutosaveWindow();
    expect(mocks.saveLiveStudioDraft).not.toHaveBeenCalled();
    expect(mocks.upsertLiveAction).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"][aria-live="polite"]:not([data-live-resource-status])')?.textContent).toBe(statusBefore);

    const sent = mocks.createRegistrationFormQuickAction.mock.calls[0]![0] as FormData;
    expect(sent.get("_csrf")).toBe("test-fixture-csrf-token");
    expect(sent.get("projectId")).toBe("project-1");

    mocks.createRegistrationFormQuickAction.mockResolvedValueOnce({ status: "success", option: { id: "form-quick", name: "週五講座報名表" } });
    await submitDrawer();
    await waitForAutosaveWindow();

    expect(dialog()).toBeNull();
    const select = control<HTMLSelectElement>('select[name="formId"]');
    expect(select.value).toBe("form-quick");
    expect(document.activeElement).toBe(select);
    expect(container.querySelector("[data-live-resource-status]")?.textContent).toBe("已建立並選取報名表「週五講座報名表」。");
    expect(serializeLiveStudioDraft(studioForm, liveStudioStepIndex("content")).formId).toBe("form-quick");
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledTimes(1);
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ formId: "form-quick" }) }));
    expect(mocks.upsertLiveAction).not.toHaveBeenCalled();
  });

  it("keeps an option it created when the server props refresh without it", async () => {
    await act(async () => { root.render(emptyStudio()); });
    await act(async () => { button("新增報名表").click(); });
    await type(drawerControl('[name="name"]'), "週五講座報名表");
    await type(drawerControl('[name="headline"]'), "週五講座");
    mocks.createRegistrationFormQuickAction.mockResolvedValueOnce({ status: "success", option: { id: "form-quick", name: "週五講座報名表" } });
    await submitDrawer();
    const select = control<HTMLSelectElement>('select[name="formId"]');

    await act(async () => { root.render(emptyStudio({ forms: [{ id: "form-other", name: "其他表單" }] })); });

    expect(control<HTMLSelectElement>('select[name="formId"]')).toBe(select);
    expect(select.value).toBe("form-quick");
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["", "form-quick", "form-other"]);
  });

  it("closes on Escape and the close button, returns focus to the trigger and never opens while the studio submits", async () => {
    await act(async () => { root.render(emptyStudio()); });
    const trigger = button("新增報名表");
    trigger.focus();
    await act(async () => { trigger.click(); });
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => {
      drawerControl('[name="name"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");

    await act(async () => { trigger.click(); });
    await act(async () => { drawerControl<HTMLButtonElement>('button[aria-label="關閉"]').click(); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);

    control<HTMLFormElement>("form").setAttribute("aria-busy", "true");
    await act(async () => { trigger.click(); });
    expect(dialog()).toBeNull();
  });

  it("creates the registration Email and a reminder template, selecting one and enabling the other's rules", async () => {
    await act(async () => { root.render(emptyStudio()); });
    const studioForm = control<HTMLFormElement>("form");
    const addBeforeLive = control<HTMLButtonElement>('[data-notification-add="before_live"]');
    expect(addBeforeLive.disabled).toBe(true);

    await act(async () => { button("建立報名成功 Email").click(); });
    expect(dialog()?.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.getElementById(dialog()!.getAttribute("aria-labelledby")!)?.textContent).toBe("建立報名成功 Email");
    expect(drawerControl('[name="trigger"]').value).toBe("registration_confirmed");
    expect(new FormData(studioForm).has("subject")).toBe(false);
    mocks.createMessageTemplateQuickAction.mockResolvedValueOnce({ status: "success", option: { id: "template-quick", name: "報名成功通知", channel: "email", trigger: "registration_confirmed" } });
    await submitDrawer();

    const registrationSelect = control<HTMLSelectElement>('select[name="messageTemplateId"]');
    expect(registrationSelect.value).toBe("template-quick");
    expect(document.activeElement).toBe(registrationSelect);
    expect(serializeLiveStudioDraft(studioForm, liveStudioStepIndex("notifications")).messageTemplateId).toBe("template-quick");

    const createReminder = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === "建立開播提醒 Email");
    await act(async () => { createReminder!.click(); });
    expect(drawerControl('[name="trigger"]').value).toBe("live_reminder");
    mocks.createMessageTemplateQuickAction.mockResolvedValueOnce({ status: "success", option: { id: "template-reminder", name: "開播提醒", channel: "email", trigger: "live_reminder" } });
    await submitDrawer();

    expect(dialog()).toBeNull();
    expect(addBeforeLive.disabled).toBe(false);
    expect(document.activeElement).toBe(addBeforeLive);
    expect(control<HTMLButtonElement>('[data-notification-add="during_live"]').disabled).toBe(false);
    expect(control<HTMLButtonElement>('[data-notification-add="post_live_followup"]').disabled).toBe(true);
    expect(container.querySelector("[data-live-resource-status]")?.textContent).toContain("現在可以新增通知規則");
    expect(mocks.upsertLiveAction).not.toHaveBeenCalled();
  });

  it("leaves focus on the new select when an earlier commit's effects flush before the drawer closes", async () => {
    // Real scheduler (no act) so a transition commit can leave its passive effects
    // pending while the create result arrives; that is the order a slow browser run hit.
    let onRefreshCommit: (() => void) | null = null;
    const tree = (forms: typeof resources.forms) => (
      <Profiler id="refresh" onRender={() => onRefreshCommit?.()}>{emptyStudio({ forms })}</Profiler>
    );
    await act(async () => { root.render(tree([])); });
    const trigger = button("新增報名表");
    trigger.focus();
    await act(async () => { trigger.click(); });
    await type(drawerControl('[name="name"]'), "週五講座報名表");
    await type(drawerControl('[name="headline"]'), "週五講座");
    let release!: () => void;
    mocks.createRegistrationFormQuickAction.mockReturnValueOnce(new Promise((resolve) => {
      release = () => resolve({ status: "success", option: { id: "form-quick", name: "週五講座報名表" } });
    }));
    await submitDrawer();
    expect(dialog()).not.toBeNull();

    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    try {
      // The create revalidation commits first; its result reaches the studio right after, before that commit's effects ran.
      onRefreshCommit = () => { onRefreshCommit = null; release(); };
      root.render(tree([{ id: "form-other", name: "其他表單" }]));
      await vi.waitFor(() => {
        expect(dialog()).toBeNull();
        expect(container.querySelector("[data-live-resource-status]")?.textContent).toContain("已建立並選取報名表");
      });
      const select = control<HTMLSelectElement>('select[name="formId"]');
      await vi.waitFor(() => expect(document.activeElement).toBe(select));
      // Nothing moves it back to the trigger afterwards.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(document.activeElement).toBe(select);
    } finally {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    }
  });

  describe("while a create is in flight", () => {
    const contentPayload = LiveStudioDraftPayloadSchema.parse({
      ...reportedPayload,
      formId: "",
      messageTemplateId: "",
      activeStep: liveStudioStepIndex("content"),
    });
    const draftEnvelope: LiveStudioDraftEnvelope = { id: "draft-edit", revision: 4, payload: contentPayload, updatedAt: "2026-10-29T08:00:00.000Z" };
    const editProps = { liveId: "live-1", currentStatus: "scheduled" };

    function draftStudio(revision: number, forms: typeof resources.forms = []) {
      return <LiveStepperForm {...resources} forms={forms} templates={[]} projectId="project-1" initialDraft={{ ...draftEnvelope, revision }} {...editProps} />;
    }

    async function startFormCreate() {
      await act(async () => { button("新增報名表").click(); });
      await type(drawerControl('[name="name"]'), "週五講座報名表");
      await type(drawerControl('[name="headline"]'), "週五講座");
      await act(async () => { drawerControl<HTMLFormElement>("form").requestSubmit(); });
      await settle();
    }

    it("does not remount the studio when the create's revalidation brings a newer draft revision, then selects the new form", async () => {
      let finishCreate!: (result: unknown) => void;
      mocks.createRegistrationFormQuickAction.mockImplementationOnce(() => new Promise((resolve) => { finishCreate = resolve; }));
      await act(async () => { root.render(draftStudio(4)); });
      const studioForm = control<HTMLFormElement>("form");
      const title = control('[name="title"]');
      await startFormCreate();
      expect(drawerControl('button[aria-label="關閉"]').hasAttribute("disabled")).toBe(true);

      // The action's revalidatePath re-renders the edit page with the newer revision.
      await act(async () => { root.render(draftStudio(6)); });
      expect(control<HTMLFormElement>("form")).toBe(studioForm);
      expect(control('[name="title"]')).toBe(title);

      await act(async () => { finishCreate({ status: "success", option: { id: "form-quick", name: "週五講座報名表" } }); });
      await settle();
      await waitForAutosaveWindow();

      expect(dialog()).toBeNull();
      expect(control<HTMLFormElement>("form")).toBe(studioForm);
      expect(control<HTMLSelectElement>('select[name="formId"]').value).toBe("form-quick");
      // The newer revision is not adopted, so the save reports a conflict instead of overwriting.
      expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({
        draftId: "draft-edit",
        revision: 4,
        payload: expect.objectContaining({ formId: "form-quick" }),
      }));
    });

    it("lets a newer revision remount again once the create failed and nothing is unsaved", async () => {
      mocks.createRegistrationFormQuickAction.mockResolvedValueOnce({ status: "error", message: "有幾個欄位需要調整；內容仍保留在畫面上。", fieldErrors: { headline: "公開標題不可超過 200 個字。" } });
      await act(async () => { root.render(draftStudio(4)); });
      const studioForm = control<HTMLFormElement>("form");
      await startFormCreate();
      expect(dialog()).not.toBeNull();

      await act(async () => { root.render(draftStudio(6)); });

      expect(control<HTMLFormElement>("form")).not.toBe(studioForm);
    });

    it("says it cannot confirm the create when the action throws, and keeps the drawer open", async () => {
      mocks.createRegistrationFormQuickAction.mockRejectedValueOnce(new Error("network down"));
      await act(async () => { root.render(emptyStudio()); });
      await startFormCreate();

      const alert = dialog()!.querySelector('[role="alert"]')!.textContent!;
      expect(alert).toContain("無法確認是否已建立");
      expect(alert).toContain("重新整理頁面確認清單");
      expect(alert).not.toContain("沒有建立任何資料");
      expect(dialog()).not.toBeNull();
      expect(drawerControl('button[aria-label="關閉"]').hasAttribute("disabled")).toBe(false);
    });
  });

  it("opens the 直播中 group's template drawer with copy for a stream that is already live, still bound to live_reminder", async () => {
    await act(async () => { root.render(emptyStudio()); });
    const duringLive = control<HTMLFieldSetElement>('[data-notification-add="during_live"]').closest("fieldset")!;
    await act(async () => { button("建立直播中通知 Email", duringLive).click(); });

    expect(document.getElementById(dialog()!.getAttribute("aria-labelledby")!)?.textContent).toBe("建立直播中通知 Email");
    expect(drawerControl('[name="trigger"]').value).toBe("live_reminder");
    expect(drawerControl('[name="name"]').value).toBe("直播中通知");
    expect(drawerControl('[name="subject"]').value).toBe("{{live_title}} 正在直播中");
    expect(drawerControl('[name="body"]').value).toContain("正在直播中");
    expect(drawerControl('[name="body"]').value).not.toContain("即將開始");

    mocks.createMessageTemplateQuickAction.mockResolvedValueOnce({ status: "success", option: { id: "template-live", name: "直播中通知", channel: "email", trigger: "live_reminder" } });
    await submitDrawer();
    expect((mocks.createMessageTemplateQuickAction.mock.calls[0]![0] as FormData).get("trigger")).toBe("live_reminder");
    expect(dialog()).toBeNull();
    expect(control<HTMLButtonElement>('[data-notification-add="during_live"]').disabled).toBe(false);
    expect(document.activeElement).toBe(control('[data-notification-add="during_live"]'));
  });

  it("keeps the before-live group's drawer on the reminder copy", async () => {
    await act(async () => { root.render(emptyStudio()); });
    const beforeLive = control('[data-notification-add="before_live"]').closest("fieldset")!;
    await act(async () => { button("建立開播提醒 Email", beforeLive).click(); });

    expect(drawerControl('[name="subject"]').value).toBe("{{live_title}} 即將開始");
  });

  it("links to the full editors in a new tab", async () => {
    await act(async () => { root.render(emptyStudio()); });
    for (const href of ["/forms/new", "/messages/templates/new"]) {
      const link = control<HTMLAnchorElement>(`a[href="${href}"]`);
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener");
    }
  });
});
