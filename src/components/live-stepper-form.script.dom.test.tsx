// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLiveStudioDraft, type LiveStudioDraftPayload } from "@/lib/live-studio-draft";
import { liveStudioStepIndex } from "@/lib/live-studio-steps";

const mocks = vi.hoisted(() => ({
  upsertLiveAction: vi.fn(async (formData: FormData) => { void formData; }),
  saveLiveStudioDraft: vi.fn(),
  listLiveInteractionScriptsAction: vi.fn(),
}));

vi.mock("@/app/actions", () => ({ upsertLiveAction: mocks.upsertLiveAction }));
vi.mock("@/app/actions/live-resource-quick-create", () => ({
  createRegistrationFormQuickAction: vi.fn(),
  createMessageTemplateQuickAction: vi.fn(),
  createUrlVideoQuickAction: vi.fn(),
  createProductQuickAction: vi.fn(),
}));
vi.mock("@/app/actions/live-interaction-scripts", () => ({ listLiveInteractionScriptsAction: mocks.listLiveInteractionScriptsAction }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/components/media-upload-field", () => ({
  MediaUploadField: ({ defaultUrl, defaultAssetId }: { defaultUrl?: string; defaultAssetId?: string }) => (
    <>
      <input type="hidden" name="heroImageUrl" value={defaultUrl ?? ""} readOnly />
      <input type="hidden" name="heroImageAssetId" value={defaultAssetId ?? ""} readOnly />
    </>
  ),
}));
vi.mock("@/lib/live-studio-draft-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/live-studio-draft-client")>(),
  saveLiveStudioDraft: mocks.saveLiveStudioDraft,
}));

import { LiveStepperForm } from "./live-stepper-form";

const existing = { id: "script-existing", name: "既有腳本" };
const created = { id: "script-created", name: "新分頁建立的腳本" };
const another = { id: "script-another", name: "另一份腳本" };
const resources = {
  videos: [],
  products: [],
  forms: [],
  templates: [],
  affiliates: [],
  streamMembers: [],
  streamPages: [],
  csrfToken: "test-fixture-csrf-token",
  timeZone: "Asia/Taipei",
};
const salesStep = liveStudioStepIndex("sales");

let container: HTMLDivElement;
let root: Root;
let now = 1_000_000;

function studio(scripts: Array<{ id: string; name: string }>, initial: Partial<LiveStudioDraftPayload> = {}) {
  const initialValues: LiveStudioDraftPayload = { ...emptyLiveStudioDraft(), activeStep: salesStep, ...initial };
  return <LiveStepperForm {...resources} scripts={scripts} initialValues={initialValues} projectId="project-1" />;
}

function control<T extends Element = HTMLInputElement>(selector: string) {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

const scriptSelect = () => control<HTMLSelectElement>('select[name="interactionScriptId"]');
const optionIds = () => Array.from(scriptSelect().options).map((option) => option.value);
const scriptStatus = () => container.querySelector("[data-live-script-status]")?.textContent ?? "";

function button(label: string) {
  const match = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`missing button ${label}`);
  return match;
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
}

async function returnToTab(kind: "visibility" | "focus" = "visibility") {
  await act(async () => {
    if (kind === "visibility") {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    } else {
      window.dispatchEvent(new Event("focus"));
    }
  });
  await settle();
}

async function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
}

beforeEach(() => {
  vi.clearAllMocks();
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  window.history.replaceState({}, "", "/lives/new");
  mocks.saveLiveStudioDraft.mockImplementation(async (input: { draftId: string; revision: number | null; payload: LiveStudioDraftPayload }) => ({
    id: input.draftId || "draft-created",
    revision: (input.revision ?? 0) + 1,
    payload: input.payload,
    updatedAt: "2026-11-12T08:05:00.000Z",
    slugTaken: false,
    slugCheckFailed: false,
  }));
  mocks.listLiveInteractionScriptsAction.mockResolvedValue({ status: "success", scripts: [existing] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("LiveStepperForm 互動腳本 refresh", () => {
  it("opens the script editor in a new tab and says the list updates when the merchant returns", async () => {
    await act(async () => { root.render(studio([])); });

    const link = control<HTMLAnchorElement>('a[href="/interaction-scripts/new"]');
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener");
    expect(link.textContent).toContain("建立互動腳本");
    expect(link.textContent).toContain("另開新分頁");
    expect(document.getElementById(link.getAttribute("aria-describedby")!)?.textContent).toContain("清單會自動更新");
    expect(button("重新整理清單").getAttribute("type")).toBe("button");
    expect(mocks.listLiveInteractionScriptsAction).not.toHaveBeenCalled();
  });

  it("fetches again when the tab becomes visible, merges the new script and selects it when nothing was selected", async () => {
    await act(async () => { root.render(studio([existing])); });
    expect(optionIds()).toEqual(["", existing.id]);
    const form = control<HTMLFormElement>("form");
    mocks.listLiveInteractionScriptsAction.mockResolvedValue({ status: "success", scripts: [created, existing] });

    await returnToTab("visibility");

    expect(mocks.listLiveInteractionScriptsAction).toHaveBeenCalledOnce();
    const sent = mocks.listLiveInteractionScriptsAction.mock.calls[0]![0] as FormData;
    expect(sent.get("_csrf")).toBe("test-fixture-csrf-token");
    expect([...sent.keys()]).toEqual(["_csrf"]);
    expect(optionIds()).toEqual(["", created.id, existing.id]);
    expect(scriptSelect().value).toBe(created.id);
    expect(scriptStatus()).toContain("新分頁建立的腳本");
    expect(scriptStatus()).toContain("自動選取");
    // Same form element: the studio was not remounted.
    expect(control<HTMLFormElement>("form")).toBe(form);
  });

  it("also refreshes on window focus", async () => {
    await act(async () => { root.render(studio([])); });
    mocks.listLiveInteractionScriptsAction.mockResolvedValue({ status: "success", scripts: [created] });

    await returnToTab("focus");

    expect(optionIds()).toEqual(["", created.id]);
    expect(scriptSelect().value).toBe(created.id);
  });

  it("keeps the merchant's own choice and only announces the updated list", async () => {
    await act(async () => { root.render(studio([existing], { interactionScriptId: existing.id })); });
    expect(scriptSelect().value).toBe(existing.id);
    mocks.listLiveInteractionScriptsAction.mockResolvedValue({ status: "success", scripts: [created, existing] });

    await returnToTab();

    expect(optionIds()).toEqual(["", created.id, existing.id]);
    expect(scriptSelect().value).toBe(existing.id);
    expect(scriptStatus()).toContain("已更新清單");
    expect(scriptStatus()).toContain("目前選擇不變");
  });

  it("does not choose between several new scripts", async () => {
    await act(async () => { root.render(studio([existing])); });
    mocks.listLiveInteractionScriptsAction.mockResolvedValue({ status: "success", scripts: [created, another, existing] });

    await returnToTab();

    expect(optionIds()).toEqual(["", created.id, another.id, existing.id]);
    expect(scriptSelect().value).toBe("");
    expect(scriptStatus()).toContain("新增 2 個互動腳本");
  });

  it("merges without duplicating a script on later refreshes", async () => {
    await act(async () => { root.render(studio([existing])); });
    mocks.listLiveInteractionScriptsAction.mockResolvedValue({ status: "success", scripts: [created, existing] });
    await returnToTab();
    now += 6_000;

    await returnToTab("focus");

    expect(mocks.listLiveInteractionScriptsAction).toHaveBeenCalledTimes(2);
    expect(optionIds()).toEqual(["", created.id, existing.id]);
    // The script is already known, so nothing is announced or changed the second time.
    expect(scriptSelect().value).toBe(created.id);
  });

  it("refreshes at most once every five seconds on its own", async () => {
    await act(async () => { root.render(studio([existing])); });

    await returnToTab("visibility");
    await returnToTab("focus");
    now += 4_999;
    await returnToTab("visibility");
    expect(mocks.listLiveInteractionScriptsAction).toHaveBeenCalledTimes(1);

    now += 1;
    await returnToTab("focus");
    expect(mocks.listLiveInteractionScriptsAction).toHaveBeenCalledTimes(2);
  });

  it("does not refresh while the tab is hidden", async () => {
    await act(async () => { root.render(studio([existing])); });
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();

    expect(mocks.listLiveInteractionScriptsAction).not.toHaveBeenCalled();
  });

  it("keeps every typed field, the step and the draft when the list refreshes", async () => {
    await act(async () => { root.render(studio([existing], { title: "已命名的直播", accentCopy: "直播限定優惠" })); });
    const accent = control<HTMLInputElement>('input[name="accentCopy"]');
    await type(accent, "我剛打的促銷短句");
    const form = control<HTMLFormElement>("form");
    mocks.listLiveInteractionScriptsAction.mockResolvedValue({ status: "success", scripts: [created, existing] });

    await returnToTab();

    expect(control<HTMLFormElement>("form")).toBe(form);
    expect(control<HTMLInputElement>('input[name="accentCopy"]')).toBe(accent);
    expect(accent.value).toBe("我剛打的促銷短句");
    expect(control<HTMLInputElement>('input[name="title"]').value).toBe("已命名的直播");
    expect(container.querySelector('[data-step-key="sales"]')?.hasAttribute("hidden")).toBe(false);
  });

  it("saves the draft after a script is selected automatically", async () => {
    await act(async () => { root.render(studio([existing])); });
    mocks.listLiveInteractionScriptsAction.mockResolvedValue({ status: "success", scripts: [created, existing] });

    await returnToTab();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)); });
    await settle();

    expect(mocks.saveLiveStudioDraft).toHaveBeenCalled();
    const payload = mocks.saveLiveStudioDraft.mock.calls.at(-1)![0].payload as LiveStudioDraftPayload;
    expect(payload.interactionScriptId).toBe(created.id);
  });

  it("stays quiet and keeps the form working when an automatic refresh fails", async () => {
    await act(async () => { root.render(studio([existing], { interactionScriptId: existing.id })); });
    mocks.listLiveInteractionScriptsAction.mockRejectedValueOnce(new Error("network down"));

    await returnToTab();

    expect(scriptStatus()).toBe("");
    expect(optionIds()).toEqual(["", existing.id]);
    expect(scriptSelect().value).toBe(existing.id);

    now += 6_000;
    mocks.listLiveInteractionScriptsAction.mockResolvedValueOnce({ status: "error" });
    await returnToTab("focus");
    expect(scriptStatus()).toBe("");
    expect(scriptSelect().value).toBe(existing.id);
  });

  it("refreshes from the keyboard-operable button even inside the throttle window, and reports failures only there", async () => {
    await act(async () => { root.render(studio([existing])); });
    await returnToTab();
    expect(mocks.listLiveInteractionScriptsAction).toHaveBeenCalledTimes(1);

    const refresh = button("重新整理清單");
    await act(async () => { refresh.click(); });
    await settle();
    expect(mocks.listLiveInteractionScriptsAction).toHaveBeenCalledTimes(2);
    expect(scriptStatus()).toBe("已更新清單，沒有新的互動腳本。");

    mocks.listLiveInteractionScriptsAction.mockResolvedValueOnce({ status: "error" });
    await act(async () => { button("重新整理清單").click(); });
    await settle();
    expect(scriptStatus()).toContain("暫時無法更新");
    expect(button("重新整理清單").disabled).toBe(false);
  });

  it("ignores a second refresh while one is still in flight", async () => {
    await act(async () => { root.render(studio([existing])); });
    let resolve!: (value: unknown) => void;
    mocks.listLiveInteractionScriptsAction.mockReturnValueOnce(new Promise((done) => { resolve = done; }));

    await act(async () => { button("重新整理清單").click(); });
    expect(button("更新中…").disabled).toBe(true);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(mocks.listLiveInteractionScriptsAction).toHaveBeenCalledTimes(1);

    await act(async () => { resolve({ status: "success", scripts: [existing] }); });
    await settle();
    expect(button("重新整理清單").disabled).toBe(false);
  });
});
