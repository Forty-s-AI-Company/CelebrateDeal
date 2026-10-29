// @vitest-environment happy-dom
import { act, Profiler, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveStudioDraftPayloadSchema, type LiveStudioDraftEnvelope, type LiveStudioDraftPayload } from "@/lib/live-studio-draft";

const mocks = vi.hoisted(() => ({
  upsertLiveAction: vi.fn(async (formData: FormData) => { void formData; }),
  saveLiveStudioDraft: vi.fn(),
}));

vi.mock("@/app/actions", () => ({ upsertLiveAction: mocks.upsertLiveAction }));
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
  flowVersion: 2,
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
  activeStep: 7,
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

function studio(initialDraft?: LiveStudioDraftEnvelope, extra: { liveId?: string; currentStatus?: string; error?: string } = {}) {
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
    expect(control('[data-step-index="7"]').hidden).toBe(false);
    // Round trip: what the restored form would save is exactly the saved draft.
    expect(serializeLiveStudioDraft(form, 7)).toEqual(reportedPayload);
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

  it("keeps the studio when a refresh only reports the revision it already saved", async () => {
    await act(async () => { root.render(studio(editDraft, { liveId: "live-1", currentStatus: "scheduled" })); });
    const title = control('[name="title"]');
    await act(async () => { button("立即儲存草稿").click(); });
    await settle();
    await act(async () => { root.render(studio({ ...editDraft, revision: 5 }, { liveId: "live-1", currentStatus: "scheduled" })); });

    expect(control('[name="title"]')).toBe(title);
  });
});
